// loader.js (runs on every page instead of the full content script): injects only for saved highlights or a text selection, same page keys as pageKey.js.
import assert from 'assert';
import fs from 'fs';
import { JSDOM } from 'jsdom';
import { pathToFileURL } from 'url';
import path from 'path';
const SRC = process.env.AISH_SRC;
const { pageKeyForUrl } = await import(pathToFileURL(path.join(SRC, 'modules/pageKey.js')).href);
const code = fs.readFileSync(SRC + '/loader.js', 'utf8');
const tick = (ms = 15) => new Promise(r => setTimeout(r, ms));

// One page: returns what the loader sent to the background and lets the test poke storage events / mouseups.
async function page(url, { local = {}, sync = {}, injectOk = true, full = false } = {}) {
  const dom = new JSDOM('<!doctype html><body><p id="p">Some long article text to select</p></body>', { url, runScripts: 'outside-only', pretendToBeVisual: true });
  const w = dom.window;
  const sent = [], listeners = [];
  const get = (store) => (keys, cb) => { const out = {}; [].concat(keys).forEach(k => { if (k in store) out[k] = JSON.parse(JSON.stringify(store[k])); }); cb(out); };
  w.chrome = {
    runtime: { lastError: null, sendMessage(msg, cb) { sent.push(msg.action); setTimeout(() => cb && cb({ ok: injectOk }), 0); } },
    storage: { local: { get: get(local) }, sync: { get: get(sync) }, onChanged: { addListener: (f) => listeners.push(f), removeListener: () => {} } }
  };
  if (full) w.__AISH_CONTENT_LOADED = true;
  w.eval(code);
  await tick();
  return { w, sent, local, fire: (changes, area) => listeners.forEach(f => f(changes, area)) };
}

// 1. nothing saved for this page → the full script stays out
let p = await page('https://example.com/a/b', { local: { 'hl:all': [] } });
assert.deepEqual(p.sent, [], 'no annotations → no injection');
p = await page('https://example.com/a/b');
assert.deepEqual(p.sent, [], 'no annotation key at all → no injection');

// 2. highlights saved for this page → injected exactly once
p = await page('https://example.com/a/b?utm_source=x#frag', { local: { 'hl:all': [{ id: '1', url: 'https://example.com/a/b', text: 'Some', type: 'user' }] } });
assert.deepEqual(p.sent, ['aish:injectContent'], 'saved highlight → injection');

// 3. other page / dismissed / switched off / already loaded → no injection
const other = [{ id: '1', url: 'https://example.com/other', text: 'x', type: 'user' }];
assert.deepEqual((await page('https://example.com/a/b', { local: { 'hl:all': other } })).sent, [], 'highlight on another page');
const dismissed = [{ id: '1', url: 'https://example.com/a/b', text: 'x', type: 'ghost', dismissed: true }];
assert.deepEqual((await page('https://example.com/a/b', { local: { 'hl:all': dismissed } })).sent, [], 'dismissed ghost highlight');
const mine = [{ id: '1', url: 'https://example.com/a/b', text: 'x', type: 'user' }];
assert.deepEqual((await page('https://example.com/a/b', { local: { 'hl:all': mine }, sync: { userHighlightingEnabled: false, aiHighlightingEnabled: false } })).sent, [], 'both highlight switches off');
assert.deepEqual((await page('https://example.com/a/b', { local: { 'hl:all': mine }, sync: { highlightingEnabled: false } })).sent, [], 'legacy switch off');
assert.deepEqual((await page('https://example.com/a/b', { local: { 'hl:all': mine }, sync: { userHighlightingEnabled: false } })).sent, ['aish:injectContent'], 'ghost highlights still on → injection');
assert.deepEqual((await page('https://example.com/a/b', { local: { 'hl:all': mine }, full: true })).sent, [], 'full script already there');

// 4. same page keys as modules/pageKey.js (the loader copies the function)
const kp = await page('https://example.com/');
const urls = ['https://example.com/x?v=abc&utm_source=t#h', 'https://www.youtube.com/watch?v=123&t=5', 'https://www.linkedin.com/jobs/view?currentJobId=9&trk=a', 'https://example.com/', 'https://example.com:8080/a/b/?id=7&q=zzz', 'http://news.site/p?article=5&id=2',
  'https://x.org/a?item=1&story_fbid=2&pid=3&postId=4&currentJobId=5&v=6&id=7&article=8&zzz=9', 'https://x.org/a?id=', 'not a url?x=1#y', '',
  'https://archive.ph/2026.10.20-101500/https://www.nytimes.com/2026/10/20/tech/ai.html', 'https://web.archive.org/web/20261020101500/https://example.com/post?id=3',
  'https://12ft.io/https%3A%2F%2Fexample.com%2Fpost', 'https://archive.ph/AbCd1'];
for (const u of urls) assert.equal(kp.w.__AISH_LOADER.keyFor(u), pageKeyForUrl(u), 'page key parity for ' + JSON.stringify(u));
for (const u of urls.filter(x => x.startsWith('http'))) {
  const r = await page(u, { local: { 'hl:all': [{ id: 'k', url: pageKeyForUrl(u), text: 'x', type: 'user' }] } });
  assert.deepEqual(r.sent, ['aish:injectContent'], 'stored page key matches ' + u);
}

// 4b. one key per page (schema 2): the loader reads only this page's key
p = await page('https://www.youtube.com/watch?v=abc&t=3', { local: { 'hl:schema': 2, 'hl:page:https://www.youtube.com/watch?v=abc': mine.map(h => ({ ...h, url: 'https://www.youtube.com/watch?v=abc' })) } });
assert.deepEqual(p.sent, ['aish:injectContent'], 'schema 2: this page has highlights → injection');
p = await page('https://www.youtube.com/watch?v=def', { local: { 'hl:schema': 2, 'hl:page:https://www.youtube.com/watch?v=abc': mine.map(h => ({ ...h, url: 'https://www.youtube.com/watch?v=abc' })) } });
assert.deepEqual(p.sent, [], 'schema 2: another video has highlights → no injection');
p = await page('https://example.com/a/b', { local: { 'hl:schema': 2, 'hl:all': mine } });
assert.deepEqual(p.sent, [], 'schema 2: a stale old list is not read');
p = await page('https://example.com/a/b', { local: { 'hl:schema': 2 } });
p.local['hl:page:https://example.com/a/b'] = mine;
p.fire({ 'hl:page:https://example.com/other': { newValue: other } }, 'local'); await tick();
assert.deepEqual(p.sent, [], 'a change on another page is ignored');
p.fire({ 'hl:page:https://example.com/a/b': { newValue: mine } }, 'local'); await tick();
assert.deepEqual(p.sent, ['aish:injectContent'], 'a change on this page brings the highlights');
p = await page('https://archive.ph/2026.10.20-101500/https://example.com/a/b', { local: { 'hl:schema': 2, 'hl:page:https://example.com/a/b': mine } });
assert.deepEqual(p.sent, ['aish:injectContent'], 'an archive copy shows the original article\'s highlights');

// 5. highlights added later (another surface saves one) or switches turned on → injection
p = await page('https://example.com/a/b', { local: {} });
p.local['hl:all'] = mine;
p.fire({ 'hl:all': { newValue: mine } }, 'local');
await tick();
assert.deepEqual(p.sent, ['aish:injectContent'], 'storage change brings highlights to this page');

// 6. text selection: the loader draws its own toolbar and injects nothing; a toolbar button injects, then runs that action
const drag = (w, el, { from = 10, to = 80, detail = 1, select = true, target = el } = {}) => {
  if (select) w.getSelection().selectAllChildren(el);
  target.dispatchEvent(new w.MouseEvent('mousedown', { bubbles: true, clientX: from, clientY: 20, button: 0 }));
  target.dispatchEvent(new w.MouseEvent('mouseup', { bubbles: true, clientX: to, clientY: 20, button: 0, detail }));
};
const bar = (w) => { const h = w.document.getElementById('aish-sel-host'); return h && h.shadowRoot ? h.shadowRoot.querySelector('.bar') : null; };
p = await page('https://example.com/a/b');
const el = p.w.document.getElementById('p');
drag(p.w, el); await tick(30);
assert(bar(p.w), 'a dragged selection shows the toolbar');
assert.deepEqual(p.sent, [], 'selecting alone injects nothing');
let ran = null;
p.w.__AISH_SELECTION_ACTION = (which, pos) => { ran = { which, pos }; };
bar(p.w).querySelector('button[aria-label="Highlight"]').click();
for (let k = 0; k < 50 && !ran; k++) await tick(20);
assert.deepEqual(p.sent, ['aish:injectContent'], 'a toolbar button injects the full script');
assert.equal(ran && ran.which, 'highlight', 'and then runs that action on the selection');
assert(!bar(p.w), 'the toolbar is gone');

// false positives: none of these show the toolbar or inject
const none = async (label, setup) => { const q = await page('https://example.com/a/b'); await setup(q.w); await tick(30); assert(!bar(q.w), label + ': no toolbar'); assert.deepEqual(q.sent, [], label + ': no injection'); };
await none('a plain click on an old selection', (w) => drag(w, w.document.getElementById('p'), { from: 10, to: 11 }));
await none('a click without selection', (w) => { w.getSelection().removeAllRanges(); drag(w, w.document.getElementById('p'), { select: false }); });
await none('too short', (w) => { const t = w.document.getElementById('p').firstChild; const r = w.document.createRange(); r.setStart(t, 0); r.setEnd(t, 2); w.getSelection().removeAllRanges(); w.getSelection().addRange(r); drag(w, w.document.getElementById('p'), { select: false }); });
await none('selecting in a text field', (w) => { const ta = w.document.createElement('textarea'); ta.value = 'some longer text in a field'; w.document.body.append(ta); const d = w.document.createElement('div'); d.setAttribute('contenteditable', 'true'); d.textContent = 'editable text here'; w.document.body.append(d); w.getSelection().selectAllChildren(d); drag(w, d, { select: false }); });
await none('a press that started in a field', (w) => { const inp = w.document.createElement('input'); w.document.body.append(inp); w.getSelection().selectAllChildren(w.document.getElementById('p')); inp.dispatchEvent(new w.MouseEvent('mousedown', { bubbles: true, clientX: 0, clientY: 0, button: 0 })); w.document.getElementById('p').dispatchEvent(new w.MouseEvent('mouseup', { bubbles: true, clientX: 90, clientY: 20, button: 0 })); });
await none('a right click', (w) => { w.getSelection().selectAllChildren(w.document.getElementById('p')); const t = w.document.getElementById('p'); t.dispatchEvent(new w.MouseEvent('mousedown', { bubbles: true, clientX: 0, clientY: 0, button: 2 })); t.dispatchEvent(new w.MouseEvent('mouseup', { bubbles: true, clientX: 90, clientY: 0, button: 2 })); });
// a double click counts as a gesture; the same selection again after dismissing does not come back
p = await page('https://example.com/a/b');
drag(p.w, p.w.document.getElementById('p'), { from: 10, to: 10, detail: 2 }); await tick(30);
assert(bar(p.w), 'a double click selection shows the toolbar');
p.w.document.dispatchEvent(new p.w.KeyboardEvent('keydown', { key: 'Escape' }));
assert(!bar(p.w), 'Escape closes it');
drag(p.w, p.w.document.getElementById('p'), { from: 10, to: 10, detail: 2 }); await tick(30);
assert(!bar(p.w), 'the same selection does not bring it back');
p = await page('https://example.com/a/b', { sync: { userHighlightingEnabled: false, aiHighlightingEnabled: true } });
drag(p.w, p.w.document.getElementById('p')); await tick(30);
assert(!bar(p.w) && !p.sent.length, 'own highlights switched off: no toolbar');
p = await page('https://www.linkedin.com/feed/');
drag(p.w, p.w.document.getElementById('p')); await tick(30);
assert(!bar(p.w), 'a feed page: no toolbar');
p = await page('https://news.example.com/x', { sync: { highlightExcludedSites: ['example.com'] } });
drag(p.w, p.w.document.getElementById('p')); await tick(30);
assert(!bar(p.w), 'an excluded site: no toolbar');

// 7. failed injection (restricted page) is retried on the next trigger, not in a loop
p = await page('https://example.com/a/b', { local: { 'hl:all': mine }, injectOk: false });
assert.equal(p.sent.length, 1, 'one attempt per trigger');
console.log('TEST 80 OK');
