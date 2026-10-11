// The background inbox worker is a classic-script bundle: it loads without modules and collects a link end to end,
// and the platform manifests list it (Firefox/Safari run the background as a page, not a service worker).
import assert from 'assert'; import fs from 'fs'; import vm from 'vm'; import os from 'os'; import path from 'path'; import { spawnSync } from 'child_process';
import { imp } from './harness.mjs';

const out = fs.mkdtempSync(path.join(os.tmpdir(), 'aish-inbox-'));
const b = spawnSync(process.execPath, [new URL('../scripts/build.js', import.meta.url).pathname, '--bundle', out], { encoding: 'utf8' });
assert.equal(b.status, 0, 'bundling failed: ' + b.stderr);
const src = fs.readFileSync(path.join(out, 'inbox-worker.js'), 'utf8');
assert(!/^\s*(import|export)\s/m.test(src), 'no module syntax left in a classic script');

const C = await imp('modules/inboxCrypto.js');
const { SK } = await imp('modules/storageKeys.js');
const secrets = C.newInboxSecrets();
const env = await C.encryptMessage(secrets, { url: 'https://example.com/from-phone', platform: 'android' });
const store = { [SK.inboxConfig]: { ...secrets, createdAt: 1, v: 1 } };
const calls = [];
const fetchFn = async (url, opts) => {
    calls.push(opts.method + ' ' + url.replace(/^.*\/aish_inboxes/, ''));
    const json = (status, body) => ({ status, json: async () => body });
    if (opts.method === 'GET') return json(200, { items: [{ id: 'i1', cursor: '000000000000001', receivedAt: 1, v: 1, data: env.data }], hasMore: false });
    return json(200, { ok: true });
};
const chrome = { storage: { local: {
    get: async (k) => { const o = {}; for (const key of [].concat(k)) if (key in store) o[key] = JSON.parse(JSON.stringify(store[key])); return o; },
    set: async (o) => { Object.assign(store, JSON.parse(JSON.stringify(o))); },
    remove: async (k) => { for (const key of [].concat(k)) delete store[key]; } } } };
const sandbox = { self: {}, chrome, console, setTimeout, clearTimeout, AbortController, TextEncoder, TextDecoder, Uint8Array, ArrayBuffer, URL, atob, btoa, crypto: globalThis.crypto, fetch: fetchFn };
sandbox.globalThis = sandbox;
vm.createContext(sandbox); vm.runInContext(src, sandbox);
const W = sandbox.self.AISH_INBOX || sandbox.AISH_INBOX;
assert(W && typeof W.createInboxManager === 'function', 'AISH_INBOX exposed');
const r = await W.createInboxManager().poll();
assert(r.ok && r.added === 1, JSON.stringify(r));
assert.equal(store[SK.inboxPending][0].url, 'https://example.com/from-phone');
assert(!calls.some((c) => c.endsWith('/ack')), 'nothing is acknowledged on fetch: items stay until the user deals with them');

for (const p of ['firefox', 'ios']) {
    const m = JSON.parse(fs.readFileSync(new URL(`../platforms/${p}/manifest.json`, import.meta.url), 'utf8'));
    assert(m.background.scripts.includes('inbox-worker.js'), p + ' manifest lists inbox-worker.js');
}
console.log('ok');
