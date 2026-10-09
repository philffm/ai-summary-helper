// In-page sidebar postMessage: the popup only takes events from its parent carrying the token from its #hash; a site framing popup.html cannot inject a summary.
import assert from 'assert';
import { JSDOM } from 'jsdom';
import { setup, imp, tick } from './harness.mjs';

// 1. the channel rules on their own
const C = await imp('modules/sidebarChannel.js');
const tok = C.newSidebarToken();
assert(/^[0-9a-f-]{36}$/.test(tok), 'uuid token');
assert.notEqual(C.newSidebarToken(), tok, 'fresh per sidebar');
assert.equal(C.sidebarTokenFromHash('#aish-sidebar=' + tok), tok, 'token read from hash');
assert.equal(C.sidebarTokenFromHash(''), '', 'no hash → no token');
assert.equal(C.sidebarTokenFromHash('#other=1'), '', 'other hash → no token');
const parent = {}, self = {};
const ev = (data, source = parent) => ({ data, source });
assert(C.acceptSidebarMessage(ev({ action: 'summaryComplete', aishSidebarToken: tok }), tok, parent, self), 'own content script accepted');
assert(!C.acceptSidebarMessage(ev({ action: 'summaryComplete' }), tok, parent, self), 'missing token rejected');
assert(!C.acceptSidebarMessage(ev({ action: 'summaryComplete', aishSidebarToken: 'guess' }), tok, parent, self), 'wrong token rejected');
assert(!C.acceptSidebarMessage(ev({ action: 'summaryComplete', aishSidebarToken: tok }, {}), tok, parent, self), 'other sender rejected');
assert(!C.acceptSidebarMessage(ev({ action: 'summaryComplete', aishSidebarToken: '' }), '', parent, self), 'popup opened without a token accepts nothing');
assert(!C.acceptSidebarMessage(ev({ action: 'x', aishSidebarToken: tok }, self), tok, self, self), 'top-level popup (no parent) accepts nothing');
assert(!C.acceptSidebarMessage(ev('summaryComplete'), tok, parent, self), 'non-object rejected');

// 2. the content script puts the token in the iframe hash and stamps relayed messages with it
const page = new JSDOM('<!doctype html><body></body>', { url: 'https://site.example/a' });
globalThis.window = page.window; globalThis.document = page.window.document; globalThis.requestAnimationFrame = (f) => setTimeout(f, 0);
globalThis.chrome = { runtime: { getURL: (p) => 'chrome-extension://abc/' + p } };
const UI = await imp('content/ui.js');
assert.equal(UI.sidebarMessage({ action: 'summaryProgress' }), null, 'no sidebar of ours → nothing posted');
UI.toggleHybridSidebar();
const frame = page.window.document.getElementById('ai-summary-hybrid-sidebar');
const hashTok = C.sidebarTokenFromHash(new URL(frame.src).hash);
assert(hashTok, 'iframe src carries a token');
assert.deepEqual(UI.sidebarMessage({ action: 'summaryProgress', chunk: 'x' }), { action: 'summaryProgress', chunk: 'x', aishSidebarToken: hashTok }, 'relay stamped with the token');

// 3. the popup itself: a forged summaryComplete is ignored, the real one renders
const { w } = setup({}); const d = w.document;
globalThis.requestAnimationFrame = (f) => setTimeout(f, 0);
w.HTMLElement.prototype.scrollIntoView = function () {};
const host = new JSDOM('<!doctype html>', { url: 'https://site.example/a' }).window;
Object.defineProperty(w, 'parent', { value: host, configurable: true });
w.location.hash = '#aish-sidebar=' + hashTok;
chrome.runtime.getURL = (p) => 'chrome-extension://abc/' + p;
chrome.tabs = { query: async () => [{ id: 7, url: 'https://site.example/a', title: 'A', favIconUrl: '' }],
  sendMessage: (id, m, cb) => cb && cb({ running: false }), onActivated: { addListener() {} }, onUpdated: { addListener() {} } };
const MS = await imp('modules/mainScreen.js');
MS.initMainScreen({ showScreen() {} });
await tick(150);
const post = (data, source) => w.dispatchEvent(new w.MessageEvent('message', { data, source }));
const summary = (text) => ({ action: 'summaryComplete', url: 'https://site.example/a', title: 'T', summary: `<div><p>${text}</p></div>`, content: '', tags: [], questions: ['Q?'] });
post(summary('FORGED no token'), host);
post({ ...summary('FORGED wrong token'), aishSidebarToken: 'nope' }, host);
post({ ...summary('FORGED other frame'), aishSidebarToken: hashTok }, new JSDOM('').window);
await tick(150);
assert(!/FORGED/.test(d.body.textContent), 'forged summaries never render');
post({ ...summary('REAL summary'), aishSidebarToken: hashTok }, host);
await tick(150);
assert(/REAL summary/.test(d.body.textContent), 'the content script summary renders');
console.log('ok');
