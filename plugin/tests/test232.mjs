// The naming page for a big archive: a progress bar over all batches, every batch listed as it is saved (not only the first 40),
// rows that can be changed or skipped before saving, and an option to check every batch instead of naming the rest blind.
import { setup, tick } from './harness.mjs'; import assert from 'assert';
import path from 'path'; import { pathToFileURL } from 'url';
const { w } = setup({});
const d = w.document;
globalThis.document = d; globalThis.window = w;
const load = (rel) => import(pathToFileURL(path.join(process.env.AISH_SRC, rel)).href);
const gn = await load('modules/graphTagNaming.js');
const tc = await load('modules/topicConcepts.js');
const ai = await load('modules/feedAi.js');
const wait = async (ok) => { for (let i = 0; i < 200 && !ok(); i++) await tick(5); };

const reply = async ({ user }) => user.split('\n').map((l, k) => { const t = l.replace(/^\[\d+\]\s*/, ''); return `${k + 1}:${t} (broader: Gadgets)`; }).join(' | ');
const many = Array.from({ length: 130 }, (_, i) => ({ id: 'm' + i, tags: ['Thing ' + i, '🌐 en'] }));
const deps = { ai, route: { service: '', local: true, label: 'local' }, saveLexicon: async () => {} };

// ── blind run: progress and all rows ──
tc.setLexicon({});
let progressSeen = [];
ai.setAiTransport(async (r) => { const m = d.querySelector('.graph-naming-meter'); if (m) progressSeen.push(m.value); return reply(r); });
const box = d.createElement('div'); d.body.append(box);
let done = null;
await gn.openTagNamingPage(box, { articles: many, onDone: (n) => { done = n; } }, deps);
const page = box.querySelector('.graph-naming-page');
page.querySelector('.graph-naming-try').click();
await wait(() => page.querySelector('.graph-naming-row'));
assert.equal(page.querySelectorAll('.graph-naming-row').length, 40);
assert.ok(!page.querySelector('.graph-naming-progress').hidden, 'the progress bar is there from the start');
assert.ok(/0 of 130 tags/.test(page.querySelector('.graph-naming-count').textContent));
// change one row, skip another
const rows = page.querySelectorAll('.graph-naming-row');
rows[0].querySelector('.graph-naming-en-input').value = 'first thing';
rows[0].querySelector('.graph-naming-en-input').dispatchEvent(new w.Event('input'));
rows[0].querySelector('.graph-naming-broader-input').value = 'Hardware, Toys';
const skip = rows[1].querySelector('.graph-naming-skip-box'); skip.checked = true; skip.dispatchEvent(new w.Event('change'));
assert.ok(rows[1].classList.contains('is-skipped'));
page.querySelector('.graph-naming-save-all').click();
await wait(() => done !== null);
assert.equal(page.querySelectorAll('.graph-naming-row').length, 130, 'every batch is listed as it is saved');
assert.deepEqual(progressSeen, [0, 40, 80, 120], 'the bar moves with every batch');
assert.equal(page.querySelector('.graph-naming-meter').value, 130);
assert.ok(/130 of 130 tags/.test(page.querySelector('.graph-naming-count').textContent));
assert.equal(done, 129, 'the skipped one is not counted');
assert.equal(page.querySelectorAll('.graph-naming-en-input').length, 0, 'saved rows are plain text');
assert.equal(tc.conceptKey('Thing 0'), tc.conceptKey('first thing'), 'the changed name is the one saved');
assert.deepEqual(tc.broaderKeysOf('Thing 0'), [tc.conceptKey('hardware'), tc.conceptKey('toys')], 'with the changed broader topics');
assert.deepEqual(tc.broaderKeysOf('Thing 5'), [tc.conceptKey('gadgets')]);
assert.ok(gn.tagsToName(many).includes('Thing 1'), 'a skipped tag is not learned, so it is asked again next time');
assert.ok(/\(skipped\)/.test(rows[1].textContent));

// ── check every batch ──
tc.setLexicon({});
let calls = 0;
ai.setAiTransport(async (r) => { calls++; return reply(r); });
const box2 = d.createElement('div'); d.body.append(box2);
const dones = [];
await gn.openTagNamingPage(box2, { articles: many.slice(0, 90), onDone: (n) => dones.push(n) }, deps);
const p2 = box2.querySelector('.graph-naming-page');
p2.querySelector('.graph-naming-try').click();
await wait(() => p2.querySelector('.graph-naming-row'));
const next = p2.querySelector('.graph-naming-save-next');
assert.ok(!next.hidden && /check the next 40/.test(next.textContent), next.textContent);
next.click();
await wait(() => p2.querySelectorAll('.graph-naming-row').length === 80 && !p2.querySelector('.graph-naming-save-next').hidden);
assert.equal(calls, 2, 'one batch at a time');
assert.equal(p2.querySelectorAll('.graph-naming-row').length, 80, 'the saved batch stays listed, the new one below it');
assert.equal(p2.querySelectorAll('.graph-naming-en-input').length, 40, 'only the new batch can still be changed');
assert.deepEqual(dones, [40]);
p2.querySelectorAll('.graph-naming-skip-box')[0].checked = true;
p2.querySelector('.graph-naming-save-next').click();
await wait(() => p2.querySelectorAll('.graph-naming-row').length === 90);
await wait(() => !p2.querySelector('.graph-naming-save-first').hidden);
assert.ok(p2.querySelector('.graph-naming-save-next').hidden && p2.querySelector('.graph-naming-save-all').hidden, 'the last batch: nothing after it');
assert.equal(p2.querySelector('.graph-naming-save-first').textContent, 'Save');
p2.querySelector('.graph-naming-save-first').click();
await wait(() => dones.length === 3);
assert.deepEqual(dones, [40, 79, 89]);
assert.ok(/90 of 90 tags/.test(p2.querySelector('.graph-naming-count').textContent));
ai.setAiTransport(null);
console.log('naming progress ok');
