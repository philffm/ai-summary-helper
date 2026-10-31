// modules/syncCrypto.js
// Keys and encryption for encrypted sync places (see .briefs/prd-library-sync.md section 4). Pure Web Crypto, no chrome.*,
// so it runs in the popup, the worker and the Node tests.
//
//   passphrase --PBKDF2-SHA256(salt, iterations)--> 32-byte master key
//   master --HKDF--> encKey (AES-256-GCM) and nameKey (HMAC-SHA256, for opaque file names)
//   file = version byte (1) | 12-byte nonce | AES-GCM ciphertext of gzip(JSON)
// `meta.json` (plain) holds the salt, the iteration count and a key-check blob, so a wrong passphrase is caught before anything is written.
export const FILE_VERSION = 1;
export const KDF_ITERATIONS = 600000;
const te = new TextEncoder(), td = new TextDecoder();
const subtle = () => globalThis.crypto.subtle;
const CHECK_TEXT = 'aish-sync-ok';

export const toB64 = (u8) => { let s = ''; for (const b of u8) s += String.fromCharCode(b); return btoa(s); };
export const fromB64 = (b64) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
export const toHex = (u8) => [...u8].map((b) => b.toString(16).padStart(2, '0')).join('');
export const randomBytes = (n) => globalThis.crypto.getRandomValues(new Uint8Array(n));

export async function deriveMaster(passphrase, salt, iterations = KDF_ITERATIONS) {
    const base = await subtle().importKey('raw', te.encode(String(passphrase)), 'PBKDF2', false, ['deriveBits']);
    return new Uint8Array(await subtle().deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, base, 256));
}

async function hkdf(master, info, usage, alg) {
    const base = await subtle().importKey('raw', master, 'HKDF', false, ['deriveKey']);
    return subtle().deriveKey({ name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(0), info: te.encode(info) }, base, alg, false, usage);
}
/** { enc, name } from a master key. */
export async function subKeys(master) {
    return {
        enc: await hkdf(master, 'aish-sync-enc-v1', ['encrypt', 'decrypt'], { name: 'AES-GCM', length: 256 }),
        name: await hkdf(master, 'aish-sync-name-v1', ['sign'], { name: 'HMAC', hash: 'SHA-256', length: 256 }),
    };
}

async function gzip(bytes) {
    const cs = new CompressionStream('gzip'); const w = cs.writable.getWriter(); w.write(bytes); w.close();
    return new Uint8Array(await new Response(cs.readable).arrayBuffer());
}
async function gunzip(bytes, maxBytes = 64 * 1024 * 1024) {
    const ds = new DecompressionStream('gzip'); const w = ds.writable.getWriter(); w.write(bytes); w.close();
    const out = new Uint8Array(await new Response(ds.readable).arrayBuffer());
    if (out.byteLength > maxBytes) throw new Error('The file is larger than expected.');
    return out;
}

/** JSON-able value → encrypted file bytes. `nonce` only for tests. */
export async function encryptJson(keys, value, nonce = randomBytes(12)) {
    const ct = new Uint8Array(await subtle().encrypt({ name: 'AES-GCM', iv: nonce }, keys.enc, await gzip(te.encode(JSON.stringify(value)))));
    const out = new Uint8Array(1 + 12 + ct.length);
    out[0] = FILE_VERSION; out.set(nonce, 1); out.set(ct, 13);
    return out;
}
/** Encrypted file bytes → value. Throws on a wrong key, a damaged file or an unknown version. */
export async function decryptJson(keys, bytes) {
    if (!bytes || bytes.length < 30 || bytes[0] !== FILE_VERSION) throw new Error('This file is not a sync file this version understands.');
    let plain;
    try { plain = await subtle().decrypt({ name: 'AES-GCM', iv: bytes.slice(1, 13) }, keys.enc, bytes.slice(13)); }
    catch (_) { throw new Error('The file could not be decrypted: wrong passphrase or damaged file.'); }
    return JSON.parse(td.decode(await gunzip(new Uint8Array(plain))));
}

/** Opaque, stable file name for a record: hex of HMAC(nameKey, "type:id"). */
export async function nameOf(keys, type, id) {
    return toHex(new Uint8Array(await subtle().sign('HMAC', keys.name, te.encode(type + ':' + id))));
}

/** Keys from a master key already held by this device (the background worker): checks the key-check blob first. */
export async function openWithMaster(meta, master) {
    if (!meta || meta.mode !== 'encrypted' || !meta.check) throw new Error('This place is not an encrypted AISH sync place.');
    const keys = await subKeys(master);
    let ok = false;
    try { ok = (await decryptJson(keys, fromB64(meta.check))) === CHECK_TEXT; } catch (_) { ok = false; }
    if (!ok) throw new Error('The key saved on this device does not open this place any more. Remove the place and add it again.');
    return keys;
}

// ── meta.json ──
/** A new place: random salt, key-check blob. Returns { meta, master, keys }. */
export async function createMeta(passphrase, { iterations = KDF_ITERATIONS } = {}) {
    const salt = randomBytes(16);
    const master = await deriveMaster(passphrase, salt, iterations);
    const keys = await subKeys(master);
    const check = await encryptJson(keys, CHECK_TEXT);
    return { meta: { aish: 'sync/1', mode: 'encrypted', kdf: 'pbkdf2-sha256', iterations, salt: toB64(salt), check: toB64(check) }, master, keys };
}
/** Opens an existing place with its passphrase. Returns { master, keys } or throws "wrong passphrase". */
export async function openMeta(meta, { passphrase }) {
    if (!meta || meta.mode !== 'encrypted' || !meta.salt || !meta.check) throw new Error('This place is not an encrypted AISH sync place.');
    const master = await deriveMaster(passphrase, fromB64(meta.salt), Number(meta.iterations) || KDF_ITERATIONS);
    const keys = await subKeys(master);
    let ok = false;
    try { ok = (await decryptJson(keys, fromB64(meta.check))) === CHECK_TEXT; } catch (_) { ok = false; }
    if (!ok) throw new Error('Wrong passphrase.');
    return { master, keys };
}
