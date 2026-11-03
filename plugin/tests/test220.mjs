// MCP related_articles: closest saved articles to one article; exclude tag respected; uses the graph's similarity cache when it is current.
import assert from 'assert';
import { SK } from '../src/modules/storageKeys.js';
import { TOOLS, TOOL_SCOPE, requireScope, ToolError } from '../src/modules/mcp/tools.js';
import { toolDefinitions } from '../src/modules/mcp/client.js';
import { buildEntry, fingerprintOf, SIM_VERSION } from '../src/modules/graphSimilarity.js';

const mk = (id, title, tags, summary, extra = {}) => ({ id, title, url: `https://example.com/${id}`, timestamp: Date.UTC(2026, 8, 1) + Number(id.slice(1)) * 86400000, tags, summary, contentWordCount: 300, ...extra });
const index = [
    mk('a1', 'Rooftop solar and home batteries', ['solar', 'energy'], 'Photovoltaic panels, an inverter and a home battery cut the grid bill.'),
    mk('a2', 'Feed-in tariffs for solar panels', ['solar'], 'Tariffs, photovoltaic payback and the grid operator.'),
    mk('a3', 'Battery storage for the grid', ['energy', 'grid'], 'Battery storage smooths photovoltaic peaks on the grid.'),
    mk('a4', 'Sourdough starter basics', ['bread'], 'Flour, hydration, proofing and a sourdough starter.'),
    mk('a5', 'Weekend bake', ['bread'], 'A short note.'),
    mk('a6', 'Private solar plan', ['private', 'solar'], 'Photovoltaic panels on my own roof, battery and grid details.')
];
const run = async (store, args) => TOOLS.related_articles(args, { storage: { get: async (k) => (typeof k === 'object' && !Array.isArray(k) ? Object.fromEntries(Object.keys(k).map(x => [x, x in store ? store[x] : k[x]])) : Object.fromEntries([].concat(k).map(x => [x, store[x]]))) }, excludeTag: 'private' });

// 1) without a cache: quick vectors from the index entries
const store = { [SK.articlesIndex]: index };
const rows = await run(store, { id: 'a1' });
const ids = rows.map(r => r.aish_id);
assert.ok(ids.includes('a2') && ids.includes('a3'), 'the solar and battery articles come back');
assert.ok(!ids.includes('a4'), 'unrelated bread does not');
assert.ok(!ids.includes('a1'), 'never the article itself');
assert.ok(!ids.includes('a6'), 'an article with the exclude tag never surfaces');
assert.ok(rows.every((r, i) => r.score > 0 && (i === 0 || r.score <= rows[i - 1].score)), 'best first with a score');
assert.deepEqual(rows.find(r => r.aish_id === 'a2').shared_tags, ['solar']);
assert.ok(rows[0].title && rows[0].url && 'snippet' in rows[0], 'rows are the same shape as search_library');
assert.ok(!JSON.stringify(rows).includes('fulltext'), 'metadata and snippet only');

// 2) limits and errors
assert.ok((await run(store, { id: 'a1', limit: 1 })).length <= 1);
await assert.rejects(() => run(store, { id: 'a6' }), (e) => e instanceof ToolError && e.code === 'not_found', 'an excluded article is not found');
await assert.rejects(() => run(store, { id: 'nope' }), (e) => e.code === 'not_found');
await assert.rejects(() => run(store, {}), (e) => e.code === 'invalid_params');

// 3) the cache counts when it is current: a5 only says "A short note", its saved text is about solar
const cacheFor = (fp) => ({ v: SIM_VERSION, items: Object.fromEntries(index.map(a => [a.id, a.id === 'a5'
    ? { ...buildEntry({ title: a.title, tags: a.tags, summary: a.summary, content: 'photovoltaic inverter photovoltaic battery grid solar panels photovoltaic' }, a, true), f: fp || fingerprintOf(a) }
    : buildEntry({ title: a.title, tags: a.tags, summary: a.summary }, a, false)])), nn: null });
assert.ok(!(await run(store, { id: 'a1' })).some(r => r.aish_id === 'a5'), 'without the cache a5 looks unrelated');
const withCache = await run({ ...store, [SK.graphSim]: cacheFor() }, { id: 'a1' });
assert.ok(withCache.some(r => r.aish_id === 'a5'), 'with the cached text vector a5 is found');
assert.ok(!(await run({ ...store, [SK.graphSim]: cacheFor('stale:fingerprint') }, { id: 'a1' })).some(r => r.aish_id === 'a5'), 'a stale cache entry is ignored');
assert.ok(!(await run({ ...store, [SK.graphSim]: { ...cacheFor(), v: 999 } }, { id: 'a1' })).some(r => r.aish_id === 'a5'), 'a cache from another version is ignored');

// 4) scope and wire definition
assert.equal(TOOL_SCOPE.related_articles, 'library');
assert.throws(() => requireScope('related_articles', {}, { library: false }), (e) => e.code === 'scope_denied');
requireScope('related_articles', { id: 'a1' }, { library: true });
const def = toolDefinitions().related_articles;
assert.deepEqual(def.inputSchema.required, ['id']);
assert.ok(def.description.includes('untrusted'), 'carries the same untrusted-content note as the other library tools');
console.log('related_articles ok');
