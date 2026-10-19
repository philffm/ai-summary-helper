#!/usr/bin/env node
// scripts/check-sitemap.mjs — fail loudly if docs/sitemap.xml is not a valid sitemap.
// Google reports "Couldn't fetch" for a sitemap that is not well-formed XML, is not
// wrapped in <urlset>, or lists URLs that do not exist. This guard runs in CI before
// the Pages deploy so a broken sitemap can never ship.
import fs from 'node:fs';
import path from 'node:path';

const DOCS = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', 'docs');
const FILE = path.join(DOCS, 'sitemap.xml');
const BASE = 'https://ai-summary-helper.byphil.eu/';
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
  if (!fs.existsSync(path.join(DOCS, rel))) errors.push(`${loc}: no file at docs/${rel}`);
}

// 5. hreflang alternates must point at URLs that are themselves listed (Google drops
//    the whole alternate set otherwise) and must be reciprocal.
const listed = new Set(locs);
const altsByLoc = new Map();
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

if (errors.length) {
  console.error(`check-sitemap: ${errors.length} problem(s) in docs/sitemap.xml`);
  for (const e of errors.slice(0, 40)) console.error('  - ' + e);
  if (errors.length > 40) console.error(`  … and ${errors.length - 40} more`);
  process.exit(1);
}
console.log(`check-sitemap: OK — ${locs.length} URLs, valid XML, all targets exist, hreflang reciprocal`);
