// Ollama has no built-in default model: services.json carries none, the model list shows no "(default)" tag, and the active model stays empty until one is installed and picked.
import assert from 'assert'; import fs from 'fs';
import { setup, imp } from './harness.mjs';
const { w } = setup({}); globalThis.document = w.document; globalThis.window = w;
const services = JSON.parse(fs.readFileSync(process.env.AISH_SRC + '/services.json', 'utf8'));
const ollama = services.find(s => s.id === 'ollama');
assert(ollama && ollama.apiKeyOptional, 'ollama entry exists');
assert(!ollama.defaultModel, 'no default model for Ollama');
assert(services.filter(s => s.id !== 'ollama').every(s => s.defaultModel), 'cloud providers keep their defaults');

w.document.body.innerHTML = '<div id="modelIdentifierContainer"></div>';
const { updateModelIdentifierUI } = await imp('modules/modelManager.js');
await updateModelIdentifierUI('ollama', services.map(s => ({ ...s, id: s.id })), { 'config:services': { ollama: { customModel: [] } } });
assert.equal(w.document.querySelectorAll('.model-id-tag').length, 0, 'no pseudo model listed');
assert(!/\(default\)/.test(w.document.body.textContent), 'no "(default)" label');
await updateModelIdentifierUI('ollama', services, { 'config:services': { ollama: { customModel: [{ id: 'qwen3:8b', provider: 'ollama' }] } } });
assert.deepEqual([...w.document.querySelectorAll('.model-id-tag')].map(n => n.dataset.model), ['qwen3:8b'], 'only installed / chosen models');
console.log('TEST 123 OK'); process.exit(0);
