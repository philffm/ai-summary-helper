// Chrome's built-in model (Gemini Nano) as the local FALLBACK for the whole-library run: used when Ollama is not set up,
// requests run in the page through LanguageModel (streamed, session destroyed), the card always says what is better,
// with Ollama set up the user can pick it but Ollama stays the default, and a downloadable model is offered (not forced).
import assert from 'assert';
import { setup, imp, tick } from './harness.mjs';
const yday = new Date(); yday.setDate(yday.getDate() - 1); yday.setHours(12, 0, 0, 0);
const { store, w } = setup({});
store['feeds:subs'] = [{ id: 'a', url: 'https://a.test/feed', title: 'A', tags: [], lastFetched: Date.now() }];
store['feeds:items'] = Array.from({ length: 12 }, (_, i) => ({ id: 'x' + i, feedId: 'a', title: 'Post ' + i, link: 'https://a.test/' + i, published: yday.getTime() - i * 60000, read: false }));
store.connectionMode = 'cloud'; store.activeService = 'openai';
store['feeds:settings'] = { rateWithRecap: false };
const $ = (s) => w.document.querySelector(s);

// a fake Prompt API
let avail = 'available', sessions = 0, destroyed = 0, prompts = [];
globalThis.LanguageModel = {
    availability: async () => avail,
    create: async (o) => { sessions++; const sys = (o.initialPrompts || [])[0]?.content || ''; return {
        promptStreaming(user) {
            prompts.push({ sys, user });
            const n = (user.match(/^\[\d+\]/gm) || []).length, nums = Array.from({ length: n }, (_, k) => k + 1);
            let text;
            if (/topic tags/.test(sys)) text = 'Tech, News, Gadgets, Extra';
            else if (/rate the sentiment/.test(sys)) text = JSON.stringify({ scores: nums.map(() => 0.3), labels: nums.map(() => 'Tech') });
            else text = `SCORES: ${nums.map(k => k + ':1').join(' | ')}\nLABELS: ${nums.map(k => k + ':Tech').join(' | ')}\nOverview.\n- Story\nMOOD: mixed`;
            return (async function* () { yield text.slice(0, 5); yield text.slice(5); })();
        },
        destroy() { destroyed++; },
    }; },
};
globalThis.__ai = () => { throw new Error('the hosted/worker path must not be used for nano'); };

// aiComplete with service 'nano' streams in the page
const ai = await imp('modules/feedAi.js');
const seen = [];
const txt = await ai.aiComplete('rate the sentiment', '[1] a', null, null, (m) => seen.push(m.text), { service: 'nano' });
assert.ok(/scores/.test(txt) && seen.at(-1) === txt && seen.length === 2, 'streamed and complete');
assert.equal(destroyed, sessions, 'session destroyed');

const fm = await imp('modules/feedManager.js'); fm.initFeedManager({ showToast() {}, showScreen() {} }); await tick(80);
w.document.dispatchEvent(new w.CustomEvent('aish:settings-panel', { detail: { name: 'feedprefs' } })); await tick(300);
let card = $('#feedPrefsLibrary');
assert.ok(/Gemini Nano/.test(card.textContent) && /fallback/i.test(card.textContent), 'says it is the fallback: ' + card.textContent);
assert.ok(/Better results: Ollama with a 7–8B model/.test(card.textContent), 'says what is better');
assert.ok([...card.querySelectorAll('button')].some(b => /Set up Ollama/.test(b.textContent)), 'a way to the better option');
const start = [...card.querySelectorAll('button')].find(b => /whole library/i.test(b.textContent));
assert.ok(start, 'the run is available without Ollama');
const before = prompts.length;
start.click();
for (let k = 0; k < 120 && !/Done\./.test(card.textContent); k++) await tick(50);
assert.ok(/Done\./.test(card.textContent), 'finished: ' + card.textContent);
assert.ok(prompts.length - before >= 2, 'requests went to the built-in model');
assert.ok(store['feeds:items'].some(i => typeof i.sent === 'number'), 'items were rated');

// not downloaded yet: an offer with a download button, plus the better option; the run itself is not offered
avail = 'downloadable';
w.document.dispatchEvent(new w.CustomEvent('aish:settings-panel', { detail: { name: 'feedprefs' } })); await tick(300);
card = $('#feedPrefsLibrary');
assert.ok([...card.querySelectorAll('button')].some(b => /Download the built-in model/.test(b.textContent)), 'download offered');
assert.ok(/Better results/.test(card.textContent));
assert.ok(![...card.querySelectorAll('button')].some(b => /whole library/i.test(b.textContent)), 'no run before the model is there');

// Ollama set up: it is the default; the built-in model is a choice, labelled fallback
avail = 'available';
store['config:services'] = { ollama: { endpoint: 'http://localhost:11434/v1/chat/completions', customModel: [{ id: 'llama3.2', provider: 'ollama' }], activeModelId: { id: 'llama3.2', provider: 'ollama' } } };
w.document.dispatchEvent(new w.CustomEvent('aish:settings-panel', { detail: { name: 'feedprefs' } })); await tick(300);
card = $('#feedPrefsLibrary');
const sel = card.querySelector('#feedSetEngine');
assert.ok(sel && sel.value === 'auto' && /Ollama \(recommended\)/.test(sel.textContent) && /fallback/.test(sel.textContent), 'choice with Ollama recommended');
assert.ok(!/Gemini Nano\) · fallback/.test(card.textContent), 'no fallback note while Ollama runs');
// no LanguageModel at all (Firefox, other browsers): nothing about it is shown
delete globalThis.LanguageModel; delete store['config:services'];
w.document.dispatchEvent(new w.CustomEvent('aish:settings-panel', { detail: { name: 'feedprefs' } })); await tick(300);
assert.ok(!/Gemini Nano/.test($('#feedPrefsLibrary').textContent), 'not mentioned where it does not exist');
console.log('TEST 240 OK'); process.exit(0);
