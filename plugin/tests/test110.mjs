// Accessibility: every static button has an accessible name, feed scope row is a tablist, Esc closes a trapped sheet.
import assert from 'assert';
import { setup, imp } from './harness.mjs';
const { w } = setup({}); const d = w.document;
const JS_NAMED = new Set(['onboardingCustomApiBtn', 'onboardingOllamaBtn', 'libraryToolButton']);   // text is filled in by JS
const name = (b) => (b.getAttribute('aria-label') || b.getAttribute('aria-labelledby') || b.textContent).trim().replace(/[^\p{L}\p{N}]/gu, '');
const bad = [...d.querySelectorAll('button')].filter(b => !name(b) && !JS_NAMED.has(b.id)).map(b => b.id || b.className);
assert.deepEqual(bad, [], 'buttons without an accessible name: ' + bad.join(', '));
assert.equal(d.getElementById('feedScopeRow').getAttribute('role'), 'tablist');

const { trapFocus } = await imp('modules/sheet.js');
const opener = d.createElement('button'); d.body.append(opener); opener.focus();
const dlg = d.createElement('div'); const inner = d.createElement('button'); inner.textContent = 'x'; dlg.append(inner); d.body.append(dlg);
let closed = 0, trap;
trap = trapFocus(dlg, { onEscape: () => { closed++; trap.release(); } });
d.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
assert.equal(closed, 1, 'Esc calls onEscape');
assert.equal(d.activeElement, opener, 'focus returns to opener');
d.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
assert.equal(closed, 1, 'released trap ignores Esc');
console.log('ok');
