// Collections UI: the add sheet pre-selects the last used collection, new collections, the Collections tab, the source check.
import { setup, imp, tick } from './harness.mjs'; import assert from 'assert';
const { store, w } = setup({});
const d = w.document;
globalThis.document = d; globalThis.window = w;
const K = await imp('modules/storageKeys.js');
const C = await imp('modules/collections.js');
const V = await imp('modules/collectionsView.js');
const { SK, articleRecKey } = K;

store[SK.articlesIndex] = [{ id: 'a1', url: 'https://x.test/1', title: 'First article', timestamp: '2026-01-01T00:00:00Z', summary: '<p>S</p>', tags: [] },
                           { id: 'a2', url: 'https://y.test/2', title: 'Second article', timestamp: '2026-01-02T00:00:00Z', summary: '<p>S</p>', tags: [] }];
store[articleRecKey('a1')] = { content: '<p>a</p>' }; store[articleRecKey('a2')] = { content: '<p>b</p>' };
const toasts = []; V.initCollectionsView({ toast: (m) => toasts.push(m), openArticle: () => {} });

const first = await C.createCollection({ name: 'Climate', question: 'Does it work?' });
const second = await C.createCollection({ name: 'School' });
await C.addSource(second.id, 'a2');   // School becomes "last used"

// sheet: the last used collection is pre-selected and marked
await V.openAddSheet({ id: 'a1', title: 'First article', url: 'https://x.test/1' });
await tick(30);
let sheet = d.querySelector('.sendsheet');
assert.ok(sheet, 'sheet open');
const rows = [...sheet.querySelectorAll('.sendsheet-row')];
assert.equal(rows.length, 2);
const on = rows.filter(r => r.classList.contains('on'));
assert.equal(on.length, 1); assert.ok(on[0].textContent.includes('School') && on[0].textContent.includes('last used'), 'last used is selected and says so');
// choose the other one and add
rows.find(r => r.textContent.includes('Climate')).click();
[...sheet.querySelectorAll('button')].find(b => b.textContent === 'Add').click();
await tick(60);
assert.ok(!d.querySelector('.sendsheet'), 'sheet closed');
assert.deepEqual((await C.getCollection(first.id)).sources.map(s => s.articleId), ['a1']);
assert.equal(await C.lastCollectionId(), first.id);
assert.ok(toasts.at(-1).includes('Climate'));

// new collection from the sheet (add form)
await V.openAddSheet({ id: 'a2', title: 'Second article', url: 'https://y.test/2' });
await tick(30);
sheet = d.querySelector('.sendsheet');
[...sheet.querySelectorAll('button')].find(b => b.textContent.includes('New collection')).click();
const nameIn = sheet.querySelector('.coll-new input');
const addBtn = [...sheet.querySelectorAll('button')].find(b => b.textContent === 'Add');
assert.ok(addBtn.disabled, 'needs a name');
nameIn.value = 'Fresh'; nameIn.dispatchEvent(new w.Event('input'));
assert.ok(!addBtn.disabled);
addBtn.click(); await tick(80);
const fresh = (await C.listCollections()).find(c => c.name === 'Fresh');
assert.ok(fresh); assert.deepEqual((await C.getCollection(fresh.id)).sources.map(s => s.articleId), ['a2']);

// tab: list, then detail
const host = d.createElement('div'); d.body.append(host);
let count = -1;
await V.renderCollectionsTab(host, { onCount: (n) => { count = n; } });
assert.equal(count, 3);
const cards = [...host.querySelectorAll('.coll-card')];
assert.equal(cards.length, 3);
cards.find(c => c.textContent.includes('Climate')).click(); await tick(60);
assert.ok(host.querySelector('.coll-detail'));
assert.equal(host.querySelector('.coll-name').value, 'Climate');
assert.equal(host.querySelectorAll('.coll-source').length, 1);
assert.ok(host.querySelector('.coll-source-status').textContent.includes('0/4'));

// source check inside the collection: opening, answering, profile
[...host.querySelectorAll('.coll-source button')].find(b => b.textContent === 'Check').click();
const panel = host.querySelector('.coll-check');
assert.ok(panel, 'check panel opens inline');
const who = panel.querySelector('textarea');
who.value = 'A ministry'; who.dispatchEvent(new w.Event('input')); who.dispatchEvent(new w.Event('blur'));
const type = panel.querySelector('select'); type.value = 'news'; type.dispatchEvent(new w.Event('change'));
await tick(120);
const rec = store[articleRecKey('a1')];
assert.equal(rec.sourceCheck.who, 'A ministry'); assert.equal(rec.sourceProfile.type, 'news');
assert.ok(host.querySelector('.coll-source-status').textContent.includes('1/4'), 'status follows the answer');
assert.ok(panel.querySelector('a.coll-search').href.includes('duckduckgo.com'), 'search link, not auto-sent');

// inline in the article: same answers
const strip = await V.collectionsStrip({ id: 'a1', title: 'First article' });
assert.ok([...strip.querySelectorAll('.coll-chip')].some(c => c.textContent === 'Climate'));
const inline = V.sourceCheckPanel({ id: 'a1', title: 'First', url: 'https://x.test/1', ...rec });
assert.equal(inline.querySelector('textarea').value, 'A ministry', 'inline panel shows the stored answer');
assert.equal(inline.querySelector('select').value, 'news');

// remove a source, delete the collection
host.querySelector('.coll-remove').click(); await tick(60);
assert.deepEqual((await C.getCollection(first.id)).sources, []);
assert.ok(store[articleRecKey('a1')], 'article untouched');
w.confirm = () => true;
[...host.querySelectorAll('button')].find(b => b.textContent === 'Delete collection').click(); await tick(60);
assert.ok(!(await C.listCollections()).some(c => c.id === first.id));

// several articles at once (History selection)
const multi = await C.createCollection({ name: 'Batch' });
await V.openAddSheet([{ id: 'a1', title: 'First article' }, { id: 'a2', title: 'Second article' }]);
await tick(30);
const msheet = d.querySelector('.sendsheet');
assert.ok(msheet.textContent.includes('2 articles'), 'sheet names the number of articles');
[...msheet.querySelectorAll('.sendsheet-row')].find(r => r.textContent.includes('Batch')).click();
[...msheet.querySelectorAll('button')].find(b => b.textContent === 'Add').click();
await tick(80);
assert.deepEqual((await C.getCollection(multi.id)).sources.map(s => s.articleId).sort(), ['a1', 'a2']);
assert.ok(toasts.at(-1).startsWith('2 added'));
console.log('ok');
