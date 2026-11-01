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
    for (const loc of Object.values(config.locales)) {
        head.append(entry(loc.hreflang, `${SITE_BASE}/${loc.dir}/${relPath}`));
    }
}

async function buildPage(relPath, partials, config) {
    const srcPath = path.join(PAGES_DIR, relPath);
    let html = await readFile(srcPath, 'utf8');
    const base = baseFor(relPath);

    // Resolve includes. A partial can itself reference {{base}}, so we
    // substitute per-page, not once globally.
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
