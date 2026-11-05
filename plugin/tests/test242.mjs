// Models › Ollama / local shows Chrome's built-in model as a normal model chip when Chrome has it, a download button when it
// can be downloaded, a hint with chrome://on-device-internals when Chrome blocks it (e.g. disk space), and nothing without the API.
import assert from 'assert';
import { setup, imp, tick } from './harness.mjs';
const { w } = setup({}); const d = w.document;
const SM = await imp('modules/settingsManager.js');
const box = () => { const b = d.createElement('div'); d.body.append(b); return b; };
let state = 'available';
globalThis.LanguageModel = { availability: async () => state, create: async (o) => { o.monitor && o.monitor({ addEventListener: (_, f) => f({ loaded: 1, total: 1 }) }); state = 'available'; return { destroy() {} }; } };

let picked = '';
let b = box(); await SM.__test_renderBuiltinModel(b, (id) => { picked = id; });
const chip = b.querySelector('.model-id-tag');
assert.ok(chip && /(Chrome|Edge|Opera) · built-in/.test(chip.textContent), 'a model chip named after the browser');
chip.click(); assert.equal(picked, 'chrome-builtin', 'picks the built-in model like an Ollama model');
assert.ok(/larger Ollama model/.test(b.textContent), 'says what is better');

state = 'downloadable';
b = box(); await SM.__test_renderBuiltinModel(b, () => {});
const dl = [...b.querySelectorAll('button')].find(x => /Download the built-in model/.test(x.textContent));
assert.ok(dl && !b.querySelector('.model-id-tag'), 'download first');
dl.click(); await tick(50);
assert.ok(b.querySelector('.model-id-tag'), 'after the download the chip appears');

state = 'unavailable';
b = box(); await SM.__test_renderBuiltinModel(b, () => {});
assert.ok(/on-device-internals/.test(b.textContent) && /disk space/.test(b.textContent), 'explains where to look');

delete globalThis.LanguageModel;
b = box(); await SM.__test_renderBuiltinModel(b, () => {});
assert.ok(!b.isConnected, 'nothing without the API');
console.log('TEST 242 OK'); process.exit(0);
