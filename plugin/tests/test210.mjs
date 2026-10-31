// "Prefer EU servers" for hosted models: what the app marks and shows, and what the background sends and records. Older servers must be unaffected.
import assert from 'assert';
import fs from 'fs'; import vm from 'vm'; import path from 'path';
import { setup, imp } from './harness.mjs';
const { store } = setup({});
const R = await imp('modules/cloudRegion.js'), MM = await imp('modules/modelManager.js'), { SK } = await imp('modules/storageKeys.js');

// the setting is only offered by a server that knows about regions
// Auto choices and the EU company mark
const auto = { id: 'auto', name: 'Auto', auto: true, eu: true }, autoNon = { id: 'auto:qwen', name: 'Auto · Qwen', auto: true, eu: false }, mis = { id: 'auto:mistral', name: 'Auto · Mistral', auto: true, eu: true, eu_company: true }, mistral = { id: 'mistralai/mistral-small-2603', eu: true, eu_company: true };
assert.equal(R.regionTag(auto, 'any'), null, 'Auto on the normal route makes no EU claim'); assert.deepEqual(R.regionTag(auto, 'prefer-eu'), { kind: 'eu', text: 'EU' }); assert.deepEqual(R.regionTag(autoNon, 'prefer-eu'), { kind: 'outside', text: 'Not EU' });
assert.deepEqual(R.regionTag(mis, 'any'), { kind: 'company', text: 'EU company' }); assert.deepEqual(R.regionTag(mistral, 'prefer-eu'), { kind: 'company', text: 'EU company' }, 'a European company is marked as such, with or without the preference');
const lm = await imp('modules/modelManager.js');
assert.deepEqual(lm.autoModels([auto, { id: 'a/b' }, mis]).map((m) => m.id), ['auto', 'auto:mistral']); assert.deepEqual(lm.autoModels(null), []);
assert.ok(!lm.suggestModels([auto, mis, { id: 'a/b', name: 'B', price_in: 1, price_out: 1 }]).some((m) => m.auto), 'Best value never lists Auto: it has its own row');
assert.equal(R.routeSentence({ region: 'eu', used: 'mistralai/mistral-large-4-0', auto: { tier: 'large', reason: 'long-text' } }), 'Auto chose Mistral Large 4.0 (a long text). The last request ran on EU servers.');
assert.match(R.routeSentence({ region: 'global', used: 'google/gemini-3.5-flash-lite', auto: { tier: 'tiny', reason: 'short-text' } }), /^Auto chose Gemini 3\.5 Flash Lite \(a short text\)\. The last request did not run on EU servers/);
assert.match(R.routeSentence({ region: 'eu', used: 'x/y', auto: { tier: 'tiny', reason: 'allowance' } }), /allowance is nearly used up/);
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
const body = src.slice(src.indexOf('const AISH_FEATURES'), src.indexOf('function noteCloudRoute') + src.slice(src.indexOf('function noteCloudRoute')).indexOf('\n}\n') + 3);
const local = {}; let pref = {};
const ctx = { AISH_API_BASE: 'https://api.byphil.eu', SK: { cloudRoute: 'cloud:route' }, chrome: { storage: { sync: { get: async () => pref }, local: { set: (o) => Object.assign(local, o) } } }, Date };
vm.createContext(ctx); vm.runInContext(body + '\nthis.cloudRegionHeader = cloudRegionHeader; this.noteCloudRoute = noteCloudRoute;', ctx);
const API = 'https://api.byphil.eu/v1/projects/ai_summary_helper/chat';
assert.deepEqual(await ctx.cloudRegionHeader(API), {}, 'nothing sent unless the user asked');
pref = { cloudRegionPref: 'any' }; assert.deepEqual(await ctx.cloudRegionHeader(API), {});
pref = { cloudRegionPref: 'prefer-eu' }; assert.deepEqual({ ...await ctx.cloudRegionHeader(API) }, { 'X-AISH-Region': 'prefer-eu' });
// what the request is for goes along (hosted service only, known values only), whatever the preference
assert.deepEqual({ ...await ctx.cloudRegionHeader(API, 'tags') }, { 'X-AISH-Region': 'prefer-eu', 'X-AISH-Feature': 'tags' }); pref = {}; assert.deepEqual({ ...await ctx.cloudRegionHeader(API, 'summary') }, { 'X-AISH-Feature': 'summary' });
assert.deepEqual(await ctx.cloudRegionHeader(API, 'not-a-feature'), {}); assert.deepEqual(await ctx.cloudRegionHeader(API, '<script>'), {}); assert.deepEqual(await ctx.cloudRegionHeader('https://api.openai.com/v1/chat/completions', 'summary'), {}, 'never to another server');
pref = { cloudRegionPref: 'prefer-eu' };
for (const other of ['https://api.openai.com/v1/chat/completions', 'http://localhost:11434/api/chat', 'https://api.byphil.eu.evil.test/v1/projects/x/chat', 'https://evil.test/https://api.byphil.eu/v1/projects/x']) assert.deepEqual(await ctx.cloudRegionHeader(other), {}, 'never to another server: ' + other);
const res = (v) => ({ headers: { get: (k) => (k === 'x-aish-region' ? v : null) } });
ctx.noteCloudRoute(API, res('eu'), 'a/b'); assert.equal(local['cloud:route'].region, 'eu'); assert.equal(local['cloud:route'].model, 'a/b'); assert.ok(!('used' in local['cloud:route']), 'an older service sends no model: nothing invented');
{ const h = { 'x-aish-region': 'eu', 'x-aish-model-used': 'mistralai/mistral-large-4-0', 'x-aish-switched': 'long-text' }; ctx.noteCloudRoute(API, { headers: { get: (k) => h[k] || null } }, 'mistralai/mistral-small-2603'); assert.deepEqual({ ...local['cloud:route'], at: 0 }, { region: 'eu', model: 'mistralai/mistral-small-2603', used: 'mistralai/mistral-large-4-0', switched: 'long-text', at: 0 }); }
{ const h = { 'x-aish-region': 'eu', 'x-aish-model-used': 'mistralai/mistral-large-4-0', 'x-aish-auto': 'large:long-text' }; ctx.noteCloudRoute(API, { headers: { get: (k) => h[k] || null } }, 'auto'); assert.deepEqual(local['cloud:route'].auto, { tier: 'large', reason: 'long-text' }); assert.equal(local['cloud:route'].model, 'auto'); }
{ const h = { 'x-aish-region': 'eu', 'x-aish-auto': 'huge:<evil>' }; ctx.noteCloudRoute(API, { headers: { get: (k) => h[k] || null } }, 'auto'); assert.ok(!('auto' in local['cloud:route']), 'an odd header is not recorded'); }
ctx.noteCloudRoute(API, res('global'), 'c/d'); assert.equal(local['cloud:route'].region, 'global');
ctx.noteCloudRoute(API, res(null), 'x'); ctx.noteCloudRoute(API, res('mars'), 'x'); assert.equal(local['cloud:route'].model, 'c/d', 'an answer without a known region (an older server) records nothing');
ctx.noteCloudRoute('https://api.openai.com/v1/chat/completions', res('eu'), 'x'); assert.equal(local['cloud:route'].model, 'c/d', 'only the hosted service is trusted for this');
ctx.noteCloudRoute(API, { headers: { get() { throw new Error('boom'); } } }, 'x');   // must never break a summary
// feeds: what a request is for is handed to the transport (tags, recap, qa)
{ const FA = await imp('modules/feedAi.js'); let seen = null; FA.setAiTransport((o) => { seen = o; return Promise.resolve('ok'); });
  await FA.aiComplete('s', 'u', null, null, null, { feature: 'tags' }); assert.equal(seen.feature, 'tags'); await FA.aiComplete('s', 'u'); assert.equal(seen.feature, '', 'no hint when the caller gives none'); FA.setAiTransport(null); }
console.log('TEST 210 OK'); process.exit(0);
