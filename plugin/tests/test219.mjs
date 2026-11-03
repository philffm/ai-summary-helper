// Obsidian hub note: one map-of-content note per exported topic, wikilinks to the article notes, grouped by how far you got.
import assert from 'assert';
import path from 'path';
import { pathToFileURL } from 'url';
const src = process.env.AISH_SRC;
const M = await import(pathToFileURL(path.join(src, 'modules/markdownArchive.js')).href);

const day = new Date('2026-11-03T10:00:00Z');
const A = (id, extra = {}) => ({ id, title: 'Title ' + id, url: `https://www.site${id}.example/post`, timestamp: `2026-0${id}-15T10:00:00Z`, tags: ['solar', id % 2 ? 'grid' : 'storage'], summary: '<p>s</p>', ...extra });
const items = [
    { article: A(1, { readAt: '2026-09-01', lastOpened: '2026-09-01' }), notes: 2 },   // opened, summarised, annotated → worked on
    { article: A(2, { readAt: '2026-09-02', lastOpened: '2026-09-02' }), notes: 0 },   // opened → in progress
    { article: A(3), notes: 0 },                                                       // only saved, never read
    { article: A(4, { lastOpened: '2026-10-01' }), notes: 0 }                          // opened but not marked read → in progress, still "new"
];
const names = { 1: 'Title 1', 2: 'Title 2', 3: 'Title 3 (x)', 4: 'Title 4' };
const md = M.hubToMarkdown({ title: 'Solar & grid', items, nameOf: (a) => names[a.id], briefingName: 'Briefing – Solar & grid', date: day });

assert.ok(md.startsWith('---\ntitle: "Solar & grid"\ntype: topic-hub\narticles: 4\nunread: 2\nexported: 2026-11-03\n---\n'), 'front matter: title, type, counts');
assert.ok(md.includes('# Solar & grid'));
assert.ok(md.includes('Briefing: [[Briefing – Solar & grid]]'), 'the briefing note is linked');
const section = (name) => { const i = md.indexOf('## ' + name); return i < 0 ? '' : md.slice(i, md.indexOf('\n## ', i + 1) < 0 ? undefined : md.indexOf('\n## ', i + 1)); };
const worked = section('Worked on'), progress = section('In progress'), saved = section('Saved');
assert.ok(worked.includes('[[Title 1]]') && !worked.includes('[[Title 2]]'), 'opened + summarised + annotated is "worked on"');
assert.ok(progress.includes('[[Title 2]]') && progress.includes('[[Title 4]]'), 'opened or annotated is "in progress"');
assert.ok(saved.includes('[[Title 3 (x)]]'), 'only saved is "saved, not worked on yet"; the file name is the article note name');
assert.ok(/\[\[Title 3 \(x\)\]\] · site3\.example · 2026-03-15 🆕/.test(md), 'host, date and the unread marker');
assert.ok(!/\[\[Title 1\]\].*🆕/.test(md), 'read articles carry no marker');
assert.ok(progress.indexOf('Title 4') < progress.indexOf('Title 2'), 'newest first inside a group');
assert.ok(md.includes('## Topics inside') && md.includes('solar (4)') && md.includes('grid (2)'), 'tags with counts');
assert.ok(!/\n{3,}/.test(md) && md.endsWith('\n') && !md.endsWith('\n\n'), 'tidy blank lines');
assert.ok(!md.includes('## Worked on (0)'), 'empty groups are left out');
assert.equal(M.hubToMarkdown({ title: 'T', items: [{ article: A(3), notes: 0 }], nameOf: () => '', date: day }).includes('[[ '), false);
assert.ok(M.hubToMarkdown({ title: 'T', items: [{ article: A(3), notes: 0 }], nameOf: () => '', date: day }).includes('Title 3'), 'no file name → plain title, no empty wikilink');

// in the export: only with the option, named "Hub – …", first in the zip, not counted as an article
const idx = [1, 2, 3].map(i => ({ ...A(i), id: 'article_17000000000' + i + '_abcdef', timestamp: 1700000000000 + i }));
globalThis.chrome = { storage: { local: { get(k, cb) {
    const out = {}; const keys = typeof k === 'object' && !Array.isArray(k) ? Object.keys(k) : [].concat(k);
    for (const key of keys) out[key] = key === 'articles:index' ? idx : key === 'hl:all' ? [] : undefined;
    cb(out);
} } } };
const plain = await M.buildArchiveFiles({});
assert.ok(!plain.some(f => f.name.includes('Hub – ')), 'no hub unless asked for');
const two = await M.buildArchiveFiles({ ids: [idx[0].id, idx[1].id], hub: { title: 'My topic' }, briefing: { title: 'My topic', results: [{ text: 'Short [1].', articles: [idx[0]] }] } });
assert.equal(two[0].name, 'ai-summary-helper/Hub – My topic.md', 'the hub comes first');
assert.equal(two.filter(f => !f.briefing).length, 2, 'only the two chosen articles are notes');
assert.ok(two[0].text.includes('Briefing: [[Briefing – My topic]]'), 'links to the briefing that is in the same zip');
const noteNames = two.filter(f => !f.briefing).map(f => f.name.replace(/^ai-summary-helper\//, '').replace(/\.md$/, ''));
noteNames.forEach(n => assert.ok(two[0].text.includes(`[[${n}]]`), 'the hub links ' + n));
assert.ok(!two[0].text.includes('Title 3'), 'an article outside the topic is not in the hub');
console.log('hub note ok');
