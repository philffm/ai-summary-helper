// Read aloud helpers + manifests + sound chip markup.
import { setup, imp } from './harness.mjs'; import assert from 'assert'; import fs from 'fs';
const { w } = setup({}); globalThis.document = w.document; globalThis.window = w;
const r = await imp('modules/reader.js');
const s = r.sentences('Hello world. This is a test! Is it? Yes.');
assert(s.length >= 3 && s.every(x => x.trim()), 'sentences split');
assert.deepEqual(r.finishedSentences('One done. Two done. Thre'), ['One done.', 'Two done.'], 'partial tail is held back');
assert.deepEqual(r.finishedSentences('One done. Thre', true), ['One done.', 'Thre'], 'flush emits the tail');
const voices = [{ name: 'A', lang: 'en-US' }, { name: 'B', lang: 'de-DE' }];
assert.equal(r.pickVoice(voices, 'de-DE').name, 'B'); assert.equal(r.pickVoice(voices, 'fr-FR'), null);
const root = new URL('../platforms/', import.meta.url).pathname;
assert(JSON.parse(fs.readFileSync(root + 'chrome/manifest.json', 'utf8')).permissions.includes('tts'));
for (const p of ['firefox', 'ios']) assert(JSON.stringify(JSON.parse(fs.readFileSync(root + p + '/manifest.json', 'utf8')).background).includes('ttsEngine.js'), p);
const html = fs.readFileSync(new URL('../src/popup.html', import.meta.url), 'utf8');
assert(html.includes('id="chipSound"') && html.includes('id="panelSound"'));
console.log('TEST 77 OK');
