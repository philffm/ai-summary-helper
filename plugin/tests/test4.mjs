import { setup, imp, tick } from './harness.mjs';
import assert from 'assert';
const now = Date.now();
const { store, w } = setup({});
const $ = (s) => w.document.querySelector(s), $$ = (s) => [...w.document.querySelectorAll(s)];
const click = (el) => el.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
const mk = (id, t, ageH) => ({ id, feedId: 's1', title: t, link: 'https://x.test/' + id, published: now - ageH * 3600e3, snippet: 'snip ' + id, sent: 0, read: false });
store.feedSubs = [{ id: 's1', url: 'https://a/feed', title: 'Alpha', lastFetched: now }];
store.feedItems = [mk('a', 'Good news', 0.01), mk('b', 'Bad news', 0.02), mk('c', 'Meh', 0.03)];
const calls = [];
globalThis.__ai = (m) => { calls.push(m); return m.system.includes('"scores"') || m.system.includes('{"scores"')
  ? { ok: true, text: '```json\n{"scores":[0.8,-0.6,0]}\n```' }
  : { ok: true, text: 'Overview sentence one. Two.\n- Alpha: good thing\n- Alpha: bad thing\nMOOD: mixed\nLABELS: 1:Tech | 2:Politics | 3:"World News"' }; };
const toasts = [];
const uiStub = { showToast: m => toasts.push(m), showScreen() {} };
const fm = await imp('modules/feedManager.js');
fm.initFeedManager(uiStub); await tick(50); await fm.onFeedsScreenShown(uiStub); await tick(50);
const rb = $('.feed-day-ai'); assert.ok(rb, 'recap button');
click(rb); await tick(50);
assert.equal(calls.length, 1);
assert.ok(calls[0].user.includes('[1] Alpha') && calls[0].user.includes('snip'));
assert.ok($('.feed-recap-overview').textContent.startsWith('Overview'));
assert.equal($$('.feed-recap-themes li').length, 2);
assert.ok(Object.keys(store.feedRecaps).length === 1, 'cached');
assert.deepEqual(store.feedItems.map(i => i.cat), ['Tech', 'Politics', 'World News'], 'labels applied');
assert.ok(!('labels' in Object.values(store.feedRecaps)[0]), 'labels not duplicated in cache');
assert.ok($$('.feed-cat').length === 3, 'chips');
// reopen uses cache
click($('#feedSheetBody .feed-sheet-done')); click($('.feed-day-ai')); await tick(50);
assert.equal(calls.length, 1, 'cache hit');
// new item -> stale hint
store.feedItems.push(mk('d', 'New', 0.001));
await fm.onFeedsScreenShown(uiStub); await tick(50);
click($('#feedSheetBody .feed-sheet-done')); click($('.feed-day-ai')); await tick(50);
assert.ok($('.feed-recap-stale'), 'stale hint');
// score with AI from recap sheet
click($$('#feedSheetBody .feed-manage-link').find(b => b.textContent.includes('Score'))); await tick(80);
const scored = store.feedItems.filter(i => i.ai);
console.log('scored', scored.map(i => [i.id, i.sent]), toasts.slice(-2));
assert.ok(scored.length >= 3);
assert.equal(store.feedItems.find(i => i.id === 'd').sent, 0.8);
await tick(30);
const tinted = $$('.feed-item.has-mood'); assert.equal(tinted.length, 2, 'tint on non-neutral');
console.log('tint', tinted.map(t => t.style.getPropertyValue('--mood-tint')));
// no double scoring: second run makes no AI call
const before = calls.length;
click($('#feedSheetBody .feed-sheet-done')); click($('.feed-day-ai')); await tick(50);
const btnTxt = $$('#feedSheetBody .feed-manage-link').map(b => b.textContent).join('|'); console.log('after:', btnTxt);
assert.ok(/All items here are scored|Score \d+ unscored/.test(btnTxt));
assert.equal(calls.length, before);
// error path
globalThis.__ai = () => ({ ok: false, error: 'Monthly limit reached' });
click($('#feedSheetBody .feed-sheet-done'));
click($('.feed-day-ai')); await tick(50);
click($('#feedSheetBody .feed-btn')); await tick(50);
assert.ok($('.feed-error').textContent.includes('Monthly'));
console.log('TEST 4 OK');
