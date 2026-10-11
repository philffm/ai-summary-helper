// Opening History checks the phone inbox (when paired), not only the background alarm; hopping between screens does not
// hit the server each time, and nothing happens without a pairing.
import { setup, imp, tick, SRC } from './harness.mjs'; import assert from 'assert'; import path from 'path'; import { pathToFileURL } from 'url';
const { store, w } = setup({});
const { SK } = await imp('../src/modules/storageKeys.js');
const { newInboxSecrets } = await imp('../src/modules/inboxCrypto.js');
chrome.runtime.sendMessage = (m, cb) => { if (cb) { cb({}); return; } return Promise.resolve({}); };
let gets = 0;
globalThis.fetch = async (url, opts) => {
  if ((opts && opts.method || 'GET') === 'GET' && /\/items\?/.test(String(url))) gets++;
  return { status: 200, json: async () => ({ items: [], hasMore: false }) };
};
const view = await import(pathToFileURL(path.join(SRC, 'modules/inboxView.js')).href);
const am = await import(pathToFileURL(path.join(SRC, 'modules/articleManager.js')).href);
for (const k of ['MutationObserver']) globalThis[k] = w[k];
am.initArticleManager({ showToast() {}, showScreen() {} });
store['articles:index'] = [];

// not paired: nothing is asked
let r = await view.pollInbox(); assert.deepEqual(r, { skipped: 'not-paired' }); assert.equal(gets, 0);
am.loadHistory(); await tick(300); assert.equal(gets, 0, 'History does not poll without a pairing');

// paired: opening History polls
store[SK.inboxConfig] = { ...newInboxSecrets(), createdAt: 1, v: 1 };
am.loadHistory(); await tick(400);
assert.equal(gets, 1, 'opening History checked the inbox');
// again right away: the recent check is enough
am.loadHistory(); await tick(300);
assert.equal(gets, 1, 'not again within the gap');
assert.deepEqual(await view.pollInbox(), { skipped: 'recent' });
// after the gap it checks again
store[SK.inboxState] = { ...store[SK.inboxState], lastPollAt: Date.now() - 60000 };
am.loadHistory(); await tick(400);
assert.equal(gets, 2, 'a check older than the gap is repeated');
console.log('TEST 143 OK');
