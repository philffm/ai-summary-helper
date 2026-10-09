// Privacy policy: privacy.md and plugin/src/privacy.md are generated from site-src/pages/privacy.html and must be up to date, with no placeholders.
import assert from 'assert';
import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const r = spawnSync(process.execPath, [path.join(root, 'scripts/privacy-md.mjs'), '--check'], { encoding: 'utf8' });
assert.equal(r.status, 0, 'privacy copies out of date: ' + r.stderr);
for (const f of ['privacy.md', 'plugin/src/privacy.md']) {
    const t = fs.readFileSync(path.join(root, f), 'utf8');
    assert(!/\[Your Contact|GPT-3\.5|TODO/i.test(t), f + ' still has a placeholder or stale text');
    assert(/kindle@byphil\.eu/.test(t) && /LocalSend/.test(t), f + ' must describe the Kindle (server) and LocalSend (direct) paths');
}
console.log('TEST 93 OK'); process.exit(0);
