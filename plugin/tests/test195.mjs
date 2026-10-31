// Danger zone: notes, comments, reminders and full text reach a place only when that place says so.
import assert from 'assert';
import path from 'path'; import { pathToFileURL } from 'url';
import { setup, imp } from './harness.mjs';
import { createFakeDav } from './fakeDav.mjs';
const { store: local } = setup({});
const K = await imp('modules/storageKeys.js');
const P = await imp('modules/syncPush.js');
const R = await imp('modules/syncReadable.js');
const NS = await imp('modules/notesStore.js');
const S = await imp('modules/syncService.js');
const W = await import(pathToFileURL(path.resolve(process.env.AISH_SRC, 'modules/syncWebdav.js')).href);
const { SK, articleRecKey } = K;

// defaults: all three off
assert.deepEqual(R.INCLUDE_DEFAULT, { highlights: true, qa: false, notes: false, reminders: false, fulltext: false });
assert.deepEqual(S.cleanPlace({ connectionId: 'c', scope: 'all' }).include, { highlights: true, qa: false, notes: false, reminders: false, fulltext: false });
assert.equal(S.cleanPlace({ connectionId: 'c', scope: 'all', include: { notes: true, reminders: true, fulltext: true } }).include.fulltext, true);

// the text without a DOM
const b = R.textToBlocksLite('<h2>Why prices rose</h2><p>Energy &amp; supply.</p><ul><li>one</li><li>two</li></ul><script>evil()</script><p>Last.</p>');
assert.deepEqual(b, [['h2', 'Why prices rose'], ['p', 'Energy & supply.'], ['p', 'one'], ['p', 'two'], ['p', 'Last.']]);
assert.deepEqual(R.textToBlocksLite('First para.\n\nSecond para.'), [['p', 'First para.'], ['p', 'Second para.']], 'plain text works too');
assert.equal(R.textToBlocksLite('<p>' + 'x'.repeat(500000) + '</p>').length <= 4000, true);

// a library with a highlight, its comment, a free note, a reminder and full text
const dav = createFakeDav();
const store = W.createWebdavStore({ url: 'https://cloud.test/dav/', root: 'site', username: 'phil', password: 'secret' }, { fetchFn: dav.fetchFn });
local[SK.articlesIndex] = [{ id: 'a1', url: 'https://x.test/a1', title: 'One', timestamp: '2026-03-01T00:00:00Z', tags: ['public'], summary: 's', decisionTimeframe: 'weekend', decisionReason: 'for the newsletter' }];
local[articleRecKey('a1')] = { content: '<p>FULL TEXT HERE</p>', summary: 's' };
local[SK.annotations] = [{ id: 'hl_1', url: 'https://x.test/a1', text: 'a highlight', type: 'user', timestamp: '2026-03-01T00:00:00Z' }];
const ns = NS.createNotesStore({ storage: chrome.storage.local, mark: async () => 0 });
await ns.setComment('hl_1', { text: 'my private comment', tags: ['wages'] });
const note = await ns.add({ text: 'Ask Anna about the cap', tags: ['todo'], url: 'https://x.test/a1' });

const base = { id: 'p1', mode: 'readable', direction: 'publish', scope: 'tag', filter: { tag: 'public' } };
const run = (place, stamps = {}) => P.pushPlace({ place, storage: chrome.storage.local, store, stamps });
const file = () => JSON.parse(dav.text('site/articles/a1.json')), lib = () => JSON.parse(dav.text('site/library.json'));

// everyday defaults: none of it leaves
await run({ ...base, include: { highlights: true, qa: false } });
let all = dav.text('site/articles/a1.json') + dav.text('site/library.json');
for (const secret of ['my private comment', 'Ask Anna', 'for the newsletter', 'FULL TEXT HERE']) assert.ok(!all.includes(secret), secret + ' stays home');
assert.ok(!('notes' in lib()) && !('reminder' in file()) && !('blocks' in file()));

// danger zone on: each one appears where it belongs, and full text only in the article file, not in the list
const danger = { ...base, include: { highlights: true, qa: false, notes: true, reminders: true, fulltext: true } };
let r = await run(danger);
assert.ok(r.pushed >= 1, 'the config change republishes');
assert.equal(file().highlights[0].comment, 'my private comment'); assert.deepEqual(file().highlights[0].tags, ['wages']);
assert.deepEqual(file().reminder, { timeframe: 'weekend', reason: 'for the newsletter' });
assert.ok(JSON.stringify(file().blocks).includes('FULL TEXT HERE'));
assert.equal(lib().notes.length, 1); assert.equal(lib().notes[0].text, 'Ask Anna about the cap'); assert.deepEqual(lib().notes[0].tags, ['todo']);
assert.ok(!('blocks' in lib().articles[0]), 'the list never carries full text'); assert.equal(lib().articles[0].highlights[0].comment, 'my private comment', 'but it does carry the comment');

// each switch on its own
for (const [flag, probe] of [['notes', 'my private comment'], ['reminders', 'for the newsletter'], ['fulltext', 'FULL TEXT HERE']]) {
    await run({ ...base, include: { highlights: true, qa: false, notes: false, reminders: false, fulltext: false } });
    await run({ ...base, include: { highlights: true, qa: false, notes: false, reminders: false, fulltext: false, [flag]: true } });
    const text = dav.text('site/articles/a1.json') + dav.text('site/library.json');
    assert.ok(text.includes(probe), flag + ' publishes its own part');
    for (const [f2, p2] of [['notes', 'my private comment'], ['reminders', 'for the newsletter'], ['fulltext', 'FULL TEXT HERE']]) if (f2 !== flag) assert.ok(!text.includes(p2), flag + ' does not drag in ' + f2);
}

// edits follow: a changed comment republishes its article; a new free note rewrites the list; a removed note leaves it
await run(danger, { 'article:a1': { rev: { t: 10, d: 'x' } } });
let calls = dav.log.length;
await run(danger, { 'article:a1': { rev: { t: 10, d: 'x' } } });
assert.ok(!dav.log.slice(calls).some((l) => l.startsWith('PUT')), 'nothing changed: nothing uploaded');
await ns.setComment('hl_1', { text: 'changed my mind' });
r = await run(danger, { 'article:a1': { rev: { t: 10, d: 'x' } }, 'note:c_hl_1': { rev: { t: 99, d: 'x' } } });
assert.equal(file().highlights[0].comment, 'changed my mind'); assert.equal(r.pushed, 1);
const n2 = await ns.add({ text: 'Another thought' });
r = await run(danger, { 'article:a1': { rev: { t: 10, d: 'x' } }, 'note:c_hl_1': { rev: { t: 99, d: 'x' } } });
assert.ok(r.libraryWritten); assert.deepEqual(lib().notes.map((n) => n.text).sort(), ['Another thought', 'Ask Anna about the cap']);
await ns.remove(n2.id); await ns.remove(note.id);
r = await run(danger, { 'article:a1': { rev: { t: 10, d: 'x' } }, 'note:c_hl_1': { rev: { t: 99, d: 'x' } } });
assert.deepEqual(lib().notes, [], 'deleted notes leave the published list');
// switching the notes switch off takes them off the site again
await run({ ...base, include: { highlights: true, qa: false, notes: false, reminders: false, fulltext: false } });
assert.ok(!('notes' in lib())); assert.ok(!dav.text('site/articles/a1.json').includes('changed my mind'));

console.log('TEST 195 OK');
process.exit(0);
