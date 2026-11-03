// Graph similarity: unicode tokens, strongest-terms vectors, neighbours, and the incremental background cache (no reads when nothing changed).
import { setup, imp } from './harness.mjs'; import assert from 'assert';
setup({});
const gs = await imp('modules/graphSimilarity.js');
const gc = await imp('modules/graphSimilarityCache.js');

// ── tokens: umlauts and other scripts are words, not noise ──
assert.deepEqual(gs.tokenize('Größe der Städte <b>und</b> Münchner Verkehrswende'), ['größe', 'der', 'städte', 'und', 'münchner', 'verkehrswende'], 'umlauts survive and markup goes; non-English stop words stay here …');
// … and are dropped later, by frequency: a word in more than MAX_DF of the articles says nothing, in any language
const de = {}; for (let i = 0; i < 20; i++) de['d' + i] = gs.buildEntry({ title: 'der und die ' + ['wald', 'meer', 'berg', 'stadt'][i % 4] + ' thema' + i, summary: '' }, { timestamp: i }, false);
const deNn = await gs.neighbours(de);
assert.ok(Object.entries(deNn).every(([id, list]) => list.every(([o]) => (Number(id.slice(1)) % 4) === (Number(o.slice(1)) % 4))), 'common German words do not link unrelated articles');
assert.ok(gs.tokenize('Москва и климат').includes('москва'), 'cyrillic is tokenised');
assert.deepEqual(gs.tokenize('気候変動'), ['気候', '候変', '変動'], 'han/kana runs become character pairs');
assert.deepEqual(gs.tokenize('2024 and 12345'), [], 'numbers alone are not terms');

// ── entries: the text adds terms the index entry does not have ──
const meta = { id: 'x', timestamp: 't1', contentWordCount: 900, summary: 'short summary about solar power', tags: ['energy'], title: 'Solar roofs' };
const quick = gs.buildEntry({ title: meta.title, tags: meta.tags, summary: meta.summary }, meta, false);
const deep = gs.buildEntry({ title: meta.title, tags: meta.tags, summary: meta.summary, content: 'photovoltaic inverter inverter inverter grid storage' }, meta, true);
assert.equal(quick.full, 0); assert.equal(deep.full, 1);
assert.ok(!quick.t.some(([t]) => t === 'inverter') && deep.t.some(([t]) => t === 'inverter'), 'only the deep vector knows the text');
assert.equal(deep.f, quick.f, 'same fingerprint: the vector got deeper, the article did not change');
assert.notEqual(gs.fingerprintOf({ ...meta, tags: ['energy', 'grid'] }), quick.f, 'a tag change is a change');
assert.ok(quick.t.length <= gs.TERMS_KEPT);

// ── neighbours: two topics, each article finds its own topic first ──
const topicWords = { solar: ['photovoltaic', 'inverter', 'panel', 'grid', 'storage', 'rooftop', 'battery', 'tariff'], bread: ['sourdough', 'starter', 'crumb', 'hydration', 'proofing', 'flour', 'oven', 'baguette'] };
const items = {}, topicOf = {};
Object.entries(topicWords).forEach(([topic, words]) => { for (let i = 0; i < 15; i++) {
    const id = topic + i; topicOf[id] = topic;
    const text = [words[i % 8], words[(i + 3) % 8], words[(i + 5) % 8], 'common', 'article', 'people' + (i % 3)].join(' ');
    items[id] = gs.buildEntry({ title: text, tags: [], summary: text }, { timestamp: id }, false);
} });
const nn = await gs.neighbours(items);
const ids = Object.keys(items);
assert.ok(ids.every(id => nn[id] && nn[id].length <= gs.NEIGHBOURS), 'every article has up to k neighbours');
assert.ok(ids.every(id => topicOf[nn[id][0][0]] === topicOf[id]), 'the closest article is from the same topic');
assert.ok(Object.values(nn).every(list => list.every(([, s], i) => s >= gs.MIN_SCORE && (i === 0 || s <= list[i - 1][1]))), 'best first, above the floor');
assert.deepEqual(await gs.neighbours(items), nn, 'same input, same neighbours');
assert.equal(gs.signature(items), gs.signature({ ...items }), 'signature is stable'); items.solar0 = { ...items.solar0, full: 1 };
assert.notEqual(gs.signature(items), gs.signature({ ...items, solar0: { ...items.solar0, full: 0 } }), 'a deeper vector changes the signature');
let pauses = 0; await gs.neighbours(items, {}, async () => { pauses++; }); assert.ok(pauses >= 0);
assert.deepEqual(await gs.neighbours({}), {}, 'empty archive');

// ── the cache: incremental, resumable, quiet when nothing changed ──
const mkWorld = (n) => {
    const w = { cache: null, saves: 0, reads: [], texts: {}, entries: [] };
    for (let i = 0; i < n; i++) {
        const topic = i % 2 ? 'solar' : 'bread', words = topicWords[topic];
        const id = 'a' + i;
        w.texts[id] = [words[i % 8], words[(i + 2) % 8], words[(i + 4) % 8], 'detail' + i].join(' ');
        w.entries.push({ id, timestamp: 'ts' + i, title: 'Article ' + i, tags: [topic], summary: '<p>' + words[i % 8] + ' ' + words[(i + 1) % 8] + '</p>', contentWordCount: 400 });
    }
    w.io = {
        entries: async () => w.entries, load: async () => (w.cache ? JSON.parse(JSON.stringify(w.cache)) : null),
        save: async (c) => { w.saves++; w.cache = JSON.parse(JSON.stringify(c)); },
        readRecords: async (ids) => { w.reads.push(...ids); return Object.fromEntries(ids.map(id => [id, { content: w.texts[id] }])); },
        pause: async () => {}
    };
    return w;
};
const w = mkWorld(60);
const updates = [];
const first = await gc.refreshSimilarity(w.io, { onUpdate: (u) => updates.push(u.stage) });
assert.deepEqual(updates, ['quick', 'deep'], 'a quick result first, the deep one after');
assert.equal(w.reads.length, 60, 'every saved text is read once');
assert.ok(first.complete && Object.keys(first.links).length > 0);
assert.ok(Object.values(w.cache.items).every(it => it.full === 1), 'the cache holds the deep vectors');
assert.ok(w.cache.nn.sig === first.sig, 'neighbours and their signature are stored');

// nothing changed → nothing read, nothing written, neighbours not recomputed, and it says it is finished
w.reads.length = 0; const savesBefore = w.saves; const upd2 = [];
const again = await gc.refreshSimilarity(w.io, { onUpdate: (u) => upd2.push(u) });
assert.equal(w.saves, savesBefore, 'an unchanged archive writes nothing');
assert.ok(again.complete && upd2.length === 1 && upd2[0].complete === true, 'nothing left to read counts as finished');
assert.equal(w.reads.length, 0, 'second run reads no text');
assert.equal(again.sig, first.sig); assert.deepEqual(again.links, first.links);

// one article changes, one is deleted, one is new → only the changed and the new one are read
w.entries[3] = { ...w.entries[3], tags: ['solar', 'energy'] };
w.entries.splice(10, 1);
w.entries.push({ id: 'new1', timestamp: 'tsN', title: 'Fresh', tags: ['bread'], summary: 'sourdough starter', contentWordCount: 120 }); w.texts.new1 = 'sourdough crumb';
w.reads.length = 0;
const third = await gc.refreshSimilarity(w.io, {});
assert.deepEqual([...w.reads].sort(), ['a3', 'new1'], 'only what changed is read again');
assert.ok(!('a10' in w.cache.items), 'a deleted article leaves the cache');
assert.notEqual(third.sig, first.sig);

// stop half way → a checkpoint is kept, the next run continues with the rest
const half = mkWorld(120);
const ctl = { aborted: false };
const origRead = half.io.readRecords;
let batches = 0;
half.io.readRecords = async (ids) => { if (++batches === 3) ctl.aborted = true; return origRead(ids); };
const r1 = await gc.refreshSimilarity(half.io, { signal: ctl });
assert.equal(r1.complete, false, 'an aborted run says so');
const readFirst = half.reads.length;
assert.ok(readFirst > 0 && readFirst < 120, 'part of the texts were read');
half.io.readRecords = origRead; half.reads.length = 0;
const r2 = await gc.refreshSimilarity(half.io, {});
assert.ok(r2.complete);
assert.ok(half.reads.length <= 120 - readFirst + 25, 'the resumed run does not start over (' + half.reads.length + ' of 120)');
assert.ok(half.reads.length < 120);

// a failing read does not stop the run
const flaky = mkWorld(30); flaky.io.readRecords = async () => { throw new Error('storage busy'); };
const f = await gc.refreshSimilarity(flaky.io, {});
assert.ok(f.complete && f.sig, 'a read error leaves quick vectors in place and finishes');

// a full disk only costs the cache
const full = mkWorld(10); full.io.save = async () => { throw new Error('quota'); };
assert.ok((await gc.refreshSimilarity(full.io, {})).sig, 'save errors are not fatal');

// quick-only mode never reads text
const q = mkWorld(20); const qr = await gc.refreshSimilarity(q.io, { deep: false });
assert.equal(q.reads.length, 0); assert.equal(qr.complete, false);
console.log('graph similarity ok');
