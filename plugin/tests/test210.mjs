// "Prefer EU servers" for hosted models: what the app marks and shows, and what the background sends and records. Older servers must be unaffected.
import assert from 'assert';
import fs from 'fs'; import vm from 'vm'; import path from 'path';
import { setup, imp } from './harness.mjs';
const { store } = setup({});
const R = await imp('modules/cloudRegion.js'), MM = await imp('modules/modelManager.js'), { SK } = await imp('modules/storageKeys.js');

// the setting is only offered by a server that knows about regions
assert.ok(R.supportsEu({ regions: ['global', 'eu'] })); assert.ok(!R.supportsEu({ regions: ['global'] })); assert.ok(!R.supportsEu({})); assert.ok(!R.supportsEu(null));
// marks: EU models are marked; with the preference on, the others are called out; unknown stays unmarked (an older server)
const eu = { id: 'a/b', name: 'B', eu: true, price_in: 1, price_out: 5, eu_price_in: 1.1, eu_price_out: 5.5 }, non = { id: 'c/d', name: 'D', eu: false, price_in: 0.3, price_out: 2.5 }, old = { id: 'e/f', name: 'F', price_in: 0.3, price_out: 2.5 };
assert.deepEqual(R.regionTag(eu, 'any'), { kind: 'eu', text: 'EU' }); assert.equal(R.regionTag(non, 'any'), null);
assert.deepEqual(R.regionTag(non, 'prefer-eu'), { kind: 'outside', text: 'Not EU' }); assert.equal(R.regionTag(old, 'prefer-eu'), null, 'a server that does not know regions marks nothing'); assert.equal(R.regionTag(null, 'prefer-eu'), null);
// prices: the EU price only for an EU model with the preference on
assert.deepEqual(R.pricesFor(eu, 'prefer-eu'), { price_in: 1.1, price_out: 5.5 }); assert.deepEqual(R.pricesFor(eu, 'any'), { price_in: 1, price_out: 5 }); assert.deepEqual(R.pricesFor(non, 'prefer-eu'), { price_in: 0.3, price_out: 2.5 });
assert.notEqual(MM.modelPriceLabel(eu, 'prefer-eu'), MM.modelPriceLabel(eu, 'any'), 'the label follows the preference'); assert.equal(MM.modelPriceLabel(eu), MM.modelPriceLabel(eu, 'any'), 'callers that pass nothing see the old label');
assert.equal(MM.modelPriceLabel(old, 'prefer-eu'), MM.modelPriceLabel(old, 'any'));
assert.match(R.routeSentence({ region: 'eu' }), /ran on EU servers/); assert.match(R.routeSentence({ region: 'global' }), /did not run on EU servers/); assert.equal(R.routeSentence(null), ''); assert.equal(R.routeSentence({}), '');

// the background: the header only for the hosted service and only when asked; the route is recorded from the answer
const src = fs.readFileSync(path.resolve(process.env.AISH_SRC, 'background.js'), 'utf8');
const body = src.slice(src.indexOf('async function cloudRegionHeader'), src.indexOf('function noteCloudRoute') + src.slice(src.indexOf('function noteCloudRoute')).indexOf('\n}\n') + 3);
const local = {}; let pref = {};
const ctx = { AISH_API_BASE: 'https://api.byphil.eu', SK: { cloudRoute: 'cloud:route' }, chrome: { storage: { sync: { get: async () => pref }, local: { set: (o) => Object.assign(local, o) } } }, Date };
vm.createContext(ctx); vm.runInContext(body + '\nthis.cloudRegionHeader = cloudRegionHeader; this.noteCloudRoute = noteCloudRoute;', ctx);
const API = 'https://api.byphil.eu/v1/projects/ai_summary_helper/chat';
assert.deepEqual(await ctx.cloudRegionHeader(API), {}, 'nothing sent unless the user asked');
pref = { cloudRegionPref: 'any' }; assert.deepEqual(await ctx.cloudRegionHeader(API), {});
pref = { cloudRegionPref: 'prefer-eu' }; assert.deepEqual({ ...await ctx.cloudRegionHeader(API) }, { 'X-AISH-Region': 'prefer-eu' });
for (const other of ['https://api.openai.com/v1/chat/completions', 'http://localhost:11434/api/chat', 'https://api.byphil.eu.evil.test/v1/projects/x/chat', 'https://evil.test/https://api.byphil.eu/v1/projects/x']) assert.deepEqual(await ctx.cloudRegionHeader(other), {}, 'never to another server: ' + other);
const res = (v) => ({ headers: { get: (k) => (k === 'x-aish-region' ? v : null) } });
ctx.noteCloudRoute(API, res('eu'), 'a/b'); assert.equal(local['cloud:route'].region, 'eu'); assert.equal(local['cloud:route'].model, 'a/b');
ctx.noteCloudRoute(API, res('global'), 'c/d'); assert.equal(local['cloud:route'].region, 'global');
ctx.noteCloudRoute(API, res(null), 'x'); ctx.noteCloudRoute(API, res('mars'), 'x'); assert.equal(local['cloud:route'].model, 'c/d', 'an answer without a known region (an older server) records nothing');
ctx.noteCloudRoute('https://api.openai.com/v1/chat/completions', res('eu'), 'x'); assert.equal(local['cloud:route'].model, 'c/d', 'only the hosted service is trusted for this');
ctx.noteCloudRoute(API, { headers: { get() { throw new Error('boom'); } } }, 'x');   // must never break a summary
console.log('TEST 210 OK'); process.exit(0);
