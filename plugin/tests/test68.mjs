// Models that write out their plan instead of the summary: plan stripped, or reported when nothing else is there.
import assert from 'assert';
import { setup, imp } from './harness.mjs';
setup({});
const { stripReasoning } = await imp('content/extractor.js');
const plan = '* Task: Summarize the provided PDF text.\n* Output: a single `<div>` containing `<h2>` and `<p>` tags.\n* Style Requirements:\n  * 4-5 sentences\n';
assert.equal(stripReasoning(plan), '', 'plan only → nothing');
assert.equal(stripReasoning(plan + '<div><h2>Title</h2><p>Real.</p></div>'), '<div><h2>Title</h2><p>Real.</p></div>');
const ok = '<div><h2>T</h2><p>Mentions the `<div>` tag.</p></div>';
assert.equal(stripReasoning(ok), ok);
assert.equal(stripReasoning('## Title\n\nA markdown summary with * a bullet'), '## Title\n\nA markdown summary with * a bullet');
assert.equal(stripReasoning('* Format: A single `<div>` containing `<h2>` and `<p>` tags, followed by four HTML comments.\n* Length Limit: About 200 words.'), '');
assert.equal(stripReasoning('Thinking Process: x\n<div>a</div>'), '<div>a</div>');
console.log('test68 ok');
