// Highlight page keys: normalising keeps content parameters (?v=, ?id=, currentJobId), field order never forces a rewrite, the context-menu clear matches page keys.
import assert from 'assert';
import { JSDOM } from 'jsdom';
import path from 'path';
import { pathToFileURL } from 'url';
const SRC = process.env.AISH_SRC;
const imp = (rel) => import(pathToFileURL(path.join(SRC, rel)).href + '?t=' + Math.random());
const tick = (ms = 20) => new Promise((r) => setTimeout(r, ms));

// 1. pure normaliser
const R = await imp('modules/highlightRecords.js');
const keep = R.normalizeHighlights([
  { id: 'a', url: 'https://www.youtube.com/watch?v=abc123', text: ' hi  there ', type: 'user', timestamp: 't' },
  { id: 'b', url: 'https://news.ycombinator.com/item?id=1', text: 'x', type: 'ghost', timestamp: 't' },
  { id: 'c', url: 'https://www.linkedin.com/jobs/view/?currentJobId=42&trk=z', text: 'y', type: 'user', timestamp: 't' },
  { id: 'd', url: 'https://example.com/post?utm_source=x#frag', text: 'z', type: 'user', timestamp: 't' },
  { id: 'e', url: '', text: 'no page' }, null,
]);
assert.deepEqual(keep.map((h) => h.url), [
  'https://www.youtube.com/watch?v=abc123', 'https://news.ycombinator.com/item?id=1',
  'https://www.linkedin.com/jobs/view/?currentJobId=42', 'https://example.com/post',
], 'content parameters stay, tracking parameters go');
assert.equal(keep[0].text, 'hi there');
const stored = [{ id: 'a', url: 'https://www.youtube.com/watch?v=abc123', text: 'hi', type: 'user', timestamp: 't', v: 2, quote: { exact: 'hi', prefix: 'p', suffix: 's' }, pos: 3 }];
assert.equal(R.needsRewrite(stored, R.normalizeHighlights(stored)), false, 'same content in another field order: no rewrite');
assert.equal(R.needsRewrite({ 'https://x.com/a': ['old'] }, R.normalizeHighlights({ 'https://x.com/a': ['old'] })), true, 'old object shape is rewritten');
assert.equal(R.needsRewrite(undefined, []), false, 'nothing stored: nothing to write');

// 2. the page script on a page whose key has a content parameter
const dom = new JSDOM('<!doctype html><body><article><p>Analysts say the market will cool in autumn and rates stay high.</p></article></body>', { url: 'https://news.ycombinator.com/item?id=1&utm_source=feed', pretendToBeVisual: true });
const w = dom.window;
for (const k of ['window', 'document', 'DOMParser', 'CustomEvent', 'Event', 'HTMLElement', 'Node', 'NodeFilter', 'Range', 'Text', 'Element', 'MutationObserver', 'getComputedStyle']) { try { globalThis[k] = k === 'window' ? w : w[k]; } catch (_) { /* read-only */ } }
Object.defineProperty(globalThis, 'navigator', { value: w.navigator, configurable: true });
Object.defineProperty(globalThis, 'location', { value: w.location, configurable: true });
globalThis.requestIdleCallback = (f) => setTimeout(f, 0);
const store = {};
let writes = 0;
const area = {
  get(keys, cb) { const out = {}; [].concat(keys).forEach((k) => { if (k in store) out[k] = JSON.parse(JSON.stringify(store[k])); }); if (cb) cb(out); return Promise.resolve(out); },
  set(obj, cb) { writes++; Object.entries(obj).forEach(([k, v]) => { store[k] = JSON.parse(JSON.stringify(v)); }); if (cb) cb(); return Promise.resolve(); },
  remove(keys, cb) { [].concat(keys).forEach((k) => delete store[k]); if (cb) cb(); return Promise.resolve(); },
};
const sent = [];
globalThis.chrome = { storage: { local: area, sync: area, onChanged: { addListener() {} } }, runtime: { id: 'x', lastError: null, sendMessage(m, cb) { sent.push(m); if (cb) setTimeout(() => cb({ ok: true }), 0); return Promise.resolve({ ok: true }); }, onMessage: { addListener() {} } } };

const H = await imp('content/highlighter.js');
H.setHighlightingEnabled(true, true);
const t = w.document.querySelector('article p').firstChild;
const at = t.nodeValue.indexOf('the market');
const r = w.document.createRange(); r.setStart(t, at); r.setEnd(t, at + 10);
assert(H.applyHighlightFromRange(r, 'the market'), 'highlight created');
await tick(40);
assert.equal(store['hl:all'].length, 1);
assert.equal(store['hl:all'][0].url, 'https://news.ycombinator.com/item?id=1', 'saved under the page key with ?id=');

// what used to happen: the next read cut the query, the restore no longer found the highlight and unpainted it
H.clearHighlightElements();
H.restoreAnnotations(); await tick(80);
assert.equal(store['hl:all'][0].url, 'https://news.ycombinator.com/item?id=1', 'a read keeps the page key');
assert.equal(w.document.querySelectorAll('mark.ai-user-highlight').length, 1, 'the highlight is painted again after a restore');

// a read of an unchanged list writes nothing
const before = writes;
H.restoreAnnotations(); await tick(80);
assert.equal(writes, before, 'restoring an unchanged list does not rewrite it');

// 3. context-menu clear: matches this page (despite utm_source), leaves other pages
store['hl:all'].push({ id: 'other', url: 'https://news.ycombinator.com/item?id=2', text: 'keep me', type: 'user', timestamp: 't' });
await new Promise((res) => H.clearPageHighlights(res));
assert.deepEqual(store['hl:all'].map((h) => h.id), ['other'], 'only this page cleared');
assert(sent.some((m) => m.action === 'syncHlDeleted' && m.ids.length === 1), 'deletion reported for sync');
console.log('TEST 250 OK');
