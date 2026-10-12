// shared/suggested-feeds.json (read by the Android app) lists the same starter feeds as the extension's Add feed sheet.
import assert from 'assert';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const json = JSON.parse(fs.readFileSync(path.join(root, 'shared/suggested-feeds.json'), 'utf8'));
assert.equal(json.version, 1);
assert(Array.isArray(json.feeds) && json.feeds.length > 0);
for (const f of json.feeds) {
    assert(f.name && f.icon, 'name and icon: ' + JSON.stringify(f));
    assert(/^https:\/\//.test(f.url), 'https only: ' + f.url);
    assert(Array.isArray(f.tags) && f.tags.every((t) => typeof t === 'string'), 'tags: ' + f.name);
}
const src = fs.readFileSync(path.join(root, 'plugin/src/modules/feedManager.js'), 'utf8');
const block = src.slice(src.indexOf('const SUGGESTED_FEEDS = ['), src.indexOf('function suggestionsNode'));
const inExtension = [...block.matchAll(/url:\s*'([^']+)'/g)].map((m) => m[1]);
assert.deepEqual(json.feeds.map((f) => f.url).sort(), inExtension.sort(), 'same feeds in the extension and in shared/suggested-feeds.json');
console.log('test149 ok');
