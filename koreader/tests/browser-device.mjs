// A browser with the AISH extension, for the plugin's interop tests: the extension's own stamp store, data adapter and sync
// engine over an in-memory chrome.storage, synced against a sync place in a local folder. Its storage can be saved to a
// JSON file and loaded again, so one "browser" can sync several times across test steps.
import fs from 'fs'; import path from 'path'; import crypto from 'crypto'; import { fileURLToPath, pathToFileURL } from 'url';
const here = path.dirname(fileURLToPath(import.meta.url)), SRC = path.resolve(here, '../../plugin/src');
const imp = (m) => import(pathToFileURL(path.join(SRC, m)).href);
export const { SK, articleRecKey, collRecKey, noteRecKey } = await imp('modules/storageKeys.js');
const { createStampStore } = await imp('modules/syncStampStore.js'), { createDataAdapter } = await imp('modules/syncDataAdapter.js');
const { syncEncryptedPlace } = await imp('modules/syncEngine.js'), { createMeta, openMeta } = await imp('modules/syncCrypto.js');
export const PASSPHRASE = 'orbit lemon tunnel paper river cloud';

const etag = (b) => crypto.createHash('sha1').update(b).digest('hex');
/** A sync place in a folder, with ETags and conditional writes like a WebDAV server. */
export function dirStore(place) {
  return { async ping() { return true; },
    async put(p, body, o = {}) { const f = path.join(place, p), cur = fs.existsSync(f) ? etag(fs.readFileSync(f)) : null; if (o.ifNoneMatch === '*' && cur) throw Object.assign(new Error('exists'), { status: 412 }); if (o.ifMatch && cur !== o.ifMatch) throw Object.assign(new Error('changed'), { status: 412 }); fs.mkdirSync(path.dirname(f), { recursive: true }); const b = Buffer.from(body); fs.writeFileSync(f, b); return { etag: etag(b) }; },
    async get(p) { const f = path.join(place, p); return fs.existsSync(f) ? { bytes: new Uint8Array(fs.readFileSync(f)), etag: etag(fs.readFileSync(f)) } : null; },
    async remove(p) { const f = path.join(place, p); if (!fs.existsSync(f)) return false; fs.unlinkSync(f); return true; },
    async list(prefix = '') { const d = path.join(place, prefix); return fs.existsSync(d) ? fs.readdirSync(d).filter((n) => fs.statSync(path.join(d, n)).isFile()).map((n) => ({ path: (prefix ? prefix + '/' : '') + n, etag: etag(fs.readFileSync(path.join(d, n))), size: fs.statSync(path.join(d, n)).size })) : []; } };
}

export async function makeDevice(stateFile) {
  let clock = Date.now();
  const data = new Map(stateFile && fs.existsSync(stateFile) ? Object.entries(JSON.parse(fs.readFileSync(stateFile, 'utf8'))) : []);
  const pending = [];
  let st;
  const area = {
    get(keys, cb) { let o = {}; if (keys == null) for (const [k, v] of data) o[k] = v; else if (typeof keys === 'string') { if (data.has(keys)) o[keys] = data.get(keys); } else if (Array.isArray(keys)) keys.forEach((k) => { if (data.has(k)) o[k] = data.get(k); }); else for (const [k, d] of Object.entries(keys)) o[k] = data.has(k) ? data.get(k) : d; o = JSON.parse(JSON.stringify(o)); if (cb) { cb(o); return; } return Promise.resolve(o); },
    set(obj, cb) { const ch = {}; for (const [k, v] of Object.entries(obj)) { ch[k] = { oldValue: data.get(k), newValue: JSON.parse(JSON.stringify(v)) }; data.set(k, ch[k].newValue); } pending.push(new Promise((r) => setTimeout(async () => { await st.onChanged(ch); r(); }, 0))); if (cb) cb(); return Promise.resolve(); },
    remove(keys, cb) { const ch = {}; for (const k of [].concat(keys)) { ch[k] = { oldValue: data.get(k) }; data.delete(k); } pending.push(new Promise((r) => setTimeout(async () => { await st.onChanged(ch); r(); }, 0))); if (cb) cb(); return Promise.resolve(); } };
  st = createStampStore({ storage: area, now: () => (clock = Math.max(clock + 10, Date.now())) });
  const adapter = createDataAdapter({ storage: area });
  const idle = async () => { await new Promise((r) => setTimeout(r, 5)); while (pending.length) await pending.shift(); await new Promise((r) => setTimeout(r, 5)); };
  let crypt = null;
  const dev = {
    data, area, st, idle,
    /** a new place in `place` (meta.json, 1000 key rounds) */
    async createPlace(place) { const c = await createMeta(PASSPHRASE, { iterations: 1000 }); fs.mkdirSync(path.join(place, 'r'), { recursive: true }); fs.writeFileSync(path.join(place, 'meta.json'), JSON.stringify(c.meta, null, 2) + '\n'); crypt = c; await area.set({ [SK.syncPlaces]: [{ id: 'p1', enabled: true }] }); },
    async sync(place) {
      await idle();
      if (!crypt) { const meta = JSON.parse(fs.readFileSync(path.join(place, 'meta.json'), 'utf8')); crypt = { meta, keys: (await openMeta(meta, { passphrase: PASSPHRASE })).keys }; }
      const r = await syncEncryptedPlace({ place: { id: 'p1' }, storage: area, store: dirStore(place), keys: crypt.keys, meta: crypt.meta, stampStore: st, adapter, now: () => Date.now() });
      await idle();
      if (r.errors && r.errors.length) throw new Error(JSON.stringify(r.errors));
      return r;
    },
    save(file) { fs.writeFileSync(file || stateFile, JSON.stringify(Object.fromEntries(data))); },
  };
  return dev;
}
