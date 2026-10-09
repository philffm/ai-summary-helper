// i18n coverage (@audit): every T()/TN()/data-i18n string the extractor finds has a translation in every locale (with the same {placeholders}).
import assert from 'assert';
import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';
import { fileURLToPath, pathToFileURL } from 'url';
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..');
const r = spawnSync(process.execPath, [path.join(root, 'scripts/feed-i18n.mjs'), 'extract'], { encoding: 'utf8', maxBuffer: 1 << 26 });
assert.equal(r.status, 0, r.stderr);
const strings = JSON.parse(r.stdout);
assert(strings.length > 500, 'extractor found ' + strings.length);
const { keyOf } = await import(pathToFileURL(path.join(root, 'plugin/src/modules/feedI18n.js')).href);
const loc = path.join(root, 'plugin/src/_locales');
const ph = (s) => (String(s).match(/\{[a-z]+\}/g) || []).sort().join(',');
const problems = [];
for (const l of fs.readdirSync(loc).filter(d => d !== 'en' && fs.existsSync(path.join(loc, d, 'messages.json')))) {
    const m = JSON.parse(fs.readFileSync(path.join(loc, l, 'messages.json'), 'utf8'));
    for (const en of strings) {
        const e = m[keyOf(en)];
        if (!e || !e.message) problems.push(`${l}: missing "${en}"`);
        else if (ph(e.message) !== ph(en)) problems.push(`${l}: placeholder mismatch "${en}"`);
    }
}
assert.equal(problems.length, 0, `${problems.length} i18n problems, first: ${problems.slice(0, 5).join(' | ')}\nRun: node scripts/feed-i18n.mjs extract, translate the missing strings, then merge <dir>.`);
console.log('TEST 60 OK'); process.exit(0);
