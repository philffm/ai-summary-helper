// Read mode: highlights can be added (selection in the full text) and removed (click a highlight); the app's saved theme
// does not break the toolbar (a bare [data-theme] selector once matched <html> and wiped the page).
import { setup, imp, tick } from './harness.mjs'; import assert from 'assert'; import fs from 'fs';
const { store, sent, w } = setup({});
const { SK, articleRecKey } = await imp('../src/modules/storageKeys.js');
const { createHighlightStore } = await imp('../src/modules/highlightStore.js');
const { pageKeyForUrl } = await imp('../src/modules/pageKey.js');
const page = fs.readFileSync(new URL('../src/readerPage.html', import.meta.url), 'utf8');
w.document.documentElement.innerHTML = page.replace(/^[\s\S]*?<html[^>]*>/i, '').replace(/<\/html>[\s\S]*$/i, '');
const url = 'https://example.com/post', key = pageKeyForUrl(url);
const hls = () => createHighlightStore({ storage: chrome.storage.local }).forPage(key);
store.theme = 'dark';
const stamp = new Date().toISOString();
store['hl:schema'] = 2;
store['hl:page:' + key] = [
  { url: key, text: 'important sentence here', type: 'user', timestamp: stamp },                                   // old record: no id
  { id: 'hl_ghost1', url: key, text: 'second passage of the article', type: 'ghost', timestamp: stamp },
];
const art = { id: 'a1', url, title: 'Hello', timestamp: stamp, summary: '<p>Short summary</p>', content: '<h2>One</h2><p>An important sentence here and more words follow.</p><p>The second passage of the article is here, plus a third sentence to mark.</p>' };
store['articles:index'] = [{ id: 'a1', url, title: art.title, timestamp: art.timestamp }];
store[articleRecKey('a1')] = art;
w.location.hash = '#id=a1';
await imp('../src/readerPage.js'); await tick(200);
const d = w.document;
assert(d.querySelector('.rp-title'), 'a saved dark theme does not wipe the page');
assert(d.querySelector('button[data-theme="dark"]').textContent, 'theme button keeps its label');
assert.equal(d.querySelectorAll('.rp-content mark[data-hl-n]').length >= 2, true, 'highlights carry their number');
assert(d.querySelector('mark[data-hl-type="ghost"]'), 'AI highlight is marked as such');

// add: select "third sentence" in the full text
const selectText = (needle) => {
  const p = [...d.querySelectorAll('.rp-content p')].find((x) => x.textContent.includes(needle));
  const tn = [...p.childNodes].find((n) => n.nodeType === 3 && n.nodeValue.includes(needle));
  const r = d.createRange(); r.setStart(tn, tn.nodeValue.indexOf(needle)); r.setEnd(tn, tn.nodeValue.indexOf(needle) + needle.length);
  const s = w.getSelection(); s.removeAllRanges(); s.addRange(r);
  d.dispatchEvent(new w.Event('selectionchange'));
};
selectText('third sentence'); await tick(250);
const addBtn = d.getElementById('rpHighlight');
assert(!addBtn.disabled, 'Highlight is enabled for a selection in the text');
addBtn.click(); await tick(80);
let list = await hls();
const added = list.find((h) => h.text === 'third sentence');
assert(added && added.type === 'user' && added.id && added.v === 2, 'stored as a user highlight with an id');
assert(added.quote && added.quote.exact === 'third sentence' && added.quote.prefix.includes('plus a'), 'quote with its context');
assert.equal(added.url, key);
assert(d.querySelector(`mark[data-hl-id="${added.id}"]`), 'painted in place');

// a selection in the summary is not offered
const sp = d.querySelector('.rp-summary p'); const r2 = d.createRange(); r2.selectNodeContents(sp); w.getSelection().removeAllRanges(); w.getSelection().addRange(r2);
d.dispatchEvent(new w.Event('selectionchange')); await tick(250);
assert(addBtn.disabled, 'no highlight from the summary');
w.getSelection().removeAllRanges();

// remove: click the new highlight, confirm
const act = () => d.querySelector('.rp-pop button');
d.querySelector(`mark[data-hl-id="${added.id}"]`).click(); await tick(20);
assert(!d.querySelector('.rp-pop').hidden, 'popover next to the highlight');
act().click(); await tick(80);
list = await hls();
assert(!list.some((h) => h.id === added.id), 'removed from the store');
assert(sent.some((m) => m.action === 'syncHlDeleted' && m.ids.includes(added.id)), 'the worker is told, so sync does not bring it back');
assert(!d.querySelector(`mark[data-hl-id="${added.id}"]`) && d.querySelector('.rp-content').textContent.includes('third sentence'), 'text stays, mark gone');

// an AI highlight is dismissed, not removed
d.querySelector('mark[data-hl-type="ghost"]').click(); await tick(20); act().click(); await tick(80);
const g = (await createHighlightStore({ storage: chrome.storage.local }).forPage(key)).find((h) => h.id === 'hl_ghost1');
assert(g && g.dismissed, 'ghost kept as dismissed');
assert(!sent.some((m) => m.action === 'syncHlDeleted' && m.ids.includes('hl_ghost1')), 'a dismissal is not a deletion');

// an old record without id goes by its text
d.querySelector('mark[data-hl-type="user"]').click(); await tick(20); act().click(); await tick(80);
assert(!(await hls()).some((h) => h.text === 'important sentence here'), 'old record removed by text');
console.log('TEST 266 OK');
