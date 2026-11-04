// Feeds graph: items group by what they are about (headline, teaser), not by source. Words of a source's name are no topic,
// a word on a single item or on nearly all of them ties nothing together, and the result is deterministic.
import { setup } from './harness.mjs'; import assert from 'assert';
import path from 'path'; import { pathToFileURL } from 'url';
setup({});
const { topicWords, PER_ITEM } = await import(pathToFileURL(path.join(process.env.AISH_SRC, 'modules/feedTopics.js')).href);

const mk = (ts, title, summary = '') => ({ timestamp: ts, title, summary });
const arts = [
    mk(1, 'Heise: Neue Wärmepumpe senkt Heizkosten deutlich', 'Die Wärmepumpe spart im Winter Strom.'),
    mk(2, 'Spiegel: Wärmepumpe im Altbau lohnt sich', 'Heizkosten sinken, sagt eine Studie.'),
    mk(3, 'Heise: Neuer Prozessor von AMD vorgestellt', 'Der Prozessor schlägt die Konkurrenz.'),
    mk(4, 'Spiegel: AMD Prozessor im Test', 'Benchmarks zeigen den schnellen Prozessor.'),
    mk(5, 'Heise: Wetter am Wochenende', 'Sonne und Regen.'),
    mk(6, 'Spiegel: Einzelthema Quokka', 'Nur hier.')
];
const out = topicWords(arts, { skip: ['Heise', 'Spiegel'] });
const has = (ts, w) => out.get(ts).includes(w);
assert.ok(has(1, 'wärmepumpe') && has(2, 'wärmepumpe'), 'same story, different sources, same word');
assert.ok(has(3, 'prozessor') && has(4, 'prozessor'));
assert.ok(!has(1, 'prozessor') && !has(3, 'wärmepumpe'), 'the two stories stay apart');
for (const [, ws] of out) { assert.ok(!ws.includes('heise') && !ws.includes('spiegel'), 'a source name is no topic'); assert.ok(ws.length <= PER_ITEM); }
assert.ok(!has(6, 'quokka'), 'a word on one item only is no topic');
assert.deepEqual([...topicWords(arts, { skip: ['Heise', 'Spiegel'] })], [...out], 'deterministic');

// without the skip list the source name would tie its own items together
const noSkip = topicWords(arts);
assert.ok([...noSkip.values()].some(ws => ws.includes('heise') || ws.includes('spiegel')), 'control: the skip list is what removes them');
console.log('test236 ok');
