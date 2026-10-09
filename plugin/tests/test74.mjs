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
assert(x.needsChunking(9000, 8192, 200) && !x.needsChunking(3000, 8192, 200) && !x.needsChunking(9000, 0, 200));
const text = Array.from({ length: 40 }, (_, i) => 'Paragraph ' + i + ' ' + 'word '.repeat(150)).join('\n\n');
const parts = x.splitForContext(text, 1500);
assert(parts.length > 3 && parts.every(p => p.length <= 4500), 'parts fit');
assert.equal(parts.join(' ').replace(/\s+/g, ' ').trim().length, text.replace(/\s+/g, ' ').trim().length, 'nothing lost');
assert(x.splitForContext('x'.repeat(20000), 1000).every(p => p.length <= 3000), 'long runs without breaks are split');
assert.equal(x.modelContextFromShow({ model_info: { 'general.architecture': 'llama', 'llama.context_length': 8192 } }), 8192);
assert.equal(x.modelContextFromShow({}), 0);
assert(c.contextRows({ words: 9000, parts: 4, window: 8192 }).find(r => r.key === 'parts').text.includes('4'));
const rr = c.contextRows({ words: 1, pageTokens: 20000, seenTokens: 19000 });
assert(rr.some(r => r.key === 'read' && r.text.includes('19,000') && !r.warn) && !rr.some(r => r.key === 'cut'));
assert(c.contextRows({ words: 1, pageTokens: 9000 }).find(r => r.key === 'read').text.includes('9,000'));
const sl = c.statusLines({ words: 5, length: 100, model: 'M', pageTokens: 25000 });
assert(sl.some(l => l.includes('25,000') && /minute/.test(l)) && !c.statusLines({ words: 5, pageTokens: 4000 }).some(l => /minute/.test(l)));
console.log('TEST 74 OK'); process.exit(0);
// Estimate is high for real text: 5,487 read of an estimated 7,912 in a 16k window is a full read, not a cut-off.
assert(!c.contextRows({ words: 1, pageTokens: 7912, seenTokens: 5487, numCtx: 16384 }).some(r => r.key === 'cut'));
// Ollama cut the prompt at the window we asked for.
assert(c.contextRows({ words: 1, pageTokens: 9000, seenTokens: 4090, numCtx: 4096 }).some(r => r.key === 'cut' && r.warn));
