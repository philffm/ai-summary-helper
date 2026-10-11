// Phone inbox settings: overlapping renders (click + storage change + poll) never show the pairing QR twice.
import { setup, imp, tick } from './harness.mjs'; import assert from 'assert';
const { store, w } = setup({});
const { SK } = await imp('../src/modules/storageKeys.js');
const { newInboxSecrets } = await imp('../src/modules/inboxCrypto.js');
store[SK.inboxConfig] = { ...newInboxSecrets(), createdAt: 1, v: 1 };
store[SK.inboxPending] = [];
chrome.runtime.sendMessage = (m, cb) => { if (cb) { cb({}); return; } return Promise.resolve({}); };
const d = w.document;
const view = await imp('../src/modules/inboxView.js');
await view.initInboxView(); await tick(80);
const show = [...d.querySelectorAll('#phoneInboxSettings button')].find(b => /Show code/.test(b.textContent));
assert(show, 'paired: Show code button');
show.click();
// two more renders land while the first is still waiting for the pairing code
(globalThis.__chL || []).forEach(f => { f({ [SK.inboxConfig]: {} }, 'local'); f({ [SK.inboxState]: {} }, 'local'); });
await tick(150);
const root = d.getElementById('phoneInboxSettings');
assert.equal(root.querySelectorAll('.phone-inbox-qr').length, 1, 'one QR code');
assert.equal(root.querySelectorAll('.phone-inbox-actions').length, 1, 'one action row');
assert.equal([...root.querySelectorAll('button')].filter(b => /Hide code/.test(b.textContent)).length, 1);
console.log('TEST 135 OK');
