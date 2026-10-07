import { setup, imp, tick } from './harness.mjs'; import assert from 'assert';
const now = Date.now(); const H = 3600e3;
const { store, w } = setup({});
const $ = s => w.document.querySelector(s), $$ = s => [...w.document.querySelectorAll(s)];
const click = el => el.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
store['feeds:subs'] = [{ id: 'a', url: 'https://a.test/f', title: 'Alpha', tags: [], lastFetched: now }, { id: 'b', url: 'https://b.test/f', title: 'Beta', tags: [], lastFetched: now }];
const mk = (id, f, t, sn, extra = {}) => ({ id, feedId: f, title: t, link: 'https://x.test/' + id, published: now - Number(id.slice(1)) * H, snippet: sn, read: false, ...extra });
store['feeds:items'] = [
  mk('i1', 'a', 'Climate summit ends with deal', 'Leaders agreed on emissions cuts climate'),
  mk('i2', 'a', 'Board game teaches climate impacts', 'A game about floods and fires', { audio: 'https://x/a.mp3', dur: 1800 }),
  mk('i3', 'b', 'Börse steigt kräftig', 'Der DAX legt zu, Börse jubelt', { ai: true, sent: 0.7, cat: 'Wirtschaft' }),
  mk('i4', 'b', 'Quarterly roundup', 'Neutral things happened', { ai: true, sent: -0.6, cat: 'Business' }),
];
const fm = await imp('modules/feedManager.js'); const ui = { showToast() {}, showScreen() {} };
fm.initFeedManager(ui); await tick(50); await fm.onFeedsScreenShown(ui); await tick(100);
const titles = () => $$('.feed-item h4').map(h => h.textContent);
assert.equal(titles().length, 4);
// search
const input = $('#feedSearch'); input.value = 'climate'; input.dispatchEvent(new w.Event('input', { bubbles: true })); await tick(250);
console.log('search climate →', titles()); assert.ok(titles().length === 2 && titles().every(t => /climate/i.test(t)), 'search filters');
assert.ok($$('.feed-day-label').some(l => /Best match/.test(l.textContent)), 'relevance header');
input.value = 'börse'; input.dispatchEvent(new w.Event('input', { bubbles: true })); await tick(250);
assert.equal(titles().length, 1, 'unicode search');
input.value = ''; input.dispatchEvent(new w.Event('input', { bubbles: true })); await tick(250);
assert.equal(titles().length, 4);
// insights
click($('#feedInsightsBtn')); await tick(50);
assert.ok(!$('#feedInsights').hidden && $('#feedItemList').hidden, 'insights shown');
const txt = $('#feedInsights').textContent; console.log(txt.replace(/\s+/g, ' ').slice(0, 300));
assert.ok(/Items/.test(txt) && /Mood/.test(txt) && /Wirtschaft/.test(txt) && /Podcasts/.test(txt), 'sections');
assert.ok($$('#feedInsights .ar-cat-row').some(r => /Alpha/.test(r.textContent)), 'top sources');
// click category → search + list
click($$('#feedInsights .ar-cat-row').find(r => /Wirtschaft/.test(r.textContent))); await tick(50);
assert.ok($('#feedItemList').hidden === false && $('#feedInsights').hidden, 'back to list'); assert.equal($('#feedSearch').value, 'Wirtschaft');
console.log('after category click →', titles()); assert.deepEqual(titles(), ['Börse steigt kräftig']);
// toggling graph button flips view (graph lib can't load in jsdom → no crash)
click($('#feedGraphBtn')); await tick(80);
assert.ok(!$('#feedGraph').hidden && $('#feedItemList').hidden && $('#feedGraphBtn').classList.contains('active'), 'graph view');
click($('#feedGraphBtn')); await tick(30);
assert.ok($('#feedGraph').hidden && !$('#feedItemList').hidden);
// scroll hide
const sc = $('#feedsScreen'); const bar = $('#feedControls');
const scrollTo = async (y) => { Object.defineProperty(sc, 'scrollTop', { value: y, configurable: true }); sc.dispatchEvent(new w.Event('scroll')); };
await tick(1300);   // feedManager ignores scroll for 1.2 s after the screen is shown (hideSuppressUntil); wait it out so fast runners don't race it
await scrollTo(200); assert.ok(bar.classList.contains('scroll-hidden'), 'hidden when scrolling down');
await scrollTo(150); assert.ok(!bar.classList.contains('scroll-hidden'), 'back when scrolling up');
await scrollTo(400); assert.ok(bar.classList.contains('scroll-hidden')); await scrollTo(0); assert.ok(!bar.classList.contains('scroll-hidden'));
console.log('TEST 13 OK');
