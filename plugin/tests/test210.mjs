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
assert.match(R.routeSentence({ region: 'eu' }), /ran on EU servers/);
assert.match(R.routeSentence({ region: 'eu', used: 'mistralai/mistral-large-4-0', switched: 'long-text' }), /on Mistral Large 4\.0: the text was long, so the larger model was used/);
assert.equal(R.routeSentence({ region: 'eu', used: 'mistralai/mistral-small-2603' }), 'The last request ran on EU servers.', 'no swap, nothing extra said');
// the one-tap suggestion: only with the preference on, a server that offers a default, and a model that is not on EU servers
const roster = { regions: ['global', 'eu'], eu_default: 'mistralai/mistral-small-2603', models: [{ id: 'mistralai/mistral-small-2603', name: 'Mistral: Small 4', eu: true }, { id: 'google/gemini-3.6-flash', name: 'Gemini', eu: false }, { id: 'a/b', name: 'B', eu: true }] };
assert.deepEqual(R.euSuggestion(roster, 'google/gemini-3.6-flash', 'prefer-eu'), { id: 'mistralai/mistral-small-2603', name: 'Mistral: Small 4' });
assert.equal(R.euSuggestion(roster, 'google/gemini-3.6-flash', 'any'), null); assert.equal(R.euSuggestion(roster, 'a/b', 'prefer-eu'), null, 'already on an EU model');
assert.equal(R.euSuggestion({ ...roster, eu_default: undefined }, 'google/gemini-3.6-flash', 'prefer-eu'), null); assert.equal(R.euSuggestion({ models: roster.models }, 'google/gemini-3.6-flash', 'prefer-eu'), null, 'an older server offers nothing');
assert.ok(R.euSuggestion(roster, 'not-in-the-list/x', 'prefer-eu'), 'a model the list does not know is not an EU model either'); assert.match(R.routeSentence({ region: 'global' }), /did not run on EU servers/); assert.equal(R.routeSentence(null), ''); assert.equal(R.routeSentence({}), '');

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
ctx.noteCloudRoute(API, res('eu'), 'a/b'); assert.equal(local['cloud:route'].region, 'eu'); assert.equal(local['cloud:route'].model, 'a/b'); assert.ok(!('used' in local['cloud:route']), 'an older service sends no model: nothing invented');
{ const h = { 'x-aish-region': 'eu', 'x-aish-model-used': 'mistralai/mistral-large-4-0', 'x-aish-switched': 'long-text' }; ctx.noteCloudRoute(API, { headers: { get: (k) => h[k] || null } }, 'mistralai/mistral-small-2603'); assert.deepEqual({ ...local['cloud:route'], at: 0 }, { region: 'eu', model: 'mistralai/mistral-small-2603', used: 'mistralai/mistral-large-4-0', switched: 'long-text', at: 0 }); }
ctx.noteCloudRoute(API, res('global'), 'c/d'); assert.equal(local['cloud:route'].region, 'global');
ctx.noteCloudRoute(API, res(null), 'x'); ctx.noteCloudRoute(API, res('mars'), 'x'); assert.equal(local['cloud:route'].model, 'c/d', 'an answer without a known region (an older server) records nothing');
ctx.noteCloudRoute('https://api.openai.com/v1/chat/completions', res('eu'), 'x'); assert.equal(local['cloud:route'].model, 'c/d', 'only the hosted service is trusted for this');
ctx.noteCloudRoute(API, { headers: { get() { throw new Error('boom'); } } }, 'x');   // must never break a summary
console.log('TEST 210 OK'); process.exit(0);
