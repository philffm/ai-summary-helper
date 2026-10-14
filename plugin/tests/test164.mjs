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

// AI overview: parsed into agree / disagree / missing, stored on the collection, carried into the Markdown export
{
    const parts = C.parseOverview('## Agree\n- A [1][2]\n\n## Disagree\n- X [1] vs [2]\n## Missing\n- Y');
    assert.deepEqual(parts.map(p => p.key), ['agree', 'disagree', 'missing']);
    assert.equal(C.parseOverview('plain [1]')[0].key, '', 'unstructured text stays one block');
    const c = await C.createCollection({ name: 'Ov', question: 'Q?' });
    await C.saveOverview(c.id, { text: '## Agree\n- A [1]', ids: ['a1', 'a2'], used: 2 });
    const rec = await C.getCollection(c.id);
    assert.deepEqual(rec.overview.ids, ['a1', 'a2']);
    const md = C.collectionMarkdown(rec, [], { label: (k) => k });
    assert.ok(md.includes('## Overview') && md.includes('- A [1]'), 'overview in the export');
    await C.saveOverview(c.id, null);
    assert.equal((await C.getCollection(c.id)).overview, undefined, 'overview can be cleared');
}

// Picker ranking: articles that share words with the first source / the question come first
{
    const cands = [{ id: 'x1', title: 'Cooking pasta quickly', tags: [] }, { id: 'x2', title: 'Sleep and memory in students', tags: [] }, { id: 'x3', title: 'Tax rules', tags: ['learning'] }];
    const r = C.rankCandidates(cands, { name: 'Learning', question: 'Does sleep help recall?' }, [{ title: 'Sleep and memory consolidation: a review', tags: ['learning'] }]);
    assert.equal(r[0].a.id, 'x2'); assert.ok(r[0].score > r[1].score);
    assert.equal(r[1].a.id, 'x3', 'a shared tag counts'); assert.equal(r[2].score, 0);
}

// Counters, worksheet
{
    assert.equal(await C.bumpStat('x_test'), 1); assert.equal(await C.bumpStat('x_test'), 2);
    assert.equal((await C.getStats()).x_test, 2);
    const ws = C.collectionWorksheet({ name: 'WS', question: 'Q?' }, [{ title: 'T1', url: 'https://a.test' }], { label: (k) => k });
    assert.ok(ws.includes('# Worksheet: WS') && ws.includes('> Q?') && ws.includes('## 1. T1') && ws.includes('q_origin'), 'worksheet has question, source and the four questions');
    assert.ok(!/answer/i.test(ws.replace('Check each source', '')), 'no answers are filled in');
}

// Original title wins over the AI headline; profile from a DOI record
{
    assert.equal(C.displayTitle({ title: '🔍 AI headline', sourceProfile: { title: 'What caused the US pandemic-era inflation?' } }), 'What caused the US pandemic-era inflation?');
    assert.equal(C.displayTitle({ title: 'Own title', sourceProfile: { title: '' } }), 'Own title');
    const p = C.profileFromCsl({ type: 'journal-article', title: 'T', author: [{ given: 'Olivier', family: 'Blanchard' }, { given: 'Ben', family: 'Bernanke' }], container: 'Brookings Papers', year: '2023' });
    assert.deepEqual(p, { title: 'T', author: 'Olivier Blanchard, Ben Bernanke', date: '2023', publisher: 'Brookings Papers', type: 'peer' });
    assert.equal(C.profileFromCsl({ type: 'report', title: 'R', author: [], year: '' }).type, '', 'unknown types stay open');
    assert.ok(C.profileFromCsl({ title: 'X', author: [{ family: 'A' }, { family: 'B' }, { family: 'C' }, { family: 'D' }] }).author.endsWith('et al.'));
    await C.saveSourceProfile('a1', { type: '', author: '', date: '', publisher: '', title: 'Orig title' });
    const md = C.collectionMarkdown({ name: 'N' }, await C.collectionArticles({ sources: [{ articleId: 'a1' }] }), { label: (k) => k });
    assert.ok(md.includes('Orig title') && !md.includes('First article'), 'export uses the original title');
}

// Renaming a saved article
{
    const SM = (await imp('modules/storageManager.js')).default;
    assert.equal(await SM.setTitle('a2', '  Own   title \n here '), 'Own title here');
    assert.equal(store[SK.articlesIndex].find(a => a.id === 'a2').title, 'Own title here');
    assert.equal(await SM.setTitle('a2', '   '), null, 'an empty title is refused');
    assert.equal(await SM.setTitle('nope', 'x'), null, 'unknown id');
}

// "Find other sources": the source's own title, not the AI headline; DOI data fills only empty fields
{
    const url = C.otherSourcesQuery({ title: '🔍 AI headline here', sourceProfile: { title: 'What caused the US pandemic-era inflation?' } }, '');
    assert.equal(decodeURIComponent(url.split('q=')[1]), 'What caused the US pandemic-era inflation?');
    assert.equal(decodeURIComponent(C.otherSourcesQuery({ title: '🔍 Only headline' }, 'Q').split('q=')[1]), 'Q Only headline', 'leading emoji is dropped');
    const fromCsl = { title: 'Paper', author: 'A B', date: '2023', publisher: 'NBER', type: 'peer' };
    const m = C.mergeDoiProfile({ author: 'My own' }, fromCsl);
    assert.deepEqual(m, { type: 'peer', author: 'My own', date: '2023', publisher: 'NBER', title: 'Paper', fromDoi: true }, 'the reader’s author stays');
    assert.equal(C.mergeDoiProfile(m, fromCsl), null, 'nothing to add the second time');
}
