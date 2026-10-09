// Background: actions that spend the AI key or fetch for the extension answer only extension pages, never content scripts.
import assert from 'assert'; import fs from 'fs'; import vm from 'vm';
const src = fs.readFileSync(process.env.AISH_SRC + '/background.js', 'utf8');
// Any chrome.* API is a callable no-op; only runtime.onMessage is captured.
let onMessage = null;
const any = () => new Proxy(function () {}, { get: (t, k) => (k === 'then' ? undefined : any()), apply: () => any() });
const chrome = new Proxy({}, { get: (t, k) => k === 'runtime' ? new Proxy({}, {
  get: (_, r) => r === 'id' ? 'ext-id' : r === 'getURL' ? (p) => 'chrome-extension://ext-id/' + p : r === 'onMessage' ? { addListener: (f) => { onMessage = f; } } : any()
}) : any() });
const sandbox = { chrome, console: { ...console, log() {}, warn() {} }, setTimeout, clearTimeout, setInterval() {}, fetch: async () => { throw new Error('no network in test'); }, AbortController, URL, crypto: globalThis.crypto };
sandbox.globalThis = sandbox; sandbox.self = sandbox;
vm.createContext(sandbox); vm.runInContext(src, sandbox);
assert(onMessage, 'message listener registered');
const call = (msg, sender) => new Promise((res) => { let done = false; const keep = onMessage(msg, sender, (r) => { done = true; res(r); }); if (!keep && !done) res(undefined); setTimeout(() => res('pending'), 50); });

const page = { id: 'ext-id', url: 'https://evil.example/', tab: { id: 3 } };
const popup = { id: 'ext-id', url: 'chrome-extension://ext-id/popup.html' };
const sidebar = { id: 'ext-id', url: 'chrome-extension://ext-id/popup.html#aish-sidebar=x', tab: { id: 3 } };
for (const action of ['aiComplete', 'fetchFeedText', 'openFeedItem', 'sendLocalSendP2P', 'relayToActiveTab']) {
  const r = await call({ action, user: 'x', url: 'https://a.example/', message: {} }, page);
  assert(r && r.ok === false && /Not allowed/.test(r.error), action + ' refused for a content script: ' + JSON.stringify(r));
  const other = await call({ action, user: 'x', url: 'https://a.example/', message: {} }, { ...popup, id: 'other-ext' });
  assert(other && /Not allowed/.test(other.error), action + ' refused for another extension');
}
for (const sender of [popup, sidebar, { id: 'ext-id' }]) {
  const r = await call({ action: 'fetchFeedText', url: 'https://a.example/feed' }, sender);
  assert(!(r && /Not allowed/.test(r.error || '')), 'extension page allowed: ' + JSON.stringify(sender) + ' → ' + JSON.stringify(r));
}
// content-script actions keep working from pages
const w = await call({ action: 'wakeup' }, page);
assert.deepEqual(w, { status: 'awake' }, 'wakeup from a page');
console.log('ok');
