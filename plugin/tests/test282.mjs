// previewText: the card preview of a summary has no heading labels and no glued words.
import { setup, imp } from './harness.mjs'; import assert from 'assert';
const { w } = setup({}); globalThis.DOMParser = w.DOMParser;
const { previewText } = await imp('modules/previewText.js');
assert.equal(previewText('<h3>Key points</h3><p>Long-form is growing again.</p><h3>Context</h3><ul><li>One</li><li>Two</li></ul>'), 'Long-form is growing again. One Two', 'headings are dropped, blocks are separated');
assert.equal(previewText('<p>a</p><p>b</p>'), 'a b');
assert.equal(previewText('x'.repeat(130)), 'x'.repeat(100) + '…', 'cut at 100');
assert.equal(previewText('&lt;img src=x onerror=alert(1)&gt; text'), '<img src=x onerror=alert(1)> text', 'entities stay text (the caller escapes)');
assert.equal(previewText(''), ''); assert.equal(previewText(null), '');
console.log('TEST 282 OK');
