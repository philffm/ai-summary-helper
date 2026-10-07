// Models saved under the legacy 'servicesConfig' name (sync) are folded into config:services, newest wins per service.
import assert from 'assert';
import { setup, imp } from './harness.mjs';
const { store } = setup({});
const mk = (st) => ({ get: (k, cb) => { let o = {}; if (k == null) o = { ...st }; else [].concat(k).forEach(x => { if (x in st) o[x] = st[x]; }); o = JSON.parse(JSON.stringify(o)); if (cb) { cb(o); return; } return Promise.resolve(o); },
  set: (o, cb) => { Object.entries(o).forEach(([k, v]) => { st[k] = JSON.parse(JSON.stringify(v)); }); if (cb) cb(); return Promise.resolve(); },
  remove: (k, cb) => { [].concat(k).forEach(x => delete st[x]); if (cb) cb(); return Promise.resolve(); } });
const l = {}; chrome.storage.local = mk(l); chrome.storage.sync = mk(store);
l['config:services'] = { ollama: { apiKey: '', customModel: [], model: 'llama3.2' }, openai: { apiKey: 'sk-x', model: 'gpt' } };
store.servicesConfig = { ollama: { customModel: [{ id: 'gemma4:e2b', provider: 'ollama' }], activeModelId: { id: 'gemma4:e2b', provider: 'ollama' } } };
const SM = (await imp('modules/storageManager.js')).default;
await SM.migrateSensitiveToLocal();
const cfg = l['config:services'];
assert.equal(cfg.ollama.activeModelId.id, 'gemma4:e2b');
assert.equal(cfg.ollama.model, 'llama3.2', 'older fields kept');
assert.equal(cfg.openai.apiKey, 'sk-x', 'other services untouched');
assert(!('servicesConfig' in store) && !('servicesConfig' in l), 'legacy key gone from both areas');
console.log('TEST 56 OK'); process.exit(0);
