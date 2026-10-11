// i18n coverage (@audit): every translation keeps the English string's {placeholders} (a mismatch breaks the UI: fails).
// A string with no translation yet is only reported (the UI falls back to English): a reminder for the next translation run.
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
const problems = [], missing = new Map();
for (const l of fs.readdirSync(loc).filter(d => d !== 'en' && fs.existsSync(path.join(loc, d, 'messages.json')))) {
    const m = JSON.parse(fs.readFileSync(path.join(loc, l, 'messages.json'), 'utf8'));
    for (const en of strings) {
        const e = m[keyOf(en)];
        if (!e || !e.message) missing.set(en, (missing.get(en) || []).concat(l));
        else if (ph(e.message) !== ph(en)) problems.push(`${l}: placeholder mismatch "${en}"`);
    }
}
if (missing.size) {
    const first = [...missing].slice(0, 5).map(([en, ls]) => `"${en}" (${ls.length} locales)`).join(' | ');
    console.log(`WARNING: ${missing.size} string(s) without a translation in some locales (shown in English): ${first}`);
    if (process.env.GITHUB_ACTIONS) console.log(`::warning title=Missing translations::${missing.size} string(s) fall back to English. Next translation run: node scripts/feed-i18n.mjs extract, translate, merge <dir>. First: ${first}`);
}
assert.equal(problems.length, 0, `${problems.length} placeholder problems, first: ${problems.slice(0, 5).join(' | ')}`);
console.log('TEST 60 OK'); process.exit(0);
