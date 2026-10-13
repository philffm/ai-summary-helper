// Cloud model roster shows the OpenRouter price per million tokens.
import assert from 'assert';
import { setup, imp } from './harness.mjs';
setup({});
const { fmtPrice, modelPriceLabel, suggestModels } = await imp('modules/modelManager.js');
assert.equal(fmtPrice(0.1), '$0.10'); assert.equal(fmtPrice(0.075), '$0.075'); assert.equal(fmtPrice(0.4), '$0.40'); assert.equal(fmtPrice(12.5), '$12.50');
assert.equal(modelPriceLabel({ price_in: 0.1, price_out: 0.4 }), '$0.10 in / $0.40 out per 1M tokens');
assert.equal(modelPriceLabel({ price_in: 0, price_out: 0 }), 'Free');
assert.equal(modelPriceLabel({ id: 'x' }), '', 'old server: no prices, nothing shown');
assert.equal(modelPriceLabel(null), '');
// Quick-pick suggestions: the 5 best value of the top 20 (popularity rank + price rank), skipping what is already shown.
const roster = Array.from({ length: 30 }, (_, i) => ({ id: 'v/m' + i, name: 'M' + i, price_in: 5, price_out: 5 }));
roster[2].price_in = 0.1; roster[2].price_out = 0.1;      // popular and cheap: first
roster[7].price_in = 0.01; roster[7].price_out = 0.01;  // cheapest of all but only rank 7 in popularity
roster[25].price_in = 0.001; roster[25].price_out = 0.001; // cheaper still, outside the top 20: never suggested
const s = suggestModels(roster, ['v/m1']);
assert.equal(s.length, 5); assert.equal(new Set(s.map(m => m.id)).size, 5);
assert(s.slice(0, 2).some(m => m.id === 'v/m2'), 'popular and cheap is among the first'); assert(s.some(m => m.id === 'v/m7'), 'a very cheap model rises into the 5');
assert(!s.some(m => m.id === 'v/m1'), 'recents are skipped'); assert(!s.some(m => m.id === 'v/m25'), 'outside the top 20');
assert.deepEqual(suggestModels(null), []);
assert.deepEqual(suggestModels(roster.slice(0, 8).map(m => ({ id: m.id, name: m.name }))).map(m => m.id), ['v/m0', 'v/m1', 'v/m2', 'v/m3', 'v/m4'], 'no prices: popularity only');
console.log('test155 ok');
