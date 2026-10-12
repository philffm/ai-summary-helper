// Reader page: Share and the preferred delivery (LocalSend or Kindle) work like in the article's detail view.
import { setup, imp, tick } from './harness.mjs'; import assert from 'assert'; import fs from 'fs';
const { store, w } = setup({});
const { SK, articleRecKey } = await imp('../src/modules/storageKeys.js');
const page = fs.readFileSync(new URL('../src/readerPage.html', import.meta.url), 'utf8');
w.document.documentElement.innerHTML = page.replace(/^[\s\S]*?<html[^>]*>/i, '').replace(/<\/html>[\s\S]*$/i, '');
globalThis.File = w.File;
const url = 'https://example.com/post';
const art = { id: 'a1', url, title: 'Reader send test', timestamp: new Date().toISOString(), summary: '<p>Short summary</p>', content: '<p>Full text of the article.</p>' };
store['articles:index'] = [{ id: 'a1', url, title: art.title, timestamp: art.timestamp }];
store[articleRecKey('a1')] = art;
store.deliveryPreference = 'localsend';
store['send:devices'] = [{ id: 'l1', label: 'Pixel', type: 'localsend', addresses: ['192.168.1.5'] }];
const sent = [];
chrome.runtime.sendMessage = (m, cb) => {
  sent.push(m);
  const r = m.action === 'sendLocalSendP2P' ? { success: true, ok: true, status: 200, data: { sessionId: 's1', files: {} } } : {};
  if (cb) { cb(r); return; } return Promise.resolve(r);
};
const shared = [];
Object.defineProperty(w.navigator, 'share', { configurable: true, value: async (d) => { shared.push(d); } });
w.location.hash = '#id=a1';
await imp('../src/readerPage.js'); await tick(250);
const d = w.document;
const group = d.getElementById('rpSendGroup');
assert(group && !group.hidden, 'send group is visible for a stored article');
assert(!d.getElementById('rpShare').hidden, 'Share is offered when the browser can share');
assert.equal(d.getElementById('rpSend').textContent, 'LocalSend', 'the preferred delivery is labelled');

// LocalSend: sends the article document to the configured receiver, tells the reader
d.getElementById('rpSend').click(); await tick(400);
const ls = sent.filter(m => m.action === 'sendLocalSendP2P');
assert(ls.length >= 2 && ls.every(m => /192\.168\.1\.5/.test(m.targetUrl)), 'prepare + upload went to the receiver');
const toast = d.getElementById('rpToast');
assert(!toast.hidden && /Sent successfully/.test(toast.textContent), 'toast: ' + toast.textContent);
assert(!d.getElementById('rpSend').disabled, 'button usable again');

// Share
d.getElementById('rpShare').click(); await tick(300);
assert.equal(shared.length, 1, 'native share was used');
assert.equal(shared[0].title, 'Reader send test');

console.log('TEST 144 OK');
