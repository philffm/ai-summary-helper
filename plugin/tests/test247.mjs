// AISH-033, decided A + parts of D. Ranking: a tested model that rated everything wins by speed; otherwise ready before
// download, Ollama/servers before Apple before the browser. The Local tab shows ONE recommendation with its reason, saves the
// fallback order, “Compare first” tests each ready model (exactly that model) and the result changes the recommendation.
import assert from 'assert';
import { setup, imp, tick } from './harness.mjs';
const { w, store } = setup({}); const d = w.document;
const L = await imp('modules/localModels.js');
const c = (source, model, state = 'ready') => ({ source, model, label: source + ':' + model, endpoint: 'http://127.0.0.1:11434/api/chat', state });
const cands = [c('browser', 'chrome-builtin', 'download'), c('apfel', 'apple-foundationmodel'), c('ollama', 'gemma4:e2b'), c('lmstudio', 'x', 'blocked')];
assert.deepEqual(L.rankLocalModels(cands).map(x => x.source), ['ollama', 'apfel', 'browser'], 'untested: ready first, Ollama before Apple, download last, blocked out');
const bench = { [L.keyOf(cands[1])]: { sec: 9, rated: 20, total: 20 }, [L.keyOf(cands[2])]: { sec: 83, rated: 20, total: 20 } };
assert.equal(L.rankLocalModels(cands, bench)[0].source, 'apfel', 'tested: the faster complete one wins');
assert.equal(L.rankLocalModels(cands, { [L.keyOf(cands[1])]: { sec: 3, rated: 12, total: 20 } })[0].source, 'ollama', 'an incomplete test does not win');
assert.deepEqual(L.reasonFor(cands[1], bench), { kind: 'measured', sec: 9, total: 20 });
assert.deepEqual(L.fallbackOrder(L.rankLocalModels(cands, bench)).map(x => x.model), ['apple-foundationmodel', 'gemma4:e2b'], 'fallback: ready ones only');

// the Local tab card
globalThis.LanguageModel = { availability: async () => 'downloadable', create: async () => ({ destroy() {} }) };
const answers = { 'http://localhost:11434/api/tags': { models: [{ name: 'gemma4:e2b' }] } };
globalThis.fetch = w.fetch = async (u) => { if (answers[u]) return { ok: true, status: 200, json: async () => answers[u] }; throw new Error('refused'); };
const sent = [];
const ai = await imp('modules/feedAi.js');
const SM = await imp('modules/settingsManager.js');
// the quick test goes through feedAi.aiComplete → background; stub the worker reply and record the target
chrome.runtime.sendMessage = (m, cb) => { sent.push(m); const n = 20; const text = Array.from({ length: n }, (_, k) => `${k + 1}:1`).join(' | '); if (cb) cb({ ok: true, text }); return Promise.resolve({ ok: true, text }); };
const box = d.createElement('div'); d.body.append(box);
const picked = [];
await SM.__test_renderRecommendation(box, 'http://localhost:11434/api/chat', async (id, o) => { picked.push([id, o]); });
assert.ok(/Recommended for this computer/.test(box.textContent));
assert.ok(box.querySelector('.local-reco-title').textContent.includes('gemma4:e2b'), 'Ollama recommended (ready), browser model needs a download');
assert.ok(/Also found/.test(box.textContent) && /download first/.test(box.textContent));
assert.deepEqual(store.localFallbackOrder.map(x => x.model), ['gemma4:e2b'], 'fallback order saved');
[...box.querySelectorAll('button')].find(b => b.textContent === 'Use it').click(); await tick(60);
assert.deepEqual(picked[0], ['gemma4:e2b', {}], 'an Ollama model keeps the Ollama endpoint');
const cb = box.querySelector('.local-fallback input'); assert.ok(cb.checked, 'fallback on by default');
cb.checked = false; cb.dispatchEvent(new w.Event('change')); await tick(10);
assert.equal(store.localFallback, false);
// compare: one ready model + a download → still offered; the test addresses exactly that model
await SM.__test_runQuickTest([c('ollama', 'gemma4:e2b')], box, 'http://localhost:11434/api/chat', async () => {});
const t = sent.find(m => m.action === 'aiComplete');
assert.deepEqual(t.target, { model: 'gemma4:e2b', endpoint: 'http://127.0.0.1:11434/api/chat' }, 'test request targets the model');
assert.ok(/20 of 20 rated/.test(box.textContent));
assert.ok(store.localModelBench[L.keyOf(c('ollama', 'gemma4:e2b'))].rated === 20, 'result kept for the ranking');
console.log('TEST 247 OK'); process.exit(0);
