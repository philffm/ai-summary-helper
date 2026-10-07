import { setup, imp, tick } from './harness.mjs'; import assert from 'assert';
const { store, w } = setup({});
const ex = await imp('modules/annotationExporter.js');
const ann = [{ text: 'agents lose context between sessions', type: 'ghost', url: 'https://x.com/1' }, { text: 'queryable memory', type: 'user', url: 'https://x.com/1' }];
let out = ex.markHighlights('<p>Long-running <b>agents</b> lose  context between sessions. A small, queryable memory helps.</p>', ann);
assert(out.includes('#cfe3ff') && out.includes('#fff3a3'), 'both colours: ' + out);
assert(/<mark[^>]*>agents<\/mark>/.test(out) || out.includes('<mark'), 'marked across <b>');
assert.equal(ex.markHighlights('<p>nothing</p>', ann), '<p>nothing</p>');
const now = new Date().toISOString();
store.articlesIndex = [
 { id: 'a1', url: 'https://x.com/1?utm=1', title: 'First', timestamp: now, summary: '<p>one</p>', tags: [] },
 { id: 'a2', url: 'https://y.com/2', title: 'Second', timestamp: new Date(Date.now()-1000).toISOString(), summary: '<p>two</p>', tags: [] },
];
store['article:a1'] = { content: '<p>Long-running agents lose context between sessions. Rest.</p>' };
store.annotations = ann;
store.devices = [{ id: 'k1', label: 'K', type: 'kindle', addresses: ['me@kindle.com'] }];
const calls = [];
w.fetch = globalThis.fetch = async (u, o) => { calls.push(JSON.parse(o.body)); return { ok: true, json: async () => ({ success: true }) }; };
globalThis.MutationObserver = w.MutationObserver;
const am = await imp('modules/articleManager.js'); am.initArticleManager({ showToast() {}, showScreen() {} });
am.loadHistory(); await tick(150);
const d = w.document;
const run = async (full) => {
  d.getElementById('selectModeBtn').click();
  [...d.querySelectorAll('#articleList .article-card')].forEach(c => c.click());
  d.querySelector('.sel-send').click(); await tick(60);
  if (full) [...d.querySelectorAll('.sendsheet-seg-btn')].find(b => b.textContent.includes('full')).click();
  [...d.querySelectorAll('.sendsheet-row:not(.sendsheet-toggle)')][0].click(); await tick(60);
  [...d.querySelectorAll('.sendsheet button')].find(b => b.className.includes('primary') && b.textContent.includes('Kindle')).click(); await tick(400);
  [...d.querySelectorAll('.sendsheet button')].find(b => b.textContent === 'Done').click(); await tick(60);
};
await run(false);
let c = calls[0].content;
assert(c.includes('AI Suggested Highlights') && c.includes('<mark') && c.includes('agents lose context between sessions'), 'summary digest has highlights list');
await run(true);
c = calls[1].content;
assert(/<mark[^>]*>agents lose context between sessions<\/mark>/.test(c), 'full digest marks inline: ' + c.slice(0, 600));
console.log('TEST 32 OK');
