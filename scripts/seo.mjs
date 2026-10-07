#!/usr/bin/env node
// scripts/seo.mjs — idempotent SEO pass over docs/*.html (incl. docs/lang/**):
//  * adds <link rel="canonical"> + og:url (self-referencing, clean URLs: index.html -> /)
//  * normalises hreflang hrefs to the same clean form
//  * regenerates docs/sitemap.xml (with hreflang alternates) and docs/robots.txt
// Runs at the end of `site:build` and `translate`.
import fs from 'node:fs';
import path from 'node:path';
import * as cheerio from 'cheerio';

const BASE = 'https://ai-summary-helper.byphil.eu';
const DOCS = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', 'docs');
const clean = (rel) => BASE + '/' + rel.replace(/(^|\/)index\.html$/, '$1');
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');

function walk(d) {
  return fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(d, e.name);
    if (e.isDirectory()) return e.name === 'assets' || e.name === 'i18n' ? [] : walk(p);
    return e.name.endsWith('.html') ? [p] : [];
  });
}
const toUrl = (href) => {
  if (!href.startsWith(BASE + '/')) return href;
  return clean(href.slice(BASE.length + 1));
};

const entries = [];
for (const file of walk(DOCS)) {
  const rel = path.relative(DOCS, file).split(path.sep).join('/');
  const html = fs.readFileSync(file, 'utf8');
  const $ = cheerio.load(html, { decodeEntities: false });
  const self = clean(rel);
  const noindex = /noindex/i.test($('meta[name="robots"]').attr('content') || '');
  $('link[rel="canonical"]').remove();
  $('head').append(`<link rel="canonical" href="${self}">`);
  if ($('meta[property="og:url"]').length) $('meta[property="og:url"]').attr('content', self);
  const alts = [];
  $('link[rel="alternate"][hreflang]').each((_, el) => {
    const h = toUrl($(el).attr('href') || '');
    $(el).attr('href', h);
    alts.push([$(el).attr('hreflang'), h]);
  });
  fs.writeFileSync(file, $.html());
  if (!noindex && rel !== 'goodbye.html' && !/^lang\//.test(rel) === true || (!noindex && /^lang\//.test(rel))) {
    if (rel === 'goodbye.html' || rel.endsWith('/goodbye.html')) continue;
    entries.push({ rel, self, alts, mtime: fs.statSync(file).mtime });
  }
}
entries.sort((a, b) => a.self.length - b.self.length || a.self.localeCompare(b.self));
const day = (d) => d.toISOString().slice(0, 10);
const prio = (e) => (e.self === BASE + '/' ? '1.0' : /lang\//.test(e.rel) ? '0.5' : /blog\//.test(e.rel) ? '0.7' : '0.8');
let xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n`;
for (const e of entries) {
  xml += `  <url>\n    <loc>${esc(e.self)}</loc>\n    <lastmod>${day(e.mtime)}</lastmod>\n    <priority>${prio(e)}</priority>\n`;
  for (const [l, h] of e.alts) xml += `    <xhtml:link rel="alternate" hreflang="${l}" href="${esc(h)}"/>\n`;
  xml += `  </url>\n`;
}
xml += `</urlset>\n`;
fs.writeFileSync(path.join(DOCS, 'sitemap.xml'), xml);
fs.writeFileSync(path.join(DOCS, 'robots.txt'), `User-agent: *\nAllow: /\n\nSitemap: ${BASE}/sitemap.xml\n`);
console.log(`seo: ${entries.length} URLs in sitemap, canonical set on all pages`);
