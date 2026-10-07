// On-page highlights panel: split pill with Summarize, footer action, busy state.
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
assert(body.querySelector('.split .pill') && body.querySelector('.split .sum'), 'split pill');
assert(body.querySelector('.sum').textContent.includes('Summarize'));
body.querySelector('.sum').click(); await tick(10);
assert.equal(calls, 1, 'summarize called');
assert(body.querySelector('.sum').disabled && /Summarizing/.test(body.querySelector('.sum').textContent), 'busy');
body.querySelector('.sum').click(); assert.equal(calls, 1, 'no double start');
release(); await tick(20);
assert(!body.querySelector('.sum').disabled, 'busy cleared');
body.querySelector('.pill').click(); await tick(5);
assert(body.querySelector('.foot .go'), 'footer action when open');
assert(/1 of your highlights become the focus/.test(body.querySelector('.foot').textContent));
body.querySelector('.go').click(); await tick(10);
assert.equal(calls, 2);
release(); await tick(10);
console.log('test48 ok');
