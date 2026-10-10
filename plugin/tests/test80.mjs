// loader.js (runs on every page instead of the full content script): injects only for saved highlights or a text selection, same page keys as pageKey.js.
import assert from 'assert';
import fs from 'fs';
import { JSDOM } from 'jsdom';
import { pathToFileURL } from 'url';
import path from 'path';
const SRC = process.env.AISH_SRC;
const { pageKeyForUrl } = await import(pathToFileURL(path.join(SRC, 'modules/pageKey.js')).href);
const code = fs.readFileSync(SRC + '/loader.js', 'utf8');
const tick = (ms = 15) => new Promise(r => setTimeout(r, ms));

// One page: returns what the loader sent to the background and lets the test poke storage events / mouseups.
async function page(url, { local = {}, sync = {}, injectOk = true, full = false } = {}) {
  const dom = new JSDOM('<!doctype html><body><p id="p">Some long article text to select</p></body>', { url, runScripts: 'outside-only', pretendToBeVisual: true });
  const w = dom.window;
  const sent = [], listeners = [];
  const get = (store) => (keys, cb) => { const out = {}; [].concat(keys).forEach(k => { if (k in store) out[k] = JSON.parse(JSON.stringify(store[k])); }); cb(out); };
  w.chrome = {
    runtime: { lastError: null, sendMessage(msg, cb) { sent.push(msg.action); setTimeout(() => cb && cb({ ok: injectOk }), 0); } },
    storage: { local: { get: get(local) }, sync: { get: get(sync) }, onChanged: { addListener: (f) => listeners.push(f), removeListener: () => {} } }
  };
  if (full) w.__AISH_CONTENT_LOADED = true;
  w.eval(code);
  await tick();
  return { w, sent, local, fire: (changes, area) => listeners.forEach(f => f(changes, area)) };
}

// 1. nothing saved for this page → the full script stays out
let p = await page('https://example.com/a/b', { local: { 'hl:all': [] } });
assert.deepEqual(p.sent, [], 'no annotations → no injection');
p = await page('https://example.com/a/b');
assert.deepEqual(p.sent, [], 'no annotation key at all → no injection');

// 2. highlights saved for this page → injected exactly once
p = await page('https://example.com/a/b?utm_source=x#frag', { local: { 'hl:all': [{ id: '1', url: 'https://example.com/a/b', text: 'Some', type: 'user' }] } });
assert.deepEqual(p.sent, ['aish:injectContent'], 'saved highlight → injection');

// 3. other page / dismissed / switched off / already loaded → no injection
const other = [{ id: '1', url: 'https://example.com/other', text: 'x', type: 'user' }];
assert.deepEqual((await page('https://example.com/a/b', { local: { 'hl:all': other } })).sent, [], 'highlight on another page');
const dismissed = [{ id: '1', url: 'https://example.com/a/b', text: 'x', type: 'ghost', dismissed: true }];
assert.deepEqual((await page('https://example.com/a/b', { local: { 'hl:all': dismissed } })).sent, [], 'dismissed ghost highlight');
const mine = [{ id: '1', url: 'https://example.com/a/b', text: 'x', type: 'user' }];
assert.deepEqual((await page('https://example.com/a/b', { local: { 'hl:all': mine }, sync: { userHighlightingEnabled: false, aiHighlightingEnabled: false } })).sent, [], 'both highlight switches off');
assert.deepEqual((await page('https://example.com/a/b', { local: { 'hl:all': mine }, sync: { highlightingEnabled: false } })).sent, [], 'legacy switch off');
assert.deepEqual((await page('https://example.com/a/b', { local: { 'hl:all': mine }, sync: { userHighlightingEnabled: false } })).sent, ['aish:injectContent'], 'ghost highlights still on → injection');
assert.deepEqual((await page('https://example.com/a/b', { local: { 'hl:all': mine }, full: true })).sent, [], 'full script already there');

// 4. same page keys as modules/pageKey.js (the loader copies the function)
const kp = await page('https://example.com/');
const urls = ['https://example.com/x?v=abc&utm_source=t#h', 'https://www.youtube.com/watch?v=123&t=5', 'https://www.linkedin.com/jobs/view?currentJobId=9&trk=a', 'https://example.com/', 'https://example.com:8080/a/b/?id=7&q=zzz', 'http://news.site/p?article=5&id=2',
  'https://x.org/a?item=1&story_fbid=2&pid=3&postId=4&currentJobId=5&v=6&id=7&article=8&zzz=9', 'https://x.org/a?id=', 'not a url?x=1#y', ''];
for (const u of urls) assert.equal(kp.w.__AISH_LOADER.keyFor(u), pageKeyForUrl(u), 'page key parity for ' + JSON.stringify(u));
for (const u of urls.filter(x => x.startsWith('http'))) {
  const r = await page(u, { local: { 'hl:all': [{ id: 'k', url: pageKeyForUrl(u), text: 'x', type: 'user' }] } });
  assert.deepEqual(r.sent, ['aish:injectContent'], 'stored page key matches ' + u);
}

// 5. highlights added later (another surface saves one) or switches turned on → injection
p = await page('https://example.com/a/b', { local: {} });
p.local['hl:all'] = mine;
p.fire({ 'hl:all': { newValue: mine } }, 'local');
await tick();
assert.deepEqual(p.sent, ['aish:injectContent'], 'storage change brings highlights to this page');

// 6. text selection → injection, then the mouseup is replayed for the full script's tooltip
p = await page('https://example.com/a/b');
let replayed = 0;
p.w.document.addEventListener('mouseup', () => { replayed++; });
const el = p.w.document.getElementById('p');
p.w.getSelection().selectAllChildren(el);
el.dispatchEvent(new p.w.MouseEvent('mouseup', { bubbles: true, clientX: 10, clientY: 20 }));
for (let k = 0; k < 100 && replayed < 2; k++) await tick(20);
assert.deepEqual(p.sent, ['aish:injectContent'], 'selection → injection');
assert.equal(replayed, 2, 'original + replayed mouseup reach the page script');
p = await page('https://example.com/a/b');
p.w.getSelection().removeAllRanges();
p.w.document.getElementById('p').dispatchEvent(new p.w.MouseEvent('mouseup', { bubbles: true }));
await tick(30);
assert.deepEqual(p.sent, [], 'a click without selection does not inject');
p = await page('https://example.com/a/b', { sync: { userHighlightingEnabled: false, aiHighlightingEnabled: false } });
p.w.getSelection().selectAllChildren(p.w.document.getElementById('p'));
p.w.document.getElementById('p').dispatchEvent(new p.w.MouseEvent('mouseup', { bubbles: true }));
await tick(30);
assert.deepEqual(p.sent, [], 'highlighting off: selecting text does not inject');

// 7. failed injection (restricted page) is retried on the next trigger, not in a loop
p = await page('https://example.com/a/b', { local: { 'hl:all': mine }, injectOk: false });
assert.equal(p.sent.length, 1, 'one attempt per trigger');
console.log('TEST 80 OK');
