import { setup, imp, tick } from './harness.mjs';
import assert from 'assert';
const now = Date.now();
const { store, sent, w } = setup({});
const $ = (s) => w.document.querySelector(s), $$ = (s) => [...w.document.querySelectorAll(s)];
const click = (el) => el.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
const change = (el) => el.dispatchEvent(new w.Event('change', { bubbles: true }));
const mk = (id, feedId, title, ageH, extra = {}) => ({ id, feedId, title, link: 'https://x.test/' + id, published: now - ageH * 3600e3, snippet: '', sent: 0, read: false, ...extra });
store.feedSubs = [
  { id: 's1', url: 'https://a/feed', title: 'Alpha', folder: 'Dev', lastFetched: now },
  { id: 's2', url: 'https://b/feed', title: 'Beta', folder: '', lastFetched: now },
];
store.feedItems = [mk('i1','s1','Alpha one',0.01), mk('i2','s1','Alpha two',0.02), mk('i3','s2','Beta one',0.03), mk('i4','s2','Old beta',24*20), mk('i5','s2','Ancient',24*60)];
const shown = []; const uiStub = { showToast: (m) => shown.push(m), showScreen: (n) => shown.push('screen:' + n) };
const fm = await imp('modules/feedManager.js');
fm.initFeedManager(uiStub); await tick(50); await fm.onFeedsScreenShown(uiStub); await tick(50);
assert.equal(store.feedItems.length, 5, 'nothing pruned yet');
click($('#feedChipRow [data-status=unread]')); await tick();
// mark read with undo (Today group has 3 unread)
const dayBtn = $('.feed-day-action:not(.feed-day-ai)'); assert.ok(dayBtn, 'day action');
click(dayBtn); await tick();
assert.equal($$('.feed-item').length, 2, 'only older unread left (today read)');
assert.equal($('#feedUndo').hidden, false); assert.ok($('#feedUndoMsg').textContent.includes('Marked 3'));
click($('#feedUndoBtn')); await tick();
assert.equal($$('.feed-item').length, 5 - 0, 'undo restores');
console.log('mark read + undo OK');
// mute Beta -> All excludes it, picker marks it
document.dispatchEvent(new w.CustomEvent('aish:settings-panel', { detail: { name: 'feeds' } })); await tick(50);
const betaCard = $$('#feedSettingsRoot .feed-sub-card').find(c => c.querySelector('.feed-sub-input').value === 'Beta');
click(betaCard.querySelectorAll('.feed-icon-btn')[0]); await tick(30);
assert.equal(store.feedSubs.find(s => s.id === 's2').muted, true);
assert.ok($$('.feed-item h4').every(h => !h.textContent.includes('Beta')), 'muted excluded from All');
console.log('mute OK');
// rename
const alphaCard = $$('#feedSettingsRoot .feed-sub-card').find(c => c.querySelector('.feed-sub-input').value === 'Alpha');
const nameIn = alphaCard.querySelector('.feed-sub-input'); nameIn.value = 'Alpha ✱'; change(nameIn); await tick(30);
assert.equal(store.feedSubs.find(s => s.id === 's1').customTitle, 'Alpha ✱');
assert.ok($('.feed-item .article-date').textContent.includes('Alpha ✱'));
console.log('rename OK');
// explicit selection of muted sub shows its items
click($('#feedSourcePill')); await tick();
const betaRow = $$('#feedSheetBody .feed-pick-row').find(r => r.textContent.includes('Beta'));
assert.ok(betaRow.textContent.includes('🔕')); click(betaRow); await tick();
assert.ok($$('.feed-item h4').some(h => h.textContent === 'Beta one'));
click($('#feedSourcePill')); await tick(); click($$('#feedSheetBody .feed-pick-row')[0]); await tick();
// behavior settings -> storage + background messages
const sw = (id) => $('#' + id);
sw('feedSetPoll').checked = true; change(sw('feedSetPoll')); await tick(20);
assert.equal(store.feedSettings.backgroundPoll, true);
assert.ok(sent.some(m => m.action === 'feedPollConfig'), 'poll config sent');
const keep = sw('feedSetKeep'); keep.value = '30'; change(keep); await tick(40);
assert.ok(!store.feedItems.some(i => i.id === 'i5'), 'keepDays 30 prunes 60-day-old');
assert.ok(store.feedItems.some(i => i.id === 'i4'), '20-day-old kept');
keep.value = '7'; change(keep); await tick(40);
assert.ok(!store.feedItems.some(i => i.id === 'i4'), 'keepDays 7 prunes 20-day-old');
console.log('behavior settings + retention OK');
// auto-summarize favorites
sw('feedSetAutoSum').checked = true; change(sw('feedSetAutoSum')); await tick(20);
click($('.feed-item .star-button')); await tick(80);
const m = sent.find(x => x.action === 'openFeedItem' && x.forceExtension);
assert.ok(m && m.summarize, 'auto summarize message');
assert.ok(store.articlesIndex && store.articlesIndex.some(a => a.feedStub && a.favorite), 'stub created');
console.log('favorite + auto-summarize OK');
// markReadOnOpen off
sw('feedSetMarkRead').checked = false; change(sw('feedSetMarkRead')); await tick(20);
const before = store.feedItems.filter(i => !i.read).length;
click($$('.feed-item .feed-actions .button-secondary')[0]); await tick(40);   // Open
assert.equal(store.feedItems.filter(i => !i.read).length, before, 'open does not mark read when off');
// OPML export/import round-trip with folders
let exported = '';
globalThis.URL.createObjectURL = (b) => { b.text().then(t => exported = t); return 'blob:y'; };
click($$('#feedSettingsRoot .feed-btn').find(b => b.textContent.includes('Export'))); await tick(60);
assert.ok(exported.includes('<outline text="Dev"') && exported.includes('xmlUrl="https://a/feed"') && exported.includes('category="Dev"'), 'export has folder + category');
const opml = `<opml><body><outline text="News"><outline type="rss" text="Gamma" xmlUrl="https://g/feed" category="Tech,/Indie"/><outline text="Delta" xmlUrl="https://d/feed"/></outline><outline text="Loose" xmlUrl="https://l/feed"/></body></opml>`;
const file = new w.File([opml], 'x.opml', { type: 'text/xml' });
Object.defineProperty($('#feedOpmlInput'), 'files', { value: [file], configurable: true });
change($('#feedOpmlInput')); await tick(120);
const gamma = store.feedSubs.find(s => s.id && s.url === 'https://g/feed');
assert.deepEqual(gamma.tags, ['News', 'Tech', 'Indie']); assert.deepEqual(store.feedSubs.find(s => s.url === 'https://l/feed').tags, []);
assert.ok(!('folder' in store.feedSubs[0]), 'legacy folder migrated'); assert.ok(store.feedSubs.find(s => s.id === 's1').tags.includes('Dev'));
console.log('OPML folders import/export OK; subs:', store.feedSubs.length);
// first-run when all removed
for (const s of [...store.feedSubs]) { const c = $$('#feedSettingsRoot .feed-sub-card'); }
console.log('PART 2 OK');
