// A local model that is still loading (apfel: "Model assets are loading. Try again in a moment.") does not end in an empty
// summary: the background waits and asks again, hands on the stream untouched once text starts, and after the limit answers
// with a clear 503. Remote URLs are never held back.
import assert from 'assert'; import fs from 'fs'; import path from 'path'; import vm from 'vm';
const bg = fs.readFileSync(path.join(process.env.AISH_SRC, 'background.js'), 'utf8');
const a = bg.indexOf('const LOCAL_URL'), b = bg.indexOf('\n}', bg.indexOf('async function aiFetchOne(')) + 2;
const enc = new TextEncoder();
const sse = (...parts) => new Response(new ReadableStream({ start(c) { parts.forEach(p => c.enqueue(enc.encode(p))); c.close(); } }), { status: 200, headers: { 'content-type': 'text/event-stream' } });
let calls = 0, script = [];
const ctx = { TextDecoder, Response, ReadableStream, Headers, JSON, Object, Error, Promise, Array, setTimeout: (f) => setTimeout(f, 1), String, chrome: { storage: { sync: { get: async () => ({}) } } }, aiFetchRaw: async () => { calls++; return script.shift()(); } };
vm.createContext(ctx);
vm.runInContext(bg.slice(a, b) + '\nthis.aiFetch = aiFetch;', ctx);
const role = 'data: {"choices":[{"delta":{"role":"assistant"}}]}\n\n';
const loading = 'data: {"error":{"message":"Model assets are loading. Try again in a moment."}}\n\n';
const text = (t) => `data: {"choices":[{"delta":{"content":"${t}"}}]}\n\n`;
// loading twice, then text: retried, and the full stream arrives
script = [() => sse(role, loading), () => sse(role, loading), () => sse(role, text('Hal'), text('lo'), 'data: [DONE]\n\n')];
let out = await (await ctx.aiFetch('http://127.0.0.1:11434/v1/chat/completions', { method: 'POST', body: '{}' })).text();
assert.equal(calls, 3, 'asked again while loading');
assert.ok(out.includes('"Hal"') && out.includes('"lo"') && out.includes('[DONE]') && out.startsWith(role), 'nothing of the stream is lost');
// a 500 that says loading counts too
calls = 0; script = [() => new Response('{"error":"[model loading] Model assets are loading."}', { status: 500 }), () => sse(text('ok'))];
out = await (await ctx.aiFetch('http://localhost:11434/v1/chat/completions', {})).text();
assert.equal(calls, 2); assert.ok(out.includes('"ok"'));
// never ready: a clear 503
calls = 0; script = Array.from({ length: 30 }, () => () => sse(role, loading));
const r = await ctx.aiFetch('http://127.0.0.1:11434/v1/chat/completions', {});
assert.equal(r.status, 503); assert.ok(/still loading/.test(await r.text()));
// remote: untouched (no second call, no reading ahead)
calls = 0; script = [() => sse(loading)];
await ctx.aiFetch('https://api.example.com/v1/chat/completions', {});
assert.equal(calls, 1);
console.log('TEST 245 OK');
