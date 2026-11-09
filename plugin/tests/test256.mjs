// Speed-Read reader on the page (content/speedRead.js, Figma AISH-036 C + A): writing → reading → pause with the paragraph →
// end with the countdown; keys; the countdown never runs when nothing asks to close or the page is hidden; settings shape;
// summary HTML → blocks. Plus the wiring: popup menu entry, right-click entry, background handlers, no old overlay left.
import { setup, imp, SRC } from './harness.mjs'; import assert from 'assert'; import fs from 'fs'; import path from 'path';
setup({});
chrome.runtime.getURL = (p) => 'chrome-extension://abc/' + p;
chrome.i18n = { getMessage: () => '' };
const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));
const SR = await imp('content/speedRead.js');
const S = await imp('modules/speedReadSettings.js');

// settings: defaults, clamping, bad values
assert.deepEqual(S.speedReadNormalize(undefined), { ...S.SPEED_READ_DEFAULTS });
const n = S.speedReadNormalize({ wpm: 9000, chunk: 7, reminder: 'someday', reminderTime: '25:99', enabled: false, closeTab: false, fullscreen: true });
assert.equal(n.wpm, 600); assert.equal(n.chunk, 3); assert.equal(n.reminder, 'none'); assert.equal(n.reminderTime, '08:00');
assert.equal(n.enabled, false); assert.equal(n.closeTab, false); assert.equal(n.fullscreen, true);

// summary HTML → blocks (headings, paragraphs, list items; nested lists flattened)
const blocks = SR.srBlocksFromHtml('<h2>Key points</h2><p>Sleep sorts memories. It helps.</p><ul><li>One item.</li><li><p>Two</p></li></ul><script>x</script>');
assert.deepEqual(blocks.map((b) => [b.text, b.heading]), [['Key points', true], ['Sleep sorts memories. It helps.', false], ['One item.', false], ['Two', false]]);
// what markdownToHtml writes: <br>-separated paragraphs and "- " list lines
const md = SR.srBlocksFromHtml('<h2>Key points</h2><br><br>Sleep sorts the <strong>memories</strong>. Deep sleep matters.<br><br>- one<br>- two');
assert.deepEqual(md.map((b) => b.text), ['Key points', 'Sleep sorts the memories. Deep sleep matters.', 'one', 'two']);

// writing → reading
let closed = 0, cancelled = 0, reminders = [], patches = [];
const article = { id: 'a1', summary: '<h2>Key points</h2><p>Sleep sorts memories. Deep sleep matters most.</p><p>Small study, open questions.</p>' };
const open = (over = {}) => SR.speedReadOpen({ title: 'Sleep', settings: S.speedReadNormalize({ wpm: 600, ...over.settings }), reduceMotion: over.reduceMotion,
  onCloseTab: over.noClose ? undefined : () => { closed++; }, onCancel: () => { cancelled++; }, onReminder: (t) => reminders.push(t), onSettings: (p) => patches.push(p) });
let r = open();
const host = document.getElementById('aish-speedread-host');
assert(host && host.shadowRoot, 'host with a shadow root');
const $ = (sel) => r.root.querySelector(sel);
assert.equal($('link').getAttribute('href'), 'chrome-extension://abc/inPage.css', 'tokens + styles from inPage.css');
assert.equal(r.state, 'writing'); assert($('.sr-bar--busy'));
SR.speedReadStream('one two three');
assert.match($('.sr-status-meta').textContent, /3 words so far/);
assert.equal($('.sr').getAttribute('role'), 'dialog'); assert.equal($('.sr').getAttribute('aria-modal'), 'true');
r.read(article);
assert.equal(r.state, 'reading');
assert($('.sr-word .sr-pivot'), 'pivot letter marked');
assert($('.sr-sentence .sr-now'), 'current word marked in the sentence above');
assert.match($('.sr-progress-text').textContent, /Sentence 1 of 4/);
// keys: space pauses and shows the paragraph; arrows jump by sentence; ↑ faster
const key = (k, o = {}) => $('.sr').dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...o }));
key(' ');
assert.equal(r.state, 'paused');
assert(!$('.sr-context').hidden && $('.sr-ctx--now'), 'paused: the paragraph with the current sentence');
key('ArrowRight'); assert.match($('.sr-progress-text').textContent, /Sentence 2 of 4/);
key('ArrowRight', { shiftKey: true }); assert.equal(r.at, 3, 'Shift+→ moves one word'); key('ArrowRight', { shiftKey: true });
key('ArrowLeft'); assert.match($('.sr-progress-text').textContent, /Sentence 2 of 4/, 'back from mid-sentence goes to its start');
key('ArrowUp'); assert.equal(r.wpm, 600, 'capped at 600'); key('ArrowDown'); assert.equal(r.wpm, 575); assert.deepEqual(patches.at(-1), { wpm: 575 });
key('f'); assert($('.sr').classList.contains('sr--full'), 'F: full screen'); assert.deepEqual(patches.at(-1), { fullscreen: true });
// clicking a sentence reads from there
const ctx = [...r.root.querySelectorAll('.sr-ctx')].find((b) => b.dataset.s === '1'); ctx.click();
assert.equal(r.state, 'reading'); assert.match($('.sr-progress-text').textContent, /Sentence 2 of 4/);
// run to the end (600 WPM → ~100–250 ms a word)
for (let i = 0; i < 80 && r.state !== 'done'; i++) await tick(100);
assert.equal(r.state, 'done', 'reached the end');
assert($('.sr-ring'), 'countdown ring'); assert.match($('.sr-done-note').textContent, /closes in 5 s/);
// any mouse movement stops it; the tab is not closed
$('.sr').dispatchEvent(new window.Event('pointermove', { bubbles: true }));
assert($('.sr-done--stopped'), 'stopped'); await tick(1200); assert.equal(closed, 0, 'never closes after it was stopped');
// reminder picked on the end card
const sel = $('select[data-act="reminder"]'); sel.value = 'tomorrow'; sel.dispatchEvent(new window.Event('change', { bubbles: true }));
assert.deepEqual(reminders, ['tomorrow']);
$('[data-act="closetab"]').click(); assert.equal(closed, 1, 'Close tab'); assert(!document.getElementById('aish-speedread-host'), 'reader gone');

// countdown runs out → closes the tab (once)
r = open(); r.read(article);
for (let i = 0; i < 80 && r.state !== 'done'; i++) await tick(100);
await tick(5300); assert.equal(closed, 2, 'closed after 5 s');

// no countdown when closing is not offered; reduced motion: starts paused; Esc while writing cancels; T shows the text
r = open({ settings: { closeTab: false } }); r.read(article); r.pause();
assert.equal(r.state, 'paused');
key('t'); assert(r.root.querySelector('.sr-text h3'), 'T: the whole summary as text');
r.destroy();
r = open({ reduceMotion: true }); r.read(article); assert.equal(r.state, 'paused', 'reduced motion: no autostart'); r.destroy();
r = open(); r.root.querySelector('.sr').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); assert.equal(cancelled, 1, 'Esc while writing stops the summary');
r = open({ noClose: true }); r.read(article); r.destroy();
r = open(); r.error('Model unreachable'); assert.equal(r.state, 'error'); assert(r.root.querySelector('[role="alert"]')); r.destroy();
// a page that is hidden pauses the reader
r = open(); r.read(article);
Object.defineProperty(document, 'hidden', { configurable: true, get: () => true }); document.dispatchEvent(new window.Event('visibilitychange'));
assert.equal(r.state, 'paused', 'hidden page pauses'); r.destroy();

// wiring
const read = (f) => fs.readFileSync(path.join(SRC, f), 'utf8');
const content = read('content.js'), bg = read('background.js'), ms = read('modules/mainScreen.js'), ui = read('content/ui.js');
assert(/request\.action === 'speedRead'/.test(content) && /speedReadStream\(summary\)/.test(content), 'content script: action + stream hook');
assert(!/fetchSummaryAndClose|createStreamingOverlay|showDecisionDialog|waitForSpeedReadingComplete/.test(content + ui + bg), 'old overlay and flow removed');
assert(/id: 'aish-speedread'/.test(bg) && !/aish-summarize-close/.test(bg), 'right-click: Speed-Read replaces "Summarize & close tab"');
assert(/speedReadCloseTab: \{ from: 'page'/.test(bg) && /decisionSave: \{ from: 'page'/.test(bg), 'background handlers are page-only');
assert(/mk\('zap', T\('Speed-Read'\)/.test(ms), 'popup: third entry in the menu next to Summarize');
for (const p of ['chrome', 'firefox', 'android', 'ios']) {
  const m = JSON.parse(fs.readFileSync(path.join(SRC, '..', 'platforms', p, 'manifest.json'), 'utf8'));
  assert(m.web_accessible_resources[0].resources.includes('inPage.css'), p + ': inPage.css is web-accessible');
}
const css = read('inPage.css');
assert(/@tokens:start theme/.test(css) && /--rsvp-word-size:/.test(css), 'token region generated into inPage.css');
assert(!/#[0-9a-f]{3,8}\b/i.test(css.slice(css.indexOf('@tokens:end'))), 'no hex colours in the component CSS');
console.log('TEST 256 OK'); process.exit(0);
