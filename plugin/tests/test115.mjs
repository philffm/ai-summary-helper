// Instant read: the spoken intro ("From …", "Writing an N-word summary") is in the summary language when the extension
// is translated into it, otherwise in the app language.
import { setup, imp, tick } from './harness.mjs'; import assert from 'assert';
import fs from 'fs'; import path from 'path'; import { fileURLToPath } from 'url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'src');
const { w } = setup({}); const d = w.document; globalThis.document = d; globalThis.window = w;
globalThis.fetch = async (u) => { const f = path.join(root, String(u)); return fs.existsSync(f) ? { ok: true, json: async () => JSON.parse(fs.readFileSync(f, 'utf8')) } : { ok: false }; };
await chrome.storage.local.set({ 'tts:prefs': { instant: true } });
const cmds = [];
chrome.runtime.sendMessage = (m) => {
  if (m && m.action === 'ttsCmd') { cmds.push(m); if (m.cmd === 'caps') return Promise.resolve({ ok: true, available: true, voices: [{ name: 'V', lang: 'de-DE' }], state: 'idle' }); }
  return Promise.resolve({ ok: true, state: 'idle' });
};
chrome.i18n = { detectLanguage: (t, cb) => cb({ isReliable: true, languages: [{ language: 'en', percentage: 99 }] }), getUILanguage: () => 'en' };
const { supportedLocaleFor } = await imp('modules/i18n.js');
assert.equal(supportedLocaleFor('de'), 'de'); assert.equal(supportedLocaleFor('cn'), 'zh_CN'); assert.equal(supportedLocaleFor('pt'), 'pt_PT');
assert.equal(supportedLocaleFor('da'), '', 'no Danish translation: not a match'); assert.equal(supportedLocaleFor('uk'), '');

const { initInstantRead } = await imp('modules/instantRead.js');
const mkIr = async () => {
  const host = d.createElement('div'), chip = d.createElement('button'), panel = d.createElement('div'), btn = d.createElement('button');
  chip.innerHTML = '<span class="chip-icon"></span>'; d.body.append(host, chip, panel, btn);
  const ir = initInstantRead({ chip, panel, barHost: host, button: btn, fallback: () => '' });
  await ir.ready; await tick(); await tick(); return ir;
};
const intro = async (lang) => {
  await chrome.storage.sync.set({ selectedLanguage: lang });
  const ir = await mkIr(); cmds.length = 0;
  ir.onMessage({ action: 'summaryContext', host: 'example.com', length: 100 });
  for (let k = 0; k < 20 && !cmds.some(c => c.cmd === 'speak'); k++) await tick();
  const sp = cmds.find(c => c.cmd === 'speak'); assert(sp, 'speaks for ' + lang);
  return sp.items;
};
const de = await intro('de');
assert(de.some(i => /example\.com/.test(i.text)) && !de.some(i => /^From /.test(i.text)), 'German intro: ' + JSON.stringify(de));
assert(de.every(i => !/word summary/.test(i.text)), 'no English sentence for the word count: ' + JSON.stringify(de));
assert(de.filter(i => /example\.com|100/.test(i.text)).every(i => /^de/.test(i.lang)), 'spoken with the German voice: ' + JSON.stringify(de));
const da = await intro('da');
assert(da.some(i => /^From example\.com/.test(i.text)) && da.some(i => /100-word summary/.test(i.text)), 'untranslated language keeps the app-language announcement: ' + JSON.stringify(da));
// Untranslated summary language: the announcement is in the extension's language and is spoken by that language's voice,
// even when the browser itself is set to another one (getUILanguage() says 'en' here).
d.documentElement.lang = 'de';
const da2 = await intro('da');
assert(da2.filter(i => /example\.com|100/.test(i.text)).every(i => /^de/.test(i.lang)), 'extension-language voice, not the browser language: ' + JSON.stringify(da2));
console.log('TEST 115 OK'); process.exit(0);
