// Onboarding step 2: pick a summary style with an example; the choice is stored like the Prompt settings do.
import { setup, imp } from './harness.mjs'; import assert from 'assert';
const { store, w } = setup({});
globalThis.document = w.document; globalThis.window = w;
const m = await imp('modules/onboardingStyle.js');

const list = m.styles();
assert.deepEqual(list.map(s => s.id), ['brief', 'facts', 'actions', 'playful']);
assert.ok(list.every(s => s.title && s.hint && s.example.includes('<')), 'every style shows an example');
for (const id of Object.keys(m.STYLE_BUILDERS)) assert.ok(list.some(s => s.id === id));

const host = w.document.createElement('div'); w.document.body.append(host);
let done = null;
m.mountStyleStep(host, { onDone: (id) => { done = id; } });
const cards = [...host.querySelectorAll('.onboarding-style')];
assert.equal(cards.length, 4);
assert.equal(host.querySelector('.is-selected').dataset.style, 'brief', 'a sensible default is preselected');
assert.ok(host.querySelector('.onboarding-example-body').innerHTML.includes('Car-free Sundays'));
cards.find(c => c.dataset.style === 'facts').click();
assert.equal(host.querySelector('.is-selected').dataset.style, 'facts');
assert.ok(host.querySelector('.onboarding-example-body').innerHTML.includes('<blockquote>'), 'example follows the choice');

host.querySelector('.onboarding-skip').click();
await new Promise(r => setTimeout(r, 20));
assert.equal(done, 'facts');
const sync = store.sync || store;
const got = { ...store };
const flat = JSON.stringify(got);
assert.ok(flat.includes('"promptType":"builder"') && flat.includes('"presetPrompt":"builder"'), 'stored as builder prompt');
assert.ok(!/UX designer|standup comedian/.test(flat), 'the personal default is not applied');
console.log('ok');
