// Settings › Prompts shows what onboarding (or another window) stored after the screen was already open.
import { setup, imp, tick } from './harness.mjs'; import assert from 'assert'; import fs from 'fs';
const { store, w } = setup({});
globalThis.document = w.document; globalThis.window = w;
globalThis.fetch = w.fetch = async (u) => { const t = fs.readFileSync(process.env.AISH_SRC + '/' + String(u).replace(/^\.?\//, ''), 'utf8'); return { ok: true, json: async () => JSON.parse(t), text: async () => t }; };
const ps = await imp('modules/promptSettings.js');
const pb = await imp('modules/promptBuilder.js');
const root = w.document.createElement('div'); w.document.body.append(root);
await ps.initPromptSettings(root); await tick(30);
assert.ok(!root.textContent.includes('parent of two'));
const b = { tone: 'neutral', length: 'short', focus: ['facts', 'media'], extra: '', lens: 'stoic', about: ['parent of two'] };
Object.assign(store, { promptType: 'builder', presetPrompt: 'builder', promptBuilder: b, prompt: pb.buildArticlePrompt(b) });
await ps.onStoredPromptChanged({ promptBuilder: { newValue: b } }, 'sync'); await tick(30);
assert.ok(root.textContent.includes('parent of two'), 'new tag shows up without reopening');
assert.ok(root.querySelector('[data-act="lens"][data-v="stoic"].on'), 'mindset shown as selected');
assert.equal(root.querySelector('#promptSelect').value, 'builder');
// own edits keep working: remove the tag
root.querySelector('[data-act="tagdel"]').click(); await tick(30);
assert.ok(!store.promptBuilder.about && !store.prompt.includes('About me'), 'removing the tag is saved');
// “Full prompt”: no toggle for presets/custom (text always visible); toggle only in the builder
const sel = root.querySelector('#promptSelect');
sel.value = 'Default'; sel.dispatchEvent(new w.Event('change', { bubbles: true })); await tick(30);
assert.ok(root.querySelector('#prompt') && !root.querySelector('[data-act="toggleFull"]'), 'preset: text visible, no Hide button');
const sel2 = root.querySelector('#promptSelect'); sel2.value = 'builder'; sel2.dispatchEvent(new w.Event('change', { bubbles: true })); await tick(30);
assert.ok(!root.querySelector('#prompt') && root.querySelector('[data-act="toggleFull"]'), 'builder: prompt hidden behind a toggle');
root.querySelector('[data-act="toggleFull"]').click(); await tick(20);
assert.ok(root.querySelector('#prompt'), 'toggle shows the prompt');
root.querySelector('[data-act="toggleFull"]').click(); await tick(20);
assert.ok(!root.querySelector('#prompt'), 'and hides it again');
console.log('ok');
