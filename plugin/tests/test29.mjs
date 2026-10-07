import { setup, imp, tick } from './harness.mjs'; import assert from 'assert';
const { store, w, sent } = setup({});
const now = new Date().toISOString();
store['articles:index'] = [
 { id: 'a1', url: 'https://x.com/1', title: 'First', timestamp: now, summary: '<p>one</p>', tags: [] },
 { id: 'a2', url: 'https://y.com/2', title: 'Second', timestamp: new Date(Date.now()-1000).toISOString(), summary: '<p>two</p>', tags: [] },
 { id: 'a3', url: 'https://z.com/3', title: 'Stub', timestamp: new Date(Date.now()-2000).toISOString(), summary: '', feedStub: true, tags: [] },
];
store['articles:rec:a1']={content:'<p>FULLTEXT-A1</p>'};
store['send:devices'] = [{ id: 'k1', label: 'My Kindle', type: 'kindle', addresses: ['me@kindle.com'] }, { id: 'l1', label: 'Pixel', type: 'localsend', addresses: ['192.168.1.5'] }];
const calls = [];
w.fetch = globalThis.fetch = async (url, o) => { calls.push({ url, body: JSON.parse(o.body) }); return { ok: true, json: async () => ({ success: true }) }; };
globalThis.MutationObserver = w.MutationObserver; globalThis.IntersectionObserver = globalThis.IntersectionObserver || class { observe(){} disconnect(){} }; globalThis.ResizeObserver = globalThis.ResizeObserver || class { observe(){} disconnect(){} };
const am = await imp('modules/articleManager.js'); const ui = { showToast() {}, showScreen() {} };
am.initArticleManager(ui);
am.renderArticles(store['articles:index']); await tick(80);
const d = w.document; const hs = d.getElementById('historyScreen');
assert(d.getElementById('selectModeBtn'), 'select btn');
d.getElementById('selectModeBtn').click(); assert(hs.classList.contains('selecting'));
const cards = [...d.querySelectorAll('#articleList .article-card')]; assert.equal(cards.length, 3);
assert(cards[2].classList.contains('not-selectable'));
cards[0].click(); cards[2].click(); cards[1].click();
assert(cards[0].classList.contains('sel-on') && cards[1].classList.contains('sel-on') && !cards[2].classList.contains('sel-on'));
assert.equal(d.querySelector('.sel-send').textContent.includes('2'), true);
d.querySelector('.sel-send').click(); await tick(50);
assert(d.querySelector('.sendsheet'), 'sheet');
const rows = [...d.querySelectorAll('.sendsheet-row:not(.sendsheet-toggle)')]; assert.equal(rows.length, 2, 'two targets');
rows[0].click(); await tick(50);
[...d.querySelectorAll('.sendsheet button')].find(b => b.textContent.includes('Kindle') && b.className.includes('primary')).click();
await tick(300);
assert.equal(calls.length, 1, 'digest = one send'); assert.equal(calls[0].body.kindle_email, 'me@kindle.com');
assert(calls[0].body.content.includes('First') && calls[0].body.content.includes('Second'));
assert(!calls[0].body.content.includes('FULLTEXT'),'summary only by default');
assert(d.querySelector('.sendsheet-done'), 'done view');
[...d.querySelectorAll('.sendsheet button')].find(b => b.className.includes('primary')).click();
assert(!d.querySelector('.sendsheet') && !hs.classList.contains('selecting') && !d.querySelector('.sel-bar'), 'closed');
// separate files via localsend path (deliver stub through sendToLocalSend → runtime message)
d.getElementById('selectModeBtn').click();
const c2 = [...d.querySelectorAll('#articleList .article-card')]; c2[0].click(); c2[1].click();
d.querySelector('.sel-send').click(); await tick(50);
[...d.querySelectorAll('.sendsheet-seg-btn')][1].click();
[...d.querySelectorAll('.sendsheet-row:not(.sendsheet-toggle)')][1].click(); await tick(50);
const devRow = d.querySelector('.sendsheet-row'); assert(devRow.textContent.includes('Pixel'));
[...d.querySelectorAll('.sendsheet button')].find(b=>b.textContent==='Back').click(); await tick(50);
[...d.querySelectorAll('.sendsheet-seg-btn')].find(b=>b.textContent.includes('full')).click();
[...d.querySelectorAll('.sendsheet-row:not(.sendsheet-toggle)')][0].click(); await tick(50);
[...d.querySelectorAll('.sendsheet button')].find(b => b.className.includes('primary') && b.textContent.includes('Kindle')).click(); await tick(300);
assert(calls.length>=2 && calls.some(c=>c.body.content.includes('FULLTEXT-A1')),'full article included');
console.log('TEST 29 OK');
