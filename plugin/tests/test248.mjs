// Parts of D (AISH-033): when the chosen local model is not ready (not reachable, still loading, server error) the next ready
// local model from the saved order answers, the answer is marked (x-aish-fallback), the switch turns it off, and the quick test
// (a target request) never falls back. Without a fallback, “still loading” is waited for as before.
import { bgSource } from './bgSource.mjs';
import assert from 'assert'; import fs from 'fs'; import path from 'path'; import vm from 'vm';
const bg = bgSource();
const a = bg.indexOf('const LOCAL_URL'), b = bg.indexOf('\n}', bg.indexOf('async function aiFetchOne(')) + 2;
const enc = new TextEncoder();
const sse = (...parts) => new Response(new ReadableStream({ start(c) { parts.forEach(p => c.enqueue(enc.encode(p))); c.close(); } }), { status: 200 });
const text = (t) => `data: {"choices":[{"delta":{"content":"${t}"}}]}\n\n`;
const loading = 'data: {"error":{"message":"Model assets are loading. Try again in a moment."}}\n\n';
let syncData = {}, log = [], handler = () => sse(text('x'));
const ctx = { TextDecoder, Response, ReadableStream, Headers, JSON, Object, Error, Promise, Array, String, setTimeout: (f) => setTimeout(f, 1),
    chrome: { storage: { sync: { get: async () => syncData } } }, aiFetchRaw: async (u, init) => { const m = JSON.parse(init.body || '{}').model; log.push(u + ' ' + m); return handler(u, m); } };
vm.createContext(ctx); vm.runInContext(bg.slice(a, b) + '\nthis.aiFetch = aiFetch; this.aiFetchOne = aiFetchOne;', ctx);
const order = [{ model: 'apple-foundationmodel', endpoint: 'http://127.0.0.1:11434/v1/chat/completions', label: 'Apple Intelligence' }, { model: 'gemma4:e2b', endpoint: 'http://localhost:11434/api/chat', label: 'Ollama · gemma4:e2b' }];
syncData = { localFallbackOrder: order };
const body = JSON.stringify({ model: 'chrome-builtin', messages: [{ role: 'user', content: 'hi' }], stream: true });
// 1) chosen model still loading → Apple answers at once, marked
handler = (u, m) => m === 'chrome-builtin' ? sse(loading) : sse(text('from ' + m));
let r = await ctx.aiFetch('http://localhost:11434/api/chat', { body });
assert.equal(r.headers.get('x-aish-fallback'), 'Apple Intelligence'); assert.equal(r.headers.get('x-aish-fallback-from'), 'chrome-builtin');
assert.ok((await r.text()).includes('from apple-foundationmodel'));
assert.deepEqual(log, ['http://localhost:11434/api/chat chrome-builtin', 'http://127.0.0.1:11434/v1/chat/completions apple-foundationmodel'], 'no waiting, the next one answers');
// 2) not reachable, Apple errors too → Ollama answers
log = []; handler = (u, m) => { if (m === 'chrome-builtin') throw new TypeError('Failed to fetch'); if (m === 'apple-foundationmodel') return new Response('err', { status: 500 }); return sse(text('ok')); };
r = await ctx.aiFetch('http://localhost:11434/api/chat', { body });
assert.equal(r.headers.get('x-aish-fallback'), 'Ollama · gemma4:e2b');
// 3) switched off → the original error stands
syncData = { localFallback: false, localFallbackOrder: order }; log = [];
handler = () => new Response('nope', { status: 500 });
r = await ctx.aiFetch('http://localhost:11434/api/chat', { body });
assert.equal(r.status, 500); assert.equal(log.length, 1, 'no other model asked');
// 4) the chosen model answers → untouched
syncData = { localFallbackOrder: order }; log = []; handler = () => sse(text('fine'));
r = await ctx.aiFetch('http://localhost:11434/api/chat', { body });
assert.equal(r.headers.get('x-aish-fallback'), null); assert.equal(log.length, 1);
// 5) the quick test path (aiFetchOne) never falls back
log = []; handler = (u, m) => m === 'chrome-builtin' ? new Response('x', { status: 500 }) : sse(text('no'));
r = await ctx.aiFetchOne('http://localhost:11434/api/chat', { body });
assert.equal(r.status, 500); assert.equal(log.length, 1);
// wiring
assert.ok(/const send = target \? aiFetchOne : aiFetch;/.test(bg) && /push\(\{ meta: 'fallback'/.test(bg));
assert.ok(/msg\.meta === 'fallback'/.test(fs.readFileSync(path.join(process.env.AISH_SRC, 'content.js'), 'utf8')));
console.log('TEST 248 OK');
