import assert from 'assert';
import { setup, imp } from './harness.mjs';

setup();
const E = await imp('modules/history/export.js');
const title = 'Title"\\\nsource: injected';
const url = 'https://example.test/"\\\ncreated: injected';
const tag = 'tag"\\\ntype: injected';
const { mdContent } = await E.buildMarkdown({
    title,
    url,
    timestamp: '2026-11-09T00:00:00Z',
    tags: [tag],
    summary: 'Summary',
    content: '<p>Content</p>',
});

assert(mdContent.includes(`title: ${JSON.stringify(title)}\nsource: ${JSON.stringify(url)}`));
assert(mdContent.includes(`  - ${JSON.stringify(tag)}`));
assert.equal(mdContent.split('\n').filter(line => line.startsWith('source:')).length, 1);
console.log('TEST 255 OK');
process.exit(0);
