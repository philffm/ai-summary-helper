// A large library (always on a phone): the Topics graph leaves out tags of a single article, places the dots without a running
// simulation, and does not redraw itself when better matches arrive.
import { setup, imp, tick } from './harness.mjs'; import assert from 'assert';
import fs from 'fs'; import path from 'path'; import vm from 'vm';
const { w } = setup({});
const d = w.document;
globalThis.document = d; globalThis.window = w;
globalThis.SVGElement = w.SVGElement; globalThis.requestAnimationFrame = w.requestAnimationFrame.bind(w); globalThis.cancelAnimationFrame = w.cancelAnimationFrame.bind(w);
globalThis.ResizeObserver = class { observe() {} disconnect() {} };
const sandbox = { window: w, document: d, navigator: w.navigator, setTimeout, clearTimeout, setInterval, clearInterval, requestAnimationFrame: w.requestAnimationFrame.bind(w), cancelAnimationFrame: w.cancelAnimationFrame.bind(w), SVGElement: w.SVGElement, performance, console };
vm.createContext(sandbox); vm.runInContext(fs.readFileSync(path.join(process.env.AISH_SRC, 'lib/d3.min.js'), 'utf8'), sandbox);
globalThis.d3 = sandbox.d3;
for (const prop of ['width', 'height']) Object.defineProperty(w.SVGSVGElement.prototype, prop, { get() { return { baseVal: { value: Number(this.getAttribute(prop)) || 0 } }; }, configurable: true });
globalThis.chrome = globalThis.chrome || { runtime: { getURL: (p) => p } };
const ag = await imp('modules/archiveGraph.js');
assert.ok(ag.leanGraph(501) && !ag.leanGraph(500), 'on a desktop, from 501 articles');

let seed = 11; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
const common = Array.from({ length: 280 }, (_, i) => 'topic' + i); let rare = 0;
const arts = Array.from({ length: 714 }, (_, i) => {
    const tags = []; if (i >= 57) for (let k = 0; k < 5; k++) tags.push(rnd() < 0.42 && rare < 1470 ? 'rare' + rare++ : common[Math.floor(rnd() ** 2.2 * common.length)]);
    return { id: 'a' + i, title: 'Article ' + i, tags, timestamp: new Date(Date.UTC(2026, 0, 1) + i * 60000).toISOString(), summary: '<p>x</p>' };
});
const box = d.createElement('div');
Object.defineProperty(box, 'clientWidth', { value: 375 }); Object.defineProperty(box, 'clientHeight', { value: 520 });
d.body.append(box);
await ag.initArchiveGraph(box, arts, null, null);
await tick(60);
assert.ok(box.classList.contains('graph-overview'));
const circles = [...box.querySelectorAll('circle.graph-node')];
assert.equal(circles.filter((c) => c.classList.contains('is-article')).length, 714, 'every article stays a dot');
assert.ok(circles.length < 714 + 320, 'tags of a single article are no nodes: ' + circles.length);
const pack = box.__archiveGraphPack;
const off = circles.filter((c) => c.classList.contains('is-article')).filter((c) => { const home = pack.leaf.get(c.__data__.id); return Math.hypot(Number(c.getAttribute('cx')) - home.x, Number(c.getAttribute('cy')) - home.y) > 0.5; });
assert.equal(off.length, 0, 'the dots stand where the packing wants them at once');
const sim = box.__archiveGraphSimulation, alpha = sim.alpha();
await tick(80);
assert.equal(sim.alpha(), alpha, 'no simulation keeps running');
console.log('lean graph ok');
