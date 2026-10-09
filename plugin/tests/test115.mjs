// Instant read: the spoken intro ("From …", "Writing an N-word summary") follows the extension's UI language (text and voice),
// not the summary language and not the browser's language.
import { setup, imp, tick } from './harness.mjs'; import assert from 'assert';
const { w } = setup({}); const d = w.document; globalThis.document = d; globalThis.window = w;
await chrome.storage.local.set({ 'tts:prefs': { instant: true } });
const cmds = [];
chrome.runtime.sendMessage = (m) => {
  if (m && m.action === 'ttsCmd') { cmds.push(m); if (m.cmd === 'caps') return Promise.resolve({ ok: true, available: true, voices: [{ name: 'V', lang: 'de-DE' }], state: 'idle' }); }
  return Promise.resolve({ ok: true, state: 'idle' });
};
// the browser says English, the extension is set to German
chrome.i18n = { detectLanguage: (t, cb) => cb({ isReliable: true, languages: [{ language: 'en', percentage: 99 }] }), getUILanguage: () => 'en' };
d.documentElement.lang = 'de';
const { initInstantRead } = await imp('modules/instantRead.js');
const intro = async (summaryLang) => {
  await chrome.storage.sync.set({ selectedLanguage: summaryLang });
  const host = d.createElement('div'), chip = d.createElement('button'), panel = d.createElement('div'), btn = d.createElement('button');
  chip.innerHTML = '<span class="chip-icon"></span>'; d.body.append(host, chip, panel, btn);
  const ir = initInstantRead({ chip, panel, barHost: host, button: btn, fallback: () => '' });
  await ir.ready; await tick(); await tick(); cmds.length = 0;
  ir.onMessage({ action: 'summaryContext', host: 'example.com', length: 100 });
  for (let k = 0; k < 20 && !cmds.some(c => c.cmd === 'speak'); k++) await tick();
  const sp = cmds.find(c => c.cmd === 'speak'); assert(sp, 'speaks for summary language ' + summaryLang);
  return sp.items;
};
for (const lang of ['es', 'en', 'da']) {
  const items = await intro(lang);
  const said = items.filter(i => /example\.com|100/.test(i.text));
  assert.equal(said.length, 2, 'site and word count are announced: ' + JSON.stringify(items));
  assert(said.every(i => /^de/.test(i.lang)), `summary language ${lang}: announced with the extension-language voice, not the summary or browser language: ` + JSON.stringify(said));
}
console.log('TEST 115 OK'); process.exit(0);
