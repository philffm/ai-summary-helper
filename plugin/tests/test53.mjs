// Accessibility: shared focus trap, tab roles + arrow keys, language search below the list.
import assert from 'assert';
import { setup, imp, tick } from './harness.mjs';
const { w } = setup({}); const d = w.document;
const { trapFocus } = await imp('modules/sheet.js');
const { syncTabbar } = await imp('modules/tabbar.js');
const rect = [{}];
w.HTMLElement.prototype.getClientRects = () => rect;   // jsdom has no layout: treat everything as rendered

// language panel: list first, search last (so the box doesn't move while the list shrinks)
const panel = d.getElementById('panelLanguage');
const kids = [...panel.children].map(c => c.id || c.tagName.toLowerCase());
assert(kids.indexOf('languageTagGrid') < kids.indexOf('languageSearch'), 'search below the list: ' + kids);
assert(d.getElementById('languageSearch').getAttribute('aria-label'), 'search labelled');
for (const id of ['addKindleDeviceButton', 'addLocalSendDeviceButton', 'feedMoodChip']) assert(d.getElementById(id).getAttribute('aria-label'), id + ' labelled');

// focus trap
const opener = d.createElement('button'); opener.textContent = 'open'; d.body.appendChild(opener); opener.focus();
const dlg = d.createElement('div'); dlg.innerHTML = '<button id="a">A</button><button id="b">B</button>'; d.body.appendChild(dlg);
const trap = trapFocus(dlg, { label: 'Test sheet' });
assert.equal(dlg.getAttribute('role'), 'dialog'); assert.equal(dlg.getAttribute('aria-modal'), 'true'); assert.equal(dlg.getAttribute('aria-label'), 'Test sheet');
assert.equal(d.activeElement.id, 'a', 'focus moved in');
d.getElementById('b').focus();
const tab = (shift) => { const e = new w.KeyboardEvent('keydown', { key: 'Tab', shiftKey: !!shift, bubbles: true, cancelable: true }); d.activeElement.dispatchEvent(e); return e.defaultPrevented; };
assert(tab(false) && d.activeElement.id === 'a', 'Tab wraps to first');
assert(tab(true) && d.activeElement.id === 'b', 'Shift+Tab wraps to last');
trap.release();
assert.equal(d.activeElement, opener, 'focus restored');

// tabs
const bar = d.createElement('div'); bar.className = 'tabbar'; bar.dataset.tabbar = 't';
let clicked = [];
['one', 'two', 'three'].forEach((n, i) => { const b = d.createElement('button'); b.className = 'tabbar-btn' + (i === 0 ? ' on' : ''); b.textContent = n; b.addEventListener('click', () => clicked.push(n)); bar.appendChild(b); });
d.body.appendChild(bar);
syncTabbar(bar);
const tabs = [...bar.querySelectorAll('.tabbar-btn')];
assert.equal(bar.getAttribute('role'), 'tablist');
assert(tabs.every(t => t.getAttribute('role') === 'tab'));
assert.deepEqual(tabs.map(t => t.getAttribute('aria-selected')), ['true', 'false', 'false']);
assert.deepEqual(tabs.map(t => t.tabIndex), [0, -1, -1]);
tabs[0].focus();
const key = (k) => tabs.forEach(() => {}) || d.activeElement.dispatchEvent(new w.KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));
key('ArrowRight'); assert.equal(d.activeElement, tabs[1]); assert.deepEqual(clicked, ['two']);
key('End'); assert.equal(d.activeElement, tabs[2]);
key('ArrowRight'); assert.equal(d.activeElement, tabs[0], 'wraps');
key('ArrowLeft'); assert.equal(d.activeElement, tabs[2]);
console.log('TEST 53 OK');
process.exit(0);
