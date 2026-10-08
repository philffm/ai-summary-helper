// Feeds: i18n keys and the Feeds panel in Settings.
import { setup, imp, tick } from './harness.mjs';
import assert from 'assert'; import fs from 'fs';
const { store, w } = setup({});
const fm = await imp('modules/feedManager.js');
const nav = fs.readFileSync(process.env.AISH_SRC + '/modules/settingsNav.js', 'utf8');
const ids = [...nav.matchAll(/^\s*\['(\w+)', '[^']*', '([\w-]+)'/gm)].map(m => [m[1], m[2]]);
store['feeds:subs'] = [{ id: 's', url: 'u', title: 'T', lastFetched: Date.now() }]; store['feeds:items'] = [];
const ui = { showToast() {}, showScreen() {} };
fm.initFeedManager(ui); await tick(50); await fm.onFeedsScreenShown(ui); await tick(30);
document.dispatchEvent(new w.CustomEvent('aish:settings-panel', { detail: { name: 'feeds' } })); await tick(30);
const missing = ids.filter(([, id]) => !w.document.getElementById(id));
console.log('index entries', ids.length, 'missing targets:', missing);
assert.equal(missing.length, 0);
const panels = [...w.document.querySelectorAll('.settings-row[data-panel]')].map(r => r.dataset.panel);
assert.ok(panels.includes('feeds') && w.document.getElementById('settingsPanel-feeds'));
console.log('sub text:', w.document.querySelector('[data-sub=feeds]').textContent);
// i18n keys
for (const l of ['en','de','fr','es','pt_PT','ja','zh_CN','zh_TW','ko','hi']) { const j = JSON.parse(fs.readFileSync(process.env.AISH_SRC + `/_locales/${l}/messages.json`, 'utf8')); assert.ok(j.settingsFeeds && j.settingsCapFeeds, l); }
console.log('TEST 3 OK');
