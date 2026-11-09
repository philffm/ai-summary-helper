// Background parts in bg/ (R4 phase 3): every bg/*.js the worker imports is listed in the Firefox and iOS manifests, and the
// worker starts and answers in both load orders — Chrome/Android (importScripts in the middle of background.js) and
// Firefox/iOS (separate scripts in manifest order, after background.js).
import assert from 'assert'; import fs from 'fs'; import path from 'path'; import vm from 'vm';
const SRC = process.env.AISH_SRC;
const main = fs.readFileSync(path.join(SRC, 'background.js'), 'utf8');
const parts = [...main.matchAll(/importScripts\('(bg\/[\w.-]+\.js)'\)/g)].map((m) => m[1]);
assert(parts.includes('bg/feedPoll.js') && parts.includes('bg/aiComplete.js'), 'background.js imports its parts: ' + parts);
for (const p of ['firefox', 'ios']) {
  const scripts = JSON.parse(fs.readFileSync(path.join(SRC, '..', 'platforms', p, 'manifest.json'), 'utf8')).background.scripts;
  const at = scripts.indexOf('background.js');
  for (const f of parts) assert(scripts.indexOf(f) > at, `${p} manifest lists ${f} after background.js`);
}

function boot(order) {
  let onMessage = null, alarms = 0;
  const area = () => ({ get: (d, cb) => { const v = d && typeof d === 'object' && !Array.isArray(d) ? { ...d } : {}; if (cb) cb(v); return Promise.resolve(v); }, set: (_, cb) => { if (cb) cb(); return Promise.resolve(); }, remove: () => Promise.resolve() });
  const storage = { local: area(), sync: area(), session: area(), onChanged: { addListener() {} } };
  const any = () => new Proxy(function () {}, { get: (t, k) => (k === 'then' ? undefined : any()), apply: () => any() });
  const chrome = new Proxy({}, { get: (t, k) => k === 'runtime' ? new Proxy({}, {
    get: (_, r) => r === 'id' ? 'ext-id' : r === 'getURL' ? (x) => 'chrome-extension://ext-id/' + x : r === 'onMessage' ? { addListener: (f) => { onMessage = f; } } : any(),
  }) : k === 'storage' ? storage : k === 'alarms' ? new Proxy({}, { get: (_, r) => r === 'onAlarm' ? { addListener: () => { alarms++; } } : any() }) : any() });
  const sandbox = { chrome, console: { ...console, log() {}, warn() {}, info() {} }, setTimeout, clearTimeout, setInterval() {}, AbortController, URL, crypto: globalThis.crypto,
    fetch: async () => { throw new Error('no network in test'); } };
  sandbox.globalThis = sandbox; sandbox.self = sandbox;
  if (order === 'chrome') sandbox.importScripts = (f) => { if (f.startsWith('bg/')) vm.runInContext(fs.readFileSync(path.join(SRC, f), 'utf8'), sandbox, { filename: f }); else throw new Error('not built in tests'); };
  vm.createContext(sandbox);
  vm.runInContext(main, sandbox, { filename: 'background.js' });
  if (order === 'firefox') for (const f of parts) vm.runInContext(fs.readFileSync(path.join(SRC, f), 'utf8'), sandbox, { filename: f });
  return { sandbox, onMessage: () => onMessage, alarms: () => alarms };
}

for (const order of ['chrome', 'firefox']) {
  const w = boot(order);
  assert(w.onMessage(), order + ': message listener registered');
  for (const name of ['pollFeeds', 'applyFeedPollConfig', 'aiComplete', 'aiFetch', 'usedModelOf']) assert.equal(vm.runInContext(`typeof ${name}`, w.sandbox), 'function', `${order}: ${name} is defined`);
  const popup = { id: 'ext-id', url: 'chrome-extension://ext-id/popup.html' };
  const r = await new Promise((res) => { let done = false; const keep = w.onMessage()({ action: 'aiComplete', user: 'x', system: 's' }, popup, (v) => { done = true; res(v); }); if (!keep && !done) res(undefined); setTimeout(() => res('pending'), 500); });
  assert(r && r.ok === false && !/is not defined/.test(String(r.error)), `${order}: aiComplete answers with a normal error offline: ${JSON.stringify(r)}`);
}
console.log('TEST 255 OK'); process.exit(0);
