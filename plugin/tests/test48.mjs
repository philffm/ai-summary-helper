// On-page highlights panel: split pill with Summarize (the one Primary, AISH-039), what it does, busy state.
import assert from 'assert';
import { setup, imp, tick } from './harness.mjs';
const { w } = setup({}); const d = w.document;
const P = await imp('content/highlightPanel.js');
let calls = 0; let release;
const actions = { jump() {}, remove() {}, keep() {}, reattach() {}, pending: () => false,
  summarize: () => { calls++; return new Promise((r) => { release = r; }); } };
const items = [{ id: 'a', type: 'user', text: 'Hello world', status: 'ok', frac: 0.2 }];
P.hlpRender(items, actions);
const host = d.getElementById('aish-highlight-panel') || d.querySelector('[id^="aish-"]');
assert(host, 'panel host exists');
const body = host._body;
assert(body, 'body reachable');
assert(body.querySelector('.hlp-split .hlp-pill') && body.querySelector('.hlp-split .hlp-sum'), 'split pill');
assert(body.querySelector('.hlp-sum').textContent.includes('Summarize'));
body.querySelector('.hlp-sum').click(); await tick(10);
assert.equal(calls, 1, 'summarize called');
assert(body.querySelector('.hlp-sum').disabled && /Summarizing/.test(body.querySelector('.hlp-sum').textContent), 'busy');
body.querySelector('.hlp-sum').click(); assert.equal(calls, 1, 'no double start');
release(); await tick(20);
assert(!body.querySelector('.hlp-sum').disabled, 'busy cleared');
assert(/1 of your highlights become the focus/.test(body.querySelector('.hlp-sum').title), 'the button says what it does');
body.querySelector('.hlp-pill').click(); await tick(5);
assert.equal(body.querySelector('.hlp-pill').getAttribute('aria-expanded'), 'true');
assert.equal(body.querySelectorAll('[data-act="summarize"]').length, 1, 'one Summarize, not a second one in the panel');
assert(/1 of your highlights become the focus/.test(body.querySelector('.hlp-sum-note').textContent), 'the panel says what Summarize does');
body.querySelector('.hlp-sum').click(); await tick(10);
assert.equal(calls, 2);
release(); await tick(10);
// filter: Pill segmented with counts, a radiogroup; Esc closes and gives focus back to the pill
const radios = [...body.querySelectorAll('.hlp-seg [role=radio]')];
assert.deepEqual(radios.map((r) => r.textContent), ['All · 1', 'Yours · 1', 'AI · 0']);
assert.equal(radios[0].getAttribute('aria-checked'), 'true');
radios[0].dispatchEvent(new w.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
assert.equal(body.querySelector('.hlp-seg [aria-checked="true"]').dataset.filter, 'user', '→ moves the filter');
body.querySelector('.hlp-panel').dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
assert(!body.querySelector('.hlp-panel'), 'Esc closes the panel');
// no styles in the script: the look comes from inPage.css
const fs = await import('fs'); const path = await import('path');
const src = fs.readFileSync(path.resolve(process.env.AISH_SRC, 'content/highlightPanel.js'), 'utf8');
assert(!/<style|#[0-9a-f]{6}\b/i.test(src), 'no inline CSS or colours in highlightPanel.js');
console.log('test48 ok');
