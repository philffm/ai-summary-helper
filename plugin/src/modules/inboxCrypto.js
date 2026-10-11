// modules/inboxCrypto.js
// End-to-end encryption and pairing for the phone inbox (a link shared on the phone ends up in the extension).
//
// Pure Web Crypto: no chrome.*, no DOM, so the same file runs in the popup, in the background worker (bundled as a
// classic script) and in the Node tests. The wire format is shared with the phone apps; tests/fixtures/inbox-vector.json
// holds a fixed key, nonce and message that every implementation (extension, iOS, Android) must decrypt.
//
// Design (see the build plan): the server only ever stores ciphertext.
//   • inboxId      16 random bytes, names the inbox
//   • encKey       32 random bytes, AES-256-GCM key; shared with the phone through the QR code
//   • writeToken   32 random bytes, lets the phone append items; shared with the phone
//   • readToken    32 random bytes, lets the extension read, acknowledge and delete; never leaves the extension
// The server stores only SHA-256 hashes of the two tokens.

export const INBOX_VERSION = 1;
export const MAX_URL_LENGTH = 2048;
export const PAIRING_SCHEME = 'aish-inbox://v1';

const te = new TextEncoder();
const td = new TextDecoder();

const subtle = () => {
    const c = globalThis.crypto;
    if (!c || !c.subtle || !c.getRandomValues) throw new Error('Web Crypto is not available');
    return c;
};

// ── base64url (no padding) ───────────────────────────────────────────────────────────────────────────────────────
export function toB64u(bytes) {
    const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    let bin = '';
    for (let i = 0; i < u8.length; i += 0x8000) bin += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
    return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function fromB64u(str) {
    if (typeof str !== 'string' || !/^[A-Za-z0-9_-]*$/.test(str)) throw new Error('Not base64url');
    const b64 = str.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((str.length + 3) % 4);
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
}

const randomBytes = (n) => subtle().getRandomValues(new Uint8Array(n));

// ── secrets, hashes, pairing code ────────────────────────────────────────────────────────────────────────────────
/** Fresh secrets for a new inbox. Every field is base64url text, ready to store. */
export function newInboxSecrets() {
    return {
        inboxId: toB64u(randomBytes(16)),
        encKey: toB64u(randomBytes(32)),
        writeToken: toB64u(randomBytes(32)),
        readToken: toB64u(randomBytes(32)),
    };
}

/** Lowercase hex SHA-256 of a token (what the server stores and compares). */
export async function tokenHash(token) {
    const digest = await subtle().subtle.digest('SHA-256', te.encode(String(token)));
    return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

const lengthOf = (b64) => { try { return fromB64u(b64).length; } catch (_) { return -1; } };

/** The text inside the QR code. It carries the id, the key and the write token, never the read token. */
export function pairingPayload({ inboxId, encKey, writeToken }) {
    if (lengthOf(inboxId) !== 16 || lengthOf(encKey) !== 32 || lengthOf(writeToken) !== 32) throw new Error('Invalid pairing secrets');
    return `${PAIRING_SCHEME}?i=${inboxId}&k=${encKey}&w=${writeToken}`;
}

/** Inverse of pairingPayload; used by tests and as the reference for the phone apps. Throws on anything malformed. */
export function parsePairingPayload(text) {
    const s = String(text || '').trim();
    if (!s.startsWith(PAIRING_SCHEME + '?')) throw new Error('Not an AISH pairing code');
    const q = new URLSearchParams(s.slice(PAIRING_SCHEME.length + 1));
    const out = { inboxId: q.get('i'), encKey: q.get('k'), writeToken: q.get('w') };
    if (lengthOf(out.inboxId) !== 16 || lengthOf(out.encKey) !== 32 || lengthOf(out.writeToken) !== 32) throw new Error('Invalid pairing code');
    return out;
}

// ── links ────────────────────────────────────────────────────────────────────────────────────────────────────────
/**
 * Accepts only web links. The phone is not trusted: the extension opens whatever this returns in a tab, so
 * javascript:, file:, data: and extension URLs must never get through. Returns the normalised URL or null.
 */
export function cleanLink(raw) {
    if (typeof raw !== 'string') return null;
    const s = raw.replace(/[\u0000-\u001f\u007f\s]+/g, '').slice(0, MAX_URL_LENGTH + 1);
    if (!s || s.length > MAX_URL_LENGTH) return null;
    let u;
    try { u = new URL(s); } catch (_) { return null; }
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
    if (!u.hostname) return null;
    return u.href;
}

// ── encrypt / decrypt ────────────────────────────────────────────────────────────────────────────────────────────
async function importKey(encKeyB64, usage) {
    const raw = fromB64u(encKeyB64);
    if (raw.length !== 32) throw new Error('Invalid key length');
    return subtle().subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, [usage]);
}

/**
 * Encrypts one message for the inbox. Plaintext is the JSON of {v, url, sentAt, platform}; the inbox id is bound in as
 * additional authenticated data, so a ciphertext cannot be replayed into another inbox. Output: { v, data } where data is
 * base64url of nonce(12) || ciphertext || tag(16). `opts.iv` exists only for the shared test vector.
 */
export async function encryptMessage({ inboxId, encKey }, message, opts = {}) {
    const url = cleanLink(message && message.url);
    if (!url) throw new Error('Not a web link');
    const body = { v: INBOX_VERSION, url, sentAt: Number.isFinite(message.sentAt) ? message.sentAt : Date.now() };
    if (message.platform === 'ios' || message.platform === 'android' || message.platform === 'web') body.platform = message.platform;
    const iv = opts.iv ? new Uint8Array(opts.iv) : randomBytes(12);
    if (iv.length !== 12) throw new Error('Invalid nonce length');
    const key = await importKey(encKey, 'encrypt');
    const sealed = new Uint8Array(await subtle().subtle.encrypt(
        { name: 'AES-GCM', iv, additionalData: te.encode(inboxId), tagLength: 128 }, key, te.encode(JSON.stringify(body))));
    const out = new Uint8Array(12 + sealed.length);
    out.set(iv, 0); out.set(sealed, 12);
    return { v: INBOX_VERSION, data: toB64u(out) };
}

/** Decrypts one envelope. Throws on a bad tag, wrong inbox, unknown version or a non-web link. */
export async function decryptMessage({ inboxId, encKey }, envelope) {
    if (!envelope || envelope.v !== INBOX_VERSION || typeof envelope.data !== 'string') throw new Error('Unsupported envelope');
    const all = fromB64u(envelope.data);
    if (all.length < 12 + 16 + 2) throw new Error('Envelope too short');
    const key = await importKey(encKey, 'decrypt');
    const plain = await subtle().subtle.decrypt(
        { name: 'AES-GCM', iv: all.subarray(0, 12), additionalData: te.encode(inboxId), tagLength: 128 }, key, all.subarray(12));
    const msg = JSON.parse(td.decode(plain));
    if (!msg || msg.v !== INBOX_VERSION) throw new Error('Unsupported message');
    const url = cleanLink(msg.url);
    if (!url) throw new Error('Not a web link');
    return { url, sentAt: Number.isFinite(msg.sentAt) ? msg.sentAt : 0, platform: typeof msg.platform === 'string' ? msg.platform : '' };
}
