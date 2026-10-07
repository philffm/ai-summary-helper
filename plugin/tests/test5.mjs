import fs from 'fs'; import assert from 'assert';
const src = fs.readFileSync(process.env.AISH_SRC + '/background.js', 'utf8');
const a = src.indexOf('const AISH_API_BASE'), b = src.indexOf("chrome.runtime.onStartup");
const keys = src.slice(src.indexOf('// storage-keys:begin'), src.indexOf('// storage-keys:end'));
const code = keys + '\nconst localGet = async (...a) => chrome.storage.local.get(...a);\n' + src.slice(a, b) + '\nreturn { aiComplete, parseAiResponseText, aiFriendlyError };';
let store = { sync: {}, local: {} }, calls = [], reply;
globalThis.chrome = { storage: { sync: { get: async () => store.sync }, local: { get: async () => store.local } }, runtime: { getURL: (p) => 'x://' + p } };
globalThis.fetch = async (url, o) => {
  if (String(url).startsWith('x://')) return { json: async () => [{ id: 'openai', endpointUrl: 'https://api.openai.com/v1/chat/completions', defaultModel: 'gpt-x' }, { id: 'ollama', endpointUrl: 'http://localhost:11434/api/chat', defaultModel: 'llama', apiKeyOptional: true }] };
  calls.push({ url, o }); return reply();
};
const { aiComplete, parseAiResponseText } = new Function(code)();
const ok = (t) => ({ ok: true, status: 200, text: async () => t });
// cloud
store.sync = {}; store.local = { 'account:token': 'tok', 'account:installId': 'iid' };
reply = () => ok(JSON.stringify({ choices: [{ message: { content: 'hello' } }] }));
let r = await aiComplete({ system: 's', user: 'u' });
assert.equal(r.text, 'hello'); assert.ok(calls[0].url.includes('api.byphil.eu')); assert.equal(calls[0].o.headers.Authorization, 'Bearer tok'); assert.equal(calls[0].o.headers['X-Install-ID'], 'iid');
assert.equal(JSON.parse(calls[0].o.body).model, 'google/gemini-2.5-flash');
// SSE fallback
reply = () => ok('data: {"choices":[{"delta":{"content":"He"}}]}\n\ndata: {"choices":[{"delta":{"content":"llo"}}]}\n\ndata: [DONE]\n');
assert.equal((await aiComplete({ system: 's', user: 'u' })).text, 'Hello');
// own key openai
store.sync = { connectionMode: 'own', activeService: 'openai' }; store.local = { 'config:services': { openai: { apiKey: 'k' } } };
reply = () => ok(JSON.stringify({ choices: [{ message: { content: 'own' } }] }));
r = await aiComplete({ system: 's', user: 'u' }); assert.equal(r.text, 'own'); assert.equal(calls.at(-1).url, 'https://api.openai.com/v1/chat/completions'); assert.equal(r.model, 'gpt-x');
// gemini
store.sync = { connectionMode: 'own', activeService: 'gemini' }; store.local = { 'config:services': { gemini: { apiKey: 'g', modelIdentifier: 'gemini-2.5-flash' } } };
reply = () => ok(JSON.stringify({ candidates: [{ content: { parts: [{ text: 'gem' }] } }] }));
r = await aiComplete({ system: 's', user: 'u' }); assert.equal(r.text, 'gem'); assert.ok(calls.at(-1).url.includes('generativelanguage')); assert.equal(calls.at(-1).o.headers['x-goog-api-key'], 'g');
// ollama (no key)
store.sync = { connectionMode: 'own', activeService: 'ollama' }; store.local = { 'config:services': {} };
reply = () => ok(JSON.stringify({ message: { content: 'oll' } }));
assert.equal((await aiComplete({ system: 's', user: 'u' })).text, 'oll');
// missing key
store.sync = { connectionMode: 'own', activeService: 'openai' }; store.local = {};
await assert.rejects(aiComplete({ system: 's', user: 'u' }), /API key/);
// limit error
store.sync = {}; store.local = {};
reply = () => ({ ok: false, status: 429, text: async () => 'too many' });
await assert.rejects(aiComplete({ system: 's', user: 'u' }), /free daily limit/);
console.log('TEST 5 OK');
