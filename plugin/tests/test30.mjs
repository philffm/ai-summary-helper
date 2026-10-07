import { setup, imp, tick } from './harness.mjs'; import assert from 'assert';
const { store, w } = setup({});
const iso = (d) => new Date(Date.now() - d).toISOString();
store['articles:index'] = [
 { id: 'a1', url: 'https://x.com/1', title: 'First', timestamp: iso(0), summary: '<p>one</p>', tags: [] },
 { id: 'a2', url: 'https://y.com/2', title: 'Second', timestamp: iso(1000), summary: '<p>two</p>', tags: [], readAt: iso(500) },
 { id: 'a3', url: 'https://z.com/3', title: 'Third', timestamp: iso(2000), summary: '<p>3</p>', tags: [], archived: true, archivedAt: iso(100) },
];
store['send:devices'] = [{ id: 'k1', label: 'My Kindle', type: 'kindle', addresses: ['me@kindle.com'] }];
w.fetch = globalThis.fetch = async () => ({ ok: true, json: async () => ({ success: true }) });
globalThis.MutationObserver = w.MutationObserver;
const am = await imp('modules/articleManager.js'); const ui = { showToast() {}, showScreen() {} };
am.initArticleManager(ui);
am.loadHistory(); await tick(150);
const d = w.document;
const tabs = () => [...d.querySelectorAll('.history-tab')].map(b => b.textContent);
assert.deepEqual(tabs(), ['Inbox2', 'Read1', 'Sent0', 'Archive1'], 'counts ' + tabs());
let cards = [...d.querySelectorAll('#articleList .article-card')];
assert.equal(cards.length, 2);
assert(cards[0].textContent.includes('🆕 New') && cards[1].textContent.includes('👀 Read'));
// open detail -> read
await am.showArticleDetail(store['articles:index'][0]); await tick(100);
assert(store['articles:index'][0].readAt, 'marked read on open');
// archive tab
d.querySelector('[data-tab=archive]').click(); await tick(30);
cards = [...d.querySelectorAll('#articleList .article-card')];
assert.equal(cards.length, 1); assert(cards[0].textContent.includes('🗄️ Archived'));
cards[0].querySelector('.status-restore').click(); await tick(100);
assert(!store['articles:index'][2].archived, 'restored');
d.querySelector('[data-tab=inbox]').click(); await tick(30);
assert.equal(d.querySelectorAll('#articleList .article-card').length, 3);
// bulk send kindle -> sent + archive toggle
d.getElementById('selectModeBtn').click();
[...d.querySelectorAll('#articleList .article-card')].slice(0, 2).forEach(c => c.click());
d.querySelector('.sel-send').click(); await tick(50);
[...d.querySelectorAll('.sendsheet-row:not(.sendsheet-toggle)')][0].click(); await tick(60);
[...d.querySelectorAll('.sendsheet button')].find(b => b.className.includes('primary') && b.textContent.includes('Kindle')).click(); await tick(300);
assert(store['articles:index'].filter(a => a.sentTo?.[0]?.kind === 'kindle').length === 2, 'two marked sent');
assert(d.querySelector('.sendsheet-toggle'), 'archive toggle');
d.querySelector('.sendsheet-toggle').click();
[...d.querySelectorAll('.sendsheet button')].find(b => b.textContent === 'Done').click(); await tick(150);
assert.equal(store['articles:index'].filter(a => a.archived).length, 2, 'archived after send: ' + JSON.stringify(store['articles:index'].map(a => a.archived)));
assert(d.querySelector('.undo-toast'), 'undo toast');
d.querySelector('.undo-toast-btn').click(); await tick(100);
assert.equal(store['articles:index'].filter(a => a.archived).length, 0, 'undo');
// mark as… sheet
d.getElementById('selectModeBtn').click();
[...d.querySelectorAll('#articleList .article-card')].slice(0, 1).forEach(c => c.click());
d.querySelector('.sel-more').click(); await tick(30);
const opts = [...d.querySelectorAll('.sendsheet-row:not(.sendsheet-toggle)')]; assert.equal(opts.length, 4);
opts[1].click(); await tick(100);   // Unread
assert(!store['articles:index'].find(a => a.id === 'a1').readAt, 'unread');
console.log('TEST 30 OK');
