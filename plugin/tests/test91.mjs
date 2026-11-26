// Inline styles → classes: the device list and model tags escape their data, the export choice panel toggles, LocalSend status uses data-tone.
import { setup, imp, tick } from './harness.mjs'; import assert from 'assert';
const X = '<img src=x onerror="window.__pwned=1">';
const { store, w } = setup({});
const d = w.document;
globalThis.document = d; globalThis.window = w;
w.matchMedia = w.matchMedia || (() => ({ matches: false }));
chrome.runtime.getURL = (p) => p;
// extension files (services.json, prompts.json …) come from src/; anything remote fails like it would offline
const fs = await import('fs');
globalThis.fetch = w.fetch = async (u) => {
  const f = process.env.AISH_SRC + '/' + String(u).replace(/^\.?\//, '');
  if (!/^https?:/.test(String(u)) && fs.existsSync(f)) { const t = fs.readFileSync(f, 'utf8'); return { ok: true, json: async () => JSON.parse(t), text: async () => t }; }
  throw new Error('offline');
};
const noStyle = (root, sel, where) => { for (const el of root.querySelectorAll(sel)) assert(!el.getAttribute('style'), `${where}: inline style on ${el.className}: ${el.getAttribute('style')}`); };

// 1. settings: devices, export panel, LocalSend status
store['send:devices'] = [{ id: 'k1', label: 'Kindle ' + X, type: 'kindle', addresses: ['me@kindle.com' + X] }, { id: 'k2', label: 'Second', type: 'kindle', addresses: ['b@kindle.com'] }];
const sm = await imp('modules/settingsManager.js');
try { await sm.initSettingsManager({ showToast() {} }); } catch (e) { /* panels not needed here may be missing */ }
await tick(150);
const list = d.getElementById('kindleDeviceList');
const rows = [...list.querySelectorAll('.device-row')];
assert.equal(rows.length, 2, 'device rows');
assert(!list.querySelector('img') && rows[0].querySelector('.device-label').textContent.includes('Kindle <img'), 'device label as text');
assert(rows[0].querySelector('.device-address').textContent.includes('<img'), 'address as text');
noStyle(list, '*', 'devices');
assert.equal(rows[0].querySelector('.device-active-btn').getAttribute('aria-pressed'), 'true', 'first device is the active target');
assert.equal(rows[1].querySelector('.device-active-btn').getAttribute('aria-pressed'), 'false');
const exportBtn = d.getElementById('exportSettingsButton') || [...d.querySelectorAll('button')].find(b => /Export/.test(b.textContent) && !b.closest('.export-choice'));
const panel = d.querySelector('.export-choice');
assert(exportBtn && panel, 'export button + choice panel');
assert(panel.hidden && !panel.getAttribute('style'), 'choice panel starts hidden, no inline style');
exportBtn.click(); assert(!panel.hidden && /▲/.test(exportBtn.textContent), 'opens, arrow shown');
exportBtn.click(); assert(panel.hidden && !/▲/.test(exportBtn.textContent), 'closes again');
assert(!d.getElementById('localSendStatus').getAttribute('style'), 'LocalSend status colour comes from CSS');
const lic = d.getElementById('licenseStatusLabel'); assert(lic && !lic.getAttribute('style'), 'licence badge has no inline colours');

// 2. model tags
store['config:services'] = { openai: { apiKey: 'k', customModel: [{ id: 'm"' + X, provider: 'openai' }] } };
let mc = d.getElementById('modelIdentifierContainer'); if (!mc) { mc = d.createElement('div'); mc.id = 'modelIdentifierContainer'; d.body.appendChild(mc); }
const mm = await imp('modules/modelManager.js');
await mm.updateModelIdentifierUI('openai', [{ id: 'openai', defaultModel: 'gpt-x' }], { 'config:services': store['config:services'] });
const tag = mc.querySelector('.model-id-tag');
assert(tag && tag.dataset.model === 'm"' + X && tag.textContent.includes('<img') && !mc.querySelector('img'), 'model id escaped in text and attribute');
noStyle(mc, '*', 'model tags');
assert.equal(w.__pwned, undefined);
console.log('ok');
