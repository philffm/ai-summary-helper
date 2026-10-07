// Model panel: always-visible Cloud | Own-model switch; typed model IDs are saved (+, Enter, blur).
import assert from 'assert';
import fs from 'fs';
import { setup, imp, tick, SRC } from './harness.mjs';
const { w, store } = setup({}); const d = w.document;
globalThis.requestAnimationFrame = (f) => setTimeout(f, 0);
globalThis.MutationObserver = w.MutationObserver; globalThis.getComputedStyle = w.getComputedStyle.bind(w); globalThis.IntersectionObserver = class { observe() {} disconnect() {} };
const services = JSON.parse(fs.readFileSync(SRC + '/services.json', 'utf8'));
chrome.runtime.getURL = (p) => 'chrome-extension://abc/' + p;
chrome.tabs = { query: async () => [], sendMessage() {}, onActivated: { addListener() {} }, onUpdated: { addListener() {} } };
chrome.i18n = { getMessage: () => '' };
globalThis.fetch = w.fetch = async (u) => ({ ok: true, json: async () => (String(u).includes('services') ? services : []), text: async () => '' });
// real chrome keeps sync and local separate (the harness shares one store)
const mk = (st) => ({ get: (k, cb) => { let o = {}; if (k == null) o = { ...st }; else [].concat(typeof k === 'object' && !Array.isArray(k) ? Object.keys(k) : k).forEach(x => { if (x in st) o[x] = st[x]; }); o = JSON.parse(JSON.stringify(o)); if (cb) { cb(o); return; } return Promise.resolve(o); },
  set: (o, cb) => { Object.entries(o).forEach(([k, v]) => { st[k] = JSON.parse(JSON.stringify(v)); }); if (cb) cb(); return Promise.resolve(); },
  remove: (k, cb) => { [].concat(k).forEach(x => delete st[x]); if (cb) cb(); return Promise.resolve(); } });
const lstore = {}; chrome.storage.local = mk(lstore); chrome.storage.sync = mk(store);

store['meta:version'] = 2; store.migrationVersion = 2;
lstore['meta:version'] = 2;
store.connectionMode = 'cloud'; store.activeService = 'ollama';
try { await imp('popup.js'); } catch (e) { console.log('import', e.message); }
d.dispatchEvent(new w.Event('DOMContentLoaded'));
await tick(300);
const seg = () => [...d.querySelectorAll('#modelModeGrid button')];
assert.equal(seg().length, 2, 'two source buttons in cloud mode');
assert.equal(seg()[0].getAttribute('aria-pressed'), 'true');
assert.equal(d.getElementById('setCustomModelBtn').style.display, 'none', 'no "+" in cloud mode');
seg()[1].click(); await tick(120);
assert.equal(store.connectionMode, 'local');
assert.equal(seg().length, 2, 'both source buttons still present in own-model mode');
assert.equal(seg()[1].getAttribute('aria-pressed'), 'true');
assert(!d.getElementById('modelProviderGrid').textContent.includes('Cloud Mode'), 'no dashed Cloud Mode pill');
assert(d.getElementById('modelProviderGrid').querySelectorAll('button').length >= 3, 'providers shown');
const inp = d.getElementById('customModelInput');
inp.value = 'gemma4:e2b';
inp.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
await tick(120);
const cfg = lstore['config:services'].ollama;
assert(cfg.customModel.some(m => m.id === 'gemma4:e2b'), 'saved on Enter');
assert.equal(cfg.activeModelId.id, 'gemma4:e2b');
inp.value = 'qwen3:8b'; inp.dispatchEvent(new w.FocusEvent('blur')); await tick(120);
assert.equal(lstore['config:services'].ollama.activeModelId.id, 'qwen3:8b', 'saved on blur');
assert.equal(lstore['config:services'].ollama.customModel.length, 2);
const pills = [...d.querySelectorAll('#modelIdGrid button')].map(b => b.textContent);
assert(pills.some(x => x.includes('gemma4:e2b')) && pills.some(x => x.includes('qwen3:8b')), 'stored models listed in panel: ' + pills);
assert.equal(d.getElementById('chipModelLabel').textContent, 'qwen3:8b', 'chip shows active model');
// reload-safe: legacy-named key is never written
assert(!('servicesConfig' in store) && !('servicesConfig' in lstore), 'no legacy servicesConfig key');
await imp('modules/settingsManager.js');
assert.equal(d.getElementById('apiKeyContainer').style.display, 'none', 'no API key field for Ollama');
console.log('TEST 55 OK'); process.exit(0);
