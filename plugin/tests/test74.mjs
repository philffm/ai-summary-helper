// Ollama context: num_ctx sizing, cut-off detection, and the warning row in "What I used".
import { setup, imp } from './harness.mjs'; import assert from 'assert';
const { w } = setup({}); globalThis.document = w.document; globalThis.window = w;
const x = await imp('content/extractor.js');
assert.equal(x.estimateTokens('a'.repeat(300)), 100); assert.equal(x.estimateTokens(''), 0);
assert.equal(x.ollamaNumCtx(500, 200), 4096);
assert.equal(x.ollamaNumCtx(5000, 200), 8192);
assert.equal(x.ollamaNumCtx(12000, 200), 16384);
assert.equal(x.ollamaNumCtx(20000, 200), 32768);
assert.equal(x.ollamaNumCtx(90000, 200), 32768, 'capped');
assert(x.wasCutOff(3800, 20000), 'cut');
assert(!x.wasCutOff(19000, 20000), 'fully read');
assert(!x.wasCutOff(100, 20000), 'cached prefix: ignored');
assert(!x.wasCutOff(2000, 2500), 'small prompt: ignored');
const c = await imp('modules/composerState.js');
const rows = c.contextRows({ words: 9000, host: 'a.com', length: 200, pageTokens: 20000, seenTokens: 3800 });
const cut = rows.find(r => r.key === 'cut'); assert(cut && cut.warn && /3[.,]?8|3800/.test(cut.text) || cut.text.includes('Ollama'));
assert(!c.contextRows({ words: 9000, host: 'a.com', length: 200, pageTokens: 20000 }).some(r => r.key === 'cut'));
console.log('TEST 74 OK'); process.exit(0);
