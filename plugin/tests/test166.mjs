// Storage cleanup that keeps the statistics: strip images, drop page text (flag, not delete), no-images save helper.
import { setup, imp, tick } from './harness.mjs'; import assert from 'assert';
setup({});
const S = await imp('content/stripImages.js');
const H = await imp('modules/storageHealth.js');

const pic = 'data:image/jpeg;base64,' + 'A'.repeat(1000);
const html = `<p>Hello</p><figure><img src="${pic}" alt="x"></figure><p>World <img src="https://e.com/a.png"></p>`;
assert.equal(S.imageBytes(html), pic.length, 'only inlined images are counted');
const out = S.stripImages(html);
assert.ok(!/<img/i.test(out) && out.includes('Hello') && out.includes('World'), 'images gone, text stays');
assert.ok(!out.includes('<figure'), 'figure left empty is removed');
assert.equal(S.stripImages(''), ''); assert.ok(S.hasImages(html) && !S.hasImages(out));

// fake chrome.storage.local
const mem = {};
globalThis.chrome = { storage: { local: {
    get: (k, cb) => cb(k === null ? { ...mem } : Object.fromEntries([].concat(k).map(x => [x, mem[x]]))),
    set: (o, cb) => { Object.assign(mem, JSON.parse(JSON.stringify(o))); cb && cb(); },
} } };
const now = Date.now(), iso = (d) => new Date(now - d * 86400000).toISOString();
const IDX = 'articles:index', R = 'articles:rec:';
const index = [
    { id: 'a', title: 'A', contentWordCount: 5000, summary: 's', timestamp: iso(200) },
    { id: 'b', title: 'B', contentWordCount: 5000, summary: 's', timestamp: iso(5) },
    { id: 'c', title: 'C', contentWordCount: 5000, summary: 's', timestamp: iso(300), favorite: true },
    { id: 'd', title: 'D', contentWordCount: 5000, summary: 's', timestamp: iso(300) },
];
mem[IDX] = index;
for (const a of index) mem[R + a.id] = { content: html, summary: 's' };

const ids = H.textCleanupIds(index, { minDays: 90, keep: new Set(['d']) });
assert.deepEqual(ids, ['a'], 'old only; recent, starred and collection articles are skipped');
const scan = await H.scanCleanup(index, { minDays: 90, keep: new Set(['d']) });
assert.equal(scan.images.n, 4); assert.equal(scan.text.n, 1);

const r1 = await H.removeSavedImages(index);
assert.equal(r1.n, 4); assert.ok(!/<img/i.test(mem[R + 'a'].content) && mem[R + 'a'].content.includes('Hello'));
mem[R + 'a'].content = html;   // put images back to test the next step

const r2 = await H.dropPageText(index, ids, IDX);
assert.equal(r2.n, 1);
assert.equal(mem[R + 'a'].content, ''); assert.equal(mem[R + 'a'].summary, 's', 'summary kept');
const a = mem[IDX].find(x => x.id === 'a');
assert.equal(a.contentPruned, true); assert.equal(a.contentWordCount, 5000, 'word count (statistics) unchanged');
assert.equal(mem[IDX].length, 4, 'no article removed');
assert.ok(mem[R + 'b'].content.includes('Hello'), 'others untouched');
assert.ok(!H.reclaimCandidates(mem[IDX], { now }).list.some(x => x.id === 'a'), 'pruned articles are not offered again');

// sheet with the prune option: two actions, nothing pre-selected
const { w } = setup({}); globalThis.document = w.document; globalThis.window = w;
const pruned = [], deleted = [];
await H.openStorageSheet({ report: { totalBytes: 9e6, candidates: { list: [{ id: 'x', title: 'X', bytes: 1e6, days: 200 }], kept: 0, total: 1 } }, deleteIds: async (i) => deleted.push(...i), pruneIds: async (i) => pruned.push(...i), onDone: () => {} });
await tick(20);
const sheet = w.document.querySelector('.storage-sheet');
const prune = sheet.querySelector('.button-primary'), del = sheet.querySelector('.button-danger-outline');
assert.ok(prune && del && prune.disabled && del.disabled, 'both disabled until something is ticked');
sheet.querySelector('.sendsheet-row').click();
prune.click(); await tick(30);
assert.deepEqual(pruned, ['x']); assert.deepEqual(deleted, []);
console.log('ok');

// duplicates
const D = (id, title, url, extra = {}) => ({ id, title, url, summary: 'sum', contentWordCount: 100, timestamp: new Date(now - 5 * 86400000).toISOString(), ...extra });
const di = [
    D('d1', 'A long enough article title', 'https://www.example.com/post/?utm_source=x#top', { timestamp: iso(40) }),
    D('d2', 'A long enough article title', 'https://example.com/post', { timestamp: iso(2) }),
    D('d3', 'Starred copy of the page', 'https://example.com/post?utm_medium=mail', { timestamp: iso(90), favorite: true, summary: '' }),
    D('t1', 'Same title on same site okay', 'https://site.org/a', { timestamp: iso(30) }),
    D('t2', 'Same title on same site okay!', 'https://site.org/b', { timestamp: iso(1) }),
    D('x1', 'Same title on same site okay', 'https://other.org/a'),
    D('u1', 'Untitled', 'https://q.com/1'), D('u2', 'Untitled', 'https://q.com/2'),
];
assert.equal(H.normUrl('https://www.example.com/post/?utm_source=x&b=2&a=1#top'), 'example.com/post?a=1&b=2');
const dup = H.findDuplicates(di);
const ids2 = dup.list.map(x => x.id).sort();
assert.ok(ids2.includes('d1') && ids2.includes('t1'), 'older copies offered');
assert.ok(!ids2.includes('t2'), 'the newest copy stays');
assert.ok(!ids2.includes('x1') && !ids2.includes('u1') && !ids2.includes('u2'), 'other site / generic titles are not duplicates');
// a starred copy is the one that stays; the others of its group are offered
assert.ok(!ids2.includes('d3'), 'starred copy never offered, and it is the copy that stays: d1 and d2 are offered');
assert.ok(ids2.includes('d2'));
const dup3 = H.findDuplicates(di.filter(x => x.id !== 'd3'));
assert.ok(dup3.list.some(x => x.id === 'd1') && !dup3.list.some(x => x.id === 'd2'), 'without the starred copy the newest stays');

// review sheet: the age filter can show everything, also recent articles
{
    const { w: w2 } = setup({}); globalThis.document = w2.document; globalThis.window = w2;
    const idx = [
        { id: 'old', title: 'Old big', contentWordCount: 40000, summary: 's', timestamp: iso(300) },
        { id: 'new', title: 'Recent small', contentWordCount: 300, summary: 's', timestamp: iso(2) },
    ];
    const rep = { totalBytes: 9e6, minDays: 90, candidates: H.reclaimCandidates(idx, { minDays: 90 }), dupes: { list: [], total: 0, kept: 0 } };
    await H.openStorageSheet({ report: rep, index: idx, keep: new Set(), deleteIds: async () => {}, pruneIds: async () => {}, onDone: () => {} });
    await tick(20);
    const sh = w2.document.querySelector('.storage-sheet');
    const titles = () => [...sh.querySelectorAll('.sendsheet-row .sendsheet-row-t')].map(x => x.textContent);
    assert.deepEqual(titles(), ['Old big'], 'default: old and big only');
    const allBtn = [...sh.querySelectorAll('.storage-age [role=radio]')].find(b => b.dataset.value === '0');
    allBtn.click(); await tick(10);
    assert.deepEqual(titles().sort(), ['Old big', 'Recent small'], 'All: recent and small ones too');
    sh.querySelectorAll('.sendsheet-row')[0].click();
    assert.ok(!sh.querySelector('.button-primary').disabled, 'ticking after a filter change works');
}
