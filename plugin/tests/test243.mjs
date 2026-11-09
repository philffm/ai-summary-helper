// “Local” bundles every local model: other OpenAI-style servers (LM Studio, llama.cpp, Jan) are found by /v1/models and
// listed (embedding models left out), unreachable ones are skipped, and their OpenAI-format stream is read under Local.
import { bgSource } from './bgSource.mjs';
import assert from 'assert';
import { setup, imp } from './harness.mjs';
setup({});
const L = await imp('modules/localServers.js');
let apfel = false;
globalThis.fetch = async (u) => {
    if (u === 'http://localhost:1234/v1/models') return { ok: true, json: async () => ({ data: [{ id: 'qwen3-8b' }, { id: 'text-embedding-nomic' }] }) };
    if (u === 'http://localhost:1337/v1/models') return { ok: false, json: async () => ({}) };
    if (u === 'http://127.0.0.1:11434/v1/models') return { ok: true, json: async () => ({ data: [{ id: 'gemma4:e2b' }, ...(apfel ? [{ id: 'apple-foundationmodel' }] : [])] }) };
    throw new Error('refused');
};
const found = await L.findLocalServers({ timeoutMs: 200 });
assert.equal(found.length, 1, 'only the server that answers');
assert.equal(found[0].name, 'LM Studio');
assert.deepEqual(found[0].models, ['qwen3-8b'], 'embedding models are not listed');
assert.equal(found[0].endpoint, 'http://localhost:1234/v1/chat/completions');
// Ollama on 11434 is not shown twice; apfel (Apple's model) on the same port is recognised by its model id
apfel = true;
const withApple = await L.findLocalServers({ timeoutMs: 200 });
const apple = withApple.find(x => x.id === 'apfel');
assert.ok(apple && apple.models.length === 1 && apple.models[0] === 'apple-foundationmodel', 'Apple model via apfel, without Ollama models');
assert.equal(apple.endpoint, 'http://127.0.0.1:11434/v1/chat/completions');
// the stream parser reads OpenAI-format chunks under the local service id too
const F = await imp('content/finalize.js');
const p = F.createStreamParser('ollama');
p.push('data: {"choices":[{"delta":{"content":"Hal"}}]}\n\ndata: {"choices":[{"delta":{"content":"lo"}}]}\n\ndata: [DONE]\n\n'); p.end();
assert.equal(p.summary, 'Hallo');
const q = F.createStreamParser('ollama'); q.push('{"message":{"content":"Ol"}}\n{"message":{"content":"lama"},"done":true}\n'); q.end();
assert.equal(q.summary, 'Ollama', 'Ollama NDJSON still works');
let f2;
// a server that refuses the extension (origin check) is reported, not hidden
globalThis.fetch = async (u) => {
    if (u === 'http://127.0.0.1:11434/v1/models') return { ok: false, status: 403, text: async () => 'Origin is not allowed. Use --allowed-origins to configure.' };
    if (u === 'http://localhost:1234/v1/models') return { ok: false, status: 403, text: async () => '' };
    throw new Error('refused');
};
f2 = await L.findLocalServers({ timeoutMs: 200 });
assert.ok(f2.find(x => x.id === 'apfel' && x.blocked), 'apfel refusing is reported');
assert.ok(f2.find(x => x.id === 'lmstudio' && x.blocked), 'other servers too');
// the extension's own requests to local model ports get a localhost Origin (session rules, initiator = the extension)
const fs = await import('fs'); const bg = bgSource();
assert.ok(/tabIds: \[-1\]/.test(bg) && /value: 'http:\/\/127\.0\.0\.1'/.test(bg) && /LOCAL_MODEL_PORTS = \[11434/.test(bg));
const man = JSON.parse(fs.readFileSync(process.env.AISH_SRC + '/../platforms/chrome/manifest.json', 'utf8'));
assert.ok(man.permissions.includes('declarativeNetRequestWithHostAccess'));
console.log('TEST 243 OK'); process.exit(0);
