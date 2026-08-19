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

const ROOT = process.cwd();
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
 */
function rewriteAssetPaths($) {
    $('[href], [src]').each((_, el) => {
        const $el = $(el);
        for (const attr of ['href', 'src']) {
            const val = $el.attr(attr);
            if (!val) continue;
            if (/^(https?:)?\/\//.test(val) || val.startsWith('#') || val.startsWith('mailto:')) continue;
            if (val.includes('assets/')) {
                $el.attr(attr, '../' + val);
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
    const base = 'https://aish.byphil.eu';

    head.append(entry('x-default', `${base}/${relPath}`));
    head.append(entry('en', `${base}/${relPath}`));
    for (const [code, loc] of Object.entries(config.locales)) {
        head.append(entry(loc.hreflang, `${base}/${loc.dir}/${relPath}`));
    }
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
            'HTTP-Referer': 'https://aish.byphil.eu',
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

async function main() {
    const config = await loadJson(CONFIG_PATH);
    const manifest = existsSync(MANIFEST_PATH) ? await loadJson(MANIFEST_PATH) : { files: {} };

    const apiKey = process.env.OPENROUTER_API_KEY;
    if (!DRY_RUN && !apiKey) {
        console.error('OPENROUTER_API_KEY is not set. Use --dry-run to test the pipeline without it.');
        process.exit(1);
    }

    const targetFiles = ONLY_FILE ? [ONLY_FILE] : config.content;
    const targetLocales = ONLY_LOCALE
        ? { [ONLY_LOCALE]: config.locales[ONLY_LOCALE] }
        : config.locales;

    let changedCount = 0;

    for (const relPath of targetFiles) {
        const srcPath = path.join(ROOT, relPath);
        const srcContent = await readFile(srcPath, 'utf8');
        const srcHash = sha256(srcContent);

        manifest.files[relPath] = manifest.files[relPath] || { sourceHash: null, translations: {} };
        manifest.files[relPath].sourceHash = srcHash;

        for (const [code, locale] of Object.entries(targetLocales)) {
            if (!locale) continue;
            const record = manifest.files[relPath].translations[code];
            const isStale = !record || record.hash !== srcHash;

            if (!isStale) {
                console.log(`skip   ${relPath} [${code}] — up to date`);
                continue;
            }

            console.log(`translate  ${relPath} [${code}]${DRY_RUN ? ' (dry run)' : ''}`);

            const $ = cheerio.load(srcContent, { decodeEntities: false });
            const units = extractUnits($);
            const translations = await translateUnits(units, locale, apiKey);
            injectUnits($, units, translations);
            rewriteAssetPaths($);
            addHreflangTags($, config, code, relPath);

            const outPath = path.join(ROOT, locale.dir, relPath);
            await ensureDir(outPath);
            await writeFile(outPath, $.html(), 'utf8');

            manifest.files[relPath].translations[code] = {
                hash: srcHash,
                translatedAt: new Date().toISOString(),
                model: DRY_RUN ? 'dry-run' : OPENROUTER_MODEL,
                unitCount: units.length
            };
            changedCount++;
        }
    }

    await saveJson(MANIFEST_PATH, manifest);
    console.log(`\nDone. ${changedCount} (file, locale) pair(s) updated.`);
    // Signal to the Action whether there's anything to commit/PR.
    if (process.env.GITHUB_OUTPUT) {
        await writeFile(process.env.GITHUB_OUTPUT, `changed=${changedCount > 0}\n`, { flag: 'a' });
    }
}

main().catch(err => {
    console.error(err);
    process.exit(1);
});
