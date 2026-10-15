// Send targets, step 2: messages, backup, data reset, and "no existing key is touched".
import assert from 'assert'; import fs from 'fs'; import vm from 'vm';
import { pathToFileURL } from 'url';
const shared = (rel) => import(pathToFileURL(process.env.AISH_SRC + '/' + rel).href);
const SRC = process.env.AISH_SRC;

// ── keys, delete categories ──
const { SK, targetLedgerKey, isTargetLedgerKey } = await shared('modules/storageKeys.js');
const reset = await shared('modules/dataReset.js');
assert.deepEqual(reset.uncoveredKeys(), [], 'every key belongs to a category');
assert.equal(targetLedgerKey('t1'), 'targets:ledger:t1'); assert(isTargetLedgerKey('targets:ledger:t1') && !isTargetLedgerKey('targets:list'));
const all = { 'targets:connections': [1], 'targets:list': [1], 'targets:default': 't1', 'targets:outbox': [1], 'targets:secrets': { c1: { pw: 'x' } }, 'targets:ledger:t1': { a: 1 }, 'targets:ledger:t2': {}, 'articles:index': [1], 'send:devices': [1] };
const keys = Object.keys(all);
const sendKeys = reset.keysToRemove(['send'], keys);
for (const k of ['targets:connections', 'targets:list', 'targets:default', 'targets:outbox', 'targets:ledger:t1', 'targets:ledger:t2', 'send:devices']) assert(sendKeys.includes(k), 'send removes ' + k);
assert(!sendKeys.includes('targets:secrets') && !sendKeys.includes('articles:index'));
assert.deepEqual(reset.keysToRemove(['keys'], keys).filter((k) => k.startsWith('targets:')), ['targets:secrets'], 'keys removes only the secrets');
assert(!reset.keysToRemove(['articles'], keys).some((k) => k.startsWith('targets:')));

// ── backup ──
const { filterBackupSecrets, prepareImportedData, hasBackupSecrets } = await shared('modules/backupUtils.js');
const noOpt = filterBackupSecrets(all, false);
assert(!('targets:outbox' in noOpt) && !('targets:secrets' in noOpt), 'no queue, no secrets by default');
for (const k of ['targets:connections', 'targets:list', 'targets:default', 'targets:ledger:t1', 'articles:index']) assert(k in noOpt, k + ' is exported');
const withOpt = filterBackupSecrets(all, true);
assert('targets:secrets' in withOpt, 'secrets with opt-in'); assert(!('targets:outbox' in withOpt), 'the queue is never exported, even with secrets');
assert(hasBackupSecrets({ 'targets:secrets': { c1: { pw: 'x' } } }), 'secrets are recognised on import');
const imported = prepareImportedData({ 'targets:outbox': [{ id: 'smuggled' }], 'targets:list': [{ id: 't1' }], 'articles:index': [] }, {});
assert(!('targets:outbox' in imported), 'a smuggled queue is dropped'); assert('targets:list' in imported);
// a backup without targets:* imports as before
assert.deepEqual(Object.keys(prepareImportedData({ 'articles:index': [] }, {})), ['articles:index']);

// ── background messages: only extension pages ──
const src = fs.readFileSync(SRC + '/background.js', 'utf8');
for (const a of ['targetEnqueue', 'targetStatus', 'targetCancel']) assert(new RegExp(`EXTENSION_PAGE_ACTIONS = new Set\\([^)]*'${a}'`).test(src), a + ' is extension-page only');
const store = {};
const area = { get: (k, cb) => { const o = {}; (k == null ? Object.keys(store) : typeof k === 'string' ? [k] : Array.isArray(k) ? k : Object.keys(k)).forEach((x) => { if (x in store) o[x] = JSON.parse(JSON.stringify(store[x])); }); if (cb) { cb(o); return; } return Promise.resolve(o); }, set: (o, cb) => { Object.assign(store, JSON.parse(JSON.stringify(o))); if (cb) cb(); return Promise.resolve(); }, remove: (k, cb) => { [].concat(k).forEach((x) => delete store[x]); if (cb) cb(); return Promise.resolve(); } };
let onMessage = null; const alarms = [];
const any = () => new Proxy(function () {}, { get: (t, k) => (k === 'then' ? undefined : any()), apply: () => any() });
const rt = { id: 'ext-id', getURL: (p) => 'chrome-extension://ext-id/' + p, onMessage: { addListener: (f) => { onMessage = f; } }, sendMessage() {}, lastError: null };
const chrome = new Proxy({}, { get: (t, k) => k === 'storage' ? { sync: area, local: area, session: area, onChanged: { addListener() {} } } : k === 'alarms' ? { create: (n, o) => alarms.push([n, o]), clear: () => Promise.resolve(), get: async () => null, onAlarm: { addListener() {} } } : k === 'runtime' ? new Proxy(rt, { get: (o, r) => (r in o ? o[r] : any()) }) : any() });
// the real worker bundle, as importScripts would load it
const bundle = fs.readFileSync(new URL('../scripts/build.js', import.meta.url), 'utf8');
assert(/writeTargetsWorker/.test(bundle), 'build writes targets-worker.js');
const sandbox = { chrome, console: { ...console, log() {}, warn() {} }, setTimeout, clearTimeout, setInterval() {}, fetch: async () => ({ ok: false }), AbortController, URL, TextDecoder, TextEncoder, crypto: globalThis.crypto, importScripts() {} };
sandbox.globalThis = sandbox; sandbox.self = sandbox;
vm.createContext(sandbox);
const { execFileSync } = await import('child_process'); const os = await import('os'); const path = await import('path');
const out = fs.mkdtempSync(path.join(os.tmpdir(), 'aish-tw-'));
execFileSync('node', [new URL('../scripts/build.js', import.meta.url).pathname, '--bundle', out], { stdio: 'pipe' });
vm.runInContext(fs.readFileSync(path.join(out, 'targets-worker.js'), 'utf8'), sandbox);
assert(sandbox.AISH_TARGETS && typeof sandbox.AISH_TARGETS.createTargets === 'function', 'the bundle exposes AISH_TARGETS');
vm.runInContext(src, sandbox);
const ask = (msg, sender) => new Promise((res) => { const r = onMessage(msg, sender, res); if (r !== true) setTimeout(() => res({ __sync: true }), 20); });
const page = { id: 'ext-id', url: 'chrome-extension://ext-id/popup.html' };
const web = { id: 'ext-id', url: 'https://evil.example/', tab: { id: 7 } };
for (const a of ['targetEnqueue', 'targetStatus', 'targetCancel']) {
    const r = await ask({ action: a, targetId: 't1', articleId: 'a', jobId: 'j' }, web);
    assert.equal(r.ok, false); assert.match(r.error, /Not allowed/, a + ' from a content script');
}
assert.deepEqual(await ask({ action: 'targetEnqueue', targetId: 'nope', articleId: 'a' }, page), { ok: false, error: 'unknown-target' });
const st = await ask({ action: 'targetStatus' }, page); assert(st.ok && Array.isArray(st.jobs));
assert.deepEqual(await ask({ action: 'targetCancel', jobId: 'x' }, page), { ok: false });
// Nothing was written to storage by starting the worker or by those calls: existing keys untouched, no targets:* yet.
assert.deepEqual(Object.keys(store).filter((k) => k.startsWith('targets:')), [], 'no targets:* key until something is used');

// client helper
const { enqueueTargetSend, getTargetStatus, cancelTargetJob } = await shared('modules/targetClient.js');
const seen = []; const send = async (m) => { seen.push(m); return { ok: true }; };
await enqueueTargetSend('t', 'a', send); await getTargetStatus('t', send); await getTargetStatus(undefined, send); await cancelTargetJob('j', send);
assert.deepEqual(seen.map((m) => m.action), ['targetEnqueue', 'targetStatus', 'targetStatus', 'targetCancel']);
assert(!('targetId' in seen[2]));
console.log('TEST 173 OK'); process.exit(0);
