// Graph: orphans are reconnected through posting lists exactly as the straight scan did (same best match), and the index may be passed lazily.
import { setup, imp, tick } from './harness.mjs'; import assert from 'assert';
const { w } = setup({}); const d = w.document; globalThis.document = d; globalThis.window = w;
for (const k of ['SVGElement', 'Element', 'HTMLElement', 'Node']) if (!globalThis[k] && w[k]) globalThis[k] = w[k];
globalThis.ResizeObserver = class { observe() {} disconnect() {} unobserve() {} }; globalThis.requestAnimationFrame = (f) => setTimeout(f, 0);
const fs = await import('fs'); (0, eval)(fs.readFileSync(new URL('../src/lib/d3.min.js', import.meta.url), 'utf8'));
const ag = await imp('modules/archiveGraph.js'); const ls = await imp('modules/localSearch.js');
const mk = (id, tags, text, day) => ({ id, title: 'T ' + id, tags, timestamp: new Date(1.7e12 + day * 864e5).toISOString(), summary: '<p>' + text + '</p>' });
const arts = [
  mk('a1', ['Energy'], 'heat pumps defrost efficiency cold winter grid battery storage', 1), mk('a2', ['Energy'], 'solar panels inverter grid storage battery household', 2),
  mk('f1', ['Food'], 'sourdough bread fermentation flour hydration starter', 3), mk('f2', ['Food'], 'olive oil pasta tomato basil garlic kitchen', 4),
  mk('o1', [], 'battery storage grid household solar inverter backup', 5),      // no tags: belongs to Energy by content
  mk('o2', [], 'starter flour hydration sourdough bread baking', 6),            // no tags: belongs to Food by content
  mk('o3', [], 'zzz qqq xxx unrelated words only', 7),                          // nothing similar: stays unconnected
];
const idx = ls.buildIndex(arts);

// the posting-list finder gives the same best match as comparing the article with every candidate
const included = arts.slice(0, 4), orphans = arts.slice(4);
const f = ag.makeSimilarFinder(idx); included.forEach((a) => f.add('n-' + a.id, a));
for (const o of orphans) {
  let best = null; for (const c of included) { const sc = ls.cosineSim(idx.vectors.get(o.timestamp), idx.vectors.get(c.timestamp)); if (sc >= 0.15 && (!best || sc > best.score)) best = { id: 'n-' + c.id, score: sc }; }
  const got = f.find(o);
  assert.equal(got && got.id, best && best.id, 'same best match for ' + o.id); if (best) assert(Math.abs(got.score - best.score) < 1e-9, 'same score');
}
assert.equal(f.find(arts[6]), null, 'nothing similar: stays unconnected');
f.add('n-o1', arts[4]); assert.equal(f.find(arts[4]) && f.find(arts[4]).id, 'n-o1', 'a reconnected orphan becomes a candidate for later ones');

// the index may be passed lazily, after the "Building…" note is up
let lazyCalls = 0;
const box = d.createElement('div'); d.body.append(box); Object.defineProperty(box, 'clientWidth', { value: 800 }); Object.defineProperty(box, 'clientHeight', { value: 600 });
const p = ag.initArchiveGraph(box, arts, null, () => { lazyCalls++; return idx; });
assert(box.querySelector('.graph-loading'), 'a "Building the graph…" note shows first');
await p;
assert.equal(lazyCalls, 1, 'the index is built once, after the note is up');
assert(!box.querySelector('.graph-loading'), 'and the note is gone (the picture, or the error, replaces it)');
console.log('TEST 276 OK'); process.exit(0);
