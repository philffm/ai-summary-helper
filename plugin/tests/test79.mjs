// Instant read: reading bar while it speaks, Read again / pause button, reading a loaded conversation (any order of speech states).
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
const btn = d.createElement('button'); btn.innerHTML = '<span class="composer-read-ic"></span>'; d.body.append(btn);
let fb = '';
const ir = initInstantRead({ chip, panel, barHost: host, button: btn, fallback: () => fb });
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
assert(!btn.hidden && !btn.disabled && /Read again/.test(btn.title), 'permanent button offers Read again when reading is over');
assert(!host.querySelector('.sr-bar') || host.querySelector('.sr-bar').hidden, 'no finished bar any more');
cmds.length = 0; btn.click(); await tick(); await tick();
const sp = cmds.find(c => c.cmd === 'speak'); assert(sp && sp.items.length === 3, 'reads the summary again: ' + JSON.stringify(sp && sp.items));
push({ state: 'playing', index: 0, total: 3 }); assert(/Pause/.test(btn.title), 'button pauses while reading');
cmds.length = 0; btn.click(); await tick(); assert(cmds.some(c => c.cmd === 'toggle'));
push({ state: 'idle' });
// A summary that completes without a followed stream (finished in the background) can still be read.
ir.abort(); push({ state: 'idle' }); await tick();
assert(btn.disabled, 'nothing to read yet');
fb = '<div><p>Opened from the archive. Second sentence here.</p></div>'; ir.refresh();
assert(!btn.disabled, 'a loaded conversation can be read');
cmds.length = 0; btn.click(); await tick(); await tick(); await tick();
const sp2 = cmds.find(c => c.cmd === 'speak'); assert(sp2 && sp2.items.length === 2, 'fallback text is read');
console.log('TEST 79 OK');
