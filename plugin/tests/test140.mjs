// Phone links get the page's real title/description once the page is open: the loader reports it, the background
// applies it to the waiting entry (only for that page itself), and the card shows it.
import { setup, imp, tick } from './harness.mjs'; import assert from 'assert'; import fs from 'fs'; import path from 'path'; import { pathToFileURL } from 'url'; import { JSDOM } from 'jsdom';
const SRC = process.env.AISH_SRC;

// 1. applyLinkMeta (background side)
const M = await import(pathToFileURL(path.join(SRC, 'modules/inboxManager.js')).href);
const list = [{ id: 'a', url: 'https://example.com/post?utm_source=x' }, { id: 'b', url: 'https://example.com/other' }];
assert.equal(M.applyLinkMeta(list, 'https://example.com/post', { url: 'https://example.com/post', title: '  A  real\ntitle ', description: 'D'.repeat(500) }), true);
assert.equal(list[0].title, 'A real title');
assert.equal(list[0].description.length, 300);
assert.equal(list[1].title, undefined, 'another page is untouched');
assert.equal(M.applyLinkMeta(list, 'https://evil.example/', { url: 'https://example.com/post', title: 'spoof' }), false, 'a page may only describe itself');
assert.equal(M.applyLinkMeta(list, 'https://example.com/post', { url: 'https://example.com/post', title: 'A real title' }), false, 'no change, no write');
assert(/applyLinkMeta/.test(fs.readFileSync(path.join(SRC, 'modules/inboxBackgroundBundle.js'), 'utf8')), 'exposed to the classic-script background');
assert(/inboxMeta/.test(fs.readFileSync(path.join(SRC, 'background.js'), 'utf8')));

// 2. loader.js reports it
const code = fs.readFileSync(SRC + '/loader.js', 'utf8');
async function page(url, html, local) {
  const dom = new JSDOM(html, { url, runScripts: 'outside-only', pretendToBeVisual: true });
  const w = dom.window, sent = [];
  const get = (store) => (keys, cb) => { const out = {}; [].concat(keys).forEach(k => { if (k in store) out[k] = JSON.parse(JSON.stringify(store[k])); }); cb(out); };
  w.chrome = { runtime: { lastError: null, sendMessage(msg, cb) { sent.push(msg); if (cb) setTimeout(() => cb({ ok: true }), 0); return Promise.resolve({ ok: true }); } },
    storage: { local: { get: get(local) }, sync: { get: get({}) }, onChanged: { addListener() {}, removeListener() {} } } };
  w.eval(code); await tick(30);
  return sent;
}
const html = '<!doctype html><head><title>Fallback title</title><meta property="og:title" content="The real headline"><meta name="description" content="Plain description"></head><body><p>x</p></body>';
let sent = await page('https://example.com/post?ref=tw', html, { 'inbox:pending': [{ id: 'a', url: 'https://example.com/post' }] });
const meta = sent.find(m => m.action === 'inboxMeta');
assert(meta, 'reported');
assert.equal(meta.title, 'The real headline'); assert.equal(meta.description, 'Plain description');
sent = await page('https://example.com/not-waiting', html, { 'inbox:pending': [{ id: 'a', url: 'https://example.com/post' }] });
assert(!sent.some(m => m.action === 'inboxMeta'), 'pages that do not wait in the inbox report nothing');
sent = await page('https://example.com/post', html, {});
assert(!sent.some(m => m.action === 'inboxMeta'), 'nothing waiting: nothing sent');

// 3. the card shows it
const { store, w } = setup({});
const { SK } = await imp('../src/modules/storageKeys.js');
store[SK.inboxPending] = [{ id: 'p1', url: 'https://example.com/post', receivedAt: Date.now(), title: 'The real headline', description: 'Plain description' }];
chrome.runtime.sendMessage = (m, cb) => { if (cb) { cb({}); return; } return Promise.resolve({}); };
const view = await import(pathToFileURL(path.join(SRC, 'modules/inboxView.js')).href);
await view.loadPhoneEntries();
const ul = w.document.getElementById('articleList');
view.mountPhoneCards(ul);
assert.equal(ul.querySelector('.phone-card h4').textContent, 'The real headline');
assert.equal(ul.querySelector('.phone-card .phone-card-desc').textContent, 'Plain description');
console.log('TEST 140 OK');
