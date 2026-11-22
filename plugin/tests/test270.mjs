// Command palette (⌘K): ranking, the dialog (keyboard, aria), article search, and the shortcut that opens it.
import { setup, imp, tick } from './harness.mjs'; import assert from 'assert';
const { w } = setup({});
const { rankCommands, scoreCommand, openPalette, closePalette, paletteOpen } = await imp('../src/modules/commandPalette.js');
const { buildCommands, articleCommands } = await imp('../src/modules/commands.js');

const cmds = [
  { id: 'a', group: 'Go to', title: 'History', keywords: 'library articles' },
  { id: 'b', group: 'Go to', title: 'Settings', keywords: 'preferences' },
  { id: 'c', group: 'Settings', title: 'Publish my library', keywords: 'sync backup' },
  { id: 'd', group: 'Actions', title: 'Sync now', keywords: 'backup' },
];
assert.deepEqual(rankCommands(cmds, '').map((c) => c.id), ['a', 'b', 'c', 'd'], 'no query keeps the order');
assert.equal(rankCommands(cmds, 'sync')[0].id, 'd', 'title start beats keyword hit');
assert.deepEqual(rankCommands(cmds, 'backup').map((c) => c.id), ['c', 'd'], 'keywords match, equal scores keep order');
assert.equal(rankCommands(cmds, 'zzz').length, 0);
assert.equal(rankCommands(cmds, 'sync zzz').length, 0, 'every word must match');
assert(scoreCommand({ title: 'Über Größe' }, 'uber') > 0, 'accents are ignored');

const ui = { shown: [], showScreen(n) { this.shown.push(n); } };
const built = buildCommands(ui, { settingsEntries: () => [{ panel: 'sync', title: 'Sync & backup', target: 'syncSettings', kw: 'backup' }], openSettingsPanel: (p, t) => ui.shown.push(p + ':' + t) });
assert(built.some((c) => c.id === 'go:history') && built.some((c) => c.id === 'set:sync:syncSettings'), 'screens and settings are offered');

const idx = [
  { id: 'x1', title: 'How heat pumps work', url: 'https://www.example.com/heat', tags: ['energy'], timestamp: '2026-01-01' },
  { id: 'x2', title: 'Grid connection', url: 'https://grid.org/a', tags: ['energy'], timestamp: '2026-02-01' },
];
const opened = [];
const art = articleCommands(idx, 'energy', (a) => opened.push(a.id));
assert.deepEqual(art.map((c) => c.id), ['article:x2', 'article:x1'], 'tag hit; newest first; sub = host');
assert.equal(art[1].sub, 'example.com');

// the dialog
const d = w.document; d.body.innerHTML = '';
openPalette({ doc: d, getCommands: () => built, findMore: async (q) => articleCommands(idx, q, (a) => opened.push(a.id)) });
assert(paletteOpen() && d.querySelector('.cmdk [role="listbox"]'), 'opens');
const input = d.querySelector('.cmdk-input');
assert(d.querySelectorAll('.cmdk-item').length > 5, 'all commands show first: ' + d.querySelectorAll('.cmdk-item').length + ' / shown');
input.value = 'grid'; input.dispatchEvent(new w.Event('input')); await tick(50);
assert(/Grid connection/.test(d.querySelector('.cmdk-list').textContent), 'article results are appended');
const key = (k) => d.querySelector('.cmdk').dispatchEvent(new w.KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));
key('Enter'); await tick(50);
assert.deepEqual(opened, ['x2'], 'Enter runs the highlighted entry');
assert(!paletteOpen() && !d.querySelector('.cmdk'), 'runs and closes');

openPalette({ doc: d, getCommands: () => built });
input.value = ''; const i2 = d.querySelector('.cmdk-input'); i2.value = 'history'; i2.dispatchEvent(new w.Event('input'));
key('ArrowDown'); assert.equal(d.querySelector('[aria-selected="true"]').id, 'cmdk-0', 'a single hit stays selected');
key('Escape'); assert(!paletteOpen(), 'Escape closes');
openPalette({ doc: d, getCommands: () => built }); closePalette(); assert(!d.querySelector('.cmdk'), 'closePalette');
console.log('TEST 270 OK'); process.exit(0);
