// Tags at the source: one category from the fixed list (chosen by the model, the text only as a fallback, no "General"), specific tags
// with their English names (saved as tagEn and learned by the lexicon), and no tags attached by word match from the rest of the library.
import assert from 'assert'; import fs from 'fs'; import vm from 'vm'; import os from 'os'; import path from 'path'; import { spawnSync } from 'child_process';
import { pathToFileURL } from 'url';
const SRC = process.env.AISH_SRC;
const cat = await import(pathToFileURL(path.join(SRC, 'modules/topicCategories.js')).href);
const core = await import(pathToFileURL(path.join(SRC, 'content/core.js')).href).catch(() => null);   // needs chrome only when saving

// ── reading the TAGS line ──
{
    const r = cat.parseTagLine('category: Technology, KI-Regulierung = AI regulation, Chipfertigung = chip manufacturing');
    assert.equal(r.category, 'Technology');
    assert.deepEqual(r.tags, ['KI-Regulierung', 'Chipfertigung']);
    assert.deepEqual(r.tagEn, { 'KI-Regulierung': 'AI regulation', Chipfertigung: 'chip manufacturing' });
    const old = cat.parseTagLine('eins, zwei, "#drei"');
    assert.deepEqual(old, { tags: ['eins', 'zwei', 'drei'], category: '', tagEn: {} }, 'older replies still read: plain tags');
    assert.equal(cat.parseTagLine('Kategorie: health, Schlaf = sleep').category, 'Health', 'the label in another language, any case');
    assert.equal(cat.parseTagLine('category: Gardening, Beete = beds').category, '', 'a category outside the list is none');
    assert.equal(cat.parseTagLine('Science, Genome = genome').category, 'Science', 'a category given as a plain tag is the category, not a tag');
    assert.deepEqual(cat.parseTagLine('General, Notizen = notes').tags, ['Notizen'], '"General" is no tag any more');
    assert.deepEqual(cat.parseTagLine('a = x, A = y').tags, ['a'], 'deduped, the first spelling wins');
    assert.deepEqual(cat.parseTagLine('[Klima = climate; Hitze = heat]').tags, ['Klima', 'Hitze'], 'brackets and semicolons too');
    assert.equal(cat.parseTagLine('').category, '');
    assert.ok(cat.TAG_INSTRUCTION.includes(cat.CATEGORIES.join(', ')) && /English name/.test(cat.TAG_INSTRUCTION), 'the prompt names the list and asks for English names');
}

// ── the fallback category: the best match, not the first ──
assert.equal(cat.categoryFromText('A study on climate, emissions and renewable energy; the evidence from one AI model'), 'Environment', 'three climate words beat one "AI"');
assert.equal(cat.categoryFromText('Grandma bakes bread'), '', 'nothing matches: no category (no "General")');

// ── ensureGeneralTag: category first, nothing attached from the library ──
if (core) {
    globalThis.chrome = { storage: { local: { get: () => { throw new Error('the library must not be read for tags any more'); } } } };
    assert.deepEqual(await core.ensureGeneralTag(['Schlaf', 'Studie'], 'sleep research', 'T', 7, { category: 'Health' }), ['Health', 'Schlaf', 'Studie'], 'the model\'s category, then the tags');
    assert.deepEqual(await core.ensureGeneralTag(['Schlaf'], 'a hospital study on disease and doctors', 'T'), ['Health', 'Schlaf'], 'no category from the model: the text decides');
    assert.deepEqual(await core.ensureGeneralTag(['Brot'], 'Grandma bakes bread', 'T'), ['Brot'], 'nothing matches: no "General"');
    assert.deepEqual(await core.ensureGeneralTag(['Technology', 'Rust'], 'about software', 'T', 7, { category: 'Science' }), ['Science', 'Rust'], 'a category among the tags does not become a second category');
    assert.equal((await core.ensureGeneralTag(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'], '', '', 7, { category: 'Business' })).length, 7, 'at most 7 with the category');
} else console.log('content/core.js could not be imported here; ensureGeneralTag is covered through the bundle below');

// ── the real background bundle: the English names are saved with the article ──
{
    const out = fs.mkdtempSync(path.join(os.tmpdir(), 'aish-finalize-'));
    const b = spawnSync(process.execPath, [new URL('../scripts/build.js', import.meta.url).pathname, '--bundle', out], { encoding: 'utf8' });
    assert.equal(b.status, 0, 'bundling failed: ' + b.stderr);
    const store = {};
    let libraryReads = 0;
    const chrome = {
        storage: { local: {
            get: (k, cb) => { libraryReads++; const o = {}; if (typeof k === 'object' && !Array.isArray(k)) Object.assign(o, k); for (const key of (typeof k === 'string' ? [k] : Array.isArray(k) ? k : Object.keys(k))) if (key in store) o[key] = store[key]; cb(o); },
            set: (o, cb) => { Object.assign(store, JSON.parse(JSON.stringify(o))); cb && cb(); } } },
        i18n: { detectLanguage: (t, cb) => cb({ isReliable: true, languages: [{ language: 'de', percentage: 99 }] }) }
    };
    const sandbox = { self: {}, chrome, console, setTimeout, clearTimeout }; sandbox.globalThis = sandbox;
    vm.createContext(sandbox); vm.runInContext(fs.readFileSync(path.join(out, 'finalize.js'), 'utf8'), sandbox);
    const F = sandbox.self.AISH_FINALIZE;
    const ctx = { sourceUrl: 'https://example.com/k', summaryMode: 'extension', service: 'openai', modelIdentifier: 'm', summaryLength: 100, selectedLanguage: 'de', contentText: 'Ein deutscher Text über Regeln für KI.', contentHtml: '<p>x</p>', pageTitle: 'Seite' };
    const summary = '<div><h2>Titel</h2><p>Hallo.</p></div><!-- TAGS: category: Politics, KI-Regulierung = AI regulation, EU-Recht = EU law --><!-- QUESTIONS: ["Was?"] -->';
    store['articles:index'] = [{ id: 'old', title: 'Old', tags: ['KI-Regulierung', 'Politik'], timestamp: '2026-01-01' }];
    const r = await F.finishDetached(ctx, summary, '');
    assert.ok(!r.error, r.error);
    assert.deepEqual(r.tags.filter(t => !t.startsWith('🌐')), ['Politics', 'KI-Regulierung', 'EU-Recht'], 'category first, then the specific tags: ' + r.tags);
    const saved = store['articles:index'].find(a => a.url === ctx.sourceUrl);
    assert.ok(saved, 'saved');
    assert.deepEqual(saved.tagEn, { 'KI-Regulierung': 'AI regulation', 'EU-Recht': 'EU law' }, 'the English names go with the article');
    assert.ok(!/TAGS/.test(r.cleanHtml), 'the comment is not shown');
    const r2 = await F.finishDetached({ ...ctx, sourceUrl: 'https://example.com/plain' }, '<div><h2>T</h2><p>x</p></div><!-- TAGS: eins, zwei -->', '');
    assert.ok(!('tagEn' in store['articles:index'].find(a => a.url === 'https://example.com/plain')), 'no English names: no field');
    assert.ok(r2.tags.includes('eins'));
}

// ── the History teaches the lexicon: one topic across languages ──
{
    const tc = await import(pathToFileURL(path.join(SRC, 'modules/topicConcepts.js')).href);
    tc.setLexicon({});
    assert.notEqual(tc.conceptKey('KI-Regulierung'), tc.conceptKey('AI regulation'), 'before: two tags');
    const changed = tc.learnTagPairs([{ tagEn: { 'KI-Regulierung': 'AI regulation', '🌐 de': 'Germany' } }, { tagEn: { 'Régulation de l’IA': 'AI regulation' } }, { tags: ['x'] }, null]);
    assert.equal(changed, true);
    assert.equal(tc.conceptKey('KI-Regulierung'), tc.conceptKey('AI regulation'), 'after: one topic');
    assert.equal(tc.conceptKey('Régulation de l’IA'), tc.conceptKey('AI regulation'), 'in a third language too');
    assert.equal(tc.topicLabel('🌐 de', 'de'), '🌐 de', 'a language mark is never learned, whatever the model wrote next to it');
    assert.equal(tc.learnTagPairs([{ tagEn: { 'KI-Regulierung': 'AI regulation' } }]), false, 'learning the same again changes nothing (nothing to save)');
}

// ── the graph: categories are categories, not topics ──
{
    const harness = await import('./harness.mjs'); harness.setup({});
    const gs = await harness.imp('modules/graphStructure.js');
    const nodes = [], links = [], seen = new Set();
    const add = (id, tags) => { nodes.push({ id: 'article-' + id, group: 'article', label: id, data: { id } }); tags.forEach(t => { if (!seen.has(t)) { seen.add(t); nodes.push({ id: 'tag-' + t, group: 'tag', label: t }); } links.push({ source: 'article-' + id, target: 'tag-' + t }); }); };
    for (let i = 0; i < 20; i++) add('chip' + i, ['Technology', ['gpu', 'wafer'][i % 2], 'chips']);
    for (let i = 0; i < 20; i++) add('web' + i, ['Technology', ['css', 'html'][i % 2], 'browsers']);
    for (let i = 0; i < 20; i++) add('bank' + i, ['Business', ['rates', 'loans'][i % 2], 'banks']);
    const categories = new Set(['tag-Technology', 'tag-Business']);
    const withCats = gs.topicClusters(nodes, links, { categories });
    assert.ok(!withCats.clusters.some(c => /Technology|Business/.test(c.label) || c.children.some(k => /Technology|Business/.test(k.label))), 'a category names no topic: ' + withCats.clusters.map(c => c.label));
    assert.notEqual(withCats.clusterOfArticle.get('article-chip0'), withCats.clusterOfArticle.get('article-web0'), 'chips and browsers are two topics, though both are Technology');
    assert.ok(![...withCats.clusterOfTag.keys()].includes('tag-Technology'), 'the category belongs to no cluster');
}
console.log('tags at the source ok');
