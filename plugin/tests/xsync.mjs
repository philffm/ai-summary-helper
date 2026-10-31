// Cross-implementation check: the extension's sync engine (JavaScript) and the phone's (Kotlin) sync through one folder, taking turns.
//   node plugin/tests/xsync.mjs        (needs the Android SDK; takes a few minutes: it runs the Gradle test twice)
// Not part of the normal suite. The phone side is mobile/android/.../sync/CrossSyncTest.kt (skipped unless this script sets AISH_XSYNC_DIR).
import assert from 'assert';
import fs from 'fs'; import os from 'os'; import path from 'path'; import crypto from 'crypto'; import { execFileSync } from 'child_process'; import { fileURLToPath, pathToFileURL } from 'url';
const here = path.dirname(fileURLToPath(import.meta.url)), SRC = path.resolve(here, '../src');
process.env.AISH_SRC = SRC;
const imp = (m) => import(pathToFileURL(path.join(SRC, m)).href);
const { SK, articleRecKey, collRecKey, noteRecKey } = await imp('modules/storageKeys.js');
const { createStampStore } = await imp('modules/syncStampStore.js'), { createDataAdapter } = await imp('modules/syncDataAdapter.js');
const { syncEncryptedPlace } = await imp('modules/syncEngine.js'), { createMeta, openMeta } = await imp('modules/syncCrypto.js');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aish-xsync-')), place = path.join(root, 'place');
fs.mkdirSync(path.join(place, 'r'), { recursive: true });
const etag = (b) => crypto.createHash('sha1').update(b).digest('hex');
const dirStore = { async ping() { return true; },
  async put(p, body, o = {}) { const f = path.join(place, p), cur = fs.existsSync(f) ? etag(fs.readFileSync(f)) : null; if (o.ifNoneMatch === '*' && cur) throw Object.assign(new Error('exists'), { status: 412 }); if (o.ifMatch && cur !== o.ifMatch) throw Object.assign(new Error('changed'), { status: 412 }); fs.mkdirSync(path.dirname(f), { recursive: true }); const b = typeof body === 'string' ? Buffer.from(body) : Buffer.from(body); fs.writeFileSync(f, b); return { etag: etag(b) }; },
  async get(p) { const f = path.join(place, p); return fs.existsSync(f) ? { bytes: new Uint8Array(fs.readFileSync(f)), etag: etag(fs.readFileSync(f)) } : null; },
  async remove(p) { const f = path.join(place, p); if (!fs.existsSync(f)) return false; fs.unlinkSync(f); return true; },
  async list(prefix = '') { const d = path.join(place, prefix); return fs.existsSync(d) ? fs.readdirSync(d).filter((n) => fs.statSync(path.join(d, n)).isFile()).map((n) => ({ path: (prefix ? prefix + '/' : '') + n, etag: etag(fs.readFileSync(path.join(d, n))), size: fs.statSync(path.join(d, n)).size })) : []; } };

const created = await createMeta('xsync passphrase', { iterations: 1000 });
fs.writeFileSync(path.join(place, 'meta.json'), JSON.stringify(created.meta));
const K = { meta: created.meta, keys: created.keys };

// the extension, as a device with a stamp store wired to its storage events
let clock = Date.now();
const data = new Map(), pending = [];
const area = {
  get(keys, cb) { let out = {}; if (keys == null) for (const [k, v] of data) out[k] = v; else if (typeof keys === 'string') { if (data.has(keys)) out[keys] = data.get(keys); } else if (Array.isArray(keys)) keys.forEach((k) => { if (data.has(k)) out[k] = data.get(k); }); else for (const [k, d] of Object.entries(keys)) out[k] = data.has(k) ? data.get(k) : d; out = JSON.parse(JSON.stringify(out)); if (cb) { cb(out); return; } return Promise.resolve(out); },
  set(obj, cb) { const ch = {}; for (const [k, v] of Object.entries(obj)) { ch[k] = { oldValue: data.get(k), newValue: JSON.parse(JSON.stringify(v)) }; data.set(k, ch[k].newValue); } pending.push(new Promise((r) => setTimeout(async () => { await st.onChanged(ch); r(); }, 0))); if (cb) cb(); return Promise.resolve(); },
  remove(keys, cb) { const ch = {}; for (const k of [].concat(keys)) { ch[k] = { oldValue: data.get(k) }; data.delete(k); } pending.push(new Promise((r) => setTimeout(async () => { await st.onChanged(ch); r(); }, 0))); if (cb) cb(); return Promise.resolve(); } };
const st = createStampStore({ storage: area, now: () => (clock += 10) });
const adapter = createDataAdapter({ storage: area });
const idle = async () => { await new Promise((r) => setTimeout(r, 5)); while (pending.length) await pending.shift(); await new Promise((r) => setTimeout(r, 5)); };
const sync = async () => { await idle(); const r = await syncEncryptedPlace({ place: { id: 'p1' }, storage: area, store: dirStore, keys: K.keys, meta: K.meta, stampStore: st, adapter, now: () => Date.now() }); await idle(); return r; };
await area.set({ [SK.syncPlaces]: [{ id: 'p1', enabled: true }] });
const index = () => data.get(SK.articlesIndex) || [];

await area.set({
  [SK.articlesIndex]: [{ id: 'x-a1', url: 'https://news.example/story', title: 'Grüße 🌍 Prices and wages', timestamp: '2026-01-01T00:00:00Z', tags: ['economy', 'wages'], summary: 'S', archived: false }, { id: 'x-a2', url: 'https://blog.example/rates', title: 'Rates', timestamp: '2026-01-05T00:00:00Z', tags: ['rates'], summary: 'S', archived: false }],
  [articleRecKey('x-a1')]: { content: '<p>Full text one</p>', summary: '<p>Summary</p>' }, [articleRecKey('x-a2')]: { content: '<p>two</p>', summary: '<p>s</p>' },
  [SK.annotations]: [{ id: 'h-1', url: 'https://news.example/story', text: 'quoted passage', type: 'user' }],
  [SK.collIndex]: [{ id: 'c-1', name: 'Reading', n: 1 }], [collRecKey('c-1')]: { id: 'c-1', name: 'Reading', sources: [{ articleId: 'x-a1', addedAt: '2026-01-01' }], updated: 1 },
  [SK.notesIndex]: [{ id: 'n-js', kind: 'note', created: '2026-01-02', updated: '2026-01-02' }, { id: 'n-gone', kind: 'note', created: '2026-01-02', updated: '2026-01-02' }],
  [noteRecKey('n-js')]: { id: 'n-js', kind: 'note', text: 'JS note', tags: ['js'], created: '2026-01-02', updated: '2026-01-02' }, [noteRecKey('n-gone')]: { id: 'n-gone', kind: 'note', text: 'will be deleted', tags: [], created: '2026-01-02', updated: '2026-01-02' },
});
let r = await sync(); console.log('JS seeded the folder:', JSON.stringify({ pushed: r.pushed, errors: r.errors }));
assert.ok(r.pushed === 6 && !r.errors.length);

const gradle = (phase) => { console.log(`running the phone engine, phase ${phase} …`); execFileSync('./gradlew', [':app:testDebugUnitTest', '--tests', '*CrossSyncTest*', '--rerun-tasks', '--console=plain', '-q'], { cwd: path.resolve(here, '../../mobile/android'), env: { ...process.env, ANDROID_HOME: process.env.ANDROID_HOME || path.join(os.homedir(), 'Library/Android/sdk'), AISH_XSYNC_DIR: root, AISH_XSYNC_PHASE: phase }, stdio: 'inherit', timeout: 900000 }); };

gradle('1');
r = await sync();
console.log('JS pulled what the phone wrote:', JSON.stringify({ pulled: r.pulled, errors: r.errors }));
const phoneNote = data.get(noteRecKey('n-phone'));
assert.ok(phoneNote, 'the phone\'s note arrived in the extension'); assert.equal(phoneNote.text, 'Phone note with ünïcode 🌍'); assert.deepEqual([...phoneNote.tags].sort(), ['android', 'idea']);
assert.equal(index().length, 2, 'nothing of the extension\'s own data was changed by the phone'); assert.equal(data.get(articleRecKey('x-a1')).content, '<p>Full text one</p>');

// the extension changes things while the phone is away
await area.set({ [noteRecKey('n-js')]: { ...data.get(noteRecKey('n-js')), text: 'JS note, edited in the extension' } });
await area.set({ [SK.notesIndex]: [...data.get(SK.notesIndex).filter((e) => e.id !== 'n-gone'), { id: 'n-js2', kind: 'note', created: '2026-01-03', updated: '2026-01-03' }], [noteRecKey('n-js2')]: { id: 'n-js2', kind: 'note', text: 'a note the extension added later', tags: [], created: '2026-01-03', updated: '2026-01-03' } });
await area.remove(noteRecKey('n-gone')); await st.markDeleted('note', ['n-gone']); await idle();
await sync();
gradle('2');
r = await sync();
console.log('JS pulled the phone\'s edit:', JSON.stringify({ pulled: r.pulled, errors: r.errors }));
assert.equal(data.get(noteRecKey('n-phone')).text, 'Phone note, edited on the phone', 'the phone\'s edit reached the extension');
assert.equal(data.get(noteRecKey('n-js')).text, 'JS note, edited in the extension', 'and did not undo the extension\'s edit');
const before = fs.readdirSync(path.join(place, 'r')).map((n) => n + etag(fs.readFileSync(path.join(place, 'r', n)))).join();
await sync(); assert.equal(fs.readdirSync(path.join(place, 'r')).map((n) => n + etag(fs.readFileSync(path.join(place, 'r', n)))).join(), before, 'a further round changes nothing');
console.log('CROSS-IMPLEMENTATION SYNC OK');
