// highlightStore.js: per-page keys + index, one writer under a lock (no lost highlights when writes overlap), old single list before the migration, migration (ids, cut page keys repaired, safe to repeat).
import assert from 'assert';
import path from 'path';
import { pathToFileURL } from 'url';
const SRC = process.env.AISH_SRC;
const imp = (rel) => import(pathToFileURL(path.join(SRC, rel)).href);
const { createHighlightStore, isDuplicate } = await imp('modules/highlightStore.js');

// storage that yields between read and write, like chrome.storage does: a writer without the lock would lose updates
function makeStorage(initial = {}) {
  const data = JSON.parse(JSON.stringify(initial));
  const later = () => new Promise((r) => setTimeout(r, 1));
  return {
    data,
    async get(keys) {
      await later();
      const out = {};
      if (keys == null) return JSON.parse(JSON.stringify(data));
      if (typeof keys === 'string') keys = [keys];
      if (Array.isArray(keys)) keys.forEach((k) => { if (k in data) out[k] = JSON.parse(JSON.stringify(data[k])); });
      else Object.entries(keys).forEach(([k, def]) => { out[k] = k in data ? JSON.parse(JSON.stringify(data[k])) : def; });
      return out;
    },
    async set(obj) { await later(); Object.entries(obj).forEach(([k, v]) => { data[k] = JSON.parse(JSON.stringify(v)); }); },
    remove(keys, cb) { [].concat(keys).forEach((k) => delete data[k]); if (cb) cb(); return Promise.resolve(); },
  };
}
const hl = (id, url, text, extra = {}) => ({ id, url, text, type: 'user', timestamp: '2026-11-01T00:00:00Z', ...extra });
const A = 'https://example.com/a', B = 'https://www.youtube.com/watch?v=abc';

// 1. before the migration: the old single list, still under the lock
{
  const st = makeStorage({ 'hl:all': [hl('1', A, 'one')] });
  const s = createHighlightStore({ storage: st });
  assert.equal(await s.schema(), false);
  await Promise.all([s.apply([{ op: 'add', hl: hl('2', A, 'two') }]), s.apply([{ op: 'add', hl: hl('3', B, 'three') }])]);
  assert.deepEqual(st.data['hl:all'].map((h) => h.id).sort(), ['1', '2', '3'], 'two overlapping writers: both kept');
  assert.deepEqual((await s.forPage(B)).map((h) => h.id), ['3']);
  assert(!Object.keys(st.data).some((k) => k.startsWith('hl:page:')), 'no per-page keys before the migration');
}

// 2. migration: ids for old entries (same derivation as the sync backfill), cut keys repaired, old list removed
{
  const st = makeStorage({
    'hl:all': [
      hl('1', A, 'one'),
      { url: A, text: 'no id yet', type: 'user', timestamp: '2026-10-01T00:00:00Z' },
      hl('2', 'https://www.youtube.com/watch', 'only in video abc'),           // cut by the old page script
      hl('3', 'https://www.youtube.com/watch', 'in both videos'),              // two candidates: stays
      hl('4', 'https://news.ycombinator.com/item', 'not saved anywhere'),      // no candidate article: stays
      hl('5', A, 'gone', { type: 'ghost', dismissed: true }),
    ],
    'articles:index': [{ id: 'x', url: 'https://www.youtube.com/watch?v=abc&t=3' }, { id: 'y', url: 'https://www.youtube.com/watch?v=def' }],
    'articles:rec:x': { content: '<p>this is only in video abc and in both videos</p>' },
    'articles:rec:y': { content: '<p>here: in both videos</p>' },
  });
  const s = createHighlightStore({ storage: st });
  const res = await s.migrate();
  assert.equal(res.ran, true);
  assert.equal(res.highlights, 6); assert.equal(res.ids, 1); assert.equal(res.repaired, 1); assert.equal(res.unrepaired, 1);
  assert.equal(st.data['hl:schema'], 2);
  assert(!('hl:all' in st.data), 'old list removed');
  assert.deepEqual(st.data['hl:page:' + B].map((h) => h.id), ['2'], 'repaired to its article');
  assert.deepEqual(st.data['hl:page:https://www.youtube.com/watch'].map((h) => h.id), ['3']);
  const pageA = st.data['hl:page:' + A];
  assert.equal(pageA.length, 3);
  assert(pageA.find((h) => h.text === 'no id yet').id.startsWith('hl_l'), 'id given');
  const row = st.data['hl:index'].find((r) => r.k === A);
  assert.equal(row.n, 2); assert.equal(row.d, 1);
  assert.equal(await s.schema(), true);
  assert.equal((await s.all()).length, 5, 'all() leaves out dismissed');
  assert.equal((await s.all({ dismissed: true })).length, 6);

  // safe to repeat; an old list that shows up again (old backup) is merged, not doubled
  assert.equal((await s.migrate()).ran, false, 'nothing to do');
  st.data['hl:all'] = [hl('1', A, 'one'), hl('9', A, 'from a backup')];
  const again = await s.migrate();
  assert.equal(again.ran, true);
  assert.deepEqual(st.data['hl:page:' + A].map((h) => h.id).sort(), ['1', '5', '9', st.data['hl:page:' + A].find((h) => h.text === 'no id yet').id].sort());
  assert(!('hl:all' in st.data));

  // 3. per-page writes: overlapping writers on one page and on two pages lose nothing
  await Promise.all([
    s.apply([{ op: 'add', hl: hl('10', A, 'ten') }]),
    s.apply([{ op: 'add', hl: hl('11', A, 'eleven') }]),
    s.apply([{ op: 'add', hl: hl('12', 'https://example.com/new', 'twelve') }]),
  ]);
  assert(['10', '11'].every((id) => st.data['hl:page:' + A].some((h) => h.id === id)), 'same page: both kept');
  assert.equal(st.data['hl:page:https://example.com/new'].length, 1);
  assert(st.data['hl:index'].some((r) => r.k === 'https://example.com/new' && r.n === 1), 'index row for the new page');

  // duplicates, patch, dismiss, remove, clearPage, removeId (sync), empty pages disappear
  assert.equal((await s.apply([{ op: 'add', hl: hl('dup', A, 'ten') }])).changed, false, 'same text, same context: skipped');
  await s.apply([{ op: 'patch', page: A, id: '10', patch: { quote: { exact: 'ten', prefix: 'p', suffix: 's' }, v: 2 } }]);
  assert.equal(st.data['hl:page:' + A].find((h) => h.id === '10').quote.prefix, 'p');
  await s.apply([{ op: 'patch', page: A, text: 'eleven', type: 'user', patch: { pos: 7 } }]);
  assert.equal(st.data['hl:page:' + A].find((h) => h.id === '11').pos, 7, 'patch by text + type');
  await s.apply([{ op: 'dismiss', page: A, id: '1' }]);
  assert.equal(st.data['hl:page:' + A].find((h) => h.id === '1').dismissed, true);
  const rm = await s.apply([{ op: 'remove', page: A, id: '10' }, { op: 'removeText', page: A, text: ' eleven ', type: 'user' }]);
  assert.deepEqual(rm.removed.sort(), ['10', '11']);
  const sy = await s.apply([{ op: 'removeId', id: '12' }]);
  assert.deepEqual(sy.removed, ['12'], 'sync removal finds the page by itself');
  assert(!('hl:page:https://example.com/new' in st.data), 'empty page key removed');
  assert(!st.data['hl:index'].some((r) => r.k === 'https://example.com/new'), 'and its index row');
  await s.apply([{ op: 'upsert', hl: hl('9', A, 'from a backup, edited') }]);
  assert.equal(st.data['hl:page:' + A].find((h) => h.id === '9').text, 'from a backup, edited', 'upsert replaces by id');
  const cl = await s.apply([{ op: 'clearPage', page: A }]);
  assert(cl.removed.length >= 3);
  assert(!('hl:page:' + A in st.data));
}

// 4. duplicate rule: AI highlights by text alone (also when dismissed); user highlights also compare the context
assert.equal(isDuplicate([{ url: A, text: 't', type: 'ghost', dismissed: true }], { url: A, text: 't', type: 'ghost' }), true);
assert.equal(isDuplicate([{ url: A, text: 't', type: 'user', quote: { exact: 't', prefix: 'a', suffix: 'b' } }], { url: A, text: 't', type: 'user', quote: { exact: 't', prefix: 'c', suffix: 'd' } }), false, 'same text elsewhere on the page is another highlight');
console.log('TEST 251 OK');

// 5. after a backup restore replaced the index: rebuilt from the page keys in storage
{
  const st = makeStorage({ 'hl:schema': 2, 'hl:index': [], 'hl:page:https://a.com/x': [hl('1', 'https://a.com/x', 'x')], 'hl:page:https://b.com/y': [hl('2', 'https://b.com/y', 'y', { dismissed: true })], 'other:key': 1 });
  const s = createHighlightStore({ storage: st });
  assert.equal(await s.reindex(), 2);
  assert.deepEqual(st.data['hl:index'].map((r) => [r.k, r.n, r.d]).sort(), [['https://a.com/x', 1, 0], ['https://b.com/y', 0, 1]]);
}
console.log('TEST 251 reindex OK');
