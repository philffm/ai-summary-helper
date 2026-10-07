import fs from 'fs'; import path from 'path'; import assert from 'assert';
import { setup, imp, tick, SRC } from './harness.mjs';
globalThis.fetch = async (u) => { const p = SRC + '/' + u; if (!fs.existsSync(p)) return { ok: false, status: 404 }; return { ok: true, json: async () => JSON.parse(fs.readFileSync(p, 'utf8')) }; };
const now = Date.now();
const { store, w } = setup({});
const $ = s => w.document.querySelector(s), $$ = s => [...w.document.querySelectorAll(s)];
store['feeds:subs'] = [{ id: 'a', url: 'https://a.test/f', title: 'A', tags: [], lastFetched: now }];
store['feeds:items'] = [1, 2].map(i => ({ id: 'i' + i, feedId: 'a', title: 'T' + i, link: 'https://a.test/' + i, published: now - i * 3600e3, read: false }));
const i18n = await import(path.join(SRC, 'modules/i18n.js'));
const fm = await imp('modules/feedManager.js'); const toasts = []; const ui = { showToast: m => toasts.push(m), showScreen() {} };
await i18n.applyTranslations('de');
fm.initFeedManager(ui); await tick(50); await fm.onFeedsScreenShown(ui); await tick(100);
const txt = () => $('#feedItemList').textContent;
console.log('de:', $('#feedChipRow').textContent.replace(/\s+/g, ' '), '|', $('#feedFilterChip').textContent, '|', $$('.feed-item button').map(b => b.textContent).slice(0, 4));
assert.ok(/Ungelesen/.test($('#feedChipRow').textContent), 'chip translated (static html)');
assert.ok(/Zusammenfassen|Öffnen/.test($('#feedItemList').textContent) || $$('.feed-item button').length, 'card buttons');
assert.ok(!/f_[a-z0-9_]+_[0-9a-f]{4}/.test(w.document.body.textContent), 'no raw keys visible');
assert.equal(w.document.documentElement.lang, 'de');
// switching back to English
await i18n.applyTranslations('en'); await fm.onFeedsScreenShown(ui); await tick(50);
assert.ok(/Unread/.test($('#feedChipRow').textContent));
// plural + ja
await i18n.applyTranslations('ja');
const { T, TN } = await import(path.join(SRC, 'modules/feedI18n.js'));
console.log('ja', TN(3, '{n} item', '{n} items'), T('Mark read'), T('Subscribed to {name}', { name: 'X' }));
await i18n.applyTranslations('de'); assert.equal(T('Marked {n} read', { n: 4 }), '4 als gelesen markiert'); assert.equal(T('Not translated yet {n}', { n: 2 }), 'Not translated yet 2');
console.log('TEST 11 OK');
