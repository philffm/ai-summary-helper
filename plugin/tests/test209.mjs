// Demon Route provider: services.json entry is an OpenAI-compatible chat endpoint with a required key and a default model, and it shows in the model tag list.
import assert from 'assert'; import fs from 'fs';
import { setup, imp } from './harness.mjs';
const { w } = setup({}); globalThis.document = w.document; globalThis.window = w;
const services = JSON.parse(fs.readFileSync(process.env.AISH_SRC + '/services.json', 'utf8'));
const dr = services.find(s => s.id === 'demonroute');
assert(dr, 'demonroute entry exists');
assert.equal(dr.endpointUrl, 'https://api.demonroute.com/v1/chat/completions', 'OpenAI-compatible chat completions endpoint');
assert.equal(dr.responseStructure, 'result.choices?.[0]?.message?.content', 'OpenAI-style response');
assert(!dr.apiKeyOptional && !dr.allowCustomEndpoint, 'needs a key, fixed endpoint');
assert(dr.defaultModel, 'has a default model');

w.document.body.innerHTML = '<div id="modelIdentifierContainer"></div>';
const { updateModelIdentifierUI } = await imp('modules/modelManager.js');
await updateModelIdentifierUI('demonroute', services, { 'config:services': { demonroute: { customModel: [] } } });
assert.deepEqual([...w.document.querySelectorAll('.model-id-tag')].map(n => n.dataset.model), [dr.defaultModel], 'default model listed');
console.log('TEST 209 OK'); process.exit(0);
