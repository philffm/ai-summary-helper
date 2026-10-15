// AI requests (feedAi): cloud endpoint and model, SSE fallback, own-key provider.
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
assert.equal(JSON.parse(calls[0].o.body).model, 'google/gemini-3.8-flash');
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
// expired login token (cloud): never sent; license key is the fallback, otherwise a clear "sign in again" message
const jwt = (exp) => 'h.' + Buffer.from(JSON.stringify({ exp })).toString('base64url') + '.s';
const past = Math.floor(Date.now() / 1000) - 3600, future = Math.floor(Date.now() / 1000) + 3600;
reply = () => ok(JSON.stringify({ choices: [{ message: { content: 'cl' } }] }));
store.sync = {}; store.local = { 'account:token': jwt(future) };
await aiComplete({ system: 's', user: 'u' }); assert.equal(calls.at(-1).o.headers.Authorization, 'Bearer ' + jwt(future));
store.local = { 'account:token': jwt(past), 'account:licenseKey': 'LIC' };
await aiComplete({ system: 's', user: 'u' }); assert.equal(calls.at(-1).o.headers.Authorization, 'Bearer LIC');
store.local = { 'account:token': jwt(past) }; const before = calls.length;
await assert.rejects(aiComplete({ system: 's', user: 'u' }), /session has expired.*sign in again/i);
assert.equal(calls.length, before, 'an expired token must not reach the API');
store.local = { 'account:token': 'not-a-jwt' };
await aiComplete({ system: 's', user: 'u' }); assert.equal(calls.at(-1).o.headers.Authorization, 'Bearer not-a-jwt'); // unreadable: behaves as before
reply = () => ({ ok: false, status: 401, text: async () => 'unauthorized' });
store.local = {}; await assert.rejects(aiComplete({ system: 's', user: 'u' }), /sign in again/i);
reply = () => ({ ok: false, status: 429, text: async () => 'too many' });
await assert.rejects(aiComplete({ system: 's', user: 'u' }), /free daily limit.*sign in again/i);
store.sync = { connectionMode: 'own', activeService: 'ollama' }; store.local = { 'config:services': {} };
await assert.rejects(aiComplete({ system: 's', user: 'u' }), (e) => /free daily limit/.test(e.message) && !/sign in/i.test(e.message)); // own server: no sign-in hint
{ const { isTokenExpired } = await import(process.env.AISH_SRC + '/modules/sessionToken.js');
  assert.equal(isTokenExpired(jwt(past)), true); assert.equal(isTokenExpired(jwt(future)), false);
  assert.equal(isTokenExpired(''), false); assert.equal(isTokenExpired('x.y.z'), false); assert.equal(isTokenExpired(null), false); }
console.log('TEST 5 OK');
