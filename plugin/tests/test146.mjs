// Send to phone, end to end against the reference server: pair creates both inboxes, the phone reads and decrypts the article,
// a pairing made before this feature can switch it on later, errors map to reasons, unpair deletes both inboxes.
import assert from 'assert';
import { imp } from './harness.mjs';
import { createInboxServer } from '../inbox-api/reference-server.mjs';

const C = await imp('modules/inboxCrypto.js');
const M = await imp('modules/inboxManager.js');
const { SK } = await imp('modules/storageKeys.js');

const server = createInboxServer({ limits: { maxWaitingBytes: 600000 } });
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const api = `http://127.0.0.1:${server.address().port}/v1/projects/ai_summary_helper/aish_inboxes`;
const memStorage = () => { const d = {}; return { d,
    async get(keys) { const o = {}; for (const k of [].concat(keys)) if (k in d) o[k] = JSON.parse(JSON.stringify(d[k])); return o; },
    async set(o) { for (const [k, v] of Object.entries(o)) d[k] = JSON.parse(JSON.stringify(v)); },
    async remove(keys) { for (const k of [].concat(keys)) delete d[k]; } }; };
const article = (n) => ({ url: 'https://example.com/story-' + n, title: 'Story ' + n, site: 'example.com', summary: 'Short', blocks: [['h2', 'Head'], ['p', 'Body ' + n + ' ✓']] });

// the phone: what it holds after scanning the code
async function phoneFetch(code) {
    const p = C.parsePairingPayload(code);
    assert(p.toPhone, 'code carries the second inbox');
    const res = await fetch(`${api}/${p.toPhone.inboxId}/items`, { headers: { Authorization: 'Bearer ' + p.toPhone.readToken } });
    assert.equal(res.status, 200);
    const j = await res.json();
    const items = [];
    for (const it of j.items) { assert.equal(it.v, 2); items.push({ id: it.id, msg: await C.decryptArticle({ inboxId: p.toPhone.inboxId, encKey: p.encKey }, { v: it.v, data: it.data }) }); }
    return { p, items };
}

try {
    const storage = memStorage();
    const m = M.createInboxManager({ storage, api });
    assert.deepEqual(await m.sendArticle(article(0)), { ok: false, error: 'not-paired' });

    const pr = await m.pair();
    assert(pr.ok); assert.equal(server.inboxes.size, 2, 'both inboxes exist');
    assert.equal((await m.status()).toPhone, true);

    const r1 = await m.sendArticle(article(1));
    assert(r1.ok && r1.blocks === 2 && r1.truncated === false, JSON.stringify(r1));
    await m.sendArticle(article(2));
    const got = await phoneFetch(pr.payload);
    assert.deepEqual(got.items.map((i) => i.msg.title), ['Story 1', 'Story 2']);
    assert.equal(got.items[0].msg.blocks[1][1], 'Body 1 ✓');
    // the server holds ciphertext only
    const raw = JSON.stringify([...server.inboxes.values()].map((b) => b.items));
    assert(!raw.includes('Story') && !raw.includes('example.com'), 'no plaintext on the server');
    // an article cannot be decrypted as a link, and a link cannot be read as an article
    await assert.rejects(C.decryptMessage(got.p, { v: 1, data: got.items.length ? (await (await fetch(`${api}/${got.p.toPhone.inboxId}/items`, { headers: { Authorization: 'Bearer ' + got.p.toPhone.readToken } })).json()).items[0].data : '' }));
    // the phone deletes what it has saved (read token), the server forgets it
    const del = await fetch(`${api}/${got.p.toPhone.inboxId}/items/${got.items[0].id}`, { method: 'DELETE', headers: { Authorization: 'Bearer ' + got.p.toPhone.readToken } });
    assert.equal(del.status, 204);
    assert.equal((await phoneFetch(pr.payload)).items.length, 1);
    // the phone's inbox direction still works and the extension's inbox is separate
    const cfg = storage.d[SK.inboxConfig];
    assert.notEqual(cfg.toPhone.inboxId, cfg.inboxId);

    // an article that is too big for one item is shortened, not refused
    let seed = 7; const rnd = () => { seed = (Math.imul(seed, 1103515245) + 12345) & 0x7fffffff; return seed >>> 8; };
    const word = () => Array.from({ length: 3 + (rnd() % 8) }, () => String.fromCharCode(97 + (rnd() % 26))).join('');
    const big = { url: 'https://example.com/big', title: 'Big', blocks: Array.from({ length: 4000 }, () => ['p', Array.from({ length: 100 }, word).join(' ')]) };
    const rb = await m.sendArticle(big);
    assert(rb.ok && rb.truncated, JSON.stringify(rb));

    // quota: the server refuses when the inbox is full of waiting data; the reason is 'inbox-full'
    let full = null;
    for (let i = 0; i < 20 && !full; i++) { const r = await m.sendArticle({ ...big, url: 'https://example.com/big' + i }); if (!r.ok) full = r; }
    assert.deepEqual(full, { ok: false, error: 'inbox-full' });

    // a pairing made before this feature: no second inbox until it is switched on
    const old = memStorage(); const mo = M.createInboxManager({ storage: old, api });
    const sec = C.newInboxSecrets();
    await fetch(api, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: sec.inboxId, writeHash: await C.tokenHash(sec.writeToken), readHash: await C.tokenHash(sec.readToken) }) });
    await old.set({ [SK.inboxConfig]: { ...sec, createdAt: 1, v: 1 } });
    assert.equal((await mo.status()).toPhone, false);
    assert.deepEqual(await mo.sendArticle(article(9)), { ok: false, error: 'not-enabled' });
    assert.equal(C.parsePairingPayload(await mo.pairingCode()).toPhone, null, 'old code shape until switched on');
    const on = await mo.enableToPhone();
    assert(on.ok && !on.existing && C.parsePairingPayload(on.payload).toPhone);
    assert.equal((await mo.enableToPhone()).existing, true, 'idempotent');
    assert((await mo.sendArticle(article(9))).ok);
    assert.equal((await phoneFetch(on.payload)).items[0].msg.title, 'Story 9');

    // errors: wrong write token
    const bad = memStorage(); const mb = M.createInboxManager({ storage: bad, api });
    await mb.pair(); const bc = bad.d[SK.inboxConfig]; bc.toPhone.writeToken = C.newInboxSecrets().writeToken; await bad.set({ [SK.inboxConfig]: bc });
    assert.deepEqual(await mb.sendArticle(article(1)), { ok: false, error: 'pairing-invalid' });
    assert.deepEqual(await mb.sendArticle({ url: 'javascript:alert(1)', blocks: [['p', 'x']] }), { ok: false, error: 'unreadable' });
    const offline = M.createInboxManager({ storage: await (async () => { const s = memStorage(); await s.set({ [SK.inboxConfig]: storage.d[SK.inboxConfig] }); return s; })(), api: 'http://127.0.0.1:1/x', timeoutMs: 500 });
    assert.deepEqual(await offline.sendArticle(article(1)), { ok: false, error: 'unreachable' });

    // unpair deletes both inboxes on the server
    const before = server.inboxes.size;
    assert((await m.unpair()).serverDeleted);
    assert.equal(server.inboxes.size, before - 2);
    assert.equal(storage.d[SK.inboxConfig], undefined);
    console.log('ok');
} finally { server.close(); }
