// Instant read bar: reading bar while it speaks, "Finished reading" + "Read again" afterwards (whatever order the states arrive in).
import { setup, imp, tick } from './harness.mjs'; import assert from 'assert';
const { w } = setup({}); const d = w.document; globalThis.document = d; globalThis.window = w;
await chrome.storage.local.set({ 'tts:prefs': { instant: true } });
await chrome.storage.sync.set({ selectedLanguage: 'en' });
let st = { state: 'idle', index: 0, total: 0, rate: 1, volume: 1, muted: false, open: false, meta: null };
const cmds = [];
const push = (o) => { st = { ...st, ...o }; (globalThis.__msgL || []).forEach(f => f({ action: 'ttsState', ok: true, ...st }, {}, () => {})); };
chrome.runtime.sendMessage = (m) => {
  if (m && m.action === 'ttsCmd') {
    cmds.push(m);
    if (m.cmd === 'caps') return Promise.resolve({ ok: true, available: true, voices: [{ name: 'V', lang: 'en-US' }], ...st });
    if (m.cmd === 'speak') { st = { ...st, state: m.open && !(m.items || []).length ? 'waiting' : 'playing', meta: m.meta, total: (m.items || []).length, open: !!m.open }; }
  }
  return Promise.resolve({ ok: true, ...st });
};
chrome.i18n = { detectLanguage: (t, cb) => cb({ isReliable: true, languages: [{ language: 'en', percentage: 99 }] }) };
const { initInstantRead } = await imp('modules/instantRead.js');
const host = d.createElement('div'); d.body.append(host);
const chip = d.createElement('button'); chip.innerHTML = '<span class="chip-icon"></span>'; d.body.append(chip);
const panel = d.createElement('div'); d.body.append(panel);
const ir = initInstantRead({ chip, panel, barHost: host });
await ir.ready; await tick(); await tick();
assert(ir.on, 'switch is on from the saved preference');
ir.onMessage({ action: 'summaryContext', host: 'example.com', length: 100 }); await tick(); await tick(); await tick();
ir.onMessage({ action: 'summaryProgress', preview: '<div><p>First sentence is here. Second sentence is also here. Thi' });
await tick(); await tick();
push({ state: 'playing', index: 0, total: 3 });
assert(host.querySelector('.sr-bar .sr-pp'), 'reading bar while speaking');
ir.onMessage({ action: 'summaryComplete', summary: '<div><p>First sentence is here. Second sentence is also here. Third one.</p></div>' });
await tick(); await tick();
push({ state: 'idle', index: 0, total: 0, open: false });
const again = host.querySelector('.sr-bar .sr-again');
assert(again && !host.querySelector('.sr-bar').hidden, 'Read again is offered when reading is over');
assert(/Finished/.test(host.querySelector('.sr-bar').textContent));
cmds.length = 0; again.click(); await tick(); await tick();
const sp = cmds.find(c => c.cmd === 'speak'); assert(sp && sp.items.length === 3, 'reads the summary again: ' + JSON.stringify(sp && sp.items));
push({ state: 'idle' });
host.querySelector('.sr-x').click();
assert(host.querySelector('.sr-bar').hidden, 'closing hides the bar');
// A summary that completes without a followed stream (finished in the background) can still be read.
ir.abort(); push({ state: 'idle' }); await tick();
ir.onMessage({ action: 'summaryComplete', summary: '<div><p>Late sentence one. Late sentence two.</p></div>' }); await tick(); await tick();
assert(host.querySelector('.sr-bar .sr-again') && !host.querySelector('.sr-bar').hidden, 'offered after a background completion');
console.log('TEST 79 OK');
