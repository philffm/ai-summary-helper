// Ask tab: a question about a saved article → prompt with the article, answer kept as a turn, pinnable, stoppable, errors shown.
import { setup, imp, tick } from './harness.mjs'; import assert from 'assert';
const { w } = setup({});
const { createArticleAsk } = await imp('../src/modules/articleAsk.js');
const d = w.document; d.body.innerHTML = '<div id="m"></div>';
const turns = [], saved = []; let changed = 0, prompts = [];
const mount = d.getElementById('m');
const ask = async (system, user) => { prompts.push(user); return 'Heat pumps lose efficiency in the cold.\nSOURCES: "efficiency drops below minus seven degrees"\nQUESTIONS: [{"q":"Why does it drop?","a":"Defrost cycles."}]'; };
const a = createArticleAsk({ mount, article: { id: 'a1', title: 'Heat pumps' }, content: '<p>The efficiency drops below minus seven degrees in practice.</p>', summary: '<p>Short.</p>', turns, save: async (t) => { saved.push(t.length); }, onChange: () => changed++, ask, doc: d });
assert(d.querySelectorAll('.ask-chip').length === 3, 'an empty thread offers starter questions');
await a.submit('Does the cold matter?'); await tick(30);
assert(/Heat pumps/.test(prompts[0]) && /Does the cold matter\?/.test(prompts[0]), 'the prompt carries the article and the question');
assert.equal(turns.length, 1); assert.equal(turns[0].pinned, true, 'the first question is pinned by default');
assert.deepEqual(turns[0].sources, ['efficiency drops below minus seven degrees'], 'quotes found in the article are kept as sources');
assert.deepEqual(saved, [1]); assert.equal(changed, 1, 'saved and the summary tab is told');
assert(/Heat pumps lose efficiency/.test(d.querySelector('.ask-thread').textContent), 'the answer is in the thread');
assert.deepEqual([...d.querySelectorAll('.ask-chip')].map((b) => b.textContent), ['Why does it drop?'], 'follow-up ideas from the answer replace the starters');
d.querySelector('.chat-pin').click(); await tick(20);
assert.equal(turns[0].pinned, false, 'pin toggles'); assert.equal(saved.length, 2); assert.equal(changed, 2);
// an error is shown and the question stays in the field
const bad = createArticleAsk({ mount: d.body.appendChild(d.createElement('div')), article: { id: 'a2', title: 'x' }, content: 'c', summary: '', turns: [], save: async () => {}, ask: async () => { throw new Error('no key set'); }, doc: d });
await bad.submit('Why?'); await tick(20);
assert(/Could not get an answer: no key set/.test(d.body.textContent), 'the reason is shown');
console.log('TEST 274 OK'); process.exit(0);
