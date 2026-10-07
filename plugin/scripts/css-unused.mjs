#!/usr/bin/env node
// Lists (and with --write removes) CSS selectors whose classes are never referenced in src JS/HTML.
// A class counts as used if its name appears anywhere in code, or if a string literal ending in '-' that
// is a prefix of it exists (dynamic names like 'feed-mood-' + kind). Usage: node scripts/css-unused.mjs [--write]
import fs from 'fs'; import path from 'path'; import { fileURLToPath } from 'url';
const here = path.dirname(fileURLToPath(import.meta.url)); const src = path.resolve(here, '../src');
const files = []; (function w(d) { for (const f of fs.readdirSync(d)) { const p = path.join(d, f); if (fs.statSync(p).isDirectory()) { if (!/_locales|node_modules|icons|^lib$/.test(f)) w(p); } else if (/\.(js|html)$/.test(f)) files.push(p); } })(src);
const code = files.map(f => fs.readFileSync(f, 'utf8')).join('\n');
const KEEP = new Set(['action-btn--sm']); // intentionally unused-so-far API of the global button
const used = (c) => {
  if (KEEP.has(c)) return true;
  if (new RegExp('(?<![\\w-])' + c.replace(/-/g, '\\-') + '(?![\\w-])').test(code)) return true;
  const parts = c.split('-'); for (let i = 1; i < parts.length; i++) { const pre = parts.slice(0, i).join('-') + '-'; if (new RegExp('[\'"`]' + pre.replace(/-/g, '\\-') + '[\'"`]|[\'"`]' + pre.replace(/-/g, '\\-') + '\\$\\{').test(code)) return true; }
  return false;
};
let css = fs.readFileSync(src + '/styles.css', 'utf8');
const cache = new Map(); const isUsed = c => (cache.has(c) || cache.set(c, used(c)), cache.get(c));
const removed = []; 
css = css.replace(/(^|\n)([^{}@\n/][^{}]*?)\{([^{}]*)\}/g, (m, lead, sel, body) => {
  const parts = sel.split(',').map(s => s.trim()).filter(Boolean);
  const keep = parts.filter(p => [...p.matchAll(/\.([a-zA-Z_][\w-]*)/g)].every(x => isUsed(x[1])));
  if (keep.length === parts.length) return m;
  removed.push(parts.filter(p => !keep.includes(p)).join(', '));
  return keep.length ? `${lead}${keep.join(',\n')} {${body}}` : lead;
});
console.log('removed selectors:', removed.length); console.log(removed.map(r => '  ' + r.slice(0, 90)).join('\n'));
if (process.argv.includes('--write')) { css = css.replace(/\n{3,}/g, '\n\n'); fs.writeFileSync(src + '/styles.css', css); console.log('written'); }
