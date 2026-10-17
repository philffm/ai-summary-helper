// @realtime Streaming deltas end to end: worker (background.js in a vm) → client (modules/feedAi.js).
// A lost delta is never appended; the client warns, asks for a resend, and the worker's next tick carries the whole text from 0.
import assert from 'assert'; import fs from 'fs'; import vm from 'vm';
import { setup, imp } from './harness.mjs';
setup({});
const src = fs.readFileSync(process.env.AISH_SRC + '/background.js', 'utf8');
const area = (st) => ({ get: (k, cb) => { const o = {}; (k == null ? Object.keys(st) : typeof k === 'string' ? [k] : Array.isArray(k) ? k : Object.keys(k)).forEach((x) => { if (x in st) o[x] = JSON.parse(JSON.stringify(st[x])); }); if (cb) { cb(o); return; } return Promise.resolve(o); }, set: (o, cb) => { Object.assign(st, o); if (cb) cb(); return Promise.resolve(); }, remove: () => Promise.resolve() });
const local = { 'config:services': { ollama: { endpoint: 'http://localhost:11434/v1/chat/completions', activeModelId: { id: 'm', provider: 'ollama' }, customModel: [{ id: 'm', provider: 'ollama' }] } } };
let workerOnMessage = null;
const any = () => new Proxy(function () {}, { get: (t, k) => (k === 'then' ? undefined : any()), apply: () => any() });
const wire = { toClient: () => {} };
const rt = { id: 'ext-id', getURL: (p) => 'chrome-extension://ext-id/' + p, onMessage: { addListener: (f) => { workerOnMessage = f; } }, sendMessage: (m, cb) => { wire.toClient(m); if (cb) cb({ ok: true }); }, lastError: null };
const store = { sync: area({ connectionMode: 'local', activeService: 'ollama' }), local: area(local), session: area({}), onChanged: { addListener() {} } };
const chrome = new Proxy({}, { get: (t, k) => k === 'storage' ? store : k === 'runtime' ? new Proxy(rt, { get: (o, r) => (r in o ? o[r] : any()) }) : any() });
const sse = (t) => 'data: ' + JSON.stringify({ choices: [{ delta: { content: t } }] }) + '\n\n';
const parts = ['Alpha ', 'beta ', 'gamma ', 'delta ', 'epsilon'];
const fakeFetch = async (url) => {
    if (String(url).startsWith('chrome-extension://')) return { ok: true, json: async () => [{ id: 'ollama', apiKeyOptional: true, endpointUrl: 'http://localhost:11434/v1/chat/completions', defaultModel: 'm' }] };
    let i = 0; const enc = new TextEncoder();
    return { ok: true, status: 200, body: { getReader: () => ({ read: async () => { if (i >= parts.length) return { done: true }; await new Promise(r => setTimeout(r, 300)); return { done: false, value: enc.encode(sse(parts[i++])) }; } }) } };
};
const warns = [];
const sandbox = { chrome, console: { ...console, log() {}, warn() {} }, setTimeout, clearTimeout, setInterval() {}, fetch: fakeFetch, AbortController, URL, TextDecoder, TextEncoder, crypto: globalThis.crypto, importScripts() {} };
sandbox.globalThis = sandbox; sandbox.self = sandbox;
vm.createContext(sandbox); vm.runInContext(src, sandbox);
const popup = { id: 'ext-id', url: 'chrome-extension://ext-id/popup.html' };

const { aiComplete } = await imp('modules/feedAi.js');
const realWarn = console.warn; console.warn = (...a) => warns.push(a.join(' '));
const wireLog = [];
let progressN = 0, dropNth = 2;
// client → worker (aiComplete / aiResync / aiCancel)
globalThis.chrome.runtime.sendMessage = (m, cb) => { if (m.action === 'aiComplete' || m.action === 'aiResync') workerOnMessage(m, popup, (res) => cb && cb(res)); else cb && cb({ ok: true }); };
// worker → client (aiProgress): drop one tick to simulate a lost message
wire.toClient = (m) => {
    if (m.action !== 'aiProgress' || m.phase !== 'stream') return;
    progressN++; wireLog.push({ n: progressN, from: m.from, len: (m.delta || '').length, dropped: progressN === dropNth });
    if (progressN === dropNth) return;
    for (const f of globalThis.__msgL || []) f(m);
};
const seen = [];
const text = await aiComplete('s', 'u', null, null, (m) => { if (typeof m.text === 'string') seen.push(m.text); }, { partial: true, service: 'ollama' });
console.warn = realWarn;
const full = parts.join('');
assert.equal(text, full, 'the final reply is complete');
assert.ok(warns.some(w => /out of sync/.test(w)), 'a warning is logged: ' + JSON.stringify(warns));
assert.equal(warns.filter(w => /out of sync/.test(w)).length, 1, 'one warning, one resend request per loss');
// never a half-built text: every text handed on is a prefix of the real one, and the last one is complete
assert.ok(seen.length >= 2 && seen.every(t => full.startsWith(t)), 'only prefixes of the real text: ' + JSON.stringify(seen));
assert.ok(wireLog.some(l => l.from === 0 && l.n > dropNth && l.len > 0), 'the tick after the request restarts at 0 with the whole text: ' + JSON.stringify(wireLog));
console.log('TEST stream resync OK'); process.exit(0);
