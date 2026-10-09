// Auto summary length: grows with the article, never more than half of it, bias scales it, specs resolve in the content script.
import assert from 'assert';
import { SK } from '../src/modules/storageKeys.js';
import { autoSummaryLength, clampLength, lengthSpec, resolveSummaryLength, readLengthSetting, MAX_WORDS, MIN_WORDS, DEFAULT_WORDS } from '../src/modules/summaryLength.js';

// monotonic, bounded, and different for short vs long articles
let prev = 0;
for (const w of [60, 100, 300, 1000, 2500, 5000, 10000, 40000]) { const n = autoSummaryLength(w); assert(n >= prev, 'monotonic at ' + w); prev = n; }
assert(autoSummaryLength(300) < autoSummaryLength(5000) / 2, 'short vs long differ clearly');
assert.equal(autoSummaryLength(300), 70);
assert.equal(autoSummaryLength(5000), 280);
assert(autoSummaryLength(40000) <= 800, 'upper bound');
for (const w of [20, 40, 60, 100, 150]) assert(autoSummaryLength(w) <= Math.floor(w / 2), 'never more than half of ' + w);
assert.equal(autoSummaryLength(0), DEFAULT_WORDS, 'unknown length → default');
assert(autoSummaryLength(2500, 'short') < autoSummaryLength(2500) && autoSummaryLength(2500) < autoSummaryLength(2500, 'long'), 'bias scales');

// numbers are clamped, junk falls back
assert.equal(clampLength(5), MIN_WORDS); assert.equal(clampLength(99999), MAX_WORDS);
assert.equal(clampLength('abc'), DEFAULT_WORDS); assert.equal(clampLength('333'), 333);

// message spec round trip
assert.equal(lengthSpec({ mode: 'custom', value: 345 }), 345);
assert.equal(lengthSpec({ mode: 'auto', bias: 'standard' }), 'auto');
assert.equal(lengthSpec({ mode: 'auto', bias: 'long' }), 'auto:long');
assert.equal(resolveSummaryLength(150, 9999), 150, 'a fixed number ignores the article');
assert.equal(resolveSummaryLength('auto', 5000), 280);
assert.equal(resolveSummaryLength('auto:short', 5000), autoSummaryLength(5000, 'short'));
assert.equal(resolveSummaryLength(undefined, 5000), DEFAULT_WORDS);

// stored values: new install → auto; an older saved number → custom
assert.equal(readLengthSetting({}, SK).mode, 'auto');
assert.deepEqual(readLengthSetting({ [SK.summaryLength]: 250 }, SK), { mode: 'custom', value: 250, bias: 'standard' });
assert.equal(readLengthSetting({ [SK.summaryLength]: 250, [SK.summaryLengthMode]: 'auto' }, SK).mode, 'auto');
assert.equal(readLengthSetting({ [SK.summaryLengthBias]: 'nonsense' }, SK).bias, 'standard');
console.log('TEST 94 OK'); process.exit(0);
