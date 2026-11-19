// Reading progress: the deepest point counts (never down), the end only counts after enough time on the page, two devices keep the
// larger value, and 90 % marks the article finished and read.
import assert from 'assert';
import { setup, imp } from './harness.mjs';
const { store } = setup({});
const { createReadTracker, minActiveMs } = await imp('modules/readProgress.js');
const { mergeRecord } = await imp('modules/syncMerge.js');
const SM = (await imp('modules/storageManager.js')).default;

// the tracker: depth only grows, saved in steps of 2 %
let t = 0; const saved = [];
const tr = createReadTracker({ words: 2300, now: () => t, save: (p) => saved.push(p) });   // 2300 words = 10 min → 150 s on the page for the end
assert.equal(minActiveMs(2300), 150000); assert.equal(minActiveMs(100), 10000, 'at least 10 s');
tr.sample(0.1); t += 1000; tr.sample(0.101); assert.deepEqual(saved, [0.1], 'a first value is saved, a tiny step is not');
t += 1000; tr.sample(0.4); t += 1000; tr.sample(0.2);   // back up: stays at 0.4
assert.equal(tr.deepest, 0.4); assert.equal(saved.at(-1), 0.4);
// a jump to the end right away is held just below "finished"
t += 1000; tr.sample(1);
assert.equal(tr.deepest, 0.89, 'the end does not count yet');
// time passes with the page in front (gaps over 5 s count as 5 s): the end counts
for (let i = 0; i < 40; i++) { t += 5000; tr.sample(1); }
assert.equal(tr.deepest, 1); assert.equal(saved.at(-1), 1);
// hidden time is not reading time
const hid = createReadTracker({ words: 0, now: () => t, save() {} });
hid.sample(0.5, true); t += 4000; hid.sample(0.5, false); t += 600000; hid.sample(0.5, true); assert.ok(hid.activeMs <= 4000, 'a hidden tab adds nothing');
// flush writes what the throttle kept back
const fl = []; const f = createReadTracker({ words: 0, now: () => t, save: (p) => fl.push(p) });
f.sample(0.30); f.sample(0.31); f.flush(); assert.deepEqual(fl, [0.3, 0.31]);
assert.equal(f.flush(), null, 'nothing left to write');

// a restart continues from what is stored
const again = createReadTracker({ words: 0, start: 0.6, now: () => t, save: (p) => saved.push(p) });
assert.equal(again.sample(0.3), null); assert.equal(again.deepest, 0.6);

// the merge: the larger progress wins, whoever wrote last; other fields still go by the stamp
const rec = (progress, t0, extra = {}) => ({ rev: { t: t0, d: 'a' }, f: { progress: { t: t0, h: 'p' + progress }, ...extra.f }, values: { progress, ...extra.values } });
let r = mergeRecord(rec(0.7, 100), rec(0.4, 200)).merged;
assert.equal(r.values.progress, 0.7, 'older but deeper wins'); assert.equal(r.f.progress.h, 'p0.7');
r = mergeRecord(rec(0.4, 300), rec(0.7, 200)).merged; assert.equal(r.values.progress, 0.7);
r = mergeRecord({ ...rec(0.5, 100), f: { progress: { t: 100, h: 'p0.5' }, title: { t: 100, h: 'x' } }, values: { progress: 0.5, title: 'old' } },
                { ...rec(0.5, 100), f: { progress: { t: 100, h: 'p0.5' }, title: { t: 200, h: 'y' } }, values: { progress: 0.5, title: 'new' } }).merged;
assert.equal(r.values.title, 'new', 'other fields: the later stamp');
const sym = (a, b) => JSON.stringify(mergeRecord(a, b).merged.values) === JSON.stringify(mergeRecord(b, a).merged.values);
assert.ok(sym(rec(0.3, 5), rec(0.8, 9)) && sym(rec(0.8, 5), rec(0.3, 9)), 'the same result on every device');

// the stored status: progress never goes down; from 90 % finished and read
store['articles:index'] = [{ id: 'a1', title: 'A' }, { id: 'a2', title: 'B', readAt: '2026-01-01T00:00:00.000Z' }];
assert.equal(await SM.patchArticleProgress('a1', 0.4), true);
assert.equal(await SM.patchArticleProgress('a1', 0.2), false); assert.equal(store['articles:index'][0].progress, 0.4);
assert.ok(!store['articles:index'][0].finishedAt && !store['articles:index'][0].readAt, 'not finished at 40 %');
assert.equal(await SM.patchArticleProgress('a1', 0.93), true);
const a1 = store['articles:index'][0]; assert.equal(a1.progress, 0.93); assert.ok(a1.finishedAt && a1.readAt, 'finished and read');
await SM.patchArticleProgress('a2', 1); assert.equal(store['articles:index'][1].readAt, '2026-01-01T00:00:00.000Z', 'an existing read date stays');
assert.equal(await SM.patchArticleProgress('missing', 0.5), false);
console.log('TEST 265 OK');
