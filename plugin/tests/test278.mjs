// OpenRouter as a bring-your-own-key provider: one OpenAI-style entry in services.json, no code path of its own.
import assert from 'assert'; import fs from 'fs';
const services = JSON.parse(fs.readFileSync(process.env.AISH_SRC + '/services.json', 'utf8'));
const or = services.find((s) => s.id === 'openrouter');
assert(or, 'OpenRouter is listed');
assert.equal(or.endpointUrl, 'https://openrouter.ai/api/v1/chat/completions');
assert.equal(or.responseStructure, services.find((s) => s.id === 'mistral').responseStructure, 'same reply shape as the other OpenAI-style providers');
assert(or.defaultModel && !or.apiKeyOptional, 'needs a key and has a default model (the auto router)');
assert(/openrouter\.ai\/keys/.test(or.apiKeyDocumentationUrl), 'links to where the key is made');
assert.equal(new Set(services.map((s) => s.id)).size, services.length, 'ids stay unique');
const privacy = fs.readFileSync(new URL('../../site-src/pages/privacy.html', import.meta.url), 'utf8');
assert(/OpenRouter/.test(privacy), 'the privacy page names it');
console.log('TEST 278 OK');
