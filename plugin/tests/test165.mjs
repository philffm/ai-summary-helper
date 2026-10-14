// Storage hint: which big, long-unopened articles could go (pure helpers) and the sheet.
import { setup, imp, tick } from './harness.mjs'; import assert from 'assert';
const { w } = setup({});
globalThis.document = w.document; globalThis.window = w;
const H = await imp('modules/storageHealth.js');
const now = new Date('2026-10-13T12:00:00Z').getTime();
const day = 86400000;
const iso = (d) => new Date(now - d * day).toISOString();
const big = (id, words, ago, extra = {}) => ({ id, title: id, contentWordCount: words, summary: 'x'.repeat(500), timestamp: iso(ago), ...extra });
const index = [
    big('old-big', 40000, 200), big('old-bigger', 90000, 400), big('old-small', 100, 300), big('recent-big', 80000, 5),
    big('old-star', 60000, 300, { favorite: true }), big('old-coll', 60000, 300), big('opened-recently', 70000, 400, { lastOpened: iso(3) }),
    big('stub', 70000, 500, { feedStub: true }),
];
const r = H.reclaimCandidates(index, { now, keep: new Set(['old-coll']) });
assert.deepEqual(r.list.map(x => x.id), ['old-bigger', 'old-big'], 'big and long unopened, biggest first; small, recent, starred, in a collection, stubs are not offered');
assert.equal(r.kept, 2, 'starred and collection articles are counted as protected');
assert.ok(r.list[0].bytes > r.list[1].bytes && r.list[0].days >= 400);
assert.equal(H.healthLevel({ totalBytes: 1e6, indexBytes: 1e6 }), 'ok');
assert.equal(H.healthLevel({ totalBytes: 1e6, indexBytes: 6 * 1024 * 1024 }), 'heavy');
assert.equal(H.healthLevel({ totalBytes: 200 * 1024 * 1024, indexBytes: 0 }), 'heavy');
assert.equal(H.formatBytes(500), '1 KB'); assert.equal(H.formatBytes(1.5 * 1024 * 1024), '1.5 MB');
assert.equal(H.daysUnopened({}, now), Infinity);

// sheet: nothing pre-selected, delete only what is ticked
const deleted = [];
await H.openStorageSheet({ report: { totalBytes: 9e6, candidates: r }, deleteIds: async (ids) => { deleted.push(...ids); }, onDone: () => {} });
await tick(20);
const sheet = w.document.querySelector('.storage-sheet');
assert.ok(sheet, 'sheet open');
const rows = [...sheet.querySelectorAll('.sendsheet-row')];
assert.equal(rows.length, 2); assert.ok(rows.every(x => x.getAttribute('aria-checked') === 'false'), 'nothing is pre-selected');
const action = [...sheet.querySelectorAll('button')].find(b => b.classList.contains('button-primary'));
assert.ok(action.disabled, 'delete is disabled until something is ticked');
rows[1].click();
assert.ok(!action.disabled);
w.confirm = () => true; globalThis.window.confirm = () => true;
action.click(); await tick(40);
assert.deepEqual(deleted, ['old-big'], 'only the ticked article is deleted');
assert.ok(!w.document.querySelector('.storage-sheet'), 'sheet closes');
console.log('ok');

// Long lists render in batches while scrolling; a search renders everything first
{
    const AM = await imp('modules/articleManager.js');
    const observers = [];
    globalThis.IntersectionObserver = class { constructor(cb) { this.cb = cb; this.el = null; observers.push(this); } observe(e) { this.el = e; } unobserve() { this.el = null; } disconnect() { this.el = null; } };
    const d = w.document;
    d.body.innerHTML = '<input id="searchInput"><div id="historyTopBar"></div><ul id="articleList"></ul>';
    const list = d.getElementById('articleList');
    const arts = Array.from({ length: 100 }, (_, i) => ({ id: 'l' + i, title: 'Article ' + i, url: 'https://x.test/' + i, timestamp: new Date(2026, 0, 1 + i).toISOString(), tags: [], summary: '<p>s</p>' }));
    AM.renderArticles(arts); await tick(30);
    assert.equal(list.querySelectorAll('li.article-card').length, 30, 'only the first screens are built');
    observers.at(-1).cb([{ isIntersecting: true }]);
    assert.equal(list.querySelectorAll('li.article-card').length, 70, 'the next batch loads when the end is reached');
    observers.at(-1).cb([{ isIntersecting: true }]); observers.at(-1).cb([{ isIntersecting: true }]);
    assert.equal(list.querySelectorAll('li.article-card').length, 100, 'everything loaded in the end');
    assert.ok(!list.querySelector('.list-sentinel') && !list.__lazy, 'the sentinel is gone');
    AM.renderArticles(arts); await tick(30);
    assert.equal(list.querySelectorAll('li.article-card').length, 30, 'a re-render starts small again');
    d.getElementById('searchInput').value = 'Article 9';
    AM.filterArticles(); await tick(30);
    assert.equal(list.querySelectorAll('li.article-card').length, 100, 'a search renders every card before filtering');
    assert.equal([...list.querySelectorAll('li.article-card')].filter(c => c.style.display !== 'none').length > 0, true);
}

// Resize performance: list cards have no backdrop blur and are skipped off screen; resizing switches blurs off
{
    const fs = await import('fs');
    const css = fs.readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');
    assert.ok(/\.article-card \{[^}]*backdrop-filter: none[^}]*content-visibility: auto/.test(css), 'cards: no blur, content-visibility');
    assert.ok(/body\.is-resizing[^{]*\{[^}]*backdrop-filter: none !important/.test(css), 'resizing turns the blurs off');
    const js = fs.readFileSync(new URL('../src/popup.js', import.meta.url), 'utf8');
    assert.ok(/classList\.add\('is-resizing'\)/.test(js) && /classList\.remove\('is-resizing'\)/.test(js), 'popup.js toggles is-resizing');
}
