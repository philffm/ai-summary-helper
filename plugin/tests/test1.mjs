import { setup, imp, tick } from './harness.mjs';
import assert from 'assert';
const now = Date.now();
const rfc = (ms) => new Date(ms).toUTCString();
const A = `<?xml version="1.0"?><rss version="2.0"><channel><title>Alpha Blog</title><link>https://alpha.example</link>
<item><title>Team wins award for great launch</title><link>https://alpha.example/1</link><pubDate>${rfc(now-3600e3)}</pubDate><description>Success all round</description></item>
<item><title>Notes on boring infrastructure</title><link>https://alpha.example/2</link><pubDate>${rfc(now-26*3600e3)}</pubDate><description>A tour of postmortems</description></item>
<item><title>Ancient post</title><link>https://alpha.example/3</link><pubDate>${rfc(now-10*86400e3)}</pubDate><description>Old</description></item></channel></rss>`;
const B = `<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom"><title>Beta News</title><link rel="alternate" href="https://beta.example"/>
<entry><id>b1</id><title>Attack kills dozens in crisis</title><link rel="alternate" href="https://beta.example/1"/><published>${new Date(now-2*3600e3).toISOString()}</published><summary>Tragic disaster</summary></entry>
<entry><id>b2</id><title>Quarterly roundup</title><link rel="alternate" href="https://beta.example/2"/><published>${new Date(now-5*3600e3).toISOString()}</published><summary>Neutral things</summary></entry></feed>`;
const fx = { 'https://alpha.example/feed.xml': A, 'https://beta.example/atom.xml': B };
const { store, sent, w } = setup(fx);
const $ = (s) => w.document.querySelector(s), $$ = (s) => [...w.document.querySelectorAll(s)];
const click = (el) => el.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
const shown = []; const uiStub = { showToast: (m) => shown.push(m), showScreen: (n) => shown.push('screen:' + n) };
const fm = await imp('modules/feedManager.js');
fm.initFeedManager(uiStub);
await tick(50);
await fm.onFeedsScreenShown(uiStub);
// 1 first run
assert.equal($('#feedControls').hidden, true, 'controls hidden on first run');
assert.ok($('#feedEmpty').textContent.includes('Follow the sites you read'), 'first-run shown');
// 2 add feeds through the sheet
for (const u of ['https://alpha.example/feed.xml', 'https://beta.example/atom.xml']) {
  click($('#feedAddBtn')); await tick();
  assert.equal($('#feedSheetLayer').hidden, false, 'add sheet opens');
  const input = $('#feedSheetBody input[type=text]'); input.value = u;
  click($('#feedSheetBody [data-feed-add]')); await tick(80);
  assert.equal($('#feedSheetLayer').hidden, true, 'sheet closes after add');
}
assert.equal(store.feedSubs.length, 2);
assert.equal($('#feedControls').hidden, false);
console.log('chips:', $$('#feedChipRow .feed-chip').map(b => b.textContent).join(' | '));
assert.ok($('#feedChipRow [data-status=unread]').textContent.startsWith('Unread · 5'), 'unread 5');
// 3 day groups
const heads = $$('.feed-day-label').map(x => x.textContent);
console.log('day groups:', heads);
assert.ok(heads[0].includes('Today'));
assert.ok(heads.some(h => h.includes('Yesterday')));
// 4 retention: 10-day item present (keep 30)
assert.equal(store.feedItems.length, 5, 'all 5 items kept');
console.log('items stored', store.feedItems.length, 'unscored:', store.feedItems.every(i => i.sent === undefined && !i.ai));
assert.ok(store.feedItems.every(i => i.sent === undefined), 'no local scoring');
// 5 folders via settings panel
document.dispatchEvent(new w.CustomEvent('aish:settings-panel', { detail: { name: 'feeds' } }));
await tick(50);
const alphaIdx = store.feedSubs.findIndex(s => s.title === 'Alpha Blog');
const tagIns = $$('#feedSettingsRoot .feed-tag-input'); assert.equal(tagIns.length, 2);
tagIns[alphaIdx].value = 'Dev'; tagIns[alphaIdx].dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
await tick(30);
assert.deepEqual(store.feedSubs[alphaIdx].tags, ['Dev']);
// second tag, case-insensitive dedupe
let ti = $$('#feedSettingsRoot .feed-tag-input')[alphaIdx]; ti.value = 'dev'; ti.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); await tick(30);
ti = $$('#feedSettingsRoot .feed-tag-input')[alphaIdx]; ti.value = 'Blogs'; ti.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); await tick(30);
assert.deepEqual(store.feedSubs[alphaIdx].tags, ['Dev', 'Blogs']);
// 6 source picker
click($('#feedSourcePill')); await tick();
const rows = $$('#feedSheetBody .feed-pick-row').map(r => r.textContent.replace(/\s+/g, ' ').trim());
console.log('picker rows:', rows);
assert.ok($$('#feedSheetBody .feed-pick-label').some(l => l.textContent === 'TAGS'), 'tags label');
click($$('#feedSheetBody .feed-tag-chip').find(r => r.textContent.includes('# Dev'))); await tick();
assert.ok($('#feedSourceLabel').textContent.includes('Dev'));
const titlesDev = $$('.feed-item h4').map(h => h.textContent);
console.log('Dev folder items:', titlesDev);
assert.ok(titlesDev.every(t => !t.includes('Attack')), 'beta excluded');
// back to all
click($('#feedSourcePill')); await tick(); click($$('#feedSheetBody .feed-pick-row')[0]); await tick();
// 7 status chips
click($('#feedChipRow [data-status=fav]')); await tick();
assert.equal($$('.feed-item').length, 0, 'no favorites yet'); assert.ok($('#feedEmpty').textContent.includes('Nothing matches'));
click($('#feedChipRow [data-status=all]')); await tick();
assert.equal($$('.feed-item').length, 5);
console.log('ALL ok items:', $$('.feed-item').length);
// 8 mood filter — needs AI scores
globalThis.__ai = (m) => ({ ok: true, text: JSON.stringify({ scores: m.user.split('\n').slice(1).map(l => /award/i.test(l) ? 0.8 : /Attack/.test(l) ? -0.8 : 0) }) });
store.feedItems.forEach(i => { i.ai = true; i.sent = /award/i.test(i.title) ? 0.8 : /Attack/.test(i.title) ? -0.8 : 0; }); await fm.onFeedsScreenShown(uiStub); await tick(50);   // scoring entry point moved (Insights/recap)
assert.ok(store.feedItems.some(i => i.ai), 'AI scored');
click($('#feedFilterChip')); await tick();
click($$('#feedSheetBody .feed-pick-row').find(r => r.textContent.includes('Positive only'))); await tick();
let t2 = $$('.feed-item h4').map(h => h.textContent); console.log('positive only:', t2);
assert.ok(t2.length >= 1 && t2.every(t => /award/.test(t)));
click($$('#feedSheetBody .feed-pick-row').find(r => r.textContent.includes('Hide negative'))); await tick();
t2 = $$('.feed-item h4').map(h => h.textContent); console.log('hide negative:', t2);
assert.ok(!t2.some(t => /Attack/.test(t)));
click($$('#feedSheetBody .feed-pick-row').find(r => r.textContent.includes('Any mood')));
click($$('#feedSheetBody .feed-pick-row').find(r => r.textContent.includes('Most positive first'))); await tick();
t2 = $$('.feed-item h4').map(h => h.textContent); console.log('mood sort:', t2);
assert.ok(/award/.test(t2[0]) && /Attack/.test(t2[t2.length - 1]));
click($$('#feedSheetBody .feed-pick-row').find(r => r.textContent.includes('Newest first')));
click($('.feed-sheet-done')); await tick();
console.log('PART 1 OK');
globalThis.__ctx = { store, sent, w, fm, uiStub, shown };
