// Prompt settings migration: legacy and very old stored prompt shapes.
import { setup, imp, tick } from './harness.mjs'; import assert from 'assert'; import fs from 'fs';
const presets = JSON.parse(fs.readFileSync(process.env.AISH_SRC + '/prompts.json', 'utf8'));
async function run(initial, fn) {
  const { store, w } = setup({}); Object.assign(store, initial);
  globalThis.fetch = w.fetch = async () => ({ ok: true, json: async () => presets }); globalThis.MutationObserver = w.MutationObserver;
  const { initPromptSettings } = await imp('modules/promptSettings.js');
  const root = w.document.getElementById('promptSettingsRoot'); await initPromptSettings(root); await tick(60);
  await fn(store, root, w);
}
// 1) legacy: own text with promptType 'preset' (text differs from preset) → stays, becomes Custom
await run({ prompt: 'Summarize in pirate speak.', presetPrompt: 'Default', promptType: 'preset' }, async (store, root) => {
  assert.equal(store.prompt, 'Summarize in pirate speak.'); assert.equal(store.promptType, 'custom'); assert.equal(root.querySelector('#promptSelect').value, 'custom');
  assert(root.querySelector('#prompt').value === 'Summarize in pirate speak.', 'shown');
});
// 2) very old: no promptType at all, own text
await run({ prompt: 'Old plain prompt' }, async (store, root) => {
  assert.equal(store.prompt, 'Old plain prompt'); assert.equal(store.promptType, 'custom'); assert.equal(root.querySelector('#promptSelect').value, 'custom');
});
// 3) unchanged preset stays a preset
await run({ prompt: presets[0].prompt, presetPrompt: presets[0].name, promptType: 'preset' }, async (store, root) => {
  assert.equal(store.promptType, 'preset'); assert.equal(root.querySelector('#promptSelect').value, presets[0].name);
});
// 4) nothing stored: nothing written
await run({}, async (store) => { assert(!('prompt' in store) && !('promptType' in store)); });
// 5) custom survives a detour through the builder and a preset
await run({ prompt: 'My very own prompt', presetPrompt: 'custom', promptType: 'custom' }, async (store, root, w) => {
  const sel = () => root.querySelector('#promptSelect'); const pick = v => { sel().value = v; sel().dispatchEvent(new w.Event('change', { bubbles: true })); return tick(40); };
  await pick('builder'); assert(store.prompt.includes('Tone')); assert.equal(store.promptCustomText, 'My very own prompt');
  await pick(presets[1].name); assert.equal(store.prompt, presets[1].prompt);
  await pick('custom'); assert.equal(store.prompt, 'My very own prompt'); assert.equal(store.promptType, 'custom');
});
// 6) custom text unchanged when settings panel opened (content.js still reads `prompt`)
await run({ prompt: 'Keep me', promptType: 'custom', presetPrompt: 'custom' }, async (store) => { assert.equal(store.prompt, 'Keep me'); });
console.log('TEST 34 OK');
