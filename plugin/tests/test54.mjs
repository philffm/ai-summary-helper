// History, one pane: Graph and Analytics are exclusive and their buttons show the active state.
import assert from 'assert';
import { setup, imp, tick } from './harness.mjs';
const { w } = setup({}); const d = w.document;
globalThis.requestAnimationFrame = (f) => setTimeout(f, 0);
globalThis.MutationObserver = w.MutationObserver;
const { initArticleManager } = await imp('modules/articleManager.js');
try { await initArticleManager({ showScreen() {} }); } catch (e) { console.log('init:', e.message); }
await tick(60);
const g = d.getElementById('graphToggleBtn'), r = d.getElementById('reportToggleBtn');
const gc = d.getElementById('graphContainer'), rc = d.getElementById('reportContainer');
const on = (b) => b.getAttribute('aria-pressed') === 'true' && b.classList.contains('active');
g.click(); await tick(30);
assert.equal(gc.style.display, 'block'); assert(on(g) && !on(r), 'graph active');
r.click(); await tick(30);
assert.equal(rc.style.display, 'block'); assert.equal(gc.style.display, 'none', 'graph closed by analytics'); assert(on(r) && !on(g), 'analytics active');
g.click(); await tick(30);
assert.equal(gc.style.display, 'block'); assert.equal(rc.style.display, 'none', 'analytics closed by graph'); assert(on(g) && !on(r));
g.click(); await tick(30);
assert(!on(g) && !on(r), 'nothing active when closed');
console.log('TEST 54 OK'); process.exit(0);
