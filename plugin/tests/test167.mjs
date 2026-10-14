// Settings › Send & Share: target list (Kindle, LocalSend, Phone, Obsidian, Share), detail views, "Default" tag + switch.
import { setup, imp, tick } from './harness.mjs'; import assert from 'assert'; import fs from 'fs';
const { store, w } = setup({});
const d = w.document; globalThis.document = d; globalThis.window = w;
const html = fs.readFileSync(new URL('../src/popup.html', import.meta.url), 'utf8');
const sec = html.match(/<section class="settings-panel" id="settingsPanel-send"[\s\S]*?<\/section>/)[0];
d.body.innerHTML = sec.replace(' hidden>', '>') + '<button class="settings-row-sub" data-sub="phoneinbox">Not paired</button>';
store.deliveryPreference = 'localsend';
store['send:devices'] = [{ id: 'k1', type: 'kindle', label: 'A', address: 'mailto:a@kindle.com' }, { id: 'l1', type: 'localsend', label: 'B', addresses: ['1.2.3.4'] }, { id: 'l2', type: 'localsend', label: 'C', addresses: ['1.2.3.5'] }];
const st = await imp('modules/sendTargets.js');
st.initSendTargets(); await tick(700);
const rows = [...d.querySelectorAll('#sendTargets .send-target')];
assert.deepEqual(rows.map(r => r.dataset.target), ['kindle', 'localsend', 'phone', 'obsidian', 'share']);
assert(/1 devices|1 Ger/.test(rows[0].textContent) || /1/.test(rows[0].textContent), 'kindle count: ' + rows[0].textContent);
assert(/2/.test(rows[1].textContent), 'localsend count: ' + rows[1].textContent);
assert(rows[1].querySelector('.send-default-tag') && !rows[0].querySelector('.send-default-tag'), 'default tag only on the default target');
assert(!d.getElementById('sendDetail-kindle').hidden === false, 'details closed');
assert(!d.getElementById('kindleDeliveryConfig').closest('[data-send-pane]').hidden === false);
// open Kindle
rows[0].click();
assert(d.getElementById('sendTargets').hidden, 'list hidden in detail');
assert(!d.getElementById('sendDetail-kindle').hidden && d.getElementById('sendDetail-localsend').hidden);
assert(!d.getElementById('kindleDeliveryConfig').hidden && d.getElementById('localSendDeliveryConfig').hidden, 'only the kindle form');
assert(d.getElementById('sendTools').hidden, 'bookmarklet only on the list');
// back
d.querySelector('#sendDetail-kindle [data-send-back]').click(); await tick(100);
assert(!d.getElementById('sendTargets').hidden && !d.getElementById('sendTools').hidden);
// share detail
d.querySelector('[data-target=share]').click();
assert(!d.getElementById('sendDetail-share').hidden);
// Obsidian detail: vault and folder fields, nothing else of the Kindle/LocalSend forms
d.querySelector('#sendDetail-share [data-send-back]').click(); await tick(100);
d.querySelector('[data-target=obsidian]').click();
assert(!d.getElementById('sendDetail-obsidian').hidden && d.getElementById('sendDetail-share').hidden);
assert(d.getElementById('obsidianVault') && d.getElementById('obsidianFolder'));
assert(d.getElementById('kindleDeliveryConfig').closest('[data-send-pane]').hidden, 'no kindle form in the obsidian view');
d.querySelector('#sendDetail-obsidian [data-send-back]').click(); await tick(100);
// settings search jumps straight to the right form
d.dispatchEvent(new w.CustomEvent('aish:settings-panel', { detail: { name: 'send', targetId: 'newLocalSendIp' } })); await tick(50);
assert(!d.getElementById('sendDetail-localsend').hidden && !d.getElementById('localSendDeliveryConfig').hidden, 'search target opens its form');
console.log('TEST 167 OK');
