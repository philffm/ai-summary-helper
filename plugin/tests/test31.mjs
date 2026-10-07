import { setup, imp, tick } from './harness.mjs'; import assert from 'assert';
const { store, w } = setup({});
const now = new Date().toISOString();
store['articles:index'] = [
 { id: 'a1', url: 'https://x.com/1', title: 'First', timestamp: now, summary: '<p>one about agents</p>', tags: [] },
 { id: 'a2', url: 'https://y.com/2', title: 'Second', timestamp: new Date(Date.now()-1000).toISOString(), summary: '<p>two about memory</p>', tags: [] },
];
store['send:devices'] = [{ id: 'k1', label: 'My Kindle', type: 'kindle', addresses: ['me@kindle.com'] }];
const calls = []; let aiPrompt = null;
w.fetch = globalThis.fetch = async (url, o) => { calls.push(JSON.parse(o.body)); return { ok: true, json: async () => ({ success: true }) }; };
globalThis.__ai = (msg) => { aiPrompt = msg; return { ok: true, text: '"Two pieces on agents and memory."' }; };
globalThis.MutationObserver = w.MutationObserver;
const am = await imp('modules/articleManager.js'); am.initArticleManager({ showToast() {}, showScreen() {} });
am.loadHistory(); await tick(150);
const d = w.document;
d.getElementById('selectModeBtn').click();
[...d.querySelectorAll('#articleList .article-card')].forEach(c => c.click());
d.querySelector('.sel-send').click(); await tick(60);
const tg = d.querySelector('.sendsheet-intro .sendsheet-toggle'); assert(tg, 'toggle visible for digest');
assert(!d.querySelector('.sendsheet-intro .sendsheet-seg'), 'chips hidden while off');
tg.click(); assert(d.querySelector('.sendsheet-intro .sendsheet-seg'), 'chips when on');
[...d.querySelectorAll('.sendsheet-intro .sendsheet-seg-btn')].find(b => b.textContent === 'Short').click();
[...d.querySelectorAll('.sendsheet-seg-btn')].find(b => b.textContent.includes('Separate')).click();
assert(!d.querySelector('.sendsheet-intro .sendsheet-toggle'), 'hidden for separate files');
[...d.querySelectorAll('.sendsheet-seg-btn')].find(b => b.textContent.includes('One digest')).click();
assert(d.querySelector('.sendsheet-intro .sendsheet-toggle.on'), 'state kept');
[...d.querySelectorAll('.sendsheet-row')].find(r => r.textContent.includes('Kindle')).click(); await tick(60);
[...d.querySelectorAll('.sendsheet button')].find(b => b.className.includes('primary') && b.textContent.includes('Kindle')).click(); await tick(400);
assert(aiPrompt && aiPrompt.system.includes('exactly one sentence'), 'short style in prompt');
assert(aiPrompt.user.includes('First') && aiPrompt.user.includes('one about agents'), 'summaries sent');
assert(calls.length === 1 && calls[0].content.includes('Two pieces on agents and memory.') && calls[0].content.includes('aish-intro'), 'intro in digest');
assert(!calls[0].content.includes('"Two'), 'quotes stripped');
// AI failure -> sent without intro
globalThis.__ai = () => ({ ok: false, error: 'no ai' });
[...d.querySelectorAll('.sendsheet button')].find(b => b.textContent === 'Done').click(); await tick(50);
d.getElementById('selectModeBtn').click();
[...d.querySelectorAll('#articleList .article-card')].forEach(c => c.click());
d.querySelector('.sel-send').click(); await tick(60);
d.querySelector('.sendsheet-intro .sendsheet-toggle') && 0;
[...d.querySelectorAll('.sendsheet-row')].find(r => r.textContent.includes('Kindle')).click(); await tick(60);
[...d.querySelectorAll('.sendsheet button')].find(b => b.className.includes('primary') && b.textContent.includes('Kindle')).click(); await tick(400);
assert(calls.length === 2 && !calls[1].content.includes('aish-intro') , 'fallback without intro');
assert([...d.querySelectorAll('.sendsheet-note')].some(x => x.textContent.includes('Intro skipped')), 'skipped notice');
console.log('TEST 31 OK');
