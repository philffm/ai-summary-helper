#!/usr/bin/env node
// scripts/check-sitemap.mjs — fail loudly if docs/sitemap.xml is not a valid sitemap.
// Google reports "Couldn't fetch" for a sitemap that is not well-formed XML, is not
// wrapped in <urlset>, or lists URLs that do not exist. This guard runs in CI before
// the Pages deploy so a broken sitemap can never ship.
import fs from 'node:fs';
import path from 'node:path';
import { findMissingLocalLinks } from './lib/sitemap-links.mjs';
import { localizedPath } from './lib/localized-paths.mjs';

const DOCS = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', 'docs');
const FILE = path.join(DOCS, 'sitemap.xml');
const BASE = 'https://ai-summary-helper.byphil.eu/';
const I18N = JSON.parse(fs.readFileSync(path.join(DOCS, 'i18n', 'locales.json'), 'utf8'));
const errors = [];

if (!fs.existsSync(FILE)) {
  console.error('check-sitemap: docs/sitemap.xml is missing — run `npm run site:build`');
  process.exit(1);
}

const xml = fs.readFileSync(FILE, 'utf8');

// 1. Declaration + root element with the sitemap namespace.
if (!xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>')) errors.push('missing XML declaration');
if (!/<urlset\b[^>]*xmlns="http:\/\/www\.sitemaps\.org\/schemas\/sitemap\/0\.9"/.test(xml)) errors.push('missing <urlset> with the sitemap 0.9 namespace');
if (!xml.trimEnd().endsWith('</urlset>')) errors.push('missing closing </urlset>');

// 2. Every entry must be a <url> with <loc>, <lastmod> and <priority>.
const blocks = [...xml.matchAll(/<url>([\s\S]*?)<\/url>/g)].map((m) => m[1]);
if (!blocks.length) errors.push('no <url> entries');
const locs = [];
for (const b of blocks) {
  const loc = b.match(/<loc>([\s\S]*?)<\/loc>/)?.[1];
  if (!loc) { errors.push('a <url> entry has no <loc>'); continue; }
  locs.push(loc);
  if (!/<lastmod>\d{4}-\d{2}-\d{2}<\/lastmod>/.test(b)) errors.push(`${loc}: missing or malformed <lastmod>`);
  if (!/<priority>(0(\.\d+)?|1(\.0+)?)<\/priority>/.test(b)) errors.push(`${loc}: missing or malformed <priority>`);
  if (!loc.startsWith(BASE)) errors.push(`${loc}: <loc> is not under ${BASE}`);
  if (/[<>&]/.test(loc)) errors.push(`${loc}: unescaped character in <loc>`);
}

// 3. No duplicate URLs.
const dupes = locs.filter((l, i) => locs.indexOf(l) !== i);
if (dupes.length) errors.push(`duplicate <loc>: ${[...new Set(dupes)].slice(0, 5).join(', ')}`);

// 4. Every <loc> must map to a real file in docs/.
for (const loc of locs) {
  let rel = loc.slice(BASE.length);
  if (!rel || rel.endsWith('/')) rel += 'index.html';
  const file = path.join(DOCS, rel);
  if (!fs.existsSync(file)) {
    errors.push(`${loc}: no file at docs/${rel}`);
    continue;
  }
  const html = fs.readFileSync(file, 'utf8');
  const missingLinks = findMissingLocalLinks(html, loc, {
    siteBase: BASE,
    docsDir: DOCS,
    publishedRoots: [{ urlPrefix: '/demo/', directory: path.resolve(DOCS, '../plugin/dist/demo') }],
  });
  for (const href of missingLinks) errors.push(`${loc}: link "${href}" points to a missing page`);
}

// 5. hreflang alternates must point at URLs that are themselves listed (Google drops
//    the whole alternate set otherwise) and must be reciprocal.
const listed = new Set(locs);
const altsByLoc = new Map();
for (const [code, locale] of Object.entries(I18N.locales)) {
  for (const source of I18N.content) {
    if ((I18N.stagedTranslationPages || []).includes(source)) continue;
    const rel = path.posix.join(locale.dir, localizedPath(source, code));
    const file = path.join(DOCS, rel);
    if (!fs.existsSync(file)) errors.push(`${locale.dir}/${localizedPath(source, code)}: configured translated page is missing`);
    const urlPath = rel.replace(/(^|\/)index\.html$/, '$1');
    const loc = `${BASE}${urlPath}`;
    if (!listed.has(loc)) errors.push(`${loc}: configured translated page is not in the sitemap`);
  }
}
for (const b of blocks) {
  const loc = b.match(/<loc>([\s\S]*?)<\/loc>/)?.[1];
  const alts = [...b.matchAll(/hreflang="([^"]+)"\s+href="([^"]+)"/g)].map((m) => [m[1], m[2]]);
  altsByLoc.set(loc, alts);
  for (const [lang, href] of alts) {
    if (!listed.has(href)) errors.push(`${loc}: hreflang="${lang}" points at ${href}, which is not in the sitemap`);
  }
}
for (const [loc, alts] of altsByLoc) {
  for (const [lang, href] of alts) {
    if (lang === 'x-default') continue;
    const back = (altsByLoc.get(href) || []).map(([, h]) => h);
    if (!back.includes(loc)) errors.push(`${loc}: hreflang="${lang}" -> ${href} is not reciprocal`);
  }
}

// 6. The video sitemap (scripts/seo.mjs): every page and video file it names must exist, titles and durations must be valid.
const vpath = path.join(DOCS, 'sitemap-video.xml');
if (fs.existsSync(vpath)) {
  const vxml = fs.readFileSync(vpath, 'utf8');
  for (const m of vxml.matchAll(/<url>([\s\S]*?)<\/url>/g)) {
    const loc = m[1].match(/<loc>([\s\S]*?)<\/loc>/)?.[1] || '';
    let rel = loc.slice(BASE.length);
    if (!rel || rel.endsWith('/')) rel += 'index.html';
    if (!fs.existsSync(path.join(DOCS, rel))) errors.push(`sitemap-video: ${loc} has no file at docs/${rel}`);
    for (const v of m[1].matchAll(/<video:video>([\s\S]*?)<\/video:video>/g)) {
      const get = (t) => v[1].match(new RegExp(`<video:${t}>([\\s\\S]*?)</video:${t}>`))?.[1] || '';
      for (const t of ['thumbnail_loc', 'content_loc']) {
        const u = get(t);
        if (!u.startsWith(BASE) || !fs.existsSync(path.join(DOCS, u.slice(BASE.length)))) errors.push(`sitemap-video: ${loc}: ${t} ${u} does not exist`);
      }
      if (!get('title') || get('title').length > 100) errors.push(`sitemap-video: ${loc}: bad title "${get('title')}"`);
      if (!(Number(get('duration')) > 0)) errors.push(`sitemap-video: ${loc}: bad duration`);
    }
  }
}

// 7. Every listed page needs its own meta description (Bing flags duplicates and gaps).
const descs = new Map();
for (const loc of locs) {
  let rel = loc.slice(BASE.length);
  if (!rel || rel.endsWith('/')) rel += 'index.html';
  const file = path.join(DOCS, rel);
  if (!fs.existsSync(file)) continue;
  const d = fs.readFileSync(file, 'utf8').match(/<meta name="description" content="([^"]*)"/)?.[1]?.trim();
  if (!d) { errors.push(`${loc}: missing meta description`); continue; }
  descs.set(d, [...(descs.get(d) || []), loc]);
}
for (const [d, pages] of descs) {
  if (pages.length > 1) errors.push(`duplicate meta description "${d.slice(0, 60)}…" on ${pages.slice(0, 3).join(', ')}`);
}

if (errors.length) {
  console.error(`check-sitemap: ${errors.length} problem(s) in docs/sitemap.xml`);
  for (const e of errors.slice(0, 40)) console.error('  - ' + e);
  if (errors.length > 40) console.error(`  … and ${errors.length - 40} more`);
  process.exit(1);
}
console.log(`check-sitemap: OK — ${locs.length} URLs, valid XML, all targets exist, hreflang reciprocal`);
