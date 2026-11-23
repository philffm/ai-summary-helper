// Rename notice: an update of an existing install is told once that the extension is now Kaivo; fresh installs and later updates are not.
import { bgSource } from './bgSource.mjs';
import { setup, imp, tick } from './harness.mjs'; import assert from 'assert';

// background: which state an install event leaves
const fn = new Function(bgSource().match(/function renameNoticeFor\([\s\S]*?\n\}/)[0] + '; return renameNoticeFor;')();
assert.deepEqual(fn('update', undefined), { pending: true }, 'an update of an existing install is flagged');
assert.deepEqual(fn('install', undefined), { done: true }, 'a fresh install already knows the name');
assert.equal(fn('update', { done: true }), null, 'seen: later updates stay quiet');
assert.equal(fn('update', { pending: true }), null, 'already flagged: not changed again');
assert(/onInstalled\.addListener\(async \(details\)/.test(bgSource()) && /renameNoticeFor\(details && details\.reason/.test(bgSource()), 'the install handler uses the reason');

// UI
async function ui(state) {
  const { store, w } = setup({}); if (state) store['ui:renameNotice'] = state;
  const tabs = []; globalThis.chrome.tabs = { create: (o) => tabs.push(o) };
  w.document.body.innerHTML = '<div id="renameNotice" class="review-card" hidden></div>';
  const m = await imp('modules/renameNotice.js'); const el = w.document.getElementById('renameNotice');
  await m.initRenameNotice(el); await tick(30); return { store, el, tabs, m };
}
let r = await ui({ pending: true });
assert(!r.el.hidden, 'shown after an update');
assert(r.el.textContent.includes(r.m.OLD_NAME) && r.el.textContent.includes('Kaivo') && r.m.OLD_NAME === 'AI Summary Helper', 'it names the old and the new name: ' + r.el.textContent);
r.el.querySelector('[data-r=ok]').click(); await tick(30);
assert(r.el.hidden && r.store['ui:renameNotice'].done && !r.tabs.length, 'Got it ends it for good, no tab');
r = await ui({ pending: true });
r.el.querySelector('[data-r=video]').click(); await tick(30);
assert(/kaivo-rename-en\.mp4$/.test(r.tabs[0].url) && r.store['ui:renameNotice'].done && r.el.hidden, 'the video opens in a tab and ends it too');
for (const s of [undefined, { done: true }, {}]) { r = await ui(s); assert(r.el.hidden, 'hidden for ' + JSON.stringify(s)); }

// wiring
import fs from 'fs';
const rd = (f) => fs.readFileSync(new URL('../src/' + f, import.meta.url), 'utf8');
assert(/id="renameNotice"/.test(rd('popup.html')) && /initRenameNotice\(\)/.test(rd('popup.js')), 'popup');
assert(/id="renameNotice"/.test(rd('home.html')) && /initRenameNotice\(\)/.test(rd('home.js')), 'home page');
assert(fs.existsSync(new URL('../../docs/assets/video/kaivo-rename-en.mp4', import.meta.url)), 'the video is on the site');
console.log('TEST 281 OK');
