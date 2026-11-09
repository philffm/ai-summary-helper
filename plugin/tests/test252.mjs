// hl:apply from a page's content script: the page comes from the sending tab (never from the message), malformed or sync-only ops are refused, removals get a sync deletion marker.
import assert from 'assert';
import path from 'path';
import { pathToFileURL } from 'url';
const SRC = process.env.AISH_SRC;
const imp = (rel) => import(pathToFileURL(path.join(SRC, rel)).href);
const { createHighlightMessages, cleanOps, senderPage } = await imp('modules/highlightMessages.js');
const { pageKeyForUrl } = await imp('modules/pageKey.js');

const calls = [];
const deleted = [];
const store = { async apply(ops) { calls.push(ops); return { added: ops.filter((o) => o.op === 'add').map((o) => o.hl.id), removed: ops.filter((o) => o.op === 'remove').map((o) => o.id), changed: true }; } };
const m = createHighlightMessages({ store, markDeleted: (ids) => deleted.push(...ids) });
const tab = (url) => ({ tab: { url } });

assert.equal(senderPage(tab('https://news.ycombinator.com/item?id=1&utm_source=x')), 'https://news.ycombinator.com/item?id=1');
assert.equal(senderPage(tab('file:///Users/me/paper.pdf')), pageKeyForUrl('file:///Users/me/paper.pdf'), 'local files can hold highlights (same key the page script computes)');
assert.equal(senderPage(tab('chrome://settings')), '');
assert.equal(senderPage({}), '');

// the page in the message is ignored: the op lands on the sender's page
let r = await m.handle({ action: 'hl:apply', ops: [{ op: 'add', hl: { id: 'h1', url: 'https://other.site/x', text: 'hi', type: 'user', onclick: 'x' } }] }, tab('https://example.com/a?utm=1'));
assert.equal(r.ok, true);
assert.deepEqual(calls[0][0].hl, { url: 'https://example.com/a', id: 'h1', text: 'hi', type: 'user' }, 'url from the tab, unknown fields dropped');
r = await m.handle({ action: 'hl:apply', ops: [{ op: 'clearPage', page: 'https://other.site/x' }] }, tab('https://example.com/a'));
assert.equal(calls[1][0].page, 'https://example.com/a');

// refused
const refused = async (ops, sender = tab('https://example.com/a')) => assert.equal((await m.handle({ action: 'hl:apply', ops }, sender)).ok, false, JSON.stringify(ops));
await refused([{ op: 'upsert', hl: { id: 'x', text: 'y' } }]);
await refused([{ op: 'removeId', id: 'x' }]);
await refused([{ op: 'add', hl: { text: 'no id' } }]);
await refused([{ op: 'remove', id: 'bad id!' }]);
await refused([]);
await refused(Array.from({ length: 201 }, () => ({ op: 'clearPage' })));
await refused([{ op: 'add', hl: { id: 'h2', text: 'x' } }], tab('chrome-extension://abc/popup.html'));
assert.equal(calls.length, 2, 'nothing refused reached the store');

// removals → sync deletion markers
await m.handle({ action: 'hl:apply', ops: [{ op: 'remove', id: 'h1' }] }, tab('https://example.com/a'));
assert.deepEqual(deleted, ['h1']);

// patch: by id, or by text + type for a highlight saved before ids existed; a patch cannot move the highlight to another page
const p = cleanOps([{ op: 'patch', id: 'h1', patch: { url: 'https://evil/x', quote: { exact: 'a', prefix: 'b', suffix: 'c' }, pos: 3, v: 2 } }, { op: 'patch', text: 'old', type: 'user', patch: { id: 'h9' } }], 'https://example.com/a');
assert.deepEqual(p[0], { op: 'patch', page: 'https://example.com/a', id: 'h1', patch: { quote: { exact: 'a', prefix: 'b', suffix: 'c' }, pos: 3, v: 2 } });
assert.deepEqual(p[1], { op: 'patch', page: 'https://example.com/a', text: 'old', type: 'user', patch: { id: 'h9' } });
console.log('TEST 252 OK');
