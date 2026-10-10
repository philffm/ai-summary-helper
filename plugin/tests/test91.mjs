// Inline styles → classes: podcast picker and style chips use aria-pressed (theme colours, no #fff cards), the confirm step,
// device list and model tags escape their data, the export choice panel toggles, LocalSend status uses data-tone.
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

// 1. podcast wizard
store['articles:index'] = [
  { id: 'a1', title: 'Tram ' + X, summary: '<p>x</p>', timestamp: new Date().toISOString(), tags: [] },
  { id: 'a2', title: 'Second', summary: '<p>y</p>', timestamp: new Date().toISOString(), tags: [] }];
store['podcasts:list'] = [{ name: 'Brief ' + X, audio: '" onerror="window.__pwned=1' }];
const pm = await imp('modules/podcastManager.js');
const host = d.createElement('div'); d.body.appendChild(host);
pm.renderPodcastUI(host); await tick(150);
const next = () => { d.getElementById('nextStepBtn').click(); };
next(); await tick(80);   // step 1 (name) → step 2 (pick)
const picks = [...host.querySelectorAll('.podcast-pick')];
assert.equal(picks.length, 2, 'two article picks');
noStyle(host, '.podcast-pick, .podcast-pick *', 'picks');
assert(picks.every(p => p.tagName === 'BUTTON' && p.getAttribute('aria-pressed') === 'false'), 'picks are toggle buttons');
assert(d.getElementById('nextStepBtn').disabled, 'Next disabled with nothing picked');
picks[0].click(); await tick(20);
assert.equal(picks[0].getAttribute('aria-pressed'), 'true', 'picked');
assert(!d.getElementById('nextStepBtn').disabled, 'Next enabled');
picks[0].click(); await tick(20); assert.equal(picks[0].getAttribute('aria-pressed'), 'false', 'unpicked'); picks[0].click(); await tick(20);
next(); await tick(150);  // step 3 (length, style)
const chips = [...host.querySelectorAll('.podcast-style-chip')];
assert(chips.length >= 5, 'style chips');
noStyle(host, '.podcast-style-chip', 'chips');
chips[1].click(); await tick(20);
assert.deepEqual(chips.map(c => c.getAttribute('aria-pressed')).filter(v => v === 'true').length, 1, 'one style pressed');
assert.equal(chips[1].getAttribute('aria-pressed'), 'true');
next(); await tick(80);   // step 4 (confirm)
const confirm = d.getElementById('podcastStepContainer');
for (let k = 0; k < 60 && !confirm.textContent.includes('Tram <img'); k++) await tick(50);
assert(confirm.textContent.includes('Tram <img'), 'article title shown as text');
assert(!confirm.querySelector('img'), 'no markup from titles in the confirm step');
assert(!host.querySelector('.podcast-card img') && host.querySelector('.podcast-card h3').textContent.includes('Brief <img'), 'created podcast name as text');
assert(!host.querySelector('audio[onerror]'), 'audio src stays an attribute value');

// 2. settings: devices, export panel, LocalSend status
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

// 3. model tags
store['config:services'] = { openai: { apiKey: 'k', customModel: [{ id: 'm"' + X, provider: 'openai' }] } };
let mc = d.getElementById('modelIdentifierContainer'); if (!mc) { mc = d.createElement('div'); mc.id = 'modelIdentifierContainer'; d.body.appendChild(mc); }
const mm = await imp('modules/modelManager.js');
await mm.updateModelIdentifierUI('openai', [{ id: 'openai', defaultModel: 'gpt-x' }], { 'config:services': store['config:services'] });
const tag = mc.querySelector('.model-id-tag');
assert(tag && tag.dataset.model === 'm"' + X && tag.textContent.includes('<img') && !mc.querySelector('img'), 'model id escaped in text and attribute');
noStyle(mc, '*', 'model tags');
assert.equal(w.__pwned, undefined);
console.log('ok');
