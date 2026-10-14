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

import { cleanBlocks } from './articleBlocks.js';

export const INBOX_VERSION = 1;
export const MAX_URL_LENGTH = 2048;
export const PAIRING_SCHEME = 'aish-inbox://v1';
// Articles for the phone (extension → phone) travel in a second inbox, envelope version 2: the plaintext is gzip(JSON).
export const ARTICLE_VERSION = 2;
export const MAX_ARTICLE_GZ = 135000;       // bytes of gzipped JSON; keeps the base64url ciphertext under the server's 190,000-character item cap
export const MAX_ARTICLE_RAW = 4000000;     // bytes after decompression (guards against a decompression bomb)

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

/**
 * The text inside the QR code. It carries the id, the key and the write token of the phone→extension inbox, never its read
 * token. When articles can go the other way, `toPhone` adds the id (ti) and the READ token (tr) of the extension→phone
 * inbox; the same key (k) protects both, and the inbox id is bound into every ciphertext, so one cannot be replayed into the other.
 * `vault` adds the id (vi) and token (vt) of the feed-URL vault (feedSync.js); it is sealed with the same key and its own id as additional data.
 */
// The Pro license key may travel in the pairing code (lk) so the phone can use the cloud AI and show the plan. It is optional and
// never used for the inbox or vault, which stay anonymous. Anything that does not look like a key is left out / ignored.
const LICENSE_RE = /^[A-Za-z0-9._~:-]{8,200}$/;
export const isLicenseKey = (v) => typeof v === 'string' && LICENSE_RE.test(v);

export function pairingPayload({ inboxId, encKey, writeToken, toPhone, vault }, license) {
    if (lengthOf(inboxId) !== 16 || lengthOf(encKey) !== 32 || lengthOf(writeToken) !== 32) throw new Error('Invalid pairing secrets');
    let out = `${PAIRING_SCHEME}?i=${inboxId}&k=${encKey}&w=${writeToken}`;
    if (toPhone) {
        if (lengthOf(toPhone.inboxId) !== 16 || lengthOf(toPhone.readToken) !== 32) throw new Error('Invalid pairing secrets');
        out += `&ti=${toPhone.inboxId}&tr=${toPhone.readToken}`;
    }
    if (vault) {
        if (lengthOf(vault.id) !== 16 || lengthOf(vault.token) !== 32) throw new Error('Invalid pairing secrets');
        out += `&vi=${vault.id}&vt=${vault.token}`;
    }
    if (isLicenseKey(license)) out += `&lk=${license}`;
    return out;
}

/** Inverse of pairingPayload; used by tests and as the reference for the phone apps. Throws on anything malformed. */
export function parsePairingPayload(text) {
    const s = String(text || '').trim();
    if (!s.startsWith(PAIRING_SCHEME + '?')) throw new Error('Not an AISH pairing code');
    const q = new URLSearchParams(s.slice(PAIRING_SCHEME.length + 1));
    const out = { inboxId: q.get('i'), encKey: q.get('k'), writeToken: q.get('w'), toPhone: null, vault: null, license: null };
    if (lengthOf(out.inboxId) !== 16 || lengthOf(out.encKey) !== 32 || lengthOf(out.writeToken) !== 32) throw new Error('Invalid pairing code');
    if (q.get('ti') || q.get('tr')) {
        const t = { inboxId: q.get('ti'), readToken: q.get('tr') };
        if (lengthOf(t.inboxId) !== 16 || lengthOf(t.readToken) !== 32) throw new Error('Invalid pairing code');
        out.toPhone = t;
    }
    if (q.get('vi') || q.get('vt')) {
        const v = { id: q.get('vi'), token: q.get('vt') };
        if (lengthOf(v.id) !== 16 || lengthOf(v.token) !== 32) throw new Error('Invalid pairing code');
        out.vault = v;
    }
    const lk = q.get('lk');
    if (isLicenseKey(lk)) out.license = lk;
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

// ── articles for the phone (envelope v2) ─────────────────────────────────────────────────────────────────────────
const clip = (v, n) => String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, n);

async function gzipBytes(bytes) {
    const cs = new CompressionStream('gzip');
    const w = cs.writable.getWriter();
    w.write(bytes); w.close();
    return new Uint8Array(await new Response(cs.readable).arrayBuffer());
}

async function gunzipBytes(bytes, limit = MAX_ARTICLE_RAW) {
    const ds = new DecompressionStream('gzip');
    const w = ds.writable.getWriter();
    w.write(bytes).catch(() => {}); w.close().catch(() => {});
    const reader = ds.readable.getReader();
    const chunks = []; let total = 0;
    for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.length;
        if (total > limit) { try { await reader.cancel(); } catch (_) { /* already stopped */ } throw new Error('Article too large'); }
        chunks.push(value);
    }
    const out = new Uint8Array(total); let o = 0;
    for (const c of chunks) { out.set(c, o); o += c.length; }
    return out;
}

/** Normalises an article message (from the app or from the wire): web link only, known block types only, clipped fields. */
export function cleanArticleMessage(m) {
    const url = cleanLink(m && m.url);
    if (!url) throw new Error('Not a web link');
    const blocks = cleanBlocks(m.blocks);
    if (!blocks.length) throw new Error('Empty article');
    const out = {
        v: ARTICLE_VERSION, url,
        sentAt: Number.isFinite(m.sentAt) ? m.sentAt : 0,
        title: clip(m.title, 300), site: clip(m.site, 120), byline: clip(m.byline, 200), lang: clip(m.lang, 20),
        blocks,
    };
    const summary = String(m.summary || '').trim().slice(0, 8000);
    if (summary) out.summary = summary;
    const hl = cleanHighlights(m.hl);
    if (hl.length) out.hl = hl;
    if (m.truncated === true) out.truncated = true;
    const aid = clip(m.aid, 80);   // the extension's article id (optional; apps that do not know it ignore it)
    if (/^[A-Za-z0-9_-]{1,80}$/.test(aid)) out.aid = aid;
    return out;
}

export const MAX_HIGHLIGHTS = 200;
/** Highlights travel as [kind, text] pairs: kind "u" = the user's own, "g" = AI ghost highlight. The phone marks them where the text is found. */
export function cleanHighlights(list) {
    const out = [];
    for (const h of Array.isArray(list) ? list : []) {
        if (!Array.isArray(h)) continue;
        const kind = h[0] === 'g' ? 'g' : h[0] === 'u' ? 'u' : '';
        const text = clip(h[1], 600);
        if (kind && text.length >= 5 && !out.some((x) => x[1] === text)) out.push([kind, text]);
        if (out.length >= MAX_HIGHLIGHTS) break;
    }
    return out;
}

/**
 * Encrypts one article for the extension→phone inbox. The JSON is gzipped first (ciphertext does not compress), then sealed
 * with AES-256-GCM with the inbox id as additional data; output { v: 2, data }. When the gzip would exceed MAX_ARTICLE_GZ the
 * tail of the article is dropped and `truncated` is set. `opts.iv` exists only for the shared test vector.
 */
export async function encryptArticle({ inboxId, encKey }, message, opts = {}) {
    let msg = cleanArticleMessage({ ...message, sentAt: Number.isFinite(message && message.sentAt) ? message.sentAt : Date.now() });
    let gz = await gzipBytes(te.encode(JSON.stringify(msg)));
    let keep = msg.blocks.length;
    while (gz.length > MAX_ARTICLE_GZ && keep > 1) {
        keep = Math.max(1, Math.floor(keep * 0.8));
        msg = { ...msg, blocks: msg.blocks.slice(0, keep), truncated: true };
        gz = await gzipBytes(te.encode(JSON.stringify(msg)));
    }
    if (gz.length > MAX_ARTICLE_GZ) throw new Error('Article too large');
    const iv = opts.iv ? new Uint8Array(opts.iv) : randomBytes(12);
    if (iv.length !== 12) throw new Error('Invalid nonce length');
    const key = await importKey(encKey, 'encrypt');
    const sealed = new Uint8Array(await subtle().subtle.encrypt({ name: 'AES-GCM', iv, additionalData: te.encode(inboxId), tagLength: 128 }, key, gz));
    const out = new Uint8Array(12 + sealed.length);
    out.set(iv, 0); out.set(sealed, 12);
    return { envelope: { v: ARTICLE_VERSION, data: toB64u(out) }, blocks: msg.blocks.length, truncated: !!msg.truncated, bytes: gz.length };
}

/** Reference decryption for tests and the phone apps: bad tag, wrong inbox, wrong version, bomb or non-web link all throw. */
export async function decryptArticle({ inboxId, encKey }, envelope) {
    if (!envelope || envelope.v !== ARTICLE_VERSION || typeof envelope.data !== 'string') throw new Error('Unsupported envelope');
    const all = fromB64u(envelope.data);
    if (all.length < 12 + 16 + 2) throw new Error('Envelope too short');
    const key = await importKey(encKey, 'decrypt');
    const gz = new Uint8Array(await subtle().subtle.decrypt({ name: 'AES-GCM', iv: all.subarray(0, 12), additionalData: te.encode(inboxId), tagLength: 128 }, key, all.subarray(12)));
    const msg = JSON.parse(td.decode(await gunzipBytes(gz)));
    if (!msg || msg.v !== ARTICLE_VERSION) throw new Error('Unsupported message');
    return cleanArticleMessage(msg);
}

// ── feed-URL vault (document v1) ─────────────────────────────────────────────────────────────────────────────────

export const VAULT_VERSION = 1;
export const MAX_VAULT_GZ = 55000;          // bytes of gzipped JSON; keeps the base64url ciphertext under the server's 80,000-character cap
export const MAX_VAULT_RAW = 1000000;       // bytes after decompression

export function newVaultSecrets() { return { id: toB64u(randomBytes(16)), token: toB64u(randomBytes(32)) }; }

/**
 * Seals the feed list: plaintext = gzip(JSON {v:1, feeds:[entry…]}), AES-256-GCM with the vault id as additional data,
 * output { v: 1, data: base64url(nonce || ciphertext || tag) }. `opts.iv` exists only for the shared test vector.
 */
export async function encryptVault({ vaultId, encKey }, feeds, opts = {}) {
    const gz = await gzipBytes(te.encode(JSON.stringify({ v: VAULT_VERSION, feeds })));
    if (gz.length > MAX_VAULT_GZ) throw new Error('Vault too large');
    const iv = opts.iv ? new Uint8Array(opts.iv) : randomBytes(12);
    if (iv.length !== 12) throw new Error('Invalid nonce length');
    const key = await importKey(encKey, 'encrypt');
    const sealed = new Uint8Array(await subtle().subtle.encrypt({ name: 'AES-GCM', iv, additionalData: te.encode(vaultId), tagLength: 128 }, key, gz));
    const out = new Uint8Array(12 + sealed.length);
    out.set(iv, 0); out.set(sealed, 12);
    return { v: VAULT_VERSION, data: toB64u(out) };
}

/** Returns the raw feed list (not yet cleaned: feedSync.cleanEntries does that). Throws on a bad tag, wrong vault, wrong version or a bomb. */
export async function decryptVault({ vaultId, encKey }, doc) {
    if (!doc || doc.v !== VAULT_VERSION || typeof doc.data !== 'string') throw new Error('Unsupported envelope');
    const all = fromB64u(doc.data);
    if (all.length < 12 + 16 + 2) throw new Error('Envelope too short');
    const key = await importKey(encKey, 'decrypt');
    const gz = new Uint8Array(await subtle().subtle.decrypt({ name: 'AES-GCM', iv: all.subarray(0, 12), additionalData: te.encode(vaultId), tagLength: 128 }, key, all.subarray(12)));
    const msg = JSON.parse(td.decode(await gunzipBytes(gz, MAX_VAULT_RAW)));
    if (!msg || msg.v !== VAULT_VERSION || !Array.isArray(msg.feeds)) throw new Error('Unsupported message');
    return msg.feeds;
}
