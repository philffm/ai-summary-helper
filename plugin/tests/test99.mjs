// History card chips: status (New / Read / Sent) first, then the type (research paper), then the tags.
import { setup, imp, tick } from './harness.mjs'; import assert from 'assert';
const { store, w } = setup({});
const now = new Date().toISOString();
store['articles:index'] = [
    { id: 'p1', url: 'https://x.com/1', title: 'A trial', timestamp: now, summary: '<p>one</p>', tags: ['health', 'sleep'], paper: 'yes', doi: '10.1234/abc', paperType: 'trial' },
    { id: 'p2', url: 'https://x.com/2', title: 'Read paper', timestamp: now, summary: '<p>two</p>', tags: ['lab'], paper: 'yes', paperType: 'review', readAt: now },
    { id: 'p3', url: 'https://x.com/3', title: 'Sent paper', timestamp: now, summary: '<p>three</p>', tags: ['ml'], paper: 'yes', sentTo: [{ kind: 'kindle', label: 'K', at: now }] },
];
globalThis.MutationObserver = w.MutationObserver; globalThis.IntersectionObserver = globalThis.IntersectionObserver || class { observe() {} disconnect() {} }; globalThis.ResizeObserver = globalThis.ResizeObserver || class { observe() {} disconnect() {} };
const am = await imp('modules/articleManager.js');
am.initArticleManager({ showToast() {}, showScreen() {} });
am.renderArticles(store['articles:index']); await tick(80);
const rank = { status: 0, type: 1, tag: 2 };
const kinds = (card) => [...card.querySelectorAll('.card-tags > *')].map(c => c.classList.contains('status-badge') ? 'status' : c.classList.contains('paper') ? 'type' : 'tag');
const cards = [...w.document.querySelectorAll('#articleList .article-card')];
assert.equal(cards.length, 3);
for (const c of cards) {
    const k = kinds(c);
    assert(k.includes('status') && k.includes('type') && k.includes('tag'), 'all three kinds present: ' + k);
    assert(k.every((x, i) => i === 0 || rank[k[i - 1]] <= rank[x]), 'status, then type, then tags — got: ' + k.join(' '));
}
console.log('TEST 99 OK'); process.exit(0);
