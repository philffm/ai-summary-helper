// Prompt settings: builder choices, hand edit turns into custom text, presets.
import { setup, imp, tick } from './harness.mjs'; import assert from 'assert'; import fs from 'fs';
const { store, w } = setup({});
const presets = JSON.parse(fs.readFileSync(process.env.AISH_SRC + '/prompts.json', 'utf8'));
globalThis.fetch = w.fetch = async () => ({ ok: true, json: async () => presets });
globalThis.MutationObserver = w.MutationObserver;
globalThis.DOMParser = w.DOMParser;
const ai = [];
globalThis.__ai = (m) => { ai.push(m); return { ok: true, text: m.system.includes('Format exactly') ? 'Overview here.\n- Gardens: story\nMOOD: positive' : '<div><h2>Roofs</h2><p>Summary.</p></div>' }; };
const { initPromptSettings } = await imp('modules/promptSettings.js');
const pb = await imp('modules/promptBuilder.js');
const d = w.document; const root = d.getElementById('promptSettingsRoot'); assert(root, 'root');
await initPromptSettings(root); await tick(50);
assert(root.querySelector('#promptSelect'), 'select');
const opts = [...root.querySelectorAll('#promptSelect option')].map(o => o.value);
assert(opts.includes("Phil's secret prompt") && opts.includes('builder') && opts.includes('custom'), opts.join());
// choose builder
const sel = root.querySelector('#promptSelect'); sel.value = 'builder'; sel.dispatchEvent(new w.Event('change', { bubbles: true })); await tick(50);
assert(store.promptType === 'builder' && store.prompt.includes('Tone: neutral'), 'builder saved ' + store.prompt);
root.querySelector('[data-act="tone"][data-v="casual"]').click(); await tick(30);
assert(store.prompt.includes('casual'), 'tone');
root.querySelector('[data-act="phil"]').click(); await tick(30);
assert(store.prompt.includes('standup comedian') && store.prompt.includes('UX designer') && store.prompt.includes('1000 words'), 'phil mix');
root.querySelector('[data-act="focus"][data-v="media"]').click(); await tick(30);
assert(!store.prompt.includes('books and media'), 'toggle off');
const ex = root.querySelector('#psExtra'); ex.value = 'Always name the author.'; ex.dispatchEvent(new w.Event('input', { bubbles: true })); await tick(400);
assert(store.prompt.includes('Always name the author.'), 'extra');
// hand edit → custom
root.querySelector('[data-act="toggleFull"]').click(); await tick(20);
const ta = root.querySelector('#prompt'); assert(ta && ta.value.includes('Always name'), 'full prompt shown');
ta.value = 'My own words.'; ta.dispatchEvent(new w.Event('input', { bubbles: true })); await tick(900);
assert(store.promptType === 'custom' && store.prompt === 'My own words.', 'custom saved');
assert(root.querySelector('.ps-note.warn'), 'warn note');
root.querySelector('[data-act="toBuilder"]').click(); await tick(50);
assert(store.promptType === 'builder' && store.prompt.includes('Tone'), 'back to builder');
// preset
sel.value = "Phil's secret prompt"; root.querySelector('#promptSelect').value = "Phil's secret prompt"; root.querySelector('#promptSelect').dispatchEvent(new w.Event('change', { bubbles: true })); await tick(50);
assert(store.promptType === 'preset' && store.presetPrompt === "Phil's secret prompt" && store.prompt.includes('standup comedian'), 'preset');
// test on sample (articles)
root.querySelector('[data-act="test"]').click(); await tick(100);
assert(ai.length === 1 && ai[0].system.includes('standup comedian') && root.querySelector('#psTestOut').textContent.includes('Roofs'), 'article test');
// feeds
root.querySelector('[data-act="tab"][data-v="feeds"]').click(); await tick(20);
root.querySelector('[data-act="tone"][data-v="casual"]').click(); await tick(20);
root.querySelector('[data-act="ffocus"][data-v="humor"]').click(); await tick(20);
assert(store.feedPromptCfg.briefing.builder.tone === 'casual' && store.feedPromptCfg.briefing.builder.focus.includes('humor'), 'feed saved');
root.querySelector('[data-act="scope"][data-v="recap"]').click(); await tick(20);
assert(root.querySelector('.ps-row.toggle.on'), 'same as briefing default on');
root.querySelector('[data-act="sameToggle"]').click(); await tick(20);
assert(store.feedPromptCfg.recap && store.feedPromptCfg.recap.mode === 'builder', 'recap own style');
root.querySelector('[data-act="tone"][data-v="formal"]').click(); await tick(20);
assert(store.feedPromptCfg.recap.builder.tone === 'formal' && store.feedPromptCfg.briefing.builder.tone === 'casual');
root.querySelector('[data-act="test"]').click(); await tick(150);
assert(root.querySelector('#psTestOut').textContent.includes('Overview here') && ai[1].system.includes('style preferences') && ai[1].system.includes('formal'), 'feed test');
// feedAi picks style up
const fa = await imp('modules/feedAi.js');
await fa.generateRecap([{ title: 'x', snippet: '', source: 's' }], i => i.source, { rate: false }).catch(() => {});
assert(ai[2].system.includes('casual') && ai[2].system.includes('humor'), 'briefing style used');
await fa.generateRollup([{ label: 'Mon', recap: { overview: 'o', themes: [], mood: 'neu' } }], { label: 'Week' }).catch(() => {});
assert(ai[3] && ai[3].system.includes('formal'), 'recap style used: ' + (ai[3] && ai[3].system.slice(-200)));
console.log('TEST 33 OK');
