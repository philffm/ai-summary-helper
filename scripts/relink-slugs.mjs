#!/usr/bin/env node
// scripts/relink-slugs.mjs
//
// One-off / repair tool for docs/i18n/slugs.json: moves already generated translated pages to their localized names,
// rewrites the links to them (relative links inside the locale folder, absolute hreflang/og URLs everywhere),
// and leaves a redirect page at the old, English-named address. translate.mjs does the same for newly generated pages.
//   node scripts/relink-slugs.mjs [de]
import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import * as cheerio from 'cheerio';
import { localizedPath, englishPath, slugEntries, rewriteLocalizedLinks, redirectStub, SITE_URL } from './lib/localized-paths.mjs';

const ROOT = process.cwd(), DOCS = path.join(ROOT, 'docs');
const config = JSON.parse(await readFile(path.join(DOCS, 'i18n', 'locales.json'), 'utf8'));
const only = process.argv[2];
async function walk(d) {
    const out = [];
    for (const e of await readdir(d, { withFileTypes: true })) {
        const p = path.join(d, e.name);
        if (e.isDirectory()) { if (e.name !== 'assets' && e.name !== 'i18n') out.push(...await walk(p)); }
        else if (e.name.endsWith('.html')) out.push(p);
    }
    return out;
}
const isStub = (html) => html.includes('name="aish:redirect"');

for (const [code, loc] of Object.entries(config.locales)) {
    if (only && only !== code) continue;
    const entries = slugEntries(code);
    if (!entries.length) continue;
    const dir = path.join(DOCS, loc.dir);
    // 1) move the generated pages to their localized names
    for (const [en, local] of entries) {
        const oldP = path.join(dir, en), newP = path.join(dir, local);
        if (!existsSync(oldP)) continue;
        const html = await readFile(oldP, 'utf8');
        if (isStub(html)) continue;
        await mkdir(path.dirname(newP), { recursive: true });
        await writeFile(newP, html, 'utf8');
        console.log(`moved  ${loc.dir}/${en} -> ${loc.dir}/${local}`);
    }
    // 2) relative links inside the locale folder
    for (const f of await walk(dir)) {
        const rel = path.relative(dir, f).split(path.sep).join('/');
        const html = await readFile(f, 'utf8');
        if (isStub(html)) continue;
        const en = englishPath(rel, code);
        const $ = cheerio.load(html, { decodeEntities: false });
        const before = $.html();
        rewriteLocalizedLinks($, en, code);
        if ($.html() !== before) await writeFile(f, $.html(), 'utf8');
    }
    // 3) absolute URLs (hreflang lists, og:url, canonical) in every page of the site
    for (const f of await walk(DOCS)) {
        let html = await readFile(f, 'utf8'); let changed = false;
        for (const [en, local] of entries) {
            const from = `${SITE_URL}/${loc.dir}/${en}"`, to = `${SITE_URL}/${loc.dir}/${local}"`;
            if (html.includes(from)) { html = html.split(from).join(to); changed = true; }
        }
        if (changed) await writeFile(f, html, 'utf8');
    }
    // 4) redirect pages at the old addresses
    for (const [en, local] of entries) {
        const oldP = path.join(dir, en), newP = path.join(dir, local);
        if (!existsSync(newP)) continue;
        const title = cheerio.load(await readFile(newP, 'utf8'))('head > title').text().trim();
        const newRel = path.posix.relative(path.posix.dirname(en), local);
        await writeFile(oldP, redirectStub({ lang: loc.hreflang, newRel, newAbs: `${SITE_URL}/${loc.dir}/${local}`, title }), 'utf8');
        console.log(`stub   ${loc.dir}/${en} -> ${newRel}`);
    }
}
