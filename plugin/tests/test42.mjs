// Layout switcher lives once in the app header (shared by Feeds + History).
import assert from 'assert';
import { setup, imp, tick } from './harness.mjs';
const { w } = setup({}); const d = w.document;
d.body.innerHTML = `<div class="header"><div class="header-buttons"><button id="popoutButton"></button></div></div>
<div id="historyScreen"><div id="historyTopRow"></div><div id="articleList"></div><div id="articleDetail"></div><div id="graphContainer"></div><div id="reportContainer"></div></div>
<div id="feedsScreen"><div id="feedToolbar"></div><div id="feedRecapCard"></div><div id="feedItemList"></div><div id="feedEmpty"></div><div id="feedGraph"></div><div id="feedInsights"></div></div>`;
Object.defineProperty(w, 'innerWidth', { value: 1200, configurable: true }); globalThis.innerWidth = 1200;
const ws = await imp('modules/workspaceManager.js');
await ws.initWorkspace(); await tick(30);
assert.equal(d.querySelectorAll('.ws-seg').length, 1, 'one switcher');
assert(d.querySelector('.header .header-buttons > .ws-seg'), 'inside header');
assert(!d.querySelector('#historyTopRow .ws-seg') && !d.querySelector('#feedToolbar .ws-seg'), 'not in toolbars');
const seg = d.querySelector('.ws-seg'); assert(!seg.hidden, 'visible on wide window');
seg.querySelector('button[data-n="2"]').click(); await tick(20);
assert(d.getElementById('historyScreen').classList.contains('ws-active') && d.getElementById('feedsScreen').classList.contains('ws-active'), 'both screens split');
assert.equal(seg.querySelector('button[data-n="2"]').getAttribute('aria-pressed'), 'true');
seg.querySelector('button[data-n="1"]').click(); await tick(20);
assert(!d.getElementById('feedsScreen').classList.contains('ws-active'));
console.log('TEST 42 OK');
