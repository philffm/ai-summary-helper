// The Pro license key can ride in the pairing code (lk) so the phone can use the cloud AI. Optional, validated, never required.
import assert from 'assert';
import { imp } from './harness.mjs';
import { createInboxServer } from '../inbox-api/reference-server.mjs';

const C = await imp('modules/inboxCrypto.js');
const M = await imp('modules/inboxManager.js');
const { SK } = await imp('modules/storageKeys.js');

const sec = C.newInboxSecrets();
const KEY = 'AISH-TEST-4f9c2a7e1b';
const code = C.pairingPayload(sec, KEY);
assert(code.endsWith('&lk=' + KEY));
assert.equal(C.parsePairingPayload(code).license, KEY);
assert.equal(C.parsePairingPayload(C.pairingPayload(sec)).license, null, 'no key, no lk');
assert.equal(C.parsePairingPayload(C.pairingPayload(sec, '')).license, null);
for (const bad of ['short', 'has space in it', 'semi;colon&evil=1', 'x'.repeat(201), 'ünïcode-key-1234', null, undefined, 42]) {
    assert(!C.pairingPayload(sec, bad).includes('lk='), 'left out: ' + String(bad).slice(0, 20));
}
assert.equal(C.parsePairingPayload(code.replace(KEY, 'bad key!')).license, null, 'a bad lk is ignored, the code still parses');
assert.equal(C.parsePairingPayload(code).inboxId, sec.inboxId);

const server = createInboxServer({});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const api = `http://127.0.0.1:${server.address().port}/v1/projects/ai_summary_helper/aish_inboxes`;
const memStorage = () => { const d = {}; return { d,
    async get(keys) { const o = {}; for (const k of [].concat(keys)) if (k in d) o[k] = JSON.parse(JSON.stringify(d[k])); return o; },
    async set(o) { for (const [k, v] of Object.entries(o)) d[k] = JSON.parse(JSON.stringify(v)); },
    async remove(keys) { for (const k of [].concat(keys)) delete d[k]; } }; };
try {
    const storage = memStorage();
    const m = M.createInboxManager({ storage, api });
    const free = await m.pair();
    assert(free.ok); assert.equal(C.parsePairingPayload(free.payload).license, null, 'free plan: no key in the code');
    await storage.set({ [SK.licenseKey]: '  ' + KEY + ' ' });
    assert.equal(C.parsePairingPayload(await m.pairingCode()).license, KEY, 'Pro: the key from the account settings, trimmed');
    const again = await m.pair();
    assert(again.existing && C.parsePairingPayload(again.payload).license === KEY);
    await storage.set({ [SK.licenseKey]: 'not a key' });
    assert.equal(C.parsePairingPayload(await m.pairingCode()).license, null, 'unusable value is not put into the code');
    console.log('test148 ok');
} finally { server.close(); }
