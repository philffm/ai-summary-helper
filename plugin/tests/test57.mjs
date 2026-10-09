// Ollama failure (HTTP 403 / unreachable) keeps the bubble and offers a link to the Ollama setup in Settings.
import assert from 'assert';
import { setup, imp, tick } from './harness.mjs';
const { w, store } = setup({}); const d = w.document;
globalThis.requestAnimationFrame = (f) => setTimeout(f, 0);
chrome.runtime.getURL = (p) => 'chrome-extension://abc/' + p;
chrome.tabs = { query: async () => [{ id: 7, url: 'https://a.example.com/x', title: 'A page', favIconUrl: '' }],
  sendMessage: (id, m, cb) => cb && cb(m.action === 'getSummaryState' ? { running: false } : { success: true }), onActivated: { addListener() {} }, onUpdated: { addListener() {} } };
const MS = await imp('modules/mainScreen.js');
const shown = [];
MS.initMainScreen({ showScreen: (s) => shown.push(s) });
await tick(60);
const send = (m) => (globalThis.__msgL || []).forEach(f => f(m));
store.connectionMode = 'local'; store.activeService = 'ollama';
send({ action: 'summaryContext', words: 500, host: 'a.example.com', highlights: 0, length: 200 });
await tick(30);
send({ action: 'summaryError', error: 'HTTP 403: Forbidden' });
await tick(80);
const hint = d.querySelector('.ollama-hint');
assert(hint, 'hint shown for Ollama 403');
assert(/OLLAMA_ORIGINS/.test(hint.textContent));
hint.querySelector('button').click(); await tick(20);
assert.deepEqual(shown.slice(-1), ['settings'], 'opens settings');
// other providers: a 403 is a key/plan problem, so the generic settings link may show, but never the Ollama advice
d.querySelectorAll('.ollama-hint').forEach(e => e.remove());
store.activeService = 'openai';
send({ action: 'summaryContext', words: 500, host: 'a.example.com', highlights: 0, length: 200 });
await tick(30);
send({ action: 'summaryError', error: 'HTTP 403: Forbidden' });
await tick(80);
const other = d.querySelector('.ollama-hint');
assert(!other || !/Ollama|OLLAMA_ORIGINS/.test(other.textContent), 'no Ollama advice for other providers');
console.log('TEST 57 OK'); process.exit(0);
