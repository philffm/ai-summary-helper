// The app beside the reading view / home page: no Summarize tab (the tab count and the screen order follow), and the palette on those pages lists the settings.
import { setup, imp, tick } from './harness.mjs'; import assert from 'assert';
const { w } = setup({});
const d = w.document;
d.body.innerHTML = '<nav id="bottomNav">' + ['feeds', 'main', 'history', 'notes'].map((s) => `<button class="nav-item" data-screen="${s}"><span class="nav-label">${s}</span></button>`).join('') + '</nav>';
const D = await imp('modules/dockPrefs.js');
const orders = []; 
D.applyDock(null, 'float');   // (initDock does the same with the page's own surface)
D.setUi && D.setUi({ setScreenOrder: (o) => orders.push(o) });
const nav = d.getElementById('bottomNav');
assert.equal(d.querySelector('[data-screen="main"]').hidden, true, 'Summarize is not offered beside our own page');
assert.equal(nav.dataset.tabs, '3', 'the tab count says three, so the indicator is placed for three tabs');
D.applyDock(null, 'popup');
assert.equal(d.querySelector('[data-screen="main"]').hidden, false, 'in the popup Summarize is back'); assert.equal(nav.dataset.tabs, '4');

// palette entries on pages that are not the popup
chrome.runtime.getURL = (p) => 'chrome-extension://x/' + p;
const { externalCommands } = await imp('modules/paletteExternal.js');
const opened = [];
const cmds = externalCommands({ openScreen: (n) => opened.push(n) });
const home = cmds.find((c) => c.id === 'set:home:openHomeButton');
assert(home && home.group === 'Settings', 'every setting of the app is in the list');
home.run(); assert.deepEqual(opened, ['settings/home/openHomeButton'], 'it opens the app on that setting');
assert(cmds.filter((c) => c.group === 'Settings').length > 40, 'all panels and controls');
console.log('TEST 275 OK'); process.exit(0);
