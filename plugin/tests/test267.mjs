// Read mode: Send is the extension's split button: the main part goes to the last used target (else the delivery preference),
// the ▾ opens the target menu (shared with the article detail, modules/sendSplit.js).
import { setup, imp, tick } from './harness.mjs'; import assert from 'assert'; import fs from 'fs';
const { store, w } = setup({});
const { articleRecKey } = await imp('../src/modules/storageKeys.js');
const page = fs.readFileSync(new URL('../src/readerPage.html', import.meta.url), 'utf8');
w.document.documentElement.innerHTML = page.replace(/^[\s\S]*?<html[^>]*>/i, '').replace(/<\/html>[\s\S]*$/i, '');
const url = 'https://example.com/post', stamp = new Date().toISOString();
store.deliveryPreference = 'localsend';
store['articles:index'] = [{ id: 'a1', url, title: 'T', timestamp: stamp }];
store[articleRecKey('a1')] = { id: 'a1', url, title: 'T', timestamp: stamp, summary: '<p>S</p>', content: '<p>Body text of the article.</p>' };
w.location.hash = '#id=a1';
await imp('../src/readerPage.js'); await tick(250);
const d = w.document;
assert(!d.getElementById('rpSend').hidden, 'Send is shown');
assert(/LocalSend/.test(d.getElementById('rpSendMain').textContent), 'first use: the delivery preference is the main target');
assert(!d.getElementById('rpShare') && !d.getElementById('rpSendGroup'), 'no separate Share button: it lives in the ▾ menu');
d.getElementById('rpSendMore').click(); await tick(200);
const menu = [...d.querySelectorAll('.card-menu-item')].map((b) => b.textContent);
assert(menu.some((t) => /Send to Kindle/.test(t)) && menu.some((t) => /LocalSend/.test(t)), 'targets listed: ' + menu.join(' | '));
assert(menu.some((t) => /Share…/.test(t)) && menu.some((t) => /Copy link/.test(t)), 'Share and Copy link follow');
console.log('TEST 267 OK');
