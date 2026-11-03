// Topics layout: every dot ends up where the packing put it. (The hidden tag nodes used to be solid discs in the middle of their clusters and
// pushed the dots out of their circles once the rare tags were shown too.)
import { setup, imp, tick } from './harness.mjs'; import assert from 'assert';
import fs from 'fs'; import path from 'path'; import vm from 'vm';
const { w } = setup({});
const d = w.document;
globalThis.document = d; globalThis.window = w;
globalThis.SVGElement = w.SVGElement; globalThis.requestAnimationFrame = w.requestAnimationFrame.bind(w); globalThis.cancelAnimationFrame = w.cancelAnimationFrame.bind(w);
globalThis.ResizeObserver = class { observe() {} disconnect() {} };
// the vendored d3 (a UMD script), loaded the way a page would: it sets d3 on its global object
const sandbox = { window: w, document: d, navigator: w.navigator, setTimeout, clearTimeout, setInterval, clearInterval, requestAnimationFrame: w.requestAnimationFrame.bind(w), cancelAnimationFrame: w.cancelAnimationFrame.bind(w), performance, console, Date, Math, CustomEvent: w.CustomEvent, Event: w.Event, MouseEvent: w.MouseEvent, SVGElement: w.SVGElement, Element: w.Element, HTMLElement: w.HTMLElement, Node: w.Node };
vm.createContext(sandbox); vm.runInContext(fs.readFileSync(path.join(process.env.AISH_SRC, 'lib/d3.min.js'), 'utf8'), sandbox);
globalThis.d3 = sandbox.d3;
// jsdom has no layout, so an <svg> has no width/height object; d3-zoom reads them (they are the attributes the graph sets itself)
for (const prop of ['width', 'height']) Object.defineProperty(w.SVGSVGElement.prototype, prop, { get() { return { baseVal: { value: Number(this.getAttribute(prop)) || 0 } }; }, configurable: true });
globalThis.chrome = globalThis.chrome || { runtime: { getURL: (p) => p } };
const ag = await imp('modules/archiveGraph.js');

let seed = 9; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647; const pick = (a) => a[Math.floor(rnd() * a.length)];
const areas = Array.from({ length: 6 }, (_, g) => Array.from({ length: 6 }, (_, k) => `a${g}t${k}`));
const arts = [];
for (let i = 0; i < 600; i++) {
    const a = pick(areas); const tags = ['Umbrella', pick(a), pick(a)];
    if (rnd() < 0.3) tags.push(pick(pick(areas)));
    if (rnd() < 0.3) tags.push('rare' + Math.floor(rnd() * 500));      // lots of tags that only one article has
    if (rnd() < 0.07) tags.length = 0;                                  // and some with no tag at all
    arts.push({ id: 'a' + i, title: 'Article ' + i, tags, timestamp: new Date(Date.UTC(2026, 0, 1) + i * 60000).toISOString(), summary: '<p>x</p>' });
}
const box = d.createElement('div');
Object.defineProperty(box, 'clientWidth', { value: 900 }); Object.defineProperty(box, 'clientHeight', { value: 800 });
d.body.append(box);
await ag.initArchiveGraph(box, arts, null, null);
assert.ok(box.classList.contains('graph-overview'), 'a big archive opens as Topics');
const sim = box.__archiveGraphSimulation;
for (let i = 0; i < 400 && sim.alpha() > sim.alphaMin(); i++) await tick(10);   // let it settle (timers are sped up in tests)

const dots = [...box.querySelectorAll('circle.is-article')];
assert.equal(dots.length, 600, 'every article is a dot, also those with only rare tags or none: ' + dots.length);
const pack = box.__archiveGraphPack;
assert.ok(pack && pack.leaf.size === 600, 'every dot has its place in the packing');
let far = 0, sum = 0;
dots.forEach(el => { const n = el.__data__, home = pack.leaf.get(n.id); const dist = Math.hypot(n.x - home.x, n.y - home.y); sum += dist; if (dist > Math.max(6, home.r * 1.5)) far++; });
assert.ok(far <= 6, `the dots sit in their circles: ${far} of 600 are far from their place (mean ${(sum / 600).toFixed(1)} px)`);
assert.ok(sum / 600 < 3, 'and on average within a few pixels of it: ' + (sum / 600).toFixed(1));
console.log('topics layout ok');
