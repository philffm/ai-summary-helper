#!/usr/bin/env node
// scripts/translate.mjs
//
// Content-change-tracked, market-adapted translation pipeline.
//
// What it does, in order:
//   1. Reads i18n/locales.json for the list of source files and target locales.
//   2. Hashes each source (English) file's full contents (sha256). This is
//      the "version" — simple, unambiguous, auditable with `sha256sum` or
//      `git log` on the file directly. A locale is stale whenever its
//      recorded hash in i18n/manifest.json no longer matches.
//   3. For stale (file, locale) pairs: extracts translatable strings with
//      cheerio (text nodes outside <script>/<style>, <title>, meta
//      description/og tags, alt text), sends them to OpenRouter in one
//      batched request per locale with market-adaptation notes from
//      locales.json, and reinjects the translated strings back into a
//      clone of the DOM.
//   4. Rewrites the one class of path that needs it: references to the
//      shared /assets/ folder (styles.css, main.js, icon.svg — kept
//      un-duplicated across locales) get one extra "../" since the
//      translated file now lives one directory level deeper. Internal
//      content links (index <-> blog) are untouched — the whole content
//      tree is mirrored as a unit per locale, so those relationships hold.
//   5. Adds hreflang alternate tags so search engines understand the
//      locale relationship.
//   6. Writes the translated file to {locale}/{originalPath} and updates
//      the manifest with the source hash it was translated against, the
//      timestamp, and the model used — full audit trail, on top of
//      whatever git itself already tracks for every commit to these files.
//
// Usage:
//   node scripts/translate.mjs                 # real run, needs OPENROUTER_API_KEY
//   node scripts/translate.mjs --dry-run        # no API calls, mock translations
//   node scripts/translate.mjs --locale=fr      # only this locale
//   node scripts/translate.mjs --file=index.html  # only this source file

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import * as cheerio from 'cheerio';

const REPO_ROOT = process.cwd();
const ROOT = path.join(REPO_ROOT, 'docs'); // docs/ is assembled by build-site.mjs and is the canonical English source
const CONFIG_PATH = path.join(ROOT, 'i18n', 'locales.json');
const MANIFEST_PATH = path.join(ROOT, 'i18n', 'manifest.json');
const OPENROUTER_MODEL = process.env.OPENROUTER_MODEL || 'google/gemini-3.7-flash';
const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const ONLY_LOCALE = (args.find(a => a.startsWith('--locale=')) || '').split('=')[1] || null;
const ONLY_FILE = (args.find(a => a.startsWith('--file=')) || '').split('=')[1] || null;

// ── Utilities ────────────────────────────────────────────────────────

function sha256(text) {
    return crypto.createHash('sha256').update(text, 'utf8').digest('hex');
}

async function loadJson(p) {
    return JSON.parse(await readFile(p, 'utf8'));
}

async function saveJson(p, data) {
    await writeFile(p, JSON.stringify(data, null, 2) + '\n', 'utf8');
}

async function ensureDir(filePath) {
    await mkdir(path.dirname(filePath), { recursive: true });
}

// ── Extraction ───────────────────────────────────────────────────────

const SKIP_TAGS = new Set(['script', 'style', 'noscript']);

/**
 * Pulls every translatable string out of a page: body text nodes, <title>,
 * meta description/og:title/og:description content attributes, and alt
 * attributes. Each gets a stable id so the LLM's response can be mapped
 * back onto the exact same node.
 */
function extractUnits($) {
    const units = [];
    let counter = 0;
    const nextId = (prefix) => `${prefix}${counter++}`;

    // <title>
    const $title = $('head > title');
    if ($title.length && $title.text().trim()) {
        units.push({ id: nextId('title'), text: $title.text().trim(), kind: 'title' });
    }

    // <meta name="description"> and og:title / og:description
    $('head meta').each((_, el) => {
        const $el = $(el);
        const name = $el.attr('name');
        const prop = $el.attr('property');
        const isDescription = name === 'description';
        const isOg = prop === 'og:title' || prop === 'og:description';
        if ((isDescription || isOg) && $el.attr('content')?.trim()) {
            units.push({ id: nextId('meta'), text: $el.attr('content').trim(), kind: 'meta', selectorHint: name || prop });
        }
    });

    // Body text nodes, skipping script/style/noscript and opt-outs.
    $('body *').not(Array.from(SKIP_TAGS).join(',')).each((_, el) => {
        const $el = $(el);
        if ($el.closest('[data-no-translate]').length) return;
        $el.contents().each((__, node) => {
            if (node.type !== 'text') return;
            const text = node.data;
            if (!text || !text.trim()) return;
            const id = nextId('t');
            node.__aishId = id; // tag the live node so we can find it again on injection
            units.push({ id, text: text.trim(), kind: 'text', leading: text.match(/^\s*/)[0], trailing: text.match(/\s*$/)[0] });
        });
    });

    // alt attributes on <img>
    $('img[alt]').each((_, el) => {
        const $el = $(el);
        const alt = $el.attr('alt');
        if (alt && alt.trim()) {
            const id = nextId('alt');
            $el.attr('data-aish-alt-id', id);
            units.push({ id, text: alt.trim(), kind: 'alt' });
        }
    });

    return units;
}

/**
 * Applies translated { id -> text } back onto a fresh parse of the same
 * source HTML (re-extracting so the __aishId tags line up with this
 * specific DOM instance).
 */
function injectUnits($, units, translations) {
    const byId = new Map(units.map(u => [u.id, u]));

    // title
    const titleUnit = units.find(u => u.kind === 'title');
    if (titleUnit && translations[titleUnit.id]) {
        $('head > title').text(translations[titleUnit.id]);
    }

    // meta
    units.filter(u => u.kind === 'meta').forEach(u => {
        if (!translations[u.id]) return;
        const sel = u.selectorHint.startsWith('og:')
            ? `head meta[property="${u.selectorHint}"]`
            : `head meta[name="${u.selectorHint}"]`;
        $(sel).attr('content', translations[u.id]);
    });

    // body text — re-walk in the same order extraction used, so __aishId
    // tags (set during this same extraction pass) match up.
    $('body *').not(Array.from(SKIP_TAGS).join(',')).each((_, el) => {
        const $el = $(el);
        $el.contents().each((__, node) => {
            if (node.type !== 'text' || !node.__aishId) return;
            const unit = byId.get(node.__aishId);
            if (!unit || !translations[unit.id]) return;
            node.data = `${unit.leading}${translations[unit.id]}${unit.trailing}`;
        });
    });

    // alt text
    $('img[data-aish-alt-id]').each((_, el) => {
        const $el = $(el);
        const id = $el.attr('data-aish-alt-id');
        if (translations[id]) $el.attr('alt', translations[id]);
        $el.removeAttr('data-aish-alt-id');
    });
}

// ── Path rewriting for the locale directory depth shift ────────────────

/**
 * Only references to the shared /assets/ folder need adjusting — it isn't
 * duplicated per locale. Every other internal link (index <-> blog) keeps
 * working unchanged because the whole content tree is mirrored as a unit
 * under each locale folder.
 *
 * The extra depth to add is the number of path segments in the locale's
 * own directory (e.g. locale.dir "lang/fr" is 2 segments deep), NOT a
 * hardcoded single "../" — docs/ is the actual GitHub Pages web root, so
 * docs/lang/fr/index.html is served at /lang/fr/index.html (2 levels
 * under root) and docs/lang/fr/blog/index.html at /lang/fr/blog/... (3
 * levels). A flat "add one ../" undercounts by exactly (segments - 1)
 * for every locale, which is why every translated page's assets/ links
 * were broken.
 */
function rewriteAssetPaths($, locale) {
    const extraUps = '../'.repeat(locale.dir.split('/').length);
    $('[href], [src]').each((_, el) => {
        const $el = $(el);
        for (const attr of ['href', 'src']) {
            const val = $el.attr(attr);
            if (!val) continue;
            if (/^(https?:)?\/\//.test(val) || val.startsWith('#') || val.startsWith('mailto:')) continue;
            if (val.includes('assets/')) {
                $el.attr(attr, extraUps + val);
            }
        }
    });
}

/** SEO: point search engines at the sibling-locale versions of this page. */
function addHreflangTags($, config, currentLocaleCode, relPath) {
    const head = $('head');
    // Remove any stale hreflang tags from a previous run before adding fresh ones.
    $('link[rel="alternate"][hreflang]').remove();

    const entry = (hreflang, href) => `<link rel="alternate" hreflang="${hreflang}" href="${href}">`;
    const base = 'https://ai-summary-helper.byphil.eu';

    head.append(entry('x-default', `${base}/${relPath}`));
    head.append(entry('en', `${base}/${relPath}`));
    for (const [code, loc] of Object.entries(config.locales)) {
        head.append(entry(loc.hreflang, `${base}/${loc.dir}/${relPath}`));
    }
}

/**
 * Sets the <html lang> attribute to the target locale's BCP-47 code so the
 * translated page is correctly identified for SEO and screen readers. The
 * English source always carries lang="en"; without this, every translated
 * page would keep claiming to be English.
 */
function setHtmlLang($, locale) {
    const html = $('html');
    if (html.length) html.attr('lang', locale.hreflang);
}

// ── OpenRouter call ──────────────────────────────────────────────────

async function translateUnits(units, locale, apiKey) {
    if (DRY_RUN) {
        // Mock: wrap each string so a dry run is visibly distinguishable
        // from a real translation, without needing network access.
        const out = {};
        for (const u of units) out[u.id] = `[${locale.hreflang}] ${u.text}`;
        return out;
    }

    const system = `You are a professional translator and market localizer. Translate the given UI/content strings from English into ${locale.name}. This is not just literal translation — adapt tone, examples, and framing for the target market using the notes below. Preserve any HTML entities, emoji, and inline formatting markers exactly. Do not translate proper nouns, product/feature names given in backticks, or URLs. Return ONLY a JSON object mapping each input id to its translated string — no other text, no markdown fences.

Market adaptation notes for ${locale.name}:
${locale.marketNotes}`;

    const user = JSON.stringify(
        units.map(u => ({ id: u.id, text: u.text, kind: u.kind })),
        null, 2
    );

    const res = await fetch(OPENROUTER_URL, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`,
            'HTTP-Referer': 'https://ai-summary-helper.byphil.eu',
            'X-Title': 'AI Summary Helper i18n pipeline'
        },
        body: JSON.stringify({
            model: OPENROUTER_MODEL,
            messages: [
                { role: 'system', content: system },
                { role: 'user', content: user }
            ],
            temperature: 0.3,
            response_format: { type: 'json_object' }
        })
    });

    if (!res.ok) {
        throw new Error(`OpenRouter request failed: ${res.status} ${await res.text()}`);
    }

    const data = await res.json();
    const raw = data.choices?.[0]?.message?.content;
    if (!raw) throw new Error('OpenRouter response had no content');

    let parsed;
    try {
        parsed = JSON.parse(raw);
    } catch (e) {
        throw new Error(`OpenRouter response was not valid JSON: ${raw.slice(0, 300)}`);
    }
    return parsed;
}

// ── Main ─────────────────────────────────────────────────────────────

// ── String-level cache (content-addressed) ─────────────────────────────
//
// Staleness used to be tracked per FILE: any edit anywhere on a page
// (even shared nav/footer text used on every page) re-translated the
// entire page hash-to-hash. Now every extracted string is cached under
// the sha256 of its own English text, per locale. Two consequences:
//   1. Editing one sentence only re-translates that one string — not
//      every page that happens to contain it.
//   2. Identical strings (e.g. nav/footer text repeated across every
//      page via site-src/partials/) are translated ONCE per locale and
//      reused everywhere, including across different source files in
//      the same run.
// Rebuilding the output HTML itself is always cheap (no LLM call), so a
// file is always re-rendered even when every one of its strings was a
// cache hit — that keeps structural changes (new markup from
// build-site.mjs) flowing through without needing their own staleness
// tracking.

function stringKey(text) {
    return sha256(text);
}

async function translateFile(relPath, config, targetLocales, manifest, apiKey) {
    const srcPath = path.join(ROOT, relPath);
    const srcContent = await readFile(srcPath, 'utf8');

    let anyApiCallsThisFile = false;

    for (const [code, locale] of Object.entries(targetLocales)) {
        if (!locale) continue;

        const $ = cheerio.load(srcContent, { decodeEntities: false });
        const units = extractUnits($);

        // Split into cache hits (already translated for this locale) and
        // units that actually need an API call.
        const cached = {};
        const missing = [];
        for (const u of units) {
            const key = stringKey(u.text);
            const entry = manifest.strings[key];
            const hit = entry?.translations?.[code];
            if (hit) {
                cached[u.id] = hit.text;
            } else {
                missing.push(u);
            }
        }

        let fresh = {};
        if (missing.length > 0) {
            console.log(`translate  ${relPath} [${code}] — ${missing.length}/${units.length} new string(s)${DRY_RUN ? ' (dry run)' : ''}`);
            fresh = await translateUnits(missing, locale, apiKey);
            anyApiCallsThisFile = true;

            const now = new Date().toISOString();
            const model = DRY_RUN ? 'dry-run' : OPENROUTER_MODEL;
            for (const u of missing) {
                const key = stringKey(u.text);
                if (!fresh[u.id]) continue;
                // NEVER inject mock dry-run placeholders into the shared cache.
                // If a dry-run's "[fr] some text" placeholders were persisted
                // here, the next real run would treat them as a permanent cache
                // hit and serve literal "[fr] …" garbage instead of translating.
                if (DRY_RUN) continue;
                manifest.strings[key] = manifest.strings[key] || { en: u.text, translations: {} };
                manifest.strings[key].en = u.text;
                manifest.strings[key].translations[code] = { text: fresh[u.id], translatedAt: now, model };
            }
        } else {
            console.log(`cached     ${relPath} [${code}] — 0 new strings, reusing ${units.length}`);
        }

        const translations = { ...cached, ...fresh };
        injectUnits($, units, translations);
        rewriteAssetPaths($, locale);
        setHtmlLang($, locale);
        addHreflangTags($, config, code, relPath);

        const outPath = path.join(ROOT, locale.dir, relPath);
        await ensureDir(outPath);
        await writeFile(outPath, $.html(), 'utf8');
    }

    return anyApiCallsThisFile;
}

async function main() {
    const config = await loadJson(CONFIG_PATH);
    const manifest = existsSync(MANIFEST_PATH) ? await loadJson(MANIFEST_PATH) : { strings: {} };
    manifest.strings = manifest.strings || {};

    const apiKey = process.env.OPENROUTER_API_KEY;
    if (!DRY_RUN && !apiKey) {
        console.error('OPENROUTER_API_KEY is not set. Use --dry-run to test the pipeline without it.');
        process.exit(1);
    }

    const targetFiles = ONLY_FILE ? [ONLY_FILE] : config.content;
    const targetLocales = ONLY_LOCALE
        ? { [ONLY_LOCALE]: config.locales[ONLY_LOCALE] }
        : config.locales;

    let filesWithApiCalls = 0;
    for (const relPath of targetFiles) {
        const called = await translateFile(relPath, config, targetLocales, manifest, apiKey);
        if (called) filesWithApiCalls++;
    }

    // Only persist the cache on a REAL run. Dry-runs are preview-only and
    // must never mutate docs/i18n/manifest.json.
    if (!DRY_RUN) {
        await saveJson(MANIFEST_PATH, manifest);
    }
    console.log(`\nDone. ${filesWithApiCalls}/${targetFiles.length} file(s) needed new translation calls. ${Object.keys(manifest.strings).length} unique string(s) cached total.`);
    // Signal to the Action whether there's anything to commit/PR.
    if (process.env.GITHUB_OUTPUT) {
        await writeFile(process.env.GITHUB_OUTPUT, `changed=${filesWithApiCalls > 0}\n`, { flag: 'a' });
    }
}

main().catch(err => {
    console.error(err);
    process.exit(1);
});
