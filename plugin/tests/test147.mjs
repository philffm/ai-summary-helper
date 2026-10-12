// Feed-URL vault: merge rules, sealed document (shared vector), and two devices syncing through the reference server.
import assert from 'assert';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { imp } from './harness.mjs';
import { createInboxServer } from '../inbox-api/reference-server.mjs';

const C = await imp('modules/inboxCrypto.js');
const F = await imp('modules/feedSync.js');
const M = await imp('modules/inboxManager.js');
const { SK } = await imp('modules/storageKeys.js');
const vecPath = fileURLToPath(new URL('./fixtures/feed-sync-vector.json', import.meta.url));
const inboxVec = JSON.parse(fs.readFileSync(fileURLToPath(new URL('./fixtures/inbox-vector.json', import.meta.url)), 'utf8'));

const A = 'https://a.example/feed.xml', B = 'https://b.example/rss', Cc = 'https://c.example/atom';
const e = (url, updatedAt, extra = {}) => ({ url, title: extra.title ?? url.split('/')[2], tags: extra.tags ?? [], updatedAt, ...(extra.removed ? { removed: true } : {}) });
const tomb = (url, updatedAt) => ({ url, updatedAt, removed: true });

// 1) cleaning: only web URLs, canonical shape, hostile input dropped
assert.equal(F.cleanFeedUrl('javascript:alert(1)'), '');
assert.equal(F.cleanFeedUrl('file:///etc/passwd'), '');
assert.equal(F.cleanFeedUrl(' https://a.example/feed.xml '), A);
assert.deepEqual(F.cleanEntries([{ url: 'data:text/html,x', updatedAt: 1 }, { url: A, updatedAt: -1 }, null, 5, { url: A, title: ' T ', tags: ['x', 'X', ' ', 'y'], updatedAt: 3.9, extra: 1 }]),
    [{ url: A, title: 'T', tags: ['x', 'y'], updatedAt: 3 }]);

// 2) merge rules — the cases the phone implementation must reproduce (also written to the shared vector)
const NOW = 2_000_000_000_000, DAY = 86400e3;
const t = (n) => NOW - 5 * DAY + n;
const cases = [
    { name: 'union', a: [e(A, t(1))], b: [e(B, t(2))], expect: [e(B, t(2)), e(A, t(1))] },
    { name: 'newer wins', a: [e(A, t(5), { title: 'old' })], b: [e(A, t(9), { title: 'new', tags: ['news'] })], expect: [e(A, t(9), { title: 'new', tags: ['news'] })] },
    { name: 'removal newer than edit', a: [e(A, t(5))], b: [tomb(A, t(8))], expect: [tomb(A, t(8))] },
    { name: 're-added after removal', a: [tomb(A, t(8))], b: [e(A, t(12))], expect: [e(A, t(12))] },
    { name: 'tie: removal wins', a: [e(A, t(7))], b: [tomb(A, t(7))], expect: [tomb(A, t(7))] },
    { name: 'tie: larger canonical JSON wins', a: [e(A, t(7), { title: 'a' })], b: [e(A, t(7), { title: 'b' })], expect: [e(A, t(7), { title: 'b' })] },
    { name: 'old tombstone dropped', a: [tomb(A, NOW - 91 * DAY), e(B, NOW - 1)], b: [], expect: [e(B, NOW - 1)] },
    { name: 'recent tombstone kept', a: [tomb(A, NOW - 89 * DAY)], b: [], expect: [tomb(A, NOW - 89 * DAY)] },
    { name: 'invalid entries ignored', a: [{ url: 'ftp://x/y', updatedAt: 5 }, e(A, t(1))], b: [], expect: [e(A, t(1))] },
];
for (const c of cases) {
    assert.deepEqual(F.mergeEntries(c.a, c.b, NOW), c.expect, c.name);
    assert.deepEqual(F.mergeEntries(c.b, c.a, NOW), c.expect, c.name + ' (commutative)');
    assert.deepEqual(F.mergeEntries(c.expect, c.a, NOW), c.expect, c.name + ' (idempotent)');
}

// 3) what this device did since the last sync
const base = [e(A, 10, { title: 'A', tags: ['t'] }), e(B, 10, { title: 'B' }), tomb(Cc, 10)];
const subs = [{ url: A, title: 'A', tags: ['t'] }, { url: Cc, title: 'C again', tags: [] }, { url: 'https://d.example/f', title: 'D', tags: ['x'] }];
const le = F.localEntries(subs, base, 99);
assert.deepEqual(le.find((x) => x.url === A), e(A, 10, { title: 'A', tags: ['t'] }), 'unchanged keeps its stamp');
assert.deepEqual(le.find((x) => x.url === B), tomb(B, 99), 'vanished feed gets a tombstone');
assert.equal(le.find((x) => x.url === Cc).updatedAt, 99, 're-added feed replaces its tombstone');
assert.equal(le.find((x) => x.url === 'https://d.example/f').updatedAt, 99);
const edited = F.localEntries([{ url: A, title: 'A renamed', tags: ['t'] }], [e(A, 10, { title: 'A', tags: ['t'] })], 50);
assert.equal(edited[0].updatedAt, 50); assert.equal(edited[0].title, 'A renamed');

// 4) plan
const plan = F.planChanges([{ url: A, title: 'x', tags: [] }, { url: B, title: 'B', tags: [] }], [e(A, 3, { title: 'A', tags: ['n'] }), tomb(B, 3), e(Cc, 3, { title: 'C' })]);
assert.deepEqual(plan, { add: [{ url: Cc, title: 'C', tags: [] }], update: [{ url: A, title: 'A', tags: ['n'] }], remove: [B] });
assert.deepEqual(F.planChanges([{ url: A, title: 'Mine', tags: [] }], [e(A, 3, { title: '' })]), { add: [], update: [], remove: [] }, 'an empty remote title never wipes a local one');

// 5) sealed document: shared vector (AISH_WRITE_VECTOR=1 regenerates it), tamper, wrong vault, wrong key, bomb
const secrets = { vaultId: 'rq2urq2urq2urq2urq2urg', encKey: inboxVec.encKey };
const sample = [e(A, 1760000000000, { title: 'Größe & Wunder ✓', tags: ['Nachrichten', '日本語'] }), tomb(B, 1760000001000)];
if (process.env.AISH_WRITE_VECTOR === '1') {
    const nonce = Uint8Array.from(Buffer.from('404142434445464748494a4b', 'hex'));
    const vec = {
        _about: 'Feed-URL vault. `envelope` is the stored document: decrypt with encKey and vaultId (AES-256-GCM, additional data = vaultId UTF-8, nonce first, tag last), gunzip, parse JSON {v:1, feeds}; must equal `feeds`. `merge` lists cases every implementation must reproduce: mergeEntries(a, b, now) = expect, in both argument orders. Order of the result: updatedAt descending, then url ascending.',
        vaultId: secrets.vaultId, nonceHex: '404142434445464748494a4b', feeds: sample, envelope: await C.encryptVault(secrets, sample, { iv: nonce }),
        now: NOW, merge: cases,
    };
    fs.writeFileSync(vecPath, JSON.stringify(vec, null, 2) + '\n');
    console.log('feed sync vector written');
}
const vec = JSON.parse(fs.readFileSync(vecPath, 'utf8'));
assert.deepEqual(await C.decryptVault({ vaultId: vec.vaultId, encKey: inboxVec.encKey }, vec.envelope), vec.feeds);
for (const c of vec.merge) assert.deepEqual(F.mergeEntries(c.a, c.b, vec.now), c.expect, c.name);
const sealed = await C.encryptVault(secrets, sample);
assert.notEqual(sealed.data, (await C.encryptVault(secrets, sample)).data, 'random nonce');
const flip = (str, at) => { const b = C.fromB64u(str); b[at] ^= 1; return C.toB64u(b); };
for (const at of [0, 14, C.fromB64u(sealed.data).length - 1]) await assert.rejects(C.decryptVault(secrets, { v: 1, data: flip(sealed.data, at) }));
await assert.rejects(C.decryptVault({ ...secrets, vaultId: C.newVaultSecrets().id }, sealed), undefined, 'AAD binds the vault');
await assert.rejects(C.decryptVault({ ...secrets, encKey: C.newInboxSecrets().encKey }, sealed), undefined, 'wrong key');
await assert.rejects(C.decryptVault(secrets, { v: 2, data: sealed.data }), /Unsupported/);
await assert.rejects(C.encryptVault(secrets, Array.from({ length: 3000 }, (_, i) => ({ url: 'https://x.example/' + Math.random() + i, title: Math.random().toString(36).repeat(8), tags: [], updatedAt: i }))), /too large/);

// pairing code with the vault
const sec = C.newInboxSecrets(), v = C.newVaultSecrets();
const code = C.pairingPayload({ ...sec, vault: v });
assert.deepEqual(C.parsePairingPayload(code).vault, v);
assert.equal(C.parsePairingPayload(C.pairingPayload(sec)).vault, null, 'old codes still parse');
assert.throws(() => C.parsePairingPayload(code.replace(/vt=[^&]*/, 'vt=AAAA')));

// 6) two devices through the reference server
const server = createInboxServer({ limits: { putsPerHourPerVault: 1000 } });
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const api = `http://127.0.0.1:${server.address().port}/v1/projects/ai_summary_helper/aish_inboxes`;
const memStorage = () => { const d = {}; return { d,
    async get(keys) { const o = {}; for (const k of [].concat(keys)) if (k in d) o[k] = JSON.parse(JSON.stringify(d[k])); return o; },
    async set(o) { for (const [k, val] of Object.entries(o)) d[k] = JSON.parse(JSON.stringify(val)); },
    async remove(keys) { for (const k of [].concat(keys)) delete d[k]; } }; };
// a "device": its own subscriptions list and sync state; the extension and the phone behave the same way here
let clock = 1_000;
const device = (storage, subs) => {
    const m = M.createInboxManager({ storage, api, now: () => ++clock });
    return { m, subs, sync: () => m.syncFeeds({ getSubs: async () => subs, applyPlan: async (p) => {
        for (const x of p.add) subs.push({ ...x });
        for (const x of p.update) Object.assign(subs.find((s) => s.url === x.url), x);
        for (const u of p.remove) subs.splice(subs.findIndex((s) => s.url === u), 1);
    } }) };
};
const urls = (d) => d.subs.map((s) => s.url).sort();

try {
    const s1 = memStorage();
    const d1 = device(s1, [{ url: A, title: 'A', tags: ['news'] }, { url: B, title: 'B', tags: [] }]);
    assert.deepEqual(await d1.m.syncFeeds({ getSubs: async () => [], applyPlan: async () => {} }), { ok: false, error: 'not-paired' });
    const pr = await d1.m.pair();
    assert(pr.ok); assert.equal(server.vaults.size, 1, 'pair creates the vault');
    assert.equal((await d1.m.status()).vault, true);
    const r1 = await d1.sync();
    assert.deepEqual(r1, { ok: true, added: 0, updated: 0, removed: 0, uploaded: true });
    const raw = JSON.stringify([...server.vaults.values()]);
    assert(!raw.includes('a.example') && !raw.includes('news'), 'the server holds ciphertext only');
    assert.equal((await d1.sync()).uploaded, false, 'nothing changed: no upload');

    // a second device scanning the same code: same key and vault
    const parsed = C.parsePairingPayload(pr.payload);
    const s2 = memStorage();
    await s2.set({ [SK.inboxConfig]: { inboxId: parsed.inboxId, encKey: parsed.encKey, writeToken: parsed.writeToken, readToken: 'x'.repeat(43), vault: parsed.vault, createdAt: 1, v: 1 } });
    const d2 = device(s2, [{ url: Cc, title: 'C', tags: [] }]);
    const r2 = await d2.sync();
    assert.deepEqual([r2.ok, r2.added, r2.uploaded], [true, 2, true]);
    assert.deepEqual(urls(d2), [A, B, Cc].sort());
    assert.deepEqual(d2.subs.find((s) => s.url === A).tags, ['news']);
    await d1.sync(); assert.deepEqual(urls(d1), [A, B, Cc].sort(), 'device 1 gets feed C');

    // removal on one device, rename on the other; both converge
    d1.subs.splice(d1.subs.findIndex((s) => s.url === B), 1);
    d2.subs.find((s) => s.url === A).title = 'A renamed';
    await d1.sync(); await d2.sync(); await d1.sync();
    assert.deepEqual(urls(d1), [A, Cc].sort()); assert.deepEqual(urls(d2), [A, Cc].sort());
    assert.equal(d1.subs.find((s) => s.url === A).title, 'A renamed');

    // re-adding a removed feed brings it back everywhere
    d2.subs.push({ url: B, title: 'B again', tags: ['x'] });
    await d2.sync(); await d1.sync();
    assert(urls(d1).includes(B)); assert.equal(d1.subs.find((s) => s.url === B).title, 'B again');

    // a lost race: another device writes between our GET and PUT; we merge again and retry
    let injected = false;
    const racing = M.createInboxManager({ storage: s1, api, now: () => ++clock, fetchFn: async (u, o) => {
        if (!injected && o.method === 'PUT') {
            injected = true;
            d2.subs.push({ url: 'https://race.example/f', title: 'R', tags: [] });
            await d2.sync();
        }
        return fetch(u, o);
    } });
    d1.subs.push({ url: 'https://mine.example/f', title: 'M', tags: [] });
    const rr = await racing.syncFeeds({ getSubs: async () => d1.subs, applyPlan: async (p) => { for (const x of p.add) d1.subs.push({ ...x }); } });
    assert(injected && rr.ok && rr.uploaded, JSON.stringify(rr));
    assert(urls(d1).includes('https://race.example/f'), 'merged what the other device wrote');
    await d2.sync();
    assert(urls(d2).includes('https://mine.example/f'));
    assert.deepEqual(urls(d1), urls(d2));

    // hostile vault content: a document that decrypts but carries bad URLs applies nothing unsafe
    const cfg = s1.d[SK.inboxConfig];
    const bad = await C.encryptVault({ vaultId: cfg.vault.id, encKey: cfg.encKey }, [{ url: 'javascript:alert(1)', title: 'x', updatedAt: 9e12 }, { url: 'https://ok.example/f', title: 'ok', updatedAt: 9e12 }]);
    const cur = await (await fetch(`${api.replace('aish_inboxes', 'aish_vaults')}/${cfg.vault.id}`, { headers: { Authorization: 'Bearer ' + cfg.vault.token } })).json();
    assert.equal((await fetch(`${api.replace('aish_inboxes', 'aish_vaults')}/${cfg.vault.id}`, { method: 'PUT', headers: { Authorization: 'Bearer ' + cfg.vault.token, 'If-Match': String(cur.rev), 'Content-Type': 'application/json' }, body: JSON.stringify(bad) })).status, 200);
    await d1.sync();
    assert(urls(d1).includes('https://ok.example/f')); assert(!urls(d1).some((u) => u.startsWith('javascript')));

    // a wrong key makes the vault unreadable; a missing vault is reported
    const s3 = memStorage();
    await s3.set({ [SK.inboxConfig]: { ...cfg, encKey: C.newInboxSecrets().encKey } });
    assert.deepEqual(await device(s3, []).sync(), { ok: false, error: 'unreadable' });
    const s4 = memStorage();
    await s4.set({ [SK.inboxConfig]: { ...cfg, vault: undefined } });
    assert.deepEqual(await device(s4, []).sync(), { ok: false, error: 'not-enabled' });
    // a pairing made before this feature switches it on later; the QR gains the vault
    const en = await device(s4, []).m.enableVault();
    assert(en.ok && C.parsePairingPayload(en.payload).vault);
    // unpair deletes the vault on the server too
    const before = server.vaults.size;
    await d1.m.unpair();
    assert.equal(server.vaults.size, before - 1);
    assert.equal(s1.d[SK.feedSync], undefined);
    console.log('test147 ok');
} finally {
    server.close();
}
