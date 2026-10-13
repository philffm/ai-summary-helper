// Cloud model roster shows the OpenRouter price per million tokens.
import assert from 'assert';
import { setup, imp } from './harness.mjs';
setup({});
const { fmtPrice, modelPriceLabel } = await imp('modules/modelManager.js');
assert.equal(fmtPrice(0.1), '$0.10'); assert.equal(fmtPrice(0.075), '$0.075'); assert.equal(fmtPrice(0.4), '$0.40'); assert.equal(fmtPrice(12.5), '$12.50');
assert.equal(modelPriceLabel({ price_in: 0.1, price_out: 0.4 }), '$0.10 in / $0.40 out per 1M tokens');
assert.equal(modelPriceLabel({ price_in: 0, price_out: 0 }), 'Free');
assert.equal(modelPriceLabel({ id: 'x' }), '', 'old server: no prices, nothing shown');
assert.equal(modelPriceLabel(null), '');
console.log('test155 ok');
