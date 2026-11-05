// Time window replay: the window grows month by month, stops on touch or on reset, steps by hand under reduced motion, and cleans up its timer.
import { setup, imp, tick } from './harness.mjs'; import assert from 'assert';
const { w } = setup({});
const d = w.document;
globalThis.document = d; globalThis.window = w;
const ag = await imp('modules/archiveGraph.js');
globalThis.getComputedStyle = w.getComputedStyle.bind(w); globalThis.XMLSerializer = w.XMLSerializer;

const month = (m) => new Date(Date.UTC(2026, m, 15)).toISOString();   // m = 0 (Jan) … 5 (Jun)
const arts = [0, 1, 2, 3, 4, 5].flatMap(m => [{ id: 'a' + m, timestamp: month(m) }, { id: 'b' + m, timestamp: month(m) }]);
const nodes = arts.map(a => ({ id: 'article-' + a.id, group: 'article', label: a.id, data: a }));
const els = nodes.map(() => d.createElement('div'));
const sel = (list) => ({ each(fn) { list.forEach((el, i) => fn.call(el, nodes[i] || {})); } });
const build = () => {
    const c = d.createElement('div'); d.body.append(c);
    const live = d.createElement('div'); live.className = 'graph-live'; c.append(live);
    c.__archiveGraphSelections = { node: sel(els), label: sel(els), link: { each() {} } };
    ag.__test_renderTimeRange(c, nodes, [], arts);
    return c;
};
const count = (c) => c.querySelector('.graph-time-label').textContent;
const inWindow = () => els.filter(e => !e.classList.contains('graph-time-dim')).length;
const waitFor = async (fn, ms = 3000) => { const t = Date.now(); while (!fn() && Date.now() - t < ms) await tick(5); return fn(); };

// ── replay: from the first month, growing to the last ──
const c = build();
const play = c.querySelector('.graph-time-play');
assert.ok(play && /Replay/.test(play.textContent), 'a Replay button in the time panel');
assert.equal(inWindow(), 12, 'before: everything is in view');
const seen = new Set();
play.click();
assert.equal(c.querySelector('.graph-live').textContent.startsWith('Replay started'), true, 'start is announced');
assert.equal(play.getAttribute('aria-pressed'), 'true'); assert.ok(/Pause/.test(play.textContent));
assert.equal(inWindow(), 2, 'it starts with the first month only');
const iv = setInterval(() => seen.add(inWindow()), 1);
assert.ok(await waitFor(() => play.getAttribute('aria-pressed') === 'false'), 'the replay ends by itself');
clearInterval(iv);
assert.equal(inWindow(), 12, 'at the end the whole archive is in view');
assert.ok([...seen].every((n, i, all) => n >= 2 && n <= 12) && seen.size >= 3, 'the window grew through several steps: ' + [...seen].sort((a, b) => a - b));
assert.ok(c.querySelector('.graph-live').textContent.startsWith('Replay finished: all 12 articles'), 'the end is announced');
assert.ok(/Replay/.test(play.textContent) && c.__graphReplayTimer == null, 'button and timer are back to rest');

// ── pause, touch and reset stop it ──
const c2 = build(); const p2 = c2.querySelector('.graph-time-play');
p2.click(); assert.ok(c2.__graphReplayTimer, 'the timer is kept on the container (so a redraw can stop it)');
p2.click();
assert.equal(p2.getAttribute('aria-pressed'), 'false'); assert.equal(c2.__graphReplayTimer, null, 'a second press pauses');
p2.click(); const slider = c2.querySelectorAll('.graph-time-track input')[1];
slider.dispatchEvent(new w.Event('input', { bubbles: true }));
assert.equal(c2.__graphReplayTimer, null, 'moving a slider hands control back');
p2.click(); c2.querySelector('.graph-time-reset').click();
assert.equal(c2.__graphReplayTimer, null); assert.equal(inWindow(), 12, 'Reset stops the replay and shows everything');

// ── a redraw cleans up ──
const c3 = build(); c3.querySelector('.graph-time-play').click();
const timer = c3.__graphReplayTimer; assert.ok(timer);
ag.destroyArchiveGraph(c3);
assert.equal(c3.__graphReplayTimer, null, 'destroying the graph clears the replay timer');

// ── reduced motion: no animation, one month per press ──
globalThis.matchMedia = () => ({ matches: true });
const c4 = build(); const p4 = c4.querySelector('.graph-time-play');
assert.ok(/Next month/.test(p4.textContent), 'the button says what it does');
p4.click(); assert.equal(c4.__graphReplayTimer, null, 'no timer');
const first = inWindow(); p4.click(); const second = inWindow();
assert.ok(second > first, 'each press adds a month (' + first + ' → ' + second + ')');
for (let i = 0; i < 4; i++) p4.click();   // Feb → Jun: four more presses to the last month
assert.equal(inWindow(), 12, 'after the last month everything is in view');
p4.click(); assert.equal(inWindow(), 2, 'one more press starts over');
delete globalThis.matchMedia;
// ── the panel never runs past the graph's right edge (it was cut off when the chip sat on the right) ──
{
    const c5 = build();
    const rect = (l, r) => () => ({ left: l, right: r, width: r - l, top: 0, bottom: 0, height: 0 });
    c5.getBoundingClientRect = rect(0, 400);
    c5.querySelector('.graph-time').getBoundingClientRect = rect(300, 380);
    const panel = c5.querySelector('.graph-time-panel');
    panel.getBoundingClientRect = () => { const x = 300 + (parseFloat(panel.style.left) || 0); return { left: x, right: x + 280, width: 280, top: 0, bottom: 0, height: 0 }; };
    c5.querySelector('.graph-time-chip').click();
    assert.equal(panel.hidden, false);
    assert.equal(panel.style.left, '-188px', 'shifted left so its right edge stays 8px inside');
    assert.equal(panel.style.maxWidth, '384px', 'never wider than the graph');
}
// ── Save image takes the graph, not the first icon SVG of a chip ──
{
    const c6 = d.createElement('div'); d.body.append(c6);
    c6.innerHTML = '<div class="graph-filterbar"><button><svg class="icon"><use href="#i-clock"/></svg>Time</button></div><svg class="graph-svg" width="10" height="10"><circle r="3" fill="red"/></svg>';
    const md = ag.graphSvgMarkup(c6);
    assert.ok(/class="graph-svg"/.test(md) && /<circle/.test(md) && !/i-clock/.test(md), 'the graph SVG is saved');
}
console.log('replay ok');
