// Every local model with a small context window reads long pages in parts (not only Ollama): the window is known (apfel 4k,
// the browser's model 4k) or read from the server (Ollama /api/show, llama.cpp /props, LM Studio /api/v0/models), the part
// requests speak Ollama or the OpenAI format, and the answer is read whatever form it comes in.
import { bgSource } from './bgSource.mjs';
import assert from 'assert'; import fs from 'fs'; import path from 'path';
import { setup, imp } from './harness.mjs';
const { w } = setup({}); globalThis.document = w.document; globalThis.window = w;
const x = await imp('content/extractor.js');
assert.equal(x.knownContextWindow('apple-foundationmodel'), 4096);
assert.equal(x.knownContextWindow('chrome-builtin'), 4096);
assert.equal(x.knownContextWindow('llama3.2'), 0, 'others: ask the server');
assert.equal(x.contextFromServerInfo({ props: { default_generation_settings: { n_ctx: 4096 } } }), 4096, 'llama.cpp /props');
assert.equal(x.contextFromServerInfo({ props: { n_ctx: 2048 } }), 2048);
assert.equal(x.contextFromServerInfo({ lmstudio: { loaded_context_length: 8192, max_context_length: 131072 } }), 8192, 'LM Studio: what is loaded counts');
assert.equal(x.contextFromServerInfo({}), 0);
// answers in every shape
assert.equal(x.replyText('{"message":{"content":"Ollama note"}}'), 'Ollama note');
assert.equal(x.replyText('{"choices":[{"message":{"content":"OpenAI note"}}]}'), 'OpenAI note');
assert.equal(x.replyText('data: {"choices":[{"delta":{"content":"Hal"}}]}\n\ndata: {"choices":[{"delta":{"content":"lo"}}]}\n\ndata: [DONE]\n'), 'Hallo', 'SSE (server ignored stream:false)');
assert.equal(x.replyText('{"message":{"content":"A"},"done":false}\n{"message":{"content":"B"},"done":true}\n'), 'AB', 'NDJSON (the browser model)');
assert.equal(x.replyText(''), '');
// a 959-word page for a 120-word summary does not fit apfel's 4k once the prompt is counted → parts
const page = 'word '.repeat(2400);   // ≈ 4000 estimated tokens
assert.ok(x.needsChunking(x.estimateTokens(page) + 1200, 4096, 120), 'needs parts in a 4k window');
const parts = x.splitForContext(page, Math.max(1200, 4096 - 1500 - 700));
assert.ok(parts.length >= 2 && parts.every(p => x.estimateTokens(p) <= 1900), 'parts fit the window');
// wiring in content.js
const c = fs.readFileSync(path.join(process.env.AISH_SRC, 'content.js'), 'utf8');
assert.ok(/\(activeService === 'ollama' \|\| isLocalEndpoint\(finalApiUrl\)\) && modelIdentifier !== 'firefox-ml'/.test(c), 'every local model, Firefox summarizer excluded');
assert.ok(/max_tokens: Math\.ceil\(perPartWords \* 2\.2\) \+ 200/.test(c) && /replyText\(raw\)/.test(c), 'OpenAI-format part requests, any answer shape');
assert.ok(!/condenseForOllama/.test(c));
const bg = bgSource();
assert.ok(/localGetJson: \{ from: 'any'/.test(bg) && /if \(!LOCAL_URL\.test\(String\(msg\.url/.test(bg), 'server info only from localhost');
console.log('TEST 246 OK'); process.exit(0);
