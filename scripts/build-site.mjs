#!/usr/bin/env node
// scripts/build-site.mjs
//
// Assembles the English source-of-truth pages in docs/ from hand-edited
// templates + shared partials in site-src/. This runs BEFORE
// translate.mjs — translate.mjs treats its output (docs/*.html) as the
// canonical English source, so translated pages inherit whatever nav/
// footer content this step produced.
//
// Why this exists: previously every page (index.html, each blog post)
// carried its own copy-pasted <header>/<footer> markup. Editing the nav
// meant hand-editing it in N files, and — as a real example — the
// homepage and blog footers had already drifted out of sync with each
// other. This step makes each partial exist in exactly one place.
//
// Nothing here is client-side. Output is plain static HTML, identical in
// spirit to what was already being served — a crawler or answer engine
// sees no difference from before.
//
// Usage:
//   node scripts/build-site.mjs

import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import path from 'node:path';
import * as cheerio from 'cheerio';
import { localizedPath } from './lib/localized-paths.mjs';

const ROOT = process.cwd();
const SITE_SRC = path.join(ROOT, 'site-src');
const PAGES_DIR = path.join(SITE_SRC, 'pages');
const PARTIALS_DIR = path.join(SITE_SRC, 'partials');
const OUT_DIR = path.join(ROOT, 'docs');
const LOCALES_PATH = path.join(OUT_DIR, 'i18n', 'locales.json');
const SITE_BASE = 'https://ai-summary-helper.byphil.eu';

// One place for the product name (the rename is undecided): pages written with {{product}} pick it up from site-src/site.json.
const PRODUCT = JSON.parse(await readFile(path.join(SITE_SRC, 'site.json'), 'utf8')).product;

const INCLUDE_RE = /<!--include:([a-zA-Z0-9_-]+)-->/g;
const HOMEPAGE_SOURCE = await readFile(path.join(PAGES_DIR, 'index.html'), 'utf8');
const FEATURES_START = HOMEPAGE_SOURCE.indexOf('<!-- ── Features');
const FEATURES_END = HOMEPAGE_SOURCE.indexOf('<!-- ── Phone companion', FEATURES_START);
if (FEATURES_START < 0 || FEATURES_END < 0) throw new Error('Could not locate the shared What it does section in the homepage.');
const WHAT_IT_DOES = HOMEPAGE_SOURCE.slice(FEATURES_START, FEATURES_END);
const FAQ_START = HOMEPAGE_SOURCE.indexOf('<!-- ── FAQ');
const FAQ_END = HOMEPAGE_SOURCE.indexOf('<!-- ── Blog teaser', FAQ_START);
if (FAQ_START < 0 || FAQ_END < 0) throw new Error('Could not locate the shared FAQ section in the homepage.');
const SHARED_FAQ = HOMEPAGE_SOURCE.slice(FAQ_START, FAQ_END);
const RELATED_READING = {
    pdf: [
        ['Guide', 'Check an AI summary against its source', 'blog/verify-ai-summary.html', 'A quick source-checking habit for any AI answer.'],
        ['Workflow', 'Highlighting alone barely works. Ask about it instead.', 'blog/highlighting-vs-asking.html', 'Turn important passages into questions you can revisit.'],
        ['Privacy', 'Your key. Your model. Your data.', 'blog/bring-your-own-key.html', 'Understand BYOK, provider boundaries and local models.']
    ],
    youtube: [
        ['Guide', 'Turn videos into notes without losing the source', 'blog/videos.html', 'See the video workflow and the extension in action.'],
        ['Workflow', 'Highlighting alone barely works. Ask about it instead.', 'blog/highlighting-vs-asking.html', 'Keep the useful idea, not just a timestamp.'],
        ['Product', 'You won’t read most of what you save. Here’s the actual fix.', 'blog/unread-saves.html', 'Make saved video reading returnable instead of forgotten.']
    ],
    research: [
        ['Guide', 'Check an AI summary against its source', 'blog/verify-ai-summary.html', 'Keep claims tied to the paper they came from.'],
        ['Research', 'Search and tags without the cloud', 'blog/on-device-architecture.html', 'See why the research library runs on your device.'],
        ['Privacy', 'Your key. Your model. Your data.', 'blog/bring-your-own-key.html', 'Choose the model and provider behind your workflow.']
    ],
    obsidian: [
        ['Workflow', 'Search and tags without the cloud', 'blog/on-device-architecture.html', 'Build a searchable knowledge base without uploading it.'],
        ['Guide', 'Sync your reading library to Nextcloud, S3 or a folder', 'blog/sync-to-nextcloud-s3-or-a-folder.html', 'Back up and reuse your archive on your own storage.'],
        ['Product', 'From a bookmarklet to 2.0: what AI Summary Helper actually is now', 'blog/from-bookmarklet-to-2.html', 'See how saving became a connected reading workflow.']
    ],
    privacy: [
        ['Privacy', 'Your key. Your model. Your data.', 'blog/bring-your-own-key.html', 'What BYOK protects, and where the provider boundary is.'],
        ['Architecture', 'Why we moved search, tagging and recommendations out of the cloud', 'blog/on-device-architecture.html', 'The local-first decisions behind the archive.'],
        ['Guide', 'Digital sovereignty for individuals', 'blog/digital-sovereignty-for-individuals.html', 'A practical checklist for keeping control of your data.']
    ],
    graph: [
        ['Architecture', 'Why we moved search, tagging and recommendations out of the cloud', 'blog/on-device-architecture.html', 'How local search and recommendations make the graph useful.'],
        ['Product', 'You won’t read most of what you save. Here’s the actual fix.', 'blog/unread-saves.html', 'Use digests to return to the knowledge you already collected.'],
        ['Guide', 'Sync your reading library to Nextcloud, S3 or a folder', 'blog/sync-to-nextcloud-s3-or-a-folder.html', 'Keep the connected archive on storage you control.']
    ],
    mcp: [
        ['MCP', 'Use your library in Claude, LM Studio and Cursor', 'blog/ai-apps-mcp.html', 'Give compatible AI apps controlled access to your local library.'],
        ['Privacy', 'Digital sovereignty for individuals', 'blog/digital-sovereignty-for-individuals.html', 'Understand local context, permissions and ownership.'],
        ['Privacy', 'Your key. Your model. Your data.', 'blog/bring-your-own-key.html', 'Choose which provider handles a request and which does not.']
    ]
};

function filteredFeatureSection(persona) {
    const $ = cheerio.load(WHAT_IT_DOES, { decodeEntities: false });
    $('#features').attr('data-default-persona', persona);
    $('#featureGrid .feature-card').each((_, card) => {
        const personas = ($(card).attr('data-personas') || '').split(/\s+/);
        if (!personas.includes(persona)) $(card).remove();
    });
    return $('body').html().replace(/[ \t]+$/gm, '');
}

function filteredFaqSection(persona) {
    const $ = cheerio.load(SHARED_FAQ, { decodeEntities: false });
    $('#faqList details').each((_, item) => {
        const personas = ($(item).attr('data-faq-personas') || 'all').split(/\s+/);
        if (!personas.includes('shared') && !personas.includes(persona)) $(item).remove();
    });
    return $('body').html().replace(/[ \t]+$/gm, '');
}

function relatedReadingSection(topic) {
    const cards = RELATED_READING[topic];
    if (!cards) throw new Error(`Unknown related-reading topic "${topic}".`);
    return `<section class="related-reading"><div class="wrap"><div class="section-head center"><div class="eyebrow">Further reading</div><h2>Go deeper on this workflow</h2><p>Practical notes on the ideas behind this page.</p></div><div class="blog-grid">${cards.map(([label, title, href, text]) => `<a class="blog-card" href="{{base}}${href}"><span class="blog-date">${label}</span><h3>${title}</h3><p>${text}</p><span class="blog-read">Read the post →</span></a>`).join('')}</div></div></section>`;
}

async function loadPartials() {
    const files = await readdir(PARTIALS_DIR);
    const partials = {};
    for (const f of files) {
        if (!f.endsWith('.html')) continue;
        const name = f.replace(/\.html$/, '');
        partials[name] = await readFile(path.join(PARTIALS_DIR, f), 'utf8');
    }
    return partials;
}

async function walk(dir, base = '') {
    const entries = await readdir(dir, { withFileTypes: true });
    let files = [];
    for (const entry of entries) {
        const rel = path.join(base, entry.name);
        if (entry.isDirectory()) {
            files = files.concat(await walk(path.join(dir, entry.name), rel));
        } else if (entry.name.endsWith('.html')) {
            files.push(rel);
        }
    }
    return files;
}

function baseFor(relPath) {
    // How many "../" a page needs to reach docs/ root, based on its own
    // depth under pages/. index.html -> "", blog/index.html -> "../".
    const depth = relPath.split(path.sep).length - 1;
    return '../'.repeat(depth);
}

/** SEO: point search engines at the sibling-locale versions of this English page. */
function addHreflangTags($, config, relPath) {
    const head = $('head');
    $('link[rel="alternate"][hreflang]').remove();
    const entry = (hreflang, href) => `<link rel="alternate" hreflang="${hreflang}" href="${href}">`;
    head.append(entry('x-default', `${SITE_BASE}/${relPath}`));
    head.append(entry('en', `${SITE_BASE}/${relPath}`));
    for (const [code, loc] of Object.entries(config.locales)) {
        head.append(entry(loc.hreflang, `${SITE_BASE}/${loc.dir}/${localizedPath(relPath, code)}`));
    }
}

async function buildPage(relPath, partials, config) {
    const srcPath = path.join(PAGES_DIR, relPath);
    let html = await readFile(srcPath, 'utf8');
    const base = baseFor(relPath);

    // Resolve includes. A partial can itself reference {{base}}, so we
    // substitute per-page, not once globally.
    html = html.replace(/<!--include:what-it-does:([a-z]+)-->/g, (_, persona) => filteredFeatureSection(persona));
    html = html.replace(/<!--include:faq:([a-z]+)-->/g, (_, persona) => filteredFaqSection(persona));
    html = html.replace(/<!--include:related:([a-z]+)-->/g, (_, topic) => relatedReadingSection(topic));
    html = html.replace(INCLUDE_RE, (match, name) => {
        if (!(name in partials)) {
            throw new Error(`${relPath}: unknown partial "${name}" (looked in site-src/partials/${name}.html)`);
        }
        return partials[name].trimEnd();
    });

    html = html.replaceAll('{{base}}', base);
    html = html.replaceAll('{{product}}', PRODUCT);

    // Reciprocal hreflang: every translated page already points back at
    // this English page as an alternate (translate.mjs handles that) —
    // this page needs to point at all of THEM too, or Google can discard
    // the whole hreflang cluster as unconfirmed.
    if (config) {
        const $ = cheerio.load(html, { decodeEntities: false });
        // Native pages (written in another language, e.g. site-src/pages/de/...) carry their own hreflang tags: the generic
        // ones below describe an English page and its translations, so they would label a German page as "en".
        // (a page with <meta name="aish:hreflang" content="custom"> brings its own alternates, e.g. /education/ <-> /de/bildung/)
        if (($('html').attr('lang') || 'en').toLowerCase().startsWith('en') && !$('meta[name="aish:hreflang"][content="custom"]').length) addHreflangTags($, config, relPath);
        // Landing pages with a sibling in another language (e.g. /education/ <-> /de/bildung/): the language pills of the menu go to that
        // sibling instead of the other language's home page.
        // Only for pages that declare their own, real siblings: a native page (not English) or a page with <meta name="aish:hreflang" content="custom">.
        if ($('meta[name="aish:landing"]').length && (($('html').attr('lang') || 'en').toLowerCase() !== 'en' || $('meta[name="aish:hreflang"][content="custom"]').length)) {
            $('link[rel="alternate"][hreflang]').each((_, el) => {
                const h = ($(el).attr('hreflang') || '').toLowerCase();
                if (h === 'x-default') return;
                let pth; try { pth = new URL($(el).attr('href')).pathname; } catch { return; }
                $(`a.lang-pill[data-loc="${h}"]`).attr('href', pth);
            });
        }
        html = $.html();
    }

    const outPath = path.join(OUT_DIR, relPath);
    await mkdir(path.dirname(outPath), { recursive: true });
    await writeFile(outPath, html, 'utf8');
    return outPath;
}

async function main() {
    const partials = await loadPartials();
    const pages = await walk(PAGES_DIR);

    if (pages.length === 0) {
        console.error(`No pages found under ${PAGES_DIR}`);
        process.exit(1);
    }

    let config = null;
    try {
        config = JSON.parse(await readFile(LOCALES_PATH, 'utf8'));
    } catch {
        console.warn(`No locales.json found at ${LOCALES_PATH} — building without hreflang tags.`);
    }

    for (const relPath of pages) {
        const outPath = await buildPage(relPath, partials, config);
        console.log(`built  ${path.relative(ROOT, outPath)}`);
    }

    console.log(`\nDone. ${pages.length} page(s) assembled from ${Object.keys(partials).length} partial(s).`);
}

main().catch(err => {
    console.error(err);
    process.exit(1);
});
