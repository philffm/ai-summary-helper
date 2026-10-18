#!/usr/bin/env node
// Old locale URLs lived under /lang/<code>/ and now live under /<code>/. GitHub Pages cannot send a 301, so for every
// translated page this writes a small stub at the old address: instant meta refresh + canonical to the new URL (Google
// treats that pair as a redirect and moves the signals), plus a script that keeps the #fragment.
// Generated into the deploy folder only (see .github/workflows/pages.yml); never committed.
//
//   node scripts/legacy-lang-stubs.mjs _site
import fs from 'node:fs';
import path from 'node:path';

const BASE = 'https://ai-summary-helper.byphil.eu';
const out = path.resolve(process.argv[2] || '_site');
const docs = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', 'docs');
const locales = Object.values(JSON.parse(fs.readFileSync(path.join(docs, 'i18n', 'locales.json'), 'utf8')).locales);

const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => {
  const p = path.join(d, e.name);
  return e.isDirectory() ? walk(p) : e.name.endsWith('.html') ? [p] : [];
});
const clean = (rel) => BASE + '/' + rel.replace(/(^|\/)index\.html$/, '$1');

let n = 0;
for (const loc of locales) {
  const dir = path.join(docs, loc.dir);
  if (!fs.existsSync(dir)) continue;
  for (const file of walk(dir)) {
    const rel = path.relative(docs, file).split(path.sep).join('/');   // de/blog/x.html
    const target = clean(rel);
    const stub = path.join(out, 'lang', rel);
    fs.mkdirSync(path.dirname(stub), { recursive: true });
    fs.writeFileSync(stub, `<!doctype html>
<html lang="${loc.hreflang}"><head><meta charset="utf-8">
<title>Moved</title>
<link rel="canonical" href="${target}">
<meta http-equiv="refresh" content="0; url=${target}">
<script>location.replace(${JSON.stringify(target)} + location.hash);</script>
</head><body><p>This page moved to <a href="${target}">${target}</a>.</p></body></html>
`);
    n++;
  }
}
console.log(`legacy-lang-stubs: ${n} stubs under ${path.relative(process.cwd(), path.join(out, 'lang'))}`);
