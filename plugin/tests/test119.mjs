// Instant read, follow-up questions: the (already known) short answer reaches the voice at once, in order, not sentence by
// sentence behind the typewriter; text handed over before the reading session is open waits for it.
import { setup, imp, tick } from './harness.mjs'; import assert from 'assert';
const { w } = setup({}); const d = w.document; globalThis.document = d; globalThis.window = w;
await chrome.storage.local.set({ 'tts:prefs': { instant: true } });
await chrome.storage.sync.set({ selectedLanguage: 'en' });
const log = [];
chrome.runtime.sendMessage = (m) => {
  if (m && m.action === 'ttsCmd') {
    log.push({ cmd: m.cmd, items: (m.items || []).map(i => i.text), open: m.open });
    if (m.cmd === 'caps') return Promise.resolve({ ok: true, available: true, voices: [{ name: 'V', lang: 'en-US' }], state: 'idle' });
  }
  return Promise.resolve({ ok: true, state: 'idle' });
};
chrome.i18n = { detectLanguage: (t, cb) => setTimeout(() => cb({ isReliable: true, languages: [{ language: 'en', percentage: 99 }] }), 20), getUILanguage: () => 'en' };
const { initInstantRead } = await imp('modules/instantRead.js');
const host = d.createElement('div'), chip = d.createElement('button'), panel = d.createElement('div'), btn = d.createElement('button');
chip.innerHTML = '<span class="chip-icon"></span>'; d.body.append(host, chip, panel, btn);
const ir = initInstantRead({ chip, panel, barHost: host, button: btn, fallback: () => '' });
await ir.ready; await tick(); await tick(); log.length = 0;

const quick = 'The first point is short. The second point follows right after it. And a third one closes the answer.';
ir.startChat('What is the main point?');
ir.chatText(quick);                        // before the session is even open
for (let k = 0; k < 30 && !log.some(l => l.items.length); k++) await tick();
const said = log.filter(l => l.items.length);
assert(said.length, 'the voice got text without waiting for any typing: ' + JSON.stringify(log));
const all = said.flatMap(l => l.items);
assert(all.includes('The first point is short.') && all.includes('The second point follows right after it.'), 'whole short answer queued at once: ' + JSON.stringify(all));
const startIdx = log.findIndex(l => l.cmd === 'speak' && l.open), firstText = log.findIndex(l => l.items.length);
assert(startIdx !== -1 && startIdx <= firstText, 'the session is opened before the text arrives (no race): ' + JSON.stringify(log.map(l => l.cmd + ':' + l.items.length)));
// a continuation only adds what is new
log.length = 0;
ir.chatText(quick + ' Then the longer answer continues with more detail here.');
for (let k = 0; k < 20 && !log.some(l => l.items.length); k++) await tick();
const more = log.flatMap(l => l.items);
assert.deepEqual(more, ['Then the longer answer continues with more detail here.'], 'only the new sentence is appended: ' + JSON.stringify(more));
console.log('TEST 119 OK'); process.exit(0);
