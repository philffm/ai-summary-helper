// Bottom dock (AISH-006.3 pattern): tabs can be reordered and hidden in Settings › Appearance; Summarize always stays,
// at least two tabs stay; the nav buttons, the screen order and the stored preference follow; bad values are repaired.
import { setup, imp, tick } from './harness.mjs';
import assert from 'assert';
const { store, w } = setup({});
const d = w.document;
const D = await imp('modules/dockPrefs.js');
const UIManager = (await imp('modules/uiManager.js')).default;

// normalize
assert.deepEqual(D.normalizeDock(null), { order: ['feeds', 'main', 'history', 'notes'], hidden: [] });
assert.deepEqual(D.normalizeDock({ order: ['notes', 'x', 'notes'], hidden: ['main', 'feeds'] }), { order: ['notes', 'feeds', 'main', 'history'], hidden: ['feeds'] }, 'unknown/duplicate ids dropped, main never hidden, new tabs appended');
assert.deepEqual(D.normalizeDock({ hidden: ['feeds', 'history', 'notes'] }).hidden, [], 'never fewer than two tabs');

globalThis.requestAnimationFrame = (f) => setTimeout(f, 0);
const ui = new UIManager();
await D.initDock(ui);
await ui.showScreen('main');
const navOrder = () => [...d.querySelectorAll('#bottomNav .nav-item')].filter(b => !b.hidden).map(b => b.dataset.screen);
assert.deepEqual(navOrder(), ['feeds', 'main', 'history', 'notes']);

// editor rows with grip + switch
const rows = () => [...d.querySelectorAll('#dockEditor [data-reorder-id]')];
assert.equal(rows().length, 4);
assert.ok(rows()[1].querySelector('input').disabled, 'Summarize cannot be hidden');
// move Notes up twice with the keyboard
let g = rows()[3].querySelector('.reorder-grip');
g.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true })); await tick(20);
g = rows()[2].querySelector('.reorder-grip');
g.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true })); await tick(20);
assert.deepEqual(navOrder(), ['feeds', 'notes', 'main', 'history'], 'nav follows');
assert.deepEqual(store.dockTabs.order, ['feeds', 'notes', 'main', 'history'], 'stored in sync');
assert.deepEqual(ui.screenOrder, ['feeds', 'notes', 'main', 'history', 'settings'], 'screens slide in dock order');
assert.ok(d.getElementById('mainScreen').style.transform.includes('translateX(0'), 'current screen stays in place');

// hide Feeds
const feedsCb = rows().find(r => r.dataset.reorderId === 'feeds').querySelector('input');
feedsCb.checked = false; feedsCb.dispatchEvent(new w.Event('change')); await tick(20);
assert.deepEqual(navOrder(), ['notes', 'main', 'history']);
assert.deepEqual(store.dockTabs.hidden, ['feeds']);
assert.equal(ui.screenOrder.at(-2), 'feeds', 'hidden screens sit after the visible ones');
// hide Notes too → only two left: the remaining switch (History) is locked
const notesCb = rows().find(r => r.dataset.reorderId === 'notes').querySelector('input');
notesCb.checked = false; notesCb.dispatchEvent(new w.Event('change')); await tick(20);
assert.ok(rows().find(r => r.dataset.reorderId === 'history').querySelector('input').disabled, 'at least two tabs stay');
// reset
d.querySelector('.dock-ed-reset').click(); await tick(20);
assert.deepEqual(navOrder(), ['feeds', 'main', 'history', 'notes']);
assert.equal(d.getElementById('dockEditor').closest('[data-panel="appearance"]') !== null, true, 'lives in Appearance');
console.log('ok');
