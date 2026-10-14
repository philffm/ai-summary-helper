// Own OpenAI-compatible server (service "custom"): services.json entry, URL normalisation, model list, stream parsing, badge.
import assert from 'assert'; import fs from 'fs';
import { imp } from './harness.mjs';
const services = JSON.parse(fs.readFileSync(process.env.AISH_SRC + '/services.json', 'utf8'));
const c = services.find(s => s.id === 'custom');
assert(c, 'custom entry exists');
assert(c.allowCustomEndpoint && c.apiKeyOptional && c.apiKeyField, 'endpoint allowed, key optional but enterable');
assert(!c.defaultModel && !c.endpointUrl, 'no built-in model or address');
assert(services.indexOf(c) === services.findIndex(s => s.id === 'ollama') + 1, 'listed after ollama');
assert(c.responseStructure.includes('choices'));

const { normalizeChatUrl, modelsUrl } = await imp('modules/endpointUrl.js');
const full = 'https://host.example/v1/chat/completions';
for (const typed of ['https://host.example/v1', 'https://host.example/v1/', full, full + '/', ' https://host.example/v1?x=1#h ', 'HTTPS://host.example/v1/chat/completions']) {
    const r = normalizeChatUrl(typed); assert(r.ok, typed); assert.equal(r.chatUrl, full, typed); assert.equal(r.baseUrl, 'https://host.example/v1', typed);
}
assert.equal(normalizeChatUrl('http://localhost:1234').chatUrl, 'http://localhost:1234/chat/completions');
assert.equal(normalizeChatUrl('http://localhost:11434/v1').baseUrl, 'http://localhost:11434/v1');
for (const bad of ['', '   ', 'localhost:1234/v1', 'ftp://x/v1', 'not a url', null]) assert.equal(normalizeChatUrl(bad).ok, false, String(bad));
assert.equal(modelsUrl(full), 'https://host.example/v1/models');
assert.equal(modelsUrl('nope'), '');

// Model list: success, 401, 404, timeout/unreachable, odd shapes. Free typing stays possible (nothing throws).
const { checkOpenAiModels } = await imp('modules/openaiModelsCheck.js');
const realFetch = globalThis.fetch;
const reply = (status, body) => async (url, opt) => { reply.last = { url, opt }; return { ok: status >= 200 && status < 300, status, json: async () => body }; };
globalThis.fetch = reply(200, { data: [{ id: 'qwen3:8b' }, { id: 'llama3' }, { id: 'llama3' }, {}] });
let r = await checkOpenAiModels(full, 'sk-x');
assert.deepEqual(r, { ok: true, models: ['qwen3:8b', 'llama3'] });
assert.equal(reply.last.url, 'https://host.example/v1/models');
assert.equal(reply.last.opt.headers.Authorization, 'Bearer sk-x');
await checkOpenAiModels(full); assert.deepEqual(reply.last.opt.headers, {}, 'no key → no Authorization header');
globalThis.fetch = reply(401, {}); assert.deepEqual(await checkOpenAiModels(full), { ok: false, reason: 'unauthorized', status: 401 });
globalThis.fetch = reply(404, {}); assert.equal((await checkOpenAiModels(full)).reason, 'notfound');
globalThis.fetch = reply(500, {}); assert.equal((await checkOpenAiModels(full)).reason, 'http');
globalThis.fetch = reply(200, { weird: true }); assert.deepEqual(await checkOpenAiModels(full), { ok: true, models: [] });
globalThis.fetch = async () => { throw new TypeError('Failed to fetch'); }; assert.equal((await checkOpenAiModels(full)).reason, 'unreachable');
assert.equal((await checkOpenAiModels('')).reason, 'invalid');
globalThis.fetch = realFetch;

// Streaming parser (background → content script and the detached run): OpenAI deltas, empty delta, non-streaming JSON.
const { createStreamParser } = await imp('content/finalize.js');
const run = (chunks, svc = 'custom') => { const p = createStreamParser(svc); chunks.forEach(x => p.push(x)); p.end(); return p.summary; };
const sse = (o) => 'data: ' + JSON.stringify(o) + '\n\n';
assert.equal(run([sse({ choices: [{ delta: { role: 'assistant', content: '' } }] }), sse({ choices: [{ delta: { content: 'Hel' } }] }), sse({ choices: [{ delta: { content: 'lo' } }] }), sse({ choices: [{ delta: {}, finish_reason: 'stop' }] }), 'data: [DONE]\n\n']), 'Hello');
assert.equal(run([JSON.stringify({ choices: [{ message: { role: 'assistant', content: 'One shot' } }] })]), 'One shot', 'compact non-streaming JSON');
assert.equal(run(['{\n  "choices": [\n    { "message": { "content": "Pretty one shot" } }\n  ]\n}']), 'Pretty one shot', 'pretty-printed non-streaming JSON');

// Badge: own server is drawn like a server, not a laptop.
const { modelKind } = await imp('modules/modelBadge.js');
assert.equal(modelKind({ connectionMode: 'local', service: 'custom', modelId: 'x' }), 'custom');
assert.equal(modelKind({ connectionMode: 'local', service: 'openai', modelId: 'gpt' }), 'own');
console.log('TEST 170 OK'); process.exit(0);
