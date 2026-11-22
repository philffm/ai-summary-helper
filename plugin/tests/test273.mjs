// "Search the web for …": the browser's own default engine through the optional `search` permission; always the last palette entry.
import { setup, imp, tick } from './harness.mjs'; import assert from 'assert';
const { w } = setup({});
const queries = []; let granted = false, asked = 0;
chrome.search = { query: async (o) => { queries.push(o); } };
chrome.permissions = { contains: async () => granted, request: async () => { asked++; granted = true; return true; } };
const { searchWeb, webSearchCommand } = await imp('../src/modules/webSearch.js');
const { withWebSearch } = await imp('../src/modules/commands.js');
const { mountCommandList } = await imp('../src/modules/commandPalette.js');

assert.equal(await searchWeb('  heat pump  '), true);
assert.equal(asked, 1, 'the browser is asked once, at the first use');
assert.deepEqual(queries, [{ text: 'heat pump', disposition: 'NEW_TAB' }], 'the words go to the default engine in a new tab');
await searchWeb('again'); assert.equal(asked, 1, 'not asked again when granted');
assert.equal(await searchWeb('   '), false, 'empty text does nothing');
granted = false; chrome.permissions.request = async () => false;
assert.equal(await searchWeb('x'), false, 'declined permission: nothing opens'); assert.equal(queries.length, 2);

const more = withWebSearch(async (q) => [{ id: 'article:1', group: 'Articles', title: 'A ' + q, run() {} }]);
assert.deepEqual((await more('a')).map((c) => c.id), ['web'], 'one character: only the web entry');
assert.deepEqual((await more('ab')).map((c) => c.id), ['article:1', 'web'], 'articles first, the web last');
assert.deepEqual(await more('  '), [], 'blank: nothing');
assert(/Search the web for/.test(webSearchCommand('x').title));

// in the list: a query that matches nothing still has an entry, and Enter runs it
const d = w.document; d.body.innerHTML = '<div id="box"></div>';
let ran = null;
const list = mountCommandList(d.getElementById('box'), { getCommands: () => [{ id: 'k', group: 'G', title: 'Settings', run() {} }], findMore: async (q) => [{ id: 'web', group: 'Web', title: 'Search the web for “' + q + '”', run: () => { ran = q; } }], doc: d });
list.input.value = 'zzqx'; list.input.dispatchEvent(new w.Event('input')); await tick(40);
assert(!d.querySelector('.cmdk-empty:not([hidden])'), 'no "Nothing found" while the web entry is there');
list.input.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })); await tick(30);
assert.equal(ran, 'zzqx', 'Enter searches the web');
console.log('TEST 273 OK'); process.exit(0);
