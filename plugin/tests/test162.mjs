// Markdown/Obsidian export from a lean list entry still carries the original page text (loaded from the full record).
import { setup, imp, tick } from './harness.mjs'; import assert from 'assert';
const { store, w } = setup({});
globalThis.document = w.document; globalThis.window = w;
const { articleRecKey } = await imp('modules/storageKeys.js');
store['articles:index'] = [{ id: 'a1', url: 'https://x.test/1', title: 'Lean one', timestamp: new Date().toISOString(), summary: '<p>Short summary</p>', tags: [] }];
store[articleRecKey('a1')] = { content: '<p>The full original page text.</p>' };

let md = '';
w.Blob = globalThis.Blob = class { constructor(p) { md = p.join(''); } };
URL.createObjectURL = () => 'blob:x'; URL.revokeObjectURL = () => {};
const am = await imp('modules/articleManager.js');
await am.exportToMarkdown({ ...store['articles:index'][0] }); await tick(60);
assert.ok(md.includes('Short summary'), 'summary present');
assert.ok(md.includes('The full original page text.'), 'original content loaded for the lean entry');
console.log('ok');
