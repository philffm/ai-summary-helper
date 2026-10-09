// Recap limit is a setting; scoring batches stay at 40.
import assert from 'assert';
import { setup, imp } from './harness.mjs';
setup({});
const A = await imp('modules/feedAi.js');
assert.equal(A.getRecapLimit(), Infinity, 'no limit by default');
A.setRecapLimit(80); assert.equal(A.getRecapLimit(), 80);
A.setRecapLimit(3); assert.equal(A.getRecapLimit(), Infinity, 'invalid falls back to no limit');
A.setRecapLimit(9999); assert.equal(A.getRecapLimit(), 9999, 'not capped');
A.setRecapLimit(0); assert.equal(A.getRecapLimit(), Infinity);
const list = Array.from({ length: 60 }, (_, k) => ({ title: 't' + k, snippet: '' }));
assert.equal(A.itemsForPrompt(list, () => 's').split(String.fromCharCode(10)).length, 60, 'prompt formatter does not cut');
console.log('TEST 49 OK');
