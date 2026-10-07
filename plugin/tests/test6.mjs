import { setup, imp, tick } from './harness.mjs';
import assert from 'assert'; import fs from 'fs';
const xml = fs.readFileSync(process.env.AISH_TESTS + '/podcast.xml', 'utf8');
const url = 'https://philwornath.com/api/podcast.xml';
const { store, w, sent } = setup({ [url]: xml });
const $ = (s) => w.document.querySelector(s), $$ = (s) => [...w.document.querySelectorAll(s)];
const click = (el) => el.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
// fake audio engine + background routing
class FakeAudio { constructor(){ this.paused=true; this.currentTime=0; this.duration=NaN; this.playbackRate=1; this.ended=false; this._l={}; }
  addEventListener(e,f){ this._l[e]=f; } play(){ this.paused=false; return Promise.resolve(); } pause(){ this.paused=true; } removeAttribute(){ this.src=''; } load(){} }
globalThis.Audio = FakeAudio;
await import(process.env.AISH_SRC + '/audioEngine.js');
const eng = globalThis.AishAudio.create();
const origSend = chrome.runtime.sendMessage;
chrome.runtime.sendMessage = (msg, cb) => {
  if (msg.action === 'audioEnsure') return setTimeout(() => cb({ ok: true }), 0);
  if (msg.action === 'audioCmd') return setTimeout(() => cb(eng.handle(msg)), 0);
  return origSend(msg, cb);
};
const fm = await imp('modules/feedManager.js');
const toasts = []; const ui = { showToast: m => toasts.push(m), showScreen() {} };
fm.initFeedManager(ui); await tick(50);
$('#feedAddBtn').click(); await tick(20);
const input = $('.feed-add-row input'); input.value = url; click($('[data-feed-add]')); await tick(150);
const its = store['feeds:items']; console.log('items', its.length, its[0].audio, its[0].dur);
assert.equal(its.length, 14); assert.ok(its.every(i => i.audio.endsWith('.mp3')));
await fm.onFeedsScreenShown(ui); await tick(50);
const pb = $$('.feed-play-btn'); assert.ok(pb.length > 0, 'play buttons');
click(pb[0]); await tick(60);
assert.equal($('#feedPlayer').hidden, false); assert.ok($('#fpTitle').textContent.length > 5);
assert.equal($('#fpToggle').dataset.state, 'playing');
assert.ok($('.feed-play-btn').textContent.includes('Pause'));
click($('#fpToggle')); await tick(60); assert.equal($('#fpToggle').dataset.state, 'paused');
click($('#fpFwd')); await tick(30);
click($('#fpClose')); await tick(30); assert.equal($('#feedPlayer').hidden, true);
console.log('TEST 6 OK');
