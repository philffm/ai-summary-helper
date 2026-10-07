import { setup, imp, tick } from './harness.mjs'; import assert from 'assert';
const DAY = 864e5;
const rp = await (async () => { setup({}); return imp('modules/reviewPrompt.js'); })();
const ok = { now: 100 * DAY, installedAt: 90 * DAY, summaries: 5, state: {}, chrome: true };
assert(rp.shouldShow(ok));
assert(!rp.shouldShow({ ...ok, installedAt: 98 * DAY }), 'too new');
assert(!rp.shouldShow({ ...ok, summaries: 2 }), 'too few');
assert(!rp.shouldShow({ ...ok, chrome: false }), 'not chrome');
assert(!rp.shouldShow({ ...ok, state: { done: true } }) && !rp.shouldShow({ ...ok, state: { dismissed: true } }));
assert(!rp.shouldShow({ ...ok, state: { snoozeUntil: 101 * DAY } }) && rp.shouldShow({ ...ok, state: { snoozeUntil: 99 * DAY } }));
assert(!rp.shouldShow({ ...ok, state: { asks: 3 } }));
assert(rp.isChromeStore('Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/120.0 Safari/537.36') && !rp.isChromeStore('... Chrome/120 Safari/537 Edg/120') && !rp.isChromeStore('Firefox/130') && !rp.isChromeStore('Version/17 Safari/605'));
// UI
async function ui(store0, ua) {
  const { store, w } = setup({}); Object.assign(store, store0);
  Object.defineProperty(w.navigator, 'userAgent', { value: ua, configurable: true }); Object.defineProperty(globalThis.navigator, 'userAgent', { value: ua, configurable: true });
  const tabs = []; globalThis.chrome.tabs = { create: o => tabs.push(o) };
  const m = await imp('modules/reviewPrompt.js'); const el = w.document.getElementById('reviewPrompt'); assert(el, 'element');
  await m.initReviewPrompt(el); await tick(30); return { store, w, el, tabs };
}
const CH = 'Mozilla/5.0 Chrome/120.0 Safari/537.36';
const idx = n => Array.from({ length: n }, (_, i) => ({ id: 'a' + i, summary: '<p>x</p>' }));
let r = await ui({ 'account:installedAt': Date.now() - 6 * DAY, 'articles:index': idx(4) }, CH); assert(!r.el.hidden, 'shown'); assert.equal(r.store['ui:reviewPrompt'].asks, 1);
r.el.querySelector('[data-r=rate]').click(); await tick(30);
assert(r.tabs[0].url.includes('hldbejcjaedipeegjcinmhejdndchkmb') && r.store['ui:reviewPrompt'].done && r.el.hidden);
r = await ui({ 'account:installedAt': Date.now() - 6 * DAY, 'articles:index': idx(4) }, CH); r.el.querySelector('[data-r=later]').click(); await tick(30); assert(r.store['ui:reviewPrompt'].snoozeUntil > Date.now());
r = await ui({ 'account:installedAt': Date.now() - 6 * DAY, 'articles:index': idx(4) }, CH); r.el.querySelector('[data-r=never]').click(); await tick(30); assert(r.store['ui:reviewPrompt'].dismissed);
r = await ui({ 'account:installedAt': Date.now() - 1 * DAY, 'articles:index': idx(9) }, CH); assert(r.el.hidden, 'too new hidden');
r = await ui({ 'account:installedAt': Date.now() - 9 * DAY, 'articles:index': idx(9) }, 'Mozilla/5.0 Firefox/130.0'); assert(r.el.hidden, 'firefox hidden');
r = await ui({ 'articles:index': idx(9) }, CH); assert(r.el.hidden && r.store['account:installedAt'], 'first run sets installedAt, not shown');
// background: installedAt + uninstall URL
import fs from 'fs';
const src = fs.readFileSync(process.env.AISH_SRC + '/background.js', 'utf8');
assert(/setUninstallURL\(`\$\{GOODBYE_URL\}\?v=/.test(src) && src.includes('goodbye.html'));
console.log('TEST 36 OK');
