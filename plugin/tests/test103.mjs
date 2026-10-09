// The whole-library run always talks to Ollama with the model last chosen for Ollama, whatever is active for summaries (also when the model is switched mid-run).
import assert from 'assert'; import fs from 'fs'; import vm from 'vm';
const src = fs.readFileSync(process.env.AISH_SRC + '/background.js', 'utf8');
const sync = { connectionMode: 'local', activeService: 'ollama', preferredCloudModel: 'openai/gpt-6.1-sol' };
const local = { 'config:services': {
    ollama: { endpoint: 'http://localhost:11434/v1/chat/completions', activeModelId: { id: 'qwen3:8b', provider: 'ollama' }, customModel: [{ id: 'llama3.2', provider: 'ollama' }, { id: 'qwen3:8b', provider: 'ollama' }] },
    openai: { apiKey: 'sk-test', activeModelId: { id: 'gpt-x', provider: 'openai' } } } };
const area = (st) => ({ get: (k, cb) => { const o = {}; (k == null ? Object.keys(st) : typeof k === 'string' ? [k] : Array.isArray(k) ? k : Object.keys(k)).forEach((x) => { if (x in st) o[x] = JSON.parse(JSON.stringify(st[x])); }); if (cb) { cb(o); return; } return Promise.resolve(o); }, set: (o, cb) => { Object.assign(st, o); if (cb) cb(); return Promise.resolve(); }, remove: () => Promise.resolve() });
let onMessage = null;
const any = () => new Proxy(function () {}, { get: (t, k) => (k === 'then' ? undefined : any()), apply: () => any() });
const rt = { id: 'ext-id', getURL: (p) => 'chrome-extension://ext-id/' + p, onMessage: { addListener: (f) => { onMessage = f; } }, sendMessage() {}, lastError: null };
const store = { sync: area(sync), local: area(local), session: area({}), onChanged: { addListener() {} } };
const chrome = new Proxy({}, { get: (t, k) => k === 'storage' ? store : k === 'runtime' ? new Proxy(rt, { get: (o, r) => (r in o ? o[r] : any()) }) : any() });
const requests = [];
const fakeFetch = async (url, opts) => {
    if (String(url).startsWith('chrome-extension://')) return { ok: true, json: async () => [{ id: 'ollama', apiKeyOptional: true, endpointUrl: 'http://localhost:11434/v1/chat/completions', defaultModel: 'llama3.2' }, { id: 'openai', endpointUrl: 'https://api.openai.com/v1/chat/completions' }] };
    requests.push({ url: String(url), body: JSON.parse(opts.body) });
    const body = 'data: {"choices":[{"delta":{"content":"{\\"scores\\":[0],\\"labels\\":[\\"Tech\\"]}"}}]}\n\ndata: [DONE]\n';
    return { ok: true, status: 200, text: async () => body, body: null };
};
const sandbox = { chrome, console: { ...console, log() {}, warn() {} }, setTimeout, clearTimeout, setInterval() {}, fetch: fakeFetch, AbortController, URL, TextDecoder, crypto: globalThis.crypto, importScripts() {} };
sandbox.globalThis = sandbox; sandbox.self = sandbox;
vm.createContext(sandbox); vm.runInContext(src, sandbox);
const popup = { id: 'ext-id', url: 'chrome-extension://ext-id/popup.html' };
const ask = (extra) => new Promise((res) => { onMessage({ action: 'aiComplete', system: 's', user: 'u', id: 'x' + Math.random(), ...extra }, popup, res); });

// 1) Ollama active, no override: Ollama
let r = await ask({}); assert(r.ok, JSON.stringify(r));
assert(/11434/.test(requests.at(-1).url) && requests.at(-1).body.model === 'qwen3:8b', JSON.stringify(requests.at(-1)));

// 2) the user switches the summary model to byPhil Cloud, then to an own-key provider, mid-run
sync.connectionMode = 'cloud'; sync.activeService = 'openai';
r = await ask({}); assert(r.ok, JSON.stringify(r));
assert(/byphil\.eu/.test(requests.at(-1).url) && requests.at(-1).body.model === 'openai/gpt-6.1-sol', 'without the override the active (cloud) model is used: ' + JSON.stringify(requests.at(-1)));
r = await ask({ service: 'ollama' }); assert(r.ok, JSON.stringify(r));
assert(/localhost:11434/.test(requests.at(-1).url), 'library run → Ollama endpoint: ' + requests.at(-1).url);
assert.equal(requests.at(-1).body.model, 'qwen3:8b', 'library run → the model last chosen for Ollama');
sync.connectionMode = 'local'; sync.activeService = 'openai';
r = await ask({ service: 'ollama' }); assert(r.ok, JSON.stringify(r));
assert(/11434/.test(requests.at(-1).url) && requests.at(-1).body.model === 'qwen3:8b', 'still Ollama with an own-key provider active');
// 3) the user picks another Ollama model → the next batch uses it
local['config:services'].ollama.activeModelId = { id: 'llama3.2', provider: 'ollama' };
r = await ask({ service: 'ollama' }); assert.equal(requests.at(-1).body.model, 'llama3.2');
// 4) only 'ollama' can be forced
r = await ask({ service: 'openai' }); assert(/api\.openai\.com/.test(requests.at(-1).url), 'only "ollama" can be forced; anything else uses the active provider: ' + requests.at(-1).url);
console.log('TEST 103 OK'); process.exit(0);
