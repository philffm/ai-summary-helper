// Back to top (Feeds + History lists): shows after scrolling a list, scrolls that list to the top, stays away on other screens and in the detail view.
import assert from 'assert';
import { setup, imp } from './harness.mjs';
const { w } = setup({}); const d = w.document;
globalThis.window = w; globalThis.document = d;
const { initBackToTop } = await imp('modules/backToTop.js');
initBackToTop(d);
initBackToTop(d);
const btn = d.getElementById('backToTopBtn');
assert(btn && d.querySelectorAll('#backToTopBtn').length === 1, 'one button, created once');
assert(btn.getAttribute('aria-label'), 'has an accessible name');
assert.equal(btn.getAttribute('aria-hidden'), 'true', 'hidden at first');

const scrolled = (el, top) => {
  Object.defineProperty(el, 'clientHeight', { configurable: true, value: 500 });
  el.scrollTop = top;
  el.dispatchEvent(new w.Event('scroll'));
};
const feeds = d.getElementById('feedsScreen'), hist = d.getElementById('historyScreen');
let scrolledTo = null;
feeds.scrollTo = (o) => { scrolledTo = o; feeds.scrollTop = o.top; };

d.body.dataset.screen = 'feeds';
scrolledTo = null;
scrolled(feeds, 100);
assert(!btn.classList.contains('is-on'), 'not shown near the top');
scrolled(feeds, 900);
assert(btn.classList.contains('is-on') && btn.getAttribute('aria-hidden') === 'false', 'shown after scrolling a screen');
btn.click();
assert.equal(scrolledTo && scrolledTo.top, 0, 'click scrolls the list back to the top');
scrolled(feeds, 0);
assert(!btn.classList.contains('is-on'), 'gone again at the top');

// the History detail view has its own reading tools: no second button there
d.body.dataset.screen = 'history';
await new Promise((r) => setTimeout(r, 0));
const detail = d.getElementById('articleDetail');
Object.defineProperty(detail, 'getClientRects', { configurable: true, value: () => [{}] });
detail.style.display = 'block';
scrolled(hist, 1200);
assert(!btn.classList.contains('is-on'), 'not on top of the detail view');
detail.style.display = 'none';
scrolled(hist, 1200);
assert(btn.classList.contains('is-on'), 'shown in the History list');

// other screens: never
d.body.dataset.screen = 'settings';
await new Promise((r) => setTimeout(r, 0));
assert(!btn.classList.contains('is-on'), 'hidden when the screen changes');
scrolled(feeds, 1200);
assert(!btn.classList.contains('is-on'), 'not on other screens');
console.log('TEST 124 OK'); process.exit(0);
