#!/usr/bin/env node
// scripts/native-partials.mjs
//
// Native (hand-written, not machine-translated) pages need a header and footer in their own language. The pipeline
// already translates both into docs/<locale>/index.html, so this takes them from there and writes them as partials
// (site-src/partials/nav-<locale>.html, footer-<locale>.html) with links that work from any page depth.
// Re-run it after a translation PR was merged, so the native pages pick up new menu items:
//   node scripts/native-partials.mjs de
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import * as cheerio from 'cheerio';

const loc = process.argv[2];
if (!loc) { console.error('usage: node scripts/native-partials.mjs <locale-folder, e.g. de>'); process.exit(1); }
const ROOT = process.cwd();
const src = await readFile(path.join(ROOT, 'docs', loc, 'index.html'), 'utf8');
const $ = cheerio.load(src, { decodeEntities: false });

// In docs/<loc>/index.html "../x" is a root file and "x" lives in docs/<loc>/. {{base}} is the page's way back to docs/.
function rebase(v) {
  if (!v || /^(https?:|mailto:|tel:|#|\/|javascript:|\{\{)/.test(v)) return v;
  const [p, rest = ''] = v.split(/(?=[#?])/, 2);
  if (p.startsWith('../')) return '{{base}}' + p.slice(3) + rest;
  return '{{base}}' + loc + '/' + p + rest;
}
function part(sel) {
  const el = $(sel).first();
  el.find('[href],[src]').each((_, n) => {
    for (const a of ['href', 'src']) { const v = $(n).attr(a); if (v) $(n).attr(a, rebase(v)); }
  });
  // The demo section moved into the "See it" gallery.
  el.find('a[href*="#try-it"]').each((_, n) => { $(n).attr('href', $(n).attr('href').replace('#try-it', '#see-it')); $(n).attr('data-sec') && $(n).attr('data-sec', 'see-it'); });
  return $.html(el).replace(/<!--[\s\S]*?-->/g, '') + '\n';
}
await writeFile(path.join(ROOT, 'site-src', 'partials', `nav-${loc}.html`), part('header#siteNav, header.nav'), 'utf8');
await writeFile(path.join(ROOT, 'site-src', 'partials', `footer-${loc}.html`), part('footer'), 'utf8');
console.log(`wrote site-src/partials/nav-${loc}.html and footer-${loc}.html from docs/${loc}/index.html`);
