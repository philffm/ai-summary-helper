#!/usr/bin/env node
// Where the extension's bytes go: raw and deflated size per top-level folder and the biggest files.
// Deflated sizes are per file (what a zip stores), so the total is close to the store package.
//
//   npm run size                        plugin/src
//   npm run size -- plugin/dev/aish-extension-chrome
//   npm run size -- --top 30            more files
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const args = process.argv.slice(2);
const topIdx = args.indexOf('--top');
const top = topIdx >= 0 ? parseInt(args[topIdx + 1], 10) || 15 : 15;
const dirArg = args.find((a, i) => !a.startsWith('--') && args[i - 1] !== '--top');
const dir = path.resolve(root, dirArg || 'plugin/src');

const files = [];
(function walk(d) {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const p = path.join(d, e.name);
        if (e.isDirectory()) walk(p);
        else {
            const buf = fs.readFileSync(p);
            files.push({ rel: path.relative(dir, p), raw: buf.length, zip: zlib.deflateRawSync(buf, { level: 9 }).length });
        }
    }
})(dir);

const kb = (n) => (n / 1024).toFixed(0).padStart(6) + ' KB';
const sum = (list, k) => list.reduce((a, f) => a + f[k], 0);
const groups = new Map();
for (const f of files) {
    const g = f.rel.includes(path.sep) ? f.rel.split(path.sep)[0] + '/' : '(root files)';
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g).push(f);
}
console.log(`${path.relative(root, dir) || '.'}: ${files.length} files, ${kb(sum(files, 'raw'))} raw, ${kb(sum(files, 'zip'))} deflated\n`);
console.log('by folder (deflated · raw)');
[...groups].map(([g, l]) => [g, sum(l, 'zip'), sum(l, 'raw'), l.length]).sort((a, b) => b[1] - a[1])
    .forEach(([g, z, r, n]) => console.log(`  ${g.padEnd(16)}${kb(z)} ·${kb(r)}   ${n} file(s)`));
console.log(`\nbiggest ${top} files (deflated · raw)`);
[...files].sort((a, b) => b.zip - a.zip).slice(0, top).forEach((f) => console.log(`  ${kb(f.zip)} ·${kb(f.raw)}  ${f.rel}`));
// Unminified text assets: long files with short average lines are the cheap wins for a minifier.
const loose = files.filter((f) => /\.(m?js|css)$/.test(f.rel) && f.raw > 20 * 1024 && !/\.min\./.test(f.rel))
    .map((f) => ({ ...f, lines: fs.readFileSync(path.join(dir, f.rel), 'utf8').split('\n').length }))
    .filter((f) => f.raw / f.lines < 80).sort((a, b) => b.raw - a.raw);
if (loose.length) {
    console.log('\nnot minified (over 20 KB, short lines):');
    loose.slice(0, 8).forEach((f) => console.log(`  ${kb(f.raw)}  ${f.rel}`));
}
