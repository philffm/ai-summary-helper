// Phone inbox crypto: the shared test vector, tamper and replay rejection, link filtering, pairing code.
import assert from 'assert';
import fs from 'fs';
import path from 'path';
import { imp } from './harness.mjs';

const C = await imp('modules/inboxCrypto.js');
const vec = JSON.parse(fs.readFileSync(path.join(process.env.AISH_TESTS, 'fixtures/inbox-vector.json'), 'utf8'));
const secrets = { inboxId: vec.inboxId, encKey: vec.encKey };

// 1) the shared vector (produced with node:crypto, not with this module) decrypts, and encrypting with its nonce reproduces it
assert.deepEqual(await C.decryptMessage(secrets, vec.envelope), vec.message);
const nonce = Uint8Array.from(Buffer.from(vec.nonceHex, 'hex'));
assert.deepEqual(await C.encryptMessage(secrets, vec.message, { iv: nonce }), vec.envelope, 'same bytes as the vector');
assert.equal(await C.tokenHash(vec.writeToken), vec.writeHash);
assert.equal(await C.tokenHash(vec.readToken), vec.readHash);

// 2) tampering, wrong inbox (replay into another inbox), wrong key and unknown versions are rejected
const flip = (s, at) => { const b = C.fromB64u(s); b[at] ^= 1; return C.toB64u(b); };
for (const at of [0, 12, 30, C.fromB64u(vec.envelope.data).length - 1]) {
    await assert.rejects(C.decryptMessage(secrets, { v: 1, data: flip(vec.envelope.data, at) }), undefined, 'flipped byte ' + at);
}
await assert.rejects(C.decryptMessage({ ...secrets, inboxId: C.newInboxSecrets().inboxId }, vec.envelope), undefined, 'AAD binds the inbox');
await assert.rejects(C.decryptMessage({ ...secrets, encKey: C.newInboxSecrets().encKey }, vec.envelope), undefined, 'wrong key');
await assert.rejects(C.decryptMessage(secrets, { ...vec.envelope, v: 2 }), /Unsupported/);
await assert.rejects(C.decryptMessage(secrets, { v: 1, data: 'AAAA' }), /short/);
await assert.rejects(C.decryptMessage(secrets, null), /Unsupported/);

// 3) a random nonce every time; round trip with a new inbox
const s = C.newInboxSecrets();
const a = await C.encryptMessage(s, { url: 'https://example.org/x', platform: 'android' });
const b = await C.encryptMessage(s, { url: 'https://example.org/x', platform: 'android' });
assert.notEqual(a.data, b.data, 'fresh nonce');
const back = await C.decryptMessage(s, a);
assert.equal(back.url, 'https://example.org/x'); assert.equal(back.platform, 'android'); assert(back.sentAt > 0);
await assert.rejects(C.encryptMessage(s, { url: 'javascript:alert(1)' }), /web link/);

// 4) links: only http(s), whitespace and control characters stripped, length capped
assert.equal(C.cleanLink('https://example.com/a b'), 'https://example.com/ab');
assert.equal(C.cleanLink(' http://example.com\n'), 'http://example.com/');
for (const bad of ['javascript:alert(1)', 'file:///etc/passwd', 'data:text/html,hi', 'chrome-extension://abc/popup.html', 'moz-extension://x/y', 'ftp://example.com',
    'about:blank', '', '   ', 'https://', 'not a url', null, undefined, 42, {}, 'https://example.com/' + 'a'.repeat(2100)]) {
    assert.equal(C.cleanLink(bad), null, 'rejects ' + String(bad).slice(0, 30));
}

// 5) pairing code: matches the vector, round-trips, never contains the read token, rejects malformed codes
assert.equal(C.pairingPayload(vec), vec.pairing);
assert.deepEqual(C.parsePairingPayload(vec.pairing), { inboxId: vec.inboxId, encKey: vec.encKey, writeToken: vec.writeToken, toPhone: null });
assert(!C.pairingPayload(s).includes(s.readToken), 'read token stays in the extension');
for (const bad of ['', 'https://example.com', C.PAIRING_SCHEME + '?i=abc&k=def&w=ghi', vec.pairing.replace(/&w=.*/, ''), vec.pairing + 'x&']) {
    assert.throws(() => C.parsePairingPayload(bad), undefined, 'rejects ' + bad.slice(0, 30));
}
assert.throws(() => C.pairingPayload({ inboxId: 'a', encKey: 'b', writeToken: 'c' }));

// 6) secrets have the right sizes and are unique; base64url round trips at every length
const ids = new Set();
for (let i = 0; i < 20; i++) { const x = C.newInboxSecrets(); ids.add(x.inboxId); assert.equal(C.fromB64u(x.inboxId).length, 16); assert.equal(C.fromB64u(x.encKey).length, 32); assert.equal(C.fromB64u(x.writeToken).length, 32); assert.equal(C.fromB64u(x.readToken).length, 32); }
assert.equal(ids.size, 20);
for (let n = 0; n <= 70; n++) { const bytes = crypto.getRandomValues(new Uint8Array(n)); assert.deepEqual(C.fromB64u(C.toB64u(bytes)), bytes); }
assert.throws(() => C.fromB64u('a+b/'), /base64url/);
console.log('ok');
