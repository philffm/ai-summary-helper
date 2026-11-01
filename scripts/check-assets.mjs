#!/usr/bin/env node
// scripts/check-assets.mjs — every relative asset reference (href/src/poster/srcset/style url()) in docs/**/*.html must resolve to a file.
//   node scripts/check-assets.mjs [--fix]   (--fix shifts a reference that only resolves one or more levels higher)
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
const D = path.join(process.cwd(), 'docs'), FIX = process.argv.includes('--fix');
async function walk(d) { const o = []; for (const e of await readdir(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) { if (!['assets', 'i18n', 'demo'].includes(e.name)) o.push(...await walk(p)); } else if (e.name.endsWith('.html')) o.push(p); } return o; }
let bad = 0, fixed = 0;
for (const f of await walk(D)) {
  let h = await readFile(f, 'utf8'), changed = false; const dir = path.dirname(f);
  const check = (ref) => {
    const clean = ref.split(/[?#]/)[0];
    if (!clean || /^(https?:|\/|mailto:|tel:|data:|javascript:|#)/.test(clean) || !/(^|\/)assets\//.test(clean)) return ref;
    if (existsSync(path.resolve(dir, clean))) return ref;
    for (let i = 1; i <= 3; i++) { const t = '../'.repeat(i) + clean; if (existsSync(path.resolve(dir, t))) { if (FIX) { fixed++; changed = true; return '../'.repeat(i) + ref; } break; } }
    bad++; console.log(path.relative(D, f), '->', ref); return ref;
  };
  h = h.replace(/\b(href|src|poster|data-src|content)="([^"]*)"/g, (m, a, v) => `${a}="${check(v)}"`);
  h = h.replace(/\bsrcset="([^"]*)"/g, (m, v) => `srcset="${v.split(',').map(x => { const t = x.trim(); const [u, ...r] = t.split(/\s+/); return [check(u), ...r].join(' '); }).join(', ')}"`);
  h = h.replace(/url\((['"]?)([^)'"]+)\1\)/g, (m, q, v) => `url(${q}${check(v)}${q})`);
  if (changed) await writeFile(f, h, 'utf8');
}
console.log(FIX ? `fixed ${fixed} reference(s)` : `${bad} broken reference(s)`);
process.exit(!FIX && bad ? 1 : 0);
