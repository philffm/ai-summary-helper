// Phone inbox manager against the reference server: pair, receive, dedupe, keep until summarized, per-item delete + retry, errors, unpair.
import assert from 'assert';
import { imp } from './harness.mjs';
import { createInboxServer } from '../inbox-api/reference-server.mjs';

const C = await imp('modules/inboxCrypto.js');
const M = await imp('modules/inboxManager.js');
const { SK } = await imp('modules/storageKeys.js');

const server = createInboxServer();
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const api = `http://127.0.0.1:${server.address().port}/v1/projects/ai_summary_helper/aish_inboxes`;

function memStorage() {
    const d = {};
    return {
        d,
        async get(keys) { const o = {}; for (const k of [].concat(keys)) if (k in d) o[k] = JSON.parse(JSON.stringify(d[k])); return o; },
        async set(o) { for (const [k, v] of Object.entries(o)) d[k] = JSON.parse(JSON.stringify(v)); },
        async remove(keys) { for (const k of [].concat(keys)) delete d[k]; },
    };
}

// the phone: parse the pairing code, encrypt, post
async function phoneShare(code, url) {
    const p = C.parsePairingPayload(code);
    const env = await C.encryptMessage(p, { url, platform: 'ios' });
    const res = await fetch(`${api}/${p.inboxId}/items`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + p.writeToken }, body: JSON.stringify(env) });
    return res.status;
}
const waiting = (id) => server.inboxes.get(id).items.length;

try {
    const storage = memStorage();
    const m = M.createInboxManager({ storage, api });
    assert.equal((await m.status()).paired, false);
    assert.deepEqual(await m.poll(), { ok: false, error: 'not-paired' });

    // pair
    const pr = await m.pair();
    assert(pr.ok && pr.payload.startsWith('aish-inbox://v1?'));
    assert(!pr.payload.includes(storage.d[SK.inboxConfig].readToken), 'read token never in the QR');
    assert.equal((await m.pair()).existing, true, 'pairing again returns the same code');
    const id = storage.d[SK.inboxConfig].inboxId;
    assert.equal(server.inboxes.get(id).readHash, await C.tokenHash(storage.d[SK.inboxConfig].readToken), 'server holds hashes');

    // phone shares three links, one twice
    assert.equal(await phoneShare(pr.payload, 'https://example.com/a'), 202);
    assert.equal(await phoneShare(pr.payload, 'https://example.com/b'), 202);
    assert.equal(await phoneShare(pr.payload, 'https://example.com/a'), 202);
    let r = await m.poll();
    assert(r.ok && r.added === 2 && r.duplicates === 1, JSON.stringify(r));
    assert.deepEqual((await m.listPending()).map((p) => p.url), ['https://example.com/a', 'https://example.com/b']);
    assert.equal(waiting(id), 2, 'links stay on the server until the user summarizes or dismisses them (the duplicate is removed)');
    r = await m.poll(); assert(r.ok && r.added === 0);

    // an unreadable item (wrong key) is dropped and cleared, and does not block the next one
    const other = C.newInboxSecrets();
    const bad = await C.encryptMessage({ ...other, inboxId: id }, { url: 'https://evil.example/' });
    await fetch(`${api}/${id}/items`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + C.parsePairingPayload(pr.payload).writeToken }, body: JSON.stringify(bad) });
    await phoneShare(pr.payload, 'https://example.com/c');
    r = await m.poll(); assert(r.added === 1 && r.rejected === 1, JSON.stringify(r));
    assert.equal(waiting(id), 3, 'the unreadable item is removed, the three links are kept');

    // resolve (Summarize / Dismiss): off the list at once, deleted on the server
    const first = (await m.listPending())[0];
    assert.equal((await m.resolve(first.id)).url, 'https://example.com/a');
    assert.equal(await m.resolve('nope'), null);
    await m.flushDeletes();
    assert.equal(waiting(id), 2, 'the resolved link is gone from the server');
    assert.equal((await m.listPending()).length, 2);

    // a phone with a wrong write token is refused
    const p = C.parsePairingPayload(pr.payload);
    const forged = await fetch(`${api}/${id}/items`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + p.readToken }, body: JSON.stringify(await C.encryptMessage(p, { url: 'https://x.example/' })) });
    assert.equal(forged.status, 403, 'read token cannot post');

    // the server delete fails (offline): the link is off the list, stays queued and is deleted on the next poll
    const second = (await m.listPending())[0];
    const noDelete = M.createInboxManager({ storage, api, fetchFn: (u, o) => (o && o.method === 'DELETE' ? Promise.reject(new Error('cut')) : fetch(u, o)) });
    assert.equal((await noDelete.resolve(second.id)).id, second.id);
    await noDelete.flushDeletes();
    assert.equal(waiting(id), 2, 'delete failed: still on the server');
    assert(storage.d[SK.inboxState].toDelete.includes(second.id), 'queued for retry');
    r = await m.poll(); assert(r.ok && r.added === 0, JSON.stringify(r));
    assert.equal(waiting(id), 1, 'queued delete went through');
    assert.deepEqual(storage.d[SK.inboxState].toDelete, []);

    // offline: unreachable, nothing lost
    await phoneShare(pr.payload, 'https://example.com/d');
    const down = M.createInboxManager({ storage, api, fetchFn: async () => { throw new Error('offline'); } });
    r = await down.poll(); assert(!r.ok && r.error === 'unreachable');
    assert.equal(waiting(id), 2);
    r = await m.poll(); assert(r.ok && r.added === 1 && r.duplicates === 0, JSON.stringify(r));
    assert.equal(waiting(id), 2, 'collected, but kept on the server until summarized');
    assert.equal((await m.listPending()).length, 2);

    // browser profile lost (no local list, no state): everything not summarized yet is collected again
    storage.d[SK.inboxPending] = []; storage.d[SK.inboxState] = {};
    r = await m.poll(); assert(r.ok && r.added === 2, JSON.stringify(r));
    assert.deepEqual((await m.listPending()).map((x) => x.url).sort(), ['https://example.com/c', 'https://example.com/d']);

    // pending full: polling pauses, the server keeps the rest
    const small = memStorage();
    const m2 = M.createInboxManager({ storage: small, api });
    const pr2 = await m2.pair();
    const id2 = small.d[SK.inboxConfig].inboxId;
    small.d[SK.inboxPending] = Array.from({ length: M.PENDING_MAX }, (_, i) => ({ id: 'x' + i, url: 'https://full.example/' + i }));
    await phoneShare(pr2.payload, 'https://example.com/late');
    r = await m2.poll(); assert(r.full && r.added === 0);
    assert.equal(waiting(id2), 1, 'kept on the server');

    // server limits
    const big = await fetch(`${api}/${id}/items`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + p.writeToken }, body: JSON.stringify({ v: 1, data: 'A'.repeat(5000) }) });
    assert.equal(big.status, 413);

    // unpair: server inbox deleted, local traces gone, phone posts now fail
    await phoneShare(pr.payload, 'https://example.com/z');
    const u = await m.unpair();
    assert(u.ok && u.serverDeleted);
    assert(!(SK.inboxConfig in storage.d) && !(SK.inboxPending in storage.d) && !(SK.inboxState in storage.d));
    assert.equal(await phoneShare(pr.payload, 'https://example.com/after'), 404);
    assert.equal((await m.status()).paired, false);

    // pairing refused / server error classification
    assert.equal(M.classify(0), 'unreachable'); assert.equal(M.classify(503), 'unreachable');
    assert.equal(M.classify(429), 'rate-limited'); assert.equal(M.classify(403), 'pairing-invalid'); assert.equal(M.classify(400), 'error');
    const m3 = M.createInboxManager({ storage: memStorage(), api: api.replace(/aish_inboxes$/, 'nope') });
    assert.deepEqual(await m3.pair(), { ok: false, error: 'pairing-invalid' });
} finally {
    server.close();
}
console.log('ok');
