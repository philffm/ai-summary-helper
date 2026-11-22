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
const open = async () => {
  w.document.documentElement.innerHTML = shell; w.location.hash = '#id=a1';
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
btn.click(); await tick(100);
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
console.log('TEST 268 OK');
