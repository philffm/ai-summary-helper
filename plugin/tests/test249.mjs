// Models › Connection path: Own key and Local share one container. While it is rebuilt for the chosen tab it is invisible
// (class is-switching, it keeps its room), and it is only shown once ready: the other tab's fields (the Ollama tutorial, the
// endpoint) are never on screen under the new tab. A newer click wins over a slower older one.
import assert from 'assert';
import fs from 'fs';
import { setup, imp, tick } from './harness.mjs';
const { w, store } = setup({ connectionMode: 'local', activeService: 'ollama' }); const d = w.document;
globalThis.requestAnimationFrame = (f) => setTimeout(f, 0);
chrome.runtime.getURL = (p) => 'chrome-extension://abc/' + p;
chrome.tabs = { query: async () => [], sendMessage() {}, onActivated: { addListener() {} }, onUpdated: { addListener() {} } };
const services = JSON.parse(fs.readFileSync(process.env.AISH_SRC + '/services.json', 'utf8'));
globalThis.fetch = w.fetch = async (url) => /services\.json/.test(String(url))
    ? ({ ok: true, json: async () => services })
    : ({ ok: true, json: async () => ({ success: true, models: [{ id: 'm/x', name: 'X', context: 8000 }] }), text: async () => '' });
const css = fs.readFileSync(process.env.AISH_SRC + '/styles.css', 'utf8');
assert.ok(/#developerModeContainer\.is-switching\s*\{\s*visibility:\s*hidden/.test(css), 'invisible while switching, but it keeps its room');

const SM = await imp('modules/settingsManager.js');
await SM.initSettingsManager({}); await tick(200);
const box = d.getElementById('developerModeContainer'), pick = (id) => { const r = d.getElementById(id); r.checked = true; r.dispatchEvent(new w.Event('change', { bubbles: true })); };
const settled = async () => { for (let k = 0; k < 80 && box.classList.contains('is-switching'); k++) await tick(25); };
assert.equal(box.classList.contains('is-switching'), false, 'visible at rest');

// Ollama → Own key: hidden at once, shown only when the Ollama tutorial is gone and the provider fields are in place
pick('modeLocal');
assert.equal(box.classList.contains('is-switching'), true, 'hidden while the fields are rebuilt');
await settled();
assert.equal(box.classList.contains('is-switching'), false, 'shown again when ready');
assert.equal(box.style.display, 'block');
assert.equal(d.getElementById('ollamaTutorialContainer').style.display, 'none', 'no Ollama tutorial under Own key');
assert.notEqual(store.activeService, 'ollama', 'an own-key provider is active');

// Own key → Local: the tutorial is there when it is shown
pick('modeOllama'); await settled();
assert.equal(d.getElementById('ollamaTutorialContainer').style.display, 'block', 'the Local tab shows its tutorial');
assert.equal(store.activeService, 'ollama');

// two quick clicks: the last one decides, and the container does not stay hidden
pick('modeLocal'); pick('modeOllama'); await settled();
assert.equal(box.classList.contains('is-switching'), false);
assert.equal(store.activeService, 'ollama');
assert.equal(d.getElementById('ollamaTutorialContainer').style.display, 'block');

// → byPhil Cloud: the container is gone, nothing is left hidden for the next switch
pick('modeCloud'); await settled();
assert.equal(box.style.display, 'none');
assert.equal(box.classList.contains('is-switching'), false);
console.log('TEST 249 OK'); process.exit(0);
