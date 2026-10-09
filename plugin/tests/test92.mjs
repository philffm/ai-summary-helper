// Side panel attach/detach (Chrome): the header button docks the popup into the side panel and undocks it again;
// inside the side panel the popup never re-opens/closes itself; the order of calls keeps the user gesture.
import assert from 'assert'; import fs from 'fs';
import { setup, imp, tick, SRC } from './harness.mjs';

// 1. module on its own
const P = await imp('modules/panelDock.js');
assert.equal(P.currentSurface('?surface=sidepanel'), 'sidepanel');
assert.equal(P.currentSurface(''), 'popup'); assert.equal(P.currentSurface('?surface=x'), 'popup');
assert.equal(P.currentSurface('', '#aish-sidebar=123e4567-e89b-42d3-a456-426614174000'), 'inpage', 'in-page sidebar iframe');
assert.equal(P.currentSurface('', '#other'), 'popup');
assert(!P.sidePanelAvailable(null) && !P.sidePanelAvailable({}) && !P.sidePanelAvailable({ sidePanel: { open() {} } }), 'needs open + setPanelBehavior');
const fake = (opts = {}) => {
  const calls = [], sync = {};
  const api = {
    calls, sync,
    sidePanel: { open: async (o) => { calls.push(['open', o]); if (opts.openFails) throw new Error('no gesture'); },
      setPanelBehavior: async (o) => { calls.push(['behavior', o]); },
      ...(opts.noClose ? {} : { close: async (o) => { calls.push(['close', o]); } }) },
    storage: { sync: { set: async (o) => { calls.push(['set', o]); Object.assign(sync, o); } } },
    action: { openPopup: async () => { calls.push(['openPopup', sync.useNativeSidePanel]); if (opts.popupFails) throw new Error('not focused'); } }
  };
  return api;
};
let a = fake();
await P.attachToSidePanel(7, a);
assert.deepEqual(a.calls.map(c => c[0]), ['open', 'set'], 'panel opens first (inside the click), then the setting is saved');
assert.deepEqual(a.calls[0][1], { windowId: 7 }); assert.equal(a.sync.useNativeSidePanel, true);
a = fake({ openFails: true });
await assert.rejects(P.attachToSidePanel(7, a), /no gesture/, 'a failed open is reported to the caller');
assert.equal(a.sync.useNativeSidePanel, undefined, 'setting unchanged when the panel did not open');
a = fake(); let closed = 0; const win = { close: () => { closed++; } };
let r = await P.detachToPopup(7, a, win);
assert.deepEqual(a.calls.map(c => c[0]), ['set', 'behavior', 'openPopup', 'close'], 'setting saved before the popup opens, then the panel closes');
assert.equal(a.calls[2][1], false, 'the popup starts with useNativeSidePanel already false (it will not re-attach)');
assert(r.popupOpened && closed === 0);
a = fake({ noClose: true, popupFails: true }); closed = 0;
r = await P.detachToPopup(7, a, win);
assert(!r.popupOpened && closed === 1 && a.sync.useNativeSidePanel === false, 'older Chrome: window.close() and the icon opens the popup next time');

// 2. manifest: the side panel tells the page where it runs
const ch = JSON.parse(fs.readFileSync(SRC + '/../platforms/chrome/manifest.json', 'utf8'));
assert.equal(ch.side_panel.default_path, 'popup.html?surface=sidepanel');

// 3. popup.js booted inside the side panel with attach mode on
const { w, store } = setup({}); const d = w.document;
// jsdom cannot change a chrome-extension:// URL; the page reads the global location, as the side panel would see it
globalThis.location = { href: 'chrome-extension://abc/popup.html?surface=sidepanel', search: '?surface=sidepanel', hash: '' };
globalThis.requestAnimationFrame = (f) => setTimeout(f, 0);
globalThis.MutationObserver = w.MutationObserver; globalThis.getComputedStyle = w.getComputedStyle.bind(w); globalThis.IntersectionObserver = class { observe() {} disconnect() {} };
const services = JSON.parse(fs.readFileSync(SRC + '/services.json', 'utf8'));
chrome.runtime.getURL = (p) => 'chrome-extension://abc/' + p;
chrome.tabs = { query: async () => [], sendMessage() {}, onActivated: { addListener() {} }, onUpdated: { addListener() {} } };
chrome.i18n = { getMessage: () => '' };
globalThis.fetch = w.fetch = async (u) => ({ ok: true, json: async () => (String(u).includes('services') ? services : []), text: async () => '' });
const sent = []; const send0 = chrome.runtime.sendMessage;
chrome.runtime.sendMessage = (m, cb) => { sent.push(m.action); return send0(m, cb); };
const api = fake(); chrome.sidePanel = api.sidePanel; chrome.action = api.action;
chrome.windows = { getCurrent: (cb) => cb({ id: 42 }) };
const realSet = chrome.storage.sync.set; chrome.storage.sync.set = (o, cb) => { api.calls.push(['set', o]); Object.assign(api.sync, o); return realSet(o, cb); };
let selfClosed = 0; w.close = () => { selfClosed++; };
store.useNativeSidePanel = true; store['meta:version'] = 2; store.migrationVersion = 2; store.connectionMode = 'cloud';
try { await imp('popup.js'); } catch (e) { console.log('import', e.message); }
d.dispatchEvent(new w.Event('DOMContentLoaded'));
await tick(300);
assert(!sent.includes('openNativeSidePanel') && selfClosed === 0, 'inside the side panel the page does not re-open the panel and close itself');
assert.equal(d.body.dataset.surface, 'sidepanel');
const btn = d.getElementById('popoutButton');
assert(!btn.hidden && btn.getAttribute('aria-label') === 'Detach to popup' && btn.title === 'Detach to popup', 'button offers Detach');
btn.click(); await tick(50);
assert.equal(store.useNativeSidePanel, false, 'detach turns attach mode off');
assert(api.calls.some(c => c[0] === 'openPopup') && api.calls.some(c => c[0] === 'close' && c[1].windowId === 42), 'popup opened, panel of this window closed');
console.log('ok');
