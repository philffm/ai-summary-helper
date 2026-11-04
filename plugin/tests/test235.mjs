// "Save image": the file is the graph itself (not the first <svg> in the container, which is a toolbar icon), with the stylesheet's
// colours written into it, hidden shapes left out, and no classes or variables that only exist inside the extension.
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
globalThis.getComputedStyle = w.getComputedStyle.bind(w); globalThis.XMLSerializer = w.XMLSerializer;
const style = d.createElement('style');
style.textContent = 'circle.is-article{fill:#123456;stroke:#abcdef;stroke-width:2px} .graph-overview .is-tag{display:none} #graphBox{--bg-page:#0b0e14}';
d.head.append(style);
const arts = Array.from({ length: 30 }, (_, i) => ({ id: 'a' + i, title: 'Article ' + i, tags: ['T' + (i % 3), 'S' + (i % 7)], timestamp: new Date(Date.UTC(2026, 0, 1) + i * 6e7).toISOString(), summary: '<p>x</p>' }));
const box = d.createElement('div'); box.id = 'graphBox';
Object.defineProperty(box, 'clientWidth', { value: 900 }); Object.defineProperty(box, 'clientHeight', { value: 700 });
d.body.append(box);
await ag.initArchiveGraph(box, arts, null, null);
const sim = box.__archiveGraphSimulation; for (let i = 0; i < 200 && sim && sim.alpha() > sim.alphaMin(); i++) await tick(10);
// a toolbar icon in front of the graph, as in the popup
const icon = d.createElementNS('http://www.w3.org/2000/svg', 'svg'); icon.setAttribute('class', 'icon icon-clock'); box.prepend(icon);
const markup = ag.graphSvgMarkup(box);
assert.ok(markup.length > 2000 && /<circle/.test(markup), 'the graph, not the icon: ' + markup.slice(0, 120));
assert.ok(!/icon-clock/.test(markup));
assert.ok(/viewBox="/.test(markup), 'a frame of its own');
assert.ok(!/class="(?!graph-svg)/.test(markup.replace(/^<svg[^>]*>/, '')), 'no classes inside: nothing in the file needs the extension stylesheet');
assert.ok(!/var\(--/.test(markup), 'no variables');
assert.ok(/fill:\s*rgb\(18, 52, 86\)|fill:\s*#123456/i.test(markup), 'the stylesheet colour of the dots is in the file');
assert.ok(/fill="#0b0e14"/.test(markup), 'the page background behind it');
const doc = new w.DOMParser().parseFromString(markup, 'image/svg+xml');
assert.ok(!doc.querySelector('parsererror'), 'valid SVG: ' + (doc.querySelector('parsererror') || {}).textContent);
assert.equal(doc.querySelectorAll('title').length, 0, 'no hover titles');
const tagsOnScreen = box.querySelectorAll('svg.graph-svg .is-tag').length;
assert.ok(tagsOnScreen > 0, 'tags exist in the view');
assert.ok(doc.querySelectorAll('circle').length < box.querySelectorAll('svg.graph-svg circle').length, 'the hidden tag shapes are left out');
console.log('graph export ok');
