// Keyboard: central ⌘F / Ctrl+F + "/" search focus per screen, platform hint, Esc back, focusable history cards.
import { setup, imp, tick } from './harness.mjs'; import assert from 'assert';
const { store, w } = setup({});
const d = w.document;
globalThis.document = d; globalThis.window = w;
d.body.innerHTML = `<div id="feedControls" class="scroll-hidden"></div><input id="feedSearch" placeholder="Search feeds…">
<div id="historyTopBar" style="display:flex"></div><input id="searchInput" placeholder="Search articles... (⌘ + F)">
<div id="settingsHome"><input id="settingsSearch" placeholder="Search settings…"></div>
<div id="articleDetail" style="display:none"></div><button id="detailBackButton">back</button>`;
const sc = await imp('modules/shortcuts.js');
let backClicks = 0; d.getElementById('detailBackButton').addEventListener('click', () => { backClicks++; });
sc.initShortcuts();
assert.equal(d.getElementById('searchInput').placeholder, 'Search articles... (' + sc.searchHint() + ')', 'old ⌘ hint replaced by the platform hint');
assert(/\(Ctrl \+ F\)$/.test(d.getElementById('settingsSearch').placeholder) || /\(⌘ \+ F\)$/.test(d.getElementById('settingsSearch').placeholder));
sc.applySearchHints(); assert.equal((d.getElementById('feedSearch').placeholder.match(/\(/g) || []).length, 1, 'hint is idempotent');
const key = (init, target = d.body) => { const e = new w.KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init }); target.dispatchEvent(e); return e; };
const mod = sc.isMac() ? { metaKey: true } : { ctrlKey: true };
for (const [screen, id] of [['feeds', 'feedSearch'], ['history', 'searchInput'], ['settings', 'settingsSearch']]) {
  d.body.dataset.screen = screen; d.activeElement && d.activeElement.blur();
  const e = key({ key: 'f', ...mod }); await tick(10);
  assert(e.defaultPrevented, screen + ': shortcut handled'); assert.equal(d.activeElement.id, id, screen + ': search focused');
}
assert(!d.getElementById('feedControls').classList.contains('scroll-hidden'), 'feed control bar is revealed');
d.body.dataset.screen = 'main'; d.activeElement.blur();
assert(!key({ key: 'f', ...mod }).defaultPrevented, 'no search on the Summarize screen');
d.body.dataset.screen = 'feeds'; d.activeElement.blur();
key({ key: '/' }); await tick(10); assert.equal(d.activeElement.id, 'feedSearch', '"/" focuses search');
const typing = d.getElementById('searchInput'); typing.focus(); d.body.dataset.screen = 'history';
assert(!key({ key: '/' }, typing).defaultPrevented, '"/" is a normal character while typing');
// Esc in the detail view goes back
d.getElementById('articleDetail').style.display = 'block'; d.activeElement.blur();
key({ key: 'Escape' }); assert.equal(backClicks, 1, 'Esc = back from the detail view');
d.getElementById('historyTopBar').style.display = 'none';
// history cards are keyboard reachable
const src = (await import('fs')).readFileSync(new URL('../src/modules/articleManager.js', import.meta.url), 'utf8');
assert(/listItem\.tabIndex = 0; listItem\.setAttribute\('role', 'button'\)/.test(src) && /event\.key !== 'Enter' && event\.key !== ' '/.test(src));
console.log('TEST 71 OK');
