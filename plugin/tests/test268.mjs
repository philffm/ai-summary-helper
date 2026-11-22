// Read mode: a bookmark (set at the block under the toolbar, kept on the article, offered again on the next visit, removable).
import { setup, imp, tick } from './harness.mjs'; import assert from 'assert'; import fs from 'fs';
const { store, w } = setup({});
const { articleRecKey } = await imp('../src/modules/storageKeys.js');
const page = fs.readFileSync(new URL('../src/readerPage.html', import.meta.url), 'utf8');
const shell = page.replace(/^[\s\S]*?<html[^>]*>/i, '').replace(/<\/html>[\s\S]*$/i, '');
const url = 'https://example.com/post', stamp = new Date().toISOString();
const content = '<h2>One</h2><p>First paragraph of the text, long enough to be found again.</p><p>Second paragraph where the reader stopped reading today.</p><p>Third paragraph at the very end of it all.</p>';
const seed = (extra = {}) => {
  store['articles:index'] = [{ id: 'a1', url, title: 'T', timestamp: stamp, ...extra }];
  store[articleRecKey('a1')] = { id: 'a1', url, title: 'T', timestamp: stamp, summary: '<p>S</p>', content };
};
const open = async (hash = '#id=a1') => {
  w.document.documentElement.innerHTML = shell; w.location.hash = hash;
  await imp('../src/readerPage.js'); await tick(250);
  const d = w.document;
  // no layout in jsdom: the first paragraph is above the toolbar, the others below it
  [...d.querySelectorAll('.rp-content p, .rp-content h2')].forEach((b, i) => { b.getBoundingClientRect = () => ({ top: i * 50 - 160, bottom: i * 50 - 120 }); });
  return d;
};
seed();
let d = await open();
const btn = d.getElementById('rpBookmarkBtn');
assert(!btn.hidden, 'bookmark button is there for an article with full text');
assert(!d.querySelector('.rp-resume'), 'nothing to continue from yet');
btn.click(); d.getElementById('rpBmMove').click(); await tick(100);
const rec = store['articles:index'][0].readPlace;
assert(rec && /^Second paragraph/.test(rec.exact), 'set at the first block under the toolbar: ' + JSON.stringify(rec));
assert(rec.prefix !== undefined && rec.at, 'with its context and time');
assert(d.querySelector('.rp-bookmarked') && /^Second paragraph/.test(d.querySelector('.rp-bookmarked').textContent), 'the block is marked');
assert.equal(btn.getAttribute('aria-pressed'), 'true');

// next visit: the way back is offered
seed({ readPlace: rec });
d = await open();
const go = d.querySelector('.rp-resume button');
assert(go && /bookmark/i.test(go.textContent), 'continue at your bookmark is offered: ' + (go && go.textContent));
assert(/^Second paragraph/.test(d.querySelector('.rp-bookmarked').textContent), 'marked again after a reload');

// remove
d.getElementById('rpBmRemove').click(); await tick(100);
assert.equal(store['articles:index'][0].readPlace, '', 'cleared as an empty value (sync carries a clear)');
assert(!d.querySelector('.rp-bookmarked'));
assert.equal(d.getElementById('rpBookmarkBtn').getAttribute('aria-pressed'), 'false');

// no bookmark, but read part of it: offer the percentage
seed({ progress: 0.42 });
d = await open();
assert(/42 %/.test(d.querySelector('.rp-resume button').textContent), 'continue at the read depth');
// the address follows: a browser bookmark made now keeps the article, the original url and the place
seed();
d = await open();
d.getElementById('rpBookmarkBtn').click(); d.getElementById('rpBmMove').click(); await tick(100);
const hp = new URLSearchParams(w.location.hash.slice(1));
assert.equal(hp.get('id'), 'a1'); assert.equal(hp.get('u'), url);
assert(/^Second paragraph/.test(hp.get('p') || ''), 'place in the address: ' + w.location.hash);
d.getElementById('rpBmRemove').click(); await tick(100);
assert(!new URLSearchParams(w.location.hash.slice(1)).get('p'), 'removed from the address too');
// opened from such a bookmark on a library that has no bookmark: it goes to the place
let jumped = null;
w.Element.prototype.scrollIntoView = function () { jumped = this.textContent; };
seed();
d = await open('#id=a1&p=' + encodeURIComponent('Second paragraph where the reader stopped'));
assert(/^Second paragraph/.test(jumped || ''), 'jumped to the place from the address: ' + jumped);
// the article is not in this library: the original is offered
store['articles:index'] = []; delete store[articleRecKey('a1')];
d = await open('#id=zz&u=' + encodeURIComponent('https://example.com/orig'));
assert(d.querySelector('.rp-empty a[href="https://example.com/orig"]'), 'way out to the original page');
// browser bookmarks: asks for the permission on the click, then one bookmark per article in the extension's folder, updated when saved again
{
  const made = [], asked = [];
  const tree = { folders: [], kids: [] };
  chrome.permissions = { contains: async () => !!chrome.bookmarks, request: async (q) => { asked.push(q); chrome.bookmarks = bmApi; return true; } };
  const bmApi = {
    search: async ({ title }) => tree.folders.filter((f) => f.title === title),
    create: async (b) => { const r = { id: 'x' + made.length, ...b }; made.push(r); if (!b.url) tree.folders.push(r); else tree.kids.push(r); return r; },
    getChildren: async () => tree.kids,
    update: async (id, ch) => { Object.assign(tree.kids.find((k) => k.id === id), ch); },
  };
  seed(); d = await open();
  assert(!d.getElementById('rpBmBrowser').hidden, 'browser bookmark is offered when the browser can ask for it');
  d.getElementById('rpBookmarkBtn').click(); d.getElementById('rpBmBrowser').click(); await tick(150);
  assert.deepEqual(asked, [{ permissions: ['bookmarks'] }], 'asked once, for bookmarks only');
  assert(tree.folders[0].title === 'AI Summary Helper' && tree.kids.length === 1 && /readerPage|#id=a1/.test(tree.kids[0].url) && tree.kids[0].title === 'T', 'one bookmark in our folder: ' + JSON.stringify(tree.kids));
  d.getElementById('rpBookmarkBtn').click(); d.getElementById('rpBmMove').click(); await tick(100);
  d.getElementById('rpBookmarkBtn').click(); await tick(100);
  assert(/Update/.test(d.getElementById('rpBmBrowser').textContent), 'it knows the article is saved already');
  d.getElementById('rpBmBrowser').click(); await tick(150);
  assert.equal(tree.kids.length, 1, 'updated, not duplicated');
  assert(/p=Second/.test(tree.kids[0].url), 'the saved address carries the place: ' + tree.kids[0].url);
}
console.log('TEST 268 OK');
