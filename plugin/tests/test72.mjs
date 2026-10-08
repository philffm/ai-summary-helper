// Keyboard phase 2: j/k + arrows through cards, "?" help sheet (filter, Esc), ⌘/Ctrl+Enter keycap, graph List view.
import { setup, imp, tick } from './harness.mjs'; import assert from 'assert';
const { w } = setup({});
const d = w.document;
globalThis.document = d; globalThis.window = w;
d.body.innerHTML = `<div id="feedSheetLayer" hidden><div role="dialog" aria-modal="true"></div></div><div id="feedScroll"><ul><li class="feed-item" tabindex="0">A</li><li class="feed-item" tabindex="0">B</li></ul></div>
<ul id="articleList"><li class="article-card" tabindex="0" data-id="x1">1</li><li class="article-card" tabindex="0" data-id="x2">2</li><li class="article-card" tabindex="0" data-id="x3">3</li></ul>`;
d.querySelectorAll('li').forEach(li => { li.getClientRects = () => [1]; });
const sc = await imp('modules/shortcuts.js');
sc.initShortcuts();
const key = (init, target = d.body) => { const e = new w.KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init }); target.dispatchEvent(e); return e; };
// lists
d.body.dataset.screen = 'history';
assert(key({ key: 'j' }).defaultPrevented); assert.equal(d.activeElement.dataset.id, 'x1', 'j from nothing → first card');
key({ key: 'j' }); assert.equal(d.activeElement.dataset.id, 'x2');
key({ key: 'ArrowDown' }, d.activeElement); assert.equal(d.activeElement.dataset.id, 'x3', 'ArrowDown on a card');
key({ key: 'ArrowDown' }, d.activeElement); assert.equal(d.activeElement.dataset.id, 'x3', 'stops at the end');
key({ key: 'k' }); assert.equal(d.activeElement.dataset.id, 'x2');
const inp = d.createElement('input'); d.body.append(inp); inp.focus();
assert(!key({ key: 'j' }, inp).defaultPrevented, 'typing is not hijacked');
d.body.dataset.screen = 'feeds'; d.activeElement.blur();
key({ key: 'j' }); assert.equal(d.activeElement.textContent, 'A'); key({ key: 'k' }); assert.equal(d.activeElement.textContent, 'A');
// help sheet
d.body.dataset.screen = 'history'; d.activeElement.blur();
assert(key({ key: '?' }).defaultPrevented);
const sheet = d.querySelector('.kbd-help'); assert(sheet, 'help opens');
assert(sheet.querySelectorAll('.kbd-row').length >= 8 && sheet.querySelector('[aria-modal]') || sheet.getAttribute('aria-modal') === 'true');
const f = sheet.querySelector('.kbd-filter'); f.value = 'summar'; f.dispatchEvent(new w.Event('input', { bubbles: true }));
const vis = [...sheet.querySelectorAll('.kbd-row:not([hidden])')].map(r => r.textContent);
assert(vis.length >= 1 && vis.every(t => /summar/i.test(t)), vis.join('|'));
key({ key: 'Escape' }, f); assert(!d.querySelector('.kbd-help'), 'Esc closes');
key({ key: '?' }); key({ key: '?' }, d.activeElement === d.body ? d.body : d.body); // toggle (focus is inside the sheet's input → ignored)
sc.closeHelp();
// composer keycap
const { createComposer } = await imp('modules/composerState.js');
d.body.innerHTML = `<div id="bar"><button id="fetchSummary"></button><textarea id="additionalQuestions"></textarea><span class="input-card-label"></span></div>`;
const c = createComposer(d.getElementById('bar'));
const b = d.getElementById('fetchSummary');
assert(/↵/.test(b.dataset.kbd) && b.getAttribute('aria-keyshortcuts'), 'keycap on Summarize');
c.set('working'); assert(!b.dataset.kbd, 'none while working'); c.set('followup'); assert(b.dataset.kbd);
// graph list view
const { renderGraphList } = await imp('modules/archiveGraph.js');
d.body.innerHTML = '<div id="g"><svg></svg></div>';
const g = d.getElementById('g'); g.getClientRects = () => [1];
const nodes = [{ id: 'tag-a', group: 'tag', label: 'politics' }, { id: 'tag-b', group: 'tag', label: 'economics' }, { id: 'article-1', group: 'article', label: 'One' }, { id: 'article-2', group: 'article', label: 'Two' }];
const links = [{ source: 'article-1', target: 'tag-a' }, { source: { id: 'article-1' }, target: { id: 'tag-b' } }, { source: 'article-2', target: 'tag-a' }];
let filtered = null; g.addEventListener('filter-by-tag', (e) => { filtered = e.detail.tag; });
renderGraphList(g, nodes, links);
assert(/2 tags, 2 articles/.test(g.querySelector('.graph-live').textContent), 'live summary');
assert(/2 tags, 2 articles/.test(g.querySelector('svg').getAttribute('aria-label')));
assert(g.querySelector('.graph-list').hidden, 'graph first');
[...g.querySelectorAll('.graph-view-toggle button')].find(x => x.textContent === 'List').click();
assert(!g.querySelector('.graph-list').hidden && g.querySelector('svg').style.visibility === 'hidden');
assert(/List view/.test(g.querySelector('.graph-live').textContent));
const items = [...g.querySelectorAll('.graph-list-item')];
assert.equal(items[0].querySelector('.graph-list-t').textContent, 'politics', 'most articles first');
assert(/2 articles · linked to economics/.test(items[0].querySelector('.graph-list-s').textContent), items[0].textContent);
items[0].click(); assert.equal(filtered, 'politics'); assert(/Filter on: politics/.test(g.querySelector('.graph-live').textContent));
key({ key: 'l' }, d.body); assert(g.querySelector('.graph-list').hidden, 'L toggles back');
console.log('TEST 72 OK'); process.exit(0);
