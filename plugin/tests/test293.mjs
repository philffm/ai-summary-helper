// The iPhone sheet (compactNav.js): "More" stays last in the bar and presses the controls that exist, a picker stands for
// History's tabs, search opens on demand, notes are written behind a plus. Only an iPhone gets any of it.
import { setup, imp, tick } from './harness.mjs'; import assert from 'assert';
const { w } = setup({});
const d = w.document;
globalThis.document = d; globalThis.window = w; globalThis.MutationObserver = w.MutationObserver;
w.matchMedia = globalThis.matchMedia = () => ({ matches: true, addEventListener() {} });
globalThis.screen = { width: 402, height: 874 };
const nav = await imp('modules/compactNav.js');
assert.ok(nav.isCompact({ userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 26_6 like Mac OS X)' }));
for (const ua of ['Mozilla/5.0 (iPad; CPU OS 26_6 like Mac OS X)', 'Mozilla/5.0 (Linux; Android 15) Mobile', 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)']) assert.ok(!nav.isCompact({ userAgent: ua }), ua);
assert.ok(!d.documentElement.dataset.compact, 'nothing happens before it is asked for');

// what History builds once it is shown
const tabs = d.createElement('div'); tabs.className = 'history-tabs';
const pressed = [];
for (const [id, label, n] of [['inbox', 'Inbox', 7], ['archive', 'Archive', 2]]) {
    const b = d.createElement('button'); b.className = 'history-tab'; b.dataset.tab = id; b.setAttribute('aria-selected', String(id === 'inbox'));
    b.innerHTML = `<span>${label}</span><span class="tabbar-n">${n}</span>`;
    b.addEventListener('click', () => { pressed.push(id); tabs.querySelectorAll('button').forEach((x) => x.setAttribute('aria-selected', String(x === b))); });
    tabs.append(b);
}
d.getElementById('historyTopBar').append(tabs);
const clicks = [];
for (const id of ['graphToggleBtn', 'settingsButton', 'feedAddBtn', 'openTabButton']) d.getElementById(id).addEventListener('click', () => clicks.push(id));

d.body.dataset.screen = 'history';
nav.initCompact(d);
assert.equal(d.documentElement.dataset.compact, '1');
const bar = d.getElementById('bottomNav'), more = d.getElementById('navMore');
assert.equal(bar.lastElementChild, more);
bar.append(bar.querySelector('[data-screen="feeds"]')); await tick(5);
assert.equal(bar.lastElementChild, more, 'still last after the tabs are put in order again');
const items = () => [...d.querySelectorAll('.compact-menu .compact-menu-item')];
const choose = (text) => items().find((b) => b.textContent.startsWith(text)).click();
more.click();
assert.deepEqual(items().map((b) => b.firstChild.textContent), ['Graph', 'Analytics', 'Settings', 'Open in new tab']);
choose('Graph'); assert.deepEqual(clicks, ['graphToggleBtn']); assert.ok(!d.querySelector('.compact-menu'), 'a choice closes the menu');
more.click(); choose('Settings'); assert.equal(clicks.at(-1), 'settingsButton');
d.body.dataset.screen = 'feeds'; more.click();
assert.ok(items().some((b) => b.textContent === 'Add feed') && !items().some((b) => b.textContent === 'List'));
choose('Add feed'); assert.equal(clicks.at(-1), 'feedAddBtn');
d.body.dataset.screen = 'main'; more.click();
assert.deepEqual(items().map((b) => b.firstChild.textContent), ['Settings', 'Open in new tab']);
more.click(); assert.ok(!d.querySelector('.compact-menu'), 'the same button closes it');

d.body.dataset.screen = 'history'; await tick(5);
const pick = d.getElementById('historyPick');
assert.ok(pick.textContent.includes('Inbox') && pick.textContent.includes('7'));
pick.click(); choose('Archive'); await tick(90);
assert.deepEqual(pressed, ['archive']); assert.ok(pick.textContent.includes('Archive'), 'the picker says what is shown');

const search = d.querySelector('#historyTopBar .compact-search'), top = d.getElementById('historyTopBar');
search.click(); assert.ok(top.classList.contains('compact-open') && search.getAttribute('aria-expanded') === 'true');
const field = d.getElementById('searchInput'); field.value = 'sleep'; field.dispatchEvent(new w.Event('input', { bubbles: true }));
assert.ok(search.classList.contains('is-narrowed'), 'a dot says that something narrows the list');

const notesScreen = d.getElementById('notesScreen'), plus = d.getElementById('notesPlus');
assert.ok(!notesScreen.classList.contains('compact-writing'));
plus.click(); assert.ok(notesScreen.classList.contains('compact-writing') && d.body.classList.contains('compact-writing'));
assert.equal(plus.parentElement, d.body, 'outside the sliding screens: inside one it would scroll with the list');
assert.equal(d.querySelector('#bottomNav [data-screen="main"] .nav-label').textContent, 'Page');
assert.ok(d.querySelector('#mainScreen .compact-options'), 'the page\'s options sit behind one chip');
// the layout leans on markup other modules build: a rename there must fail here, not on a phone
import fs from 'fs'; import path from 'path';
const source = (f) => fs.readFileSync(path.join(process.env.AISH_SRC, f), 'utf8');
for (const [file, names] of [['modules/articleManager.js', ["'history-tab tabbar-btn'", 'tabbar-n', "'aria-selected'"]],
    ['modules/notesView.js', ["'notes-bar'", "'notes-filters'", "'notesViewToggle'", "'notesInput'", "'notesComposer'", 'notes-add', 'is-selected']]]) {
    for (const name of names) assert.ok(source(file).includes(name), `${file} no longer has ${name}: see modules/compactNav.js`);
}
const popup = source('popup.html');
for (const id of ['bottomNav', 'historyTopBar', 'historyTopRow', 'searchInputWrap', 'graphToggleBtn', 'reportToggleBtn', 'feedControls', 'feedRefreshBtn', 'feedAddBtn', 'feedGraphBtn', 'feedInsightsBtn', 'feedChipRow', 'feedScopeRow', 'settingsButton', 'openTabButton', 'chipLanguageLabel', 'chipLengthLabel', 'chipModelLabel', 'notesRoot'])
    assert.ok(popup.includes(`id="${id}"`), `popup.html no longer has #${id}: see modules/compactNav.js`);
console.log('compact nav ok');
