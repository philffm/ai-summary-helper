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

const ROOT = process.cwd();
const SITE_SRC = path.join(ROOT, 'site-src');
const PAGES_DIR = path.join(SITE_SRC, 'pages');
const PARTIALS_DIR = path.join(SITE_SRC, 'partials');
const OUT_DIR = path.join(ROOT, 'docs');

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

async function buildPage(relPath, partials) {
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

    for (const relPath of pages) {
        const outPath = await buildPage(relPath, partials);
        console.log(`built  ${path.relative(ROOT, outPath)}`);
    }

    console.log(`\nDone. ${pages.length} page(s) assembled from ${Object.keys(partials).length} partial(s).`);
}

main().catch(err => {
    console.error(err);
    process.exit(1);
});
