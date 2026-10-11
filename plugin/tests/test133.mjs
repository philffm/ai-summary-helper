// Connection map for bundles: graph data, SVG/text rendering, PNG fallback, wiring into the digest.
import assert from 'assert';
import { setup, imp } from './harness.mjs';
setup({});
const cm = await imp('modules/connectionMap.js');
const { buildMagazineArticle, sortForBundle } = await imp('modules/digestBuilder.js');
const { buildIndex } = await imp('modules/localSearch.js');
const mk = (n, title, tags, summary) => ({ id: 'a' + n, timestamp: 1700000000000 - n * 1e6, title, tags, summary });
const arts = sortForBundle([
  mk(1, 'Solar prices fall again', ['energy', 'climate'], 'solar panels energy prices grid storage batteries'),
  mk(2, 'Grid storage <b>boom</b>', ['Energy'], 'batteries grid storage solar energy utilities'),
  mk(3, 'Arctic ice at record low', ['climate'], 'arctic sea ice melting warming polar'),
  mk(4, 'Sourdough basics', ['food'], 'bread flour starter fermentation baking'),
]);
const g = cm.buildConnectionGraph(arts, buildIndex(arts));
assert.deepEqual(g.tags.map(t => t.key).sort(), ['climate', 'energy'], 'only tags shared by 2+ articles; case-insensitive');
assert.equal(g.tagLinks.length, 4);
assert.ok(g.nodes.find(n => n.title.startsWith('Sourdough')).isolated, 'unrelated article is flagged stand-alone');
assert.ok(!g.simLinks.some(l => `${l.a}:${l.b}` === '0:1'), 'no similarity arc between articles that already share a tag');

const { svg, width, height } = cm.renderConnectionSvg(g);
assert.ok(svg.startsWith('<svg') && svg.endsWith('</svg>') && width === 800 && height > 100);
assert.ok(!svg.includes('<b>boom'), 'titles are escaped');
assert.ok(!/#[0-9a-f]{3,6}/i.test(svg.replace(/#(000|fff)\b/gi, '')), 'grayscale only (e-ink)');
assert.equal(cm.renderConnectionSvg(g).svg, svg, 'deterministic');

const text = cm.renderConnectionText(g);
assert.ok(/href="#aish-mag-\d"/.test(text) && /Stand-alone/.test(text));

// nothing in common -> no map at all
const lone = [mk(1, 'A', ['x'], 'alpha beta'), mk(2, 'B', ['y'], 'gamma delta')];
assert.equal(await cm.buildConnectionMapHtml(lone, buildIndex(lone), { image: 'svg' }), '');

const svgHtml = await cm.buildConnectionMapHtml(arts, buildIndex(arts), { image: 'svg' });
assert.ok(svgHtml.includes('<svg') && svgHtml.includes('aish-conn'));
// jsdom cannot rasterize an SVG: the PNG request must degrade to the text list, never throw
const pngHtml = await cm.buildConnectionMapHtml(arts, buildIndex(arts), { image: 'png' });
assert.ok(!pngHtml.includes('<svg') && pngHtml.includes('aish-conn'), 'png failure falls back to text');
assert.ok(!(await cm.buildConnectionMapHtml(arts, null, { image: 'none' })).includes('<svg'));

// 20 articles are capped
const many = Array.from({ length: 20 }, (_, i) => mk(i, 'T' + i, ['same'], 'w' + i));
const gm = cm.buildConnectionGraph(many, null);
assert.equal(gm.nodes.length, cm.MAP_MAX_ARTICLES); assert.equal(gm.truncated, 8);

const mag = buildMagazineArticle(arts, { mapHtml: svgHtml });
assert.ok(mag.content.indexOf('aish-conn') > mag.content.indexOf('<ol>') && mag.content.indexOf('aish-conn') < mag.content.indexOf('id="aish-mag-0"'), 'map sits between TOC and sections');
assert.ok(!buildMagazineArticle(arts).content.includes('aish-conn'), 'off by default');
console.log('TEST 131 OK');
process.exit(0);
