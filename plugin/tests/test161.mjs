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

// fresh mount for the “make it yours” part (Done above was already used)
host.textContent = '';
m.mountStyleStep(host, { onDone: (id) => { done = id; } });
// ── Make it yours: mindset, interests, length, own tags (keeps the templates above as the starting point) ──
const click = (sel) => host.querySelector(sel).click();
assert.ok(host.querySelector('.onboarding-style.is-selected'), 'templates stay');
click('[data-chip="lens-stoic"]');
assert.ok(host.querySelector('.onboarding-example-body').innerHTML.includes('Stoic') === false && host.querySelector('.onboarding-example-body').innerHTML.includes('🏛'), 'lens adds a line to the example');
click('[data-chip="focus-media"]');
assert.ok(host.querySelector('.onboarding-example-body').innerHTML.includes('Walkable City'));
const inp = host.querySelector('.onboarding-tag-input');
inp.value = 'UX designer'; host.querySelector('.onboarding-tag-add').click();
inp.value = 'ux designer'; host.querySelector('.onboarding-tag-add').click(); // duplicate ignored
inp.value = 'parent of two'; inp.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
assert.deepEqual([...host.querySelectorAll('[data-chip="tag"]')].map(b => b.textContent.replace(/\s*✕$/, '')), ['UX designer', 'parent of two']);
assert.ok(host.querySelector('.onboarding-prompt-text').textContent.includes('About me: UX designer, parent of two'), 'prompt preview shows the tags');
click('[data-chip="tag"]'); // remove first
assert.equal(host.querySelectorAll('[data-chip="tag"]').length, 1);
// picking another template keeps the tags but resets mindset/interests to that template
host.querySelectorAll('.onboarding-style').forEach(c => { if (c.dataset.style === 'actions') c.click(); });
assert.equal(host.querySelectorAll('[data-chip="tag"]').length, 1, 'tags survive a template change');
assert.ok(!host.querySelector('[data-chip="lens-stoic"]').classList.contains('on'), 'template change resets the lens');
click('[data-chip="lens-skeptic"]');
done = null;
host.querySelector('.onboarding-skip').click();
await new Promise(r => setTimeout(r, 20));
assert.equal(done, 'actions');
const saved = Object.values(store).find(v => v && typeof v === 'object' && v.lens) || store.promptBuilder;
assert.equal(saved.lens, 'skeptic'); assert.deepEqual(saved.about, ['parent of two']);
assert.ok(JSON.stringify(store).includes('About me: parent of two'), 'stored prompt contains the tag line');
console.log('ok');
