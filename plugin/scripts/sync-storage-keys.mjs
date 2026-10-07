// Keeps the generated storage-key block in src/background.js identical to
// src/modules/storageKeys.js (the service worker is a classic script and cannot import it).
//   node scripts/sync-storage-keys.mjs          rewrite the block
//   node scripts/sync-storage-keys.mjs --check  exit 1 when out of date (used by tests/test41.mjs)
import fs from 'fs'; import path from 'path'; import { fileURLToPath } from 'url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const reg = fs.readFileSync(path.join(root, 'src/modules/storageKeys.js'), 'utf8');
const bgPath = path.join(root, 'src/background.js');
const BEGIN = '// storage-keys:begin (generated from modules/storageKeys.js by scripts/sync-storage-keys.mjs — do not edit)';
const END = '// storage-keys:end';
export function block() {
    // drop the leading header comment, strip `export `
    const body = reg.replace(/^(\/\/.*\n)+/, '').replace(/^export /gm, '').trim();
    return `${BEGIN}\n/* eslint-disable no-unused-vars */\n${body}\n/* eslint-enable no-unused-vars */\n${END}`;
}
export function apply(bg) {
    const re = new RegExp(`${BEGIN.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[\\s\\S]*?${END}`);
    if (!re.test(bg)) throw new Error('storage-keys markers missing in background.js');
    return bg.replace(re, () => block());
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
    const bg = fs.readFileSync(bgPath, 'utf8'); const next = apply(bg);
    if (process.argv.includes('--check')) { if (next !== bg) { console.error('background.js storage-key block is stale: run node scripts/sync-storage-keys.mjs'); process.exit(1); } }
    else if (next !== bg) { fs.writeFileSync(bgPath, next); console.log('background.js updated'); } else console.log('up to date');
}
