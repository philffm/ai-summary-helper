#!/usr/bin/env node
// Re-apply after every pdf.js vendor update: node scripts/strip-corejs-ie-fallback.mjs
// The Chrome Web Store scanner flagged core-js's IE-only Object.create fallback ('java' + SCRIPT + ':',
// '<' + 'script' + '>') as obfuscation ("Red Titanium"). Object.create exists in every supported browser,
// so that fallback never runs; it is replaced by a plain polyfill.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
const LIB = path.join(path.dirname(fileURLToPath(import.meta.url)), '../plugin/src/lib');
const START = "var GT = '>';";
const END = "hiddenKeys[IE_PROTO] = true;";
for (const f of ['pdf.mjs', 'pdf.worker.mjs']) {
    const p = path.join(LIB, f);
    let s = fs.readFileSync(p, 'utf8');
    let n = 0;
    while (true) {
        const a = s.indexOf(START);
        if (a < 0) break;
        const b = s.indexOf(END, a);
        if (b < 0) throw new Error(`${f}: end marker not found`);
        s = s.slice(0, a) + "var PROTOTYPE = 'prototype';\nvar IE_PROTO = sharedKey('IE_PROTO');\n\nvar EmptyConstructor = function () { /* empty */ };\n\nvar NullProtoObject = function () { return { __proto__: null }; };\n\n" + s.slice(b);
        n++;
    }
    fs.writeFileSync(p, s);
    console.log(`${f}: patched ${n}`);
}
