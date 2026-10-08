// Card ⋯ menu: items depend on the article, one popover at a time, Escape closes, Delete is last and marked dangerous.
import assert from 'assert';
import { setup, imp, tick } from './harness.mjs';
const { w } = setup({}); const d = w.document;
chrome.runtime.getURL = (p) => 'chrome-extension://abc/' + p;
const CM = await imp('modules/cardMenu.js');
const art = { id: 'a1', title: 'T', url: 'https://a.example.com/x', summary: '<p>Hello world. Second sentence here.</p>', timestamp: 1 };
const host = d.createElement('div'); d.body.appendChild(host);
const btn = CM.attachCardMenu(host, art);
assert.equal(btn.getAttribute('aria-haspopup'), 'menu'); assert.equal(btn.getAttribute('aria-expanded'), 'false');
btn.click(); await tick(20);
const menu = d.querySelector('.card-menu'); assert(menu, 'menu opens');
const labels = [...menu.querySelectorAll('.card-menu-item')].map(b => b.lastChild.textContent);
for (const l of ['Open original', 'Copy', 'Send via LocalSend', 'Send to Kindle', 'Export as Markdown', 'Archive', 'Delete']) assert(labels.includes(l), 'has ' + l + ' in ' + JSON.stringify(labels));
const items = [...menu.querySelectorAll('.card-menu-item')];
assert(items[items.length - 1].classList.contains('is-danger'), 'Delete last + danger');
assert.equal(btn.getAttribute('aria-expanded'), 'true');
// second card: opening it closes the first
const host2 = d.createElement('div'); d.body.appendChild(host2);
const btn2 = CM.attachCardMenu(host2, { id: 'b2', url: 'https://b.example.com', feedStub: true, summary: '' });
btn2.click(); await tick(20);
assert.equal(d.querySelectorAll('.card-menu').length, 1, 'one popover at a time');
const l2 = [...d.querySelectorAll('.card-menu-item')].map(b => b.lastChild.textContent);
assert.equal(l2.length, 2, 'stub: only open + delete: ' + JSON.stringify(l2));
d.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
await tick(20);
assert.equal(d.querySelectorAll('.card-menu').length, 0, 'Escape closes');
assert.equal(btn2.getAttribute('aria-expanded'), 'false');
// cardMenu imports sendSheet statically (unsuffixed URL), so share that instance rather than imp()'s cache-busted copy
const SS = await import(new URL('../src/modules/sendSheet.js', import.meta.url).href);
const li = d.createElement('li'); d.body.appendChild(li); SS.registerCard(art, li);
assert(CM.menuItems(art).some(i => i.label === 'Select'), 'Select offered for registered summarized card');
assert(!CM.menuItems({ id: 'z', summary: '<p>x</p>' }).some(i => i.label === 'Select'), 'not for unregistered');
CM.menuItems(art).find(i => i.label === 'Select').run();
assert(SS.selectionActive() && li.classList.contains('sel-on'), 'selection mode on, card ticked');
console.log('TEST 83 OK');
