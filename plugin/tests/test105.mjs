// Danger zone dialogs: a checklist preselected by the button, counts, the red button needs DELETE and at least one ticked box; the actions remove what is ticked.
import assert from 'assert';
import { setup, imp, tick } from './harness.mjs';
const { w } = setup({}); const d = w.document;
globalThis.requestAnimationFrame = (f) => setTimeout(f, 0);
const mk = (st) => ({
    get: (k, cb) => { const o = {}; (k == null ? Object.keys(st) : [].concat(typeof k === 'object' && !Array.isArray(k) ? Object.keys(k) : k)).forEach((x) => { if (x in st) o[x] = st[x]; }); if (cb) { cb(o); return; } return Promise.resolve(o); },
    set: (o, cb) => { Object.assign(st, o); if (cb) cb(); return Promise.resolve(); },
    remove: (k, cb) => { [].concat(k).forEach((x) => delete st[x]); if (cb) cb(); return Promise.resolve(); },
    clear: (cb) => { Object.keys(st).forEach((x) => delete st[x]); if (cb) cb(); return Promise.resolve(); },
});
const local = {
    'articles:index': [{ id: 'a1' }, { id: 'a2' }], 'articles:rec:a1': { content: 'x' }, 'hl:all': [{ id: 'h1' }],
    'feeds:subs': [{ id: 's1' }], 'feeds:items': [{ id: 'i1' }], 'config:services': { openai: { apiKey: 'sk-1' } }, 'account:licenseKey': 'LIC',
    'send:devices': [{ id: 'k1' }], 'podcasts:list': [{ id: 'p1' }], 'ui:summaryLength': 250,
};
const sync = { selectedLanguage: 'de', prompt: 'p' };
chrome.storage.local = mk(local); chrome.storage.sync = mk(sync); chrome.storage.session = mk({});
let reloaded = 0; chrome.runtime.reload = () => { reloaded++; };
chrome.alarms = { clearAll: (cb) => cb && cb() }; chrome.action = { setBadgeText: async () => {} };
globalThis.location = { reload() {} };
const { initDangerZone } = await imp('modules/settingsManager.js');
initDangerZone();

const dialog = () => d.querySelector('.confirm-dialog');
const boxes = () => Object.fromEntries([...d.querySelectorAll('.confirm-dialog input[type=checkbox]')].map((c) => [c.dataset.cat, c]));
const ok = () => d.querySelector('.confirm-ok');
const type = (word) => { const i = d.querySelector('.confirm-input'); i.value = word; i.dispatchEvent(new w.Event('input', { bubbles: true })); };
const tickBox = (id, on) => { const b = boxes()[id]; b.checked = on; b.dispatchEvent(new w.Event('change', { bubbles: true })); };

// Delete history: summaries + highlights preselected, counts shown
d.getElementById('deleteHistoryButton').click(); await tick(60);
assert(dialog(), 'dialog open');
let b = boxes();
assert.deepEqual(Object.keys(b).filter((k) => b[k].checked).sort(), ['articles', 'highlights']);
assert(/2 summaries/.test(dialog().textContent) && /1 feed/.test(dialog().textContent), dialog().textContent);
assert(ok().disabled, 'needs DELETE'); type('DELETE'); assert(!ok().disabled);
tickBox('articles', false); tickBox('highlights', false); assert(ok().disabled, 'nothing ticked → blocked');
tickBox('articles', true); tickBox('highlights', true); assert(!ok().disabled);
ok().click(); await tick(80);
assert(!('articles:index' in local) && !('articles:rec:a1' in local) && !('hl:all' in local), 'summaries and highlights gone');
assert('feeds:subs' in local && 'config:services' in local && 'selectedLanguage' in sync, 'feeds, keys, preferences stay');
assert.equal(reloaded, 0, 'history only: no extension reload');

// Delete settings: prefs, keys, send targets preselected; keys and license go, feeds stay
d.getElementById('deleteSettingsButton').click(); await tick(60);
b = boxes(); assert.deepEqual(Object.keys(b).filter((k) => b[k].checked).sort(), ['keys', 'prefs', 'send']);
type('DELETE'); ok().click(); await tick(80);
assert(!('config:services' in local) && !('account:licenseKey' in local) && !('send:devices' in local) && !('ui:summaryLength' in local));
assert.deepEqual(Object.keys(sync), [], 'preferences cleared');
assert('feeds:subs' in local && 'podcasts:list' in local, 'feeds and podcasts stay'); assert.equal(reloaded, 1, 'extension reloads');

// Delete all data: everything ticked, nothing left
d.getElementById('deleteAllButton').click(); await tick(60);
b = boxes(); assert(Object.keys(b).length === 7 && Object.values(b).every((c) => c.checked), 'all seven ticked');
type('DELETE'); ok().click(); await tick(80);
assert.deepEqual(Object.keys(local), [], 'local storage empty'); assert.equal(reloaded, 2);
console.log('TEST 105 OK'); process.exit(0);
