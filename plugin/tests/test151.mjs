// Rating = two small requests: sentiment pairs, then a category per item from the known list (+ at most 2 new ones).
import assert from 'assert';
import { setup, imp } from './harness.mjs';
setup({});
const { scoreItems, parseCategoryLines, categoryVocab, setAiTransport, DEFAULT_CATS, MAX_NEW_CATS } = await imp('modules/feedAi.js');

// vocabulary: used categories first, defaults after, no duplicates (case-insensitive), capped
assert.deepEqual(categoryVocab(['Gaming', 'tech', 'Gaming']).slice(0, 3), ['Gaming', 'tech', 'Politics']);
assert.ok(categoryVocab(Array.from({ length: 40 }, (_, i) => 'C' + i)).length <= 14);
assert.deepEqual(categoryVocab([]), DEFAULT_CATS);

// parsing: snaps to the known spelling, accepts at most 2 different new labels, the rest stays null
const V = ['Tech', 'Politics', 'World'];
assert.deepEqual(parseCategoryLines('1:tech | 2: POLITICS | 3:Chess', 3, V), ['Tech', 'Politics', 'Chess']);
const many = parseCategoryLines('1:Chess | 2:Go | 3:Poker | 4:Chess | 5:World | 6:Tech', 6, V);
assert.deepEqual(many, ['Chess', 'Go', null, 'Chess', 'World', 'Tech'], 'third new label is dropped, a repeated new label is fine');
assert.equal(MAX_NEW_CATS, 2);
assert.deepEqual(parseCategoryLines('1) Tech\n2) World\ngarbage\n9:Tech', 3, V), ['Tech', 'World', null], 'newline separated, ")" accepted, out-of-range ignored');
assert.deepEqual(parseCategoryLines('', 2, V), [null, null]);

// request flow
const items = [{ title: 'Chip plant opens' }, { title: 'Election results' }, { title: 'Chess champion crowned' }];
const calls = [];
let catReply = '1:Tech | 2:Politics | 3:Chess';
setAiTransport(async ({ system, user }) => { calls.push({ system, user }); return /category/i.test(system) ? catReply : '1:3 | 2:-2 | 3:1'; });
let timing = null;
let r = await scoreItems(items, () => '', { knownCats: ['Gaming'], onTiming: (t) => { timing = t; } });
assert.equal(calls.length, 2, 'one sentiment request + one category request');
assert.ok(!/categor/i.test(calls[0].system), 'sentiment request is only about sentiment');
assert.ok(/Known categories: Gaming, Tech, Politics/.test(calls[1].system), 'categories already in use come first');
assert.ok(/at most 2 different new categories/.test(calls[1].system));
assert.deepEqual(r.scores, [0.6, -0.4, 0.2]); assert.deepEqual(r.labels, ['Tech', 'Politics', 'Chess']);
assert.ok(timing && timing.scoreSec >= 0 && timing.catSec >= 0 && timing.retried === false);

// labels: false = one request
calls.length = 0;
r = await scoreItems(items, () => '', { labels: false });
assert.equal(calls.length, 1); assert.deepEqual(r.labels, [null, null, null]);

// a failing category request keeps the scores
setAiTransport(async ({ system }) => { if (/category/i.test(system)) throw new Error('boom'); return '1:2 | 2:2 | 3:2'; });
r = await scoreItems(items, () => '');
assert.deepEqual(r.scores, [0.4, 0.4, 0.4]); assert.deepEqual(r.labels, [null, null, null]);

// ... but a cancelled request is not swallowed
setAiTransport(async ({ system }) => { if (/category/i.test(system)) throw Object.assign(new Error('Cancelled'), { cancelled: true }); return '1:1'; });
await assert.rejects(scoreItems(items, () => ''), /Cancelled/);

// unreadable sentiment reply: asked once more (reported), then an error
let n = 0; timing = null;
setAiTransport(async ({ system }) => /category/i.test(system) ? '1:Tech' : (++n === 1 ? 'I cannot do that' : '1:5'));
r = await scoreItems(items, () => '', { onTiming: (t) => { timing = t; } });
assert.equal(timing.retried, true); assert.equal(r.scores[0], 1);
setAiTransport(async () => 'nope');
await assert.rejects(scoreItems(items, () => ''), /could not be read/);

// a model that still answers with the old JSON is understood
setAiTransport(async ({ system }) => /category/i.test(system) ? '1:Tech' : '{"scores":[0.5,-0.5,0],"labels":["a","b","c"]}');
r = await scoreItems(items, () => '');
assert.deepEqual(r.scores, [0.5, -0.5, 0]);
setAiTransport(null);
console.log('TEST 151 OK');
