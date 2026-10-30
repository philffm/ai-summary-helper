#!/usr/bin/env node
// scripts/indexnow.mjs — tell IndexNow engines (Bing, Yandex, Seznam, Naver …) which pages changed.
// Compares docs/sitemap.xml against the sitemap that was live before the deploy and submits every
// URL that is new or has a newer <lastmod>. Google does not use IndexNow.
//   node scripts/indexnow.mjs --before old-sitemap.xml   changed URLs only (the Pages workflow)
//   node scripts/indexnow.mjs --all                      every URL in the sitemap
//   add --dry-run to print the list without sending it
import fs from 'node:fs';
import path from 'node:path';

const DOCS = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', 'docs');
const HOST = 'ai-summary-helper.byphil.eu';
const KEY = '74c386394ab84165be6a819f1e91dc5f';   // must match docs/<KEY>.txt
const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const opt = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };

/** loc → lastmod for every <url> in a sitemap. */
function entries(xml) {
  const map = new Map();
  for (const m of (xml || '').matchAll(/<url>([\s\S]*?)<\/url>/g)) {
    const loc = m[1].match(/<loc>([\s\S]*?)<\/loc>/)?.[1];
    if (loc) map.set(loc, m[1].match(/<lastmod>([\s\S]*?)<\/lastmod>/)?.[1] || '');
  }
  return map;
}

const now = entries(fs.readFileSync(path.join(DOCS, 'sitemap.xml'), 'utf8'));
let urls;
if (flag('--all')) {
  urls = [...now.keys()];
} else {
  const beforeFile = opt('--before');
  const before = entries(beforeFile && fs.existsSync(beforeFile) ? fs.readFileSync(beforeFile, 'utf8') : '');
  // No previous sitemap (first deploy, fetch failed): don't flood the engines, send nothing.
  if (!before.size) { console.log('indexnow: no previous sitemap to compare against — nothing sent (use --all once)'); process.exit(0); }
  urls = [...now].filter(([loc, mod]) => before.get(loc) !== mod).map(([loc]) => loc);
}

if (!urls.length) { console.log('indexnow: no changed URLs'); process.exit(0); }
console.log(`indexnow: ${urls.length} URL(s)\n  ${urls.slice(0, 20).join('\n  ')}${urls.length > 20 ? `\n  … and ${urls.length - 20} more` : ''}`);
if (flag('--dry-run')) process.exit(0);

const res = await fetch('https://api.indexnow.org/indexnow', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json; charset=utf-8' },
  body: JSON.stringify({ host: HOST, key: KEY, keyLocation: `https://${HOST}/${KEY}.txt`, urlList: urls.slice(0, 10000) }),
});
// 200 = accepted, 202 = accepted, key check still pending (normal for the first submission).
console.log(`indexnow: HTTP ${res.status} ${res.statusText}`);
if (!res.ok) { console.log(await res.text().catch(() => '')); process.exit(1); }
