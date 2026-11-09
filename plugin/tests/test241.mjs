// Chrome's built-in model as a normal local model (id `chrome-builtin` under Ollama / local): background requests for it
// are answered by the Prompt API in the same stream format the endpoint would use (Ollama NDJSON for /api/chat, OpenAI SSE
// otherwise), a too-long page is shortened and retried once, and every other model still goes to the network.
import { bgSource } from './bgSource.mjs';
import assert from 'assert'; import fs from 'fs'; import path from 'path'; import vm from 'vm';
const SRC = process.env.AISH_SRC;
const prompts = [];
let overflowOnce = false;
const LanguageModel = {
    availability: async () => 'available',
    create: async (o) => ({
        promptStreaming(text) {
            prompts.push({ sys: (o.initialPrompts || [])[0]?.content || '', text });
            if (overflowOnce) { overflowOnce = false; const e = new Error('too long'); e.name = 'QuotaExceededError'; e.requested = 10000; e.contextWindow = 4000; return (async function* () { throw e; })(); }
            return (async function* () { yield 'Hallo '; yield 'Welt'; })();
        },
        destroy() {},
    }),
};
const netCalls = [];
const ctx = { self: {}, TextEncoder, ReadableStream, Response, fetch: async (u) => { netCalls.push(u); return new Response('net'); }, console };
ctx.self = ctx; ctx.LanguageModel = LanguageModel;
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(SRC, 'builtinAi.js'), 'utf8'), ctx);
const B = ctx.AishBuiltin;
const body = (model) => JSON.stringify({ model, messages: [{ role: 'system', content: 'SYS' }, { role: 'user', content: 'PAGE' }], stream: true });

// Ollama /api/chat → NDJSON
let txt = await (await B.aiFetch('http://localhost:11434/api/chat', { method: 'POST', body: body('chrome-builtin') })).text();
const lines = txt.trim().split('\n').map(l => JSON.parse(l));
assert.equal(lines.filter(l => !l.done).map(l => l.message.content).join(''), 'Hallo Welt');
assert.equal(lines.at(-1).done, true);
assert.deepEqual(prompts[0], { sys: 'SYS', text: 'PAGE' }, 'system prompt as initial prompt, the rest as the prompt');
// OpenAI-style endpoint → SSE
txt = await (await B.aiFetch('http://localhost:11434/v1/chat/completions', { method: 'POST', body: body('chrome-builtin') })).text();
assert.ok(/^data: \{"choices":\[\{"delta":\{"content":"Hallo "\}\}\]\}/.test(txt) && /data: \[DONE\]/.test(txt), txt);
// too long → shortened once
overflowOnce = true;
const long = 'x'.repeat(20000);
txt = await (await B.aiFetch('http://localhost:11434/api/chat', { method: 'POST', body: JSON.stringify({ model: 'chrome-builtin', messages: [{ role: 'user', content: long }] }) })).text();
assert.ok(/Welt/.test(txt), 'answered after shortening');
assert.ok(prompts.at(-1).text.length < long.length, 'second try is shorter');
// any other model: the network, untouched
await B.aiFetch('http://localhost:11434/api/chat', { method: 'POST', body: body('llama3.2') });
assert.deepEqual(netCalls, ['http://localhost:11434/api/chat']);
// background and offscreen are wired
const bg = bgSource();
assert.ok(/importScripts\('builtinAi\.js'\)/.test(bg) && (bg.match(/await (aiFetch|send)\(/g) || []).length >= 3, 'model requests go through aiFetch');
assert.ok(/builtinAi\.js/.test(fs.readFileSync(path.join(SRC, 'offscreen.html'), 'utf8')) && /AishBuiltin\.host\(\)/.test(fs.readFileSync(path.join(SRC, 'offscreen.js'), 'utf8')));
console.log('TEST 241 OK');
