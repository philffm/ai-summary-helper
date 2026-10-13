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
// Quick-pick suggestions: 4 most popular, then the 4 cheapest of the top 20 (input counts triple), skipping what is already shown.
const roster = Array.from({ length: 30 }, (_, i) => ({ id: 'v/m' + i, name: 'M' + i, price_in: 1 + (i % 5), price_out: 1 + (i % 7) }));
roster[12].price_in = 0.01; roster[12].price_out = 0.02;   // very cheap, but popularity rank 12
roster[25].price_in = 0.001; roster[25].price_out = 0.001;   // cheaper still, outside the top 20: never suggested
const s = suggestModels(roster, ['v/m1']);
assert.deepEqual(s.slice(0, 4).map(m => m.id), ['v/m0', 'v/m2', 'v/m3', 'v/m4'], 'popular first, skipping recents');
assert.equal(s[4].id, 'v/m12', 'cheapest of the top 20 comes next');
assert.equal(s.length, 8); assert(!s.some(m => m.id === 'v/m25')); assert.equal(new Set(s.map(m => m.id)).size, 8);
assert.deepEqual(suggestModels(null), []); assert.deepEqual(suggestModels([{ id: 'x', name: 'X' }]).map(m => m.id), ['x'], 'no prices: popularity only');
console.log('test155 ok');
