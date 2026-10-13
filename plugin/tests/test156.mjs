// Cloud model quick pick: suggestions under their own caption, and any typed "vendor/model" id can be used (Enter or the "Use …" pill).
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
const roster = { success: true, models: Array.from({ length: 12 }, (_, i) => ({ id: 'v/m' + i, name: 'Vendor: M' + i, context: 100000, price_in: 1 + i % 3, price_out: 2 + i % 4 })) };
globalThis.fetch = w.fetch = async (u) => ({ ok: true, json: async () => (String(u).includes('/models') ? roster : String(u).includes('services') ? services : []), text: async () => '' });
// real chrome keeps sync and local separate (the harness shares one store)
const mk = (st) => ({ get: (k, cb) => { let o = {}; if (k == null) o = { ...st }; else [].concat(typeof k === 'object' && !Array.isArray(k) ? Object.keys(k) : k).forEach(x => { if (x in st) o[x] = st[x]; }); o = JSON.parse(JSON.stringify(o)); if (cb) { cb(o); return; } return Promise.resolve(o); },
  set: (o, cb) => { Object.entries(o).forEach(([k, v]) => { st[k] = JSON.parse(JSON.stringify(v)); }); if (cb) cb(); return Promise.resolve(); },
  remove: (k, cb) => { [].concat(k).forEach(x => delete st[x]); if (cb) cb(); return Promise.resolve(); } });
w.Element.prototype.scrollIntoView = function () {};
const lstore = {}; chrome.storage.local = mk(lstore); chrome.storage.sync = mk(store);

store['meta:version'] = 2; store.migrationVersion = 2;
lstore['meta:version'] = 2;
store.connectionMode = 'cloud'; store.activeService = 'openai';
store.recentCloudModels = ['v/m0'];
lstore['account:token'] = 'h.' + Buffer.from(JSON.stringify({ exp: 4102444800, sub: 'u1' })).toString('base64url') + '.s'; lstore['account:user'] = { id: 'u1', email: 'a@b.c' };
try { await imp('popup.js'); } catch (e) { console.log('import', e.message); }
d.dispatchEvent(new w.Event('DOMContentLoaded'));
await tick(400);
const grid = d.getElementById('modelIdGrid');
const note = [...grid.children].find(c => c.className === 'model-grid-note');
assert(note && note.textContent === 'Best value', 'caption for the suggestions: ' + grid.textContent);
const pills = [...grid.querySelectorAll('button')];
assert.equal(pills.length, 1 + 5, 'recent + 5 suggestions');
assert(!pills.slice(1).some(b => b.textContent.includes('M0')), 'recent model is not suggested again');
assert(pills[1].title.includes('per 1M tokens'), 'price in the tooltip: ' + pills[1].title);
// A typed vendor/model that is not in the list can be used.
const inp = d.getElementById('customModelInput');
inp.value = 'anthropic/claude-opus-9'; inp.dispatchEvent(new w.Event('input', { bubbles: true })); await tick(200);
const use = [...d.querySelectorAll('#modelIdGrid button')].find(b => b.textContent === 'Use anthropic/claude-opus-9');
assert(use, 'Use … pill for an id that is not in the list: ' + d.getElementById('modelIdGrid').textContent);
inp.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })); await tick(200);
assert.equal(store.preferredCloudModel, 'anthropic/claude-opus-9', 'Enter uses the typed id');
assert.equal(store.recentCloudModels[0], 'anthropic/claude-opus-9');
// Plain words are only a search, never a model id.
inp.value = 'flash'; inp.dispatchEvent(new w.Event('input', { bubbles: true })); await tick(200);
assert(![...d.querySelectorAll('#modelIdGrid button')].some(b => b.textContent.startsWith('Use ')), 'no Use pill for a plain search word');
console.log('test156 ok');
