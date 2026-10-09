// Markdown archive export: front matter, highlights, pinned Q&A, wikilinks, valid zip with 500 articles.
import assert from 'assert';
import { setup, imp } from './harness.mjs';
const { store } = setup({});
const { articleToMarkdown, buildArchiveFiles, buildZip, crc32 } = await imp('modules/markdownArchive.js');

const md = articleToMarkdown({ title: 'A "q" title', url: 'https://x.com/a', timestamp: '2025-01-02T00:00:00Z', tags: ['ai'], moodScore: 0.5, summary: '<p>Hello <strong>w</strong></p><ul><li>one</li></ul>' },
  { highlights: [{ text: 'hl', type: 'user' }], conversation: [{ q: 'Why?', a: 'Because', pinned: true }], related: ['B'] });
assert(md.startsWith('---\ntitle: "A \\"q\\" title"\nurl: "https://x.com/a"\ndate: 2025-01-02\nmood: 0.5\ntags:\n  - "ai"\n---'));
assert(md.includes('Hello **w**') && md.includes('- one') && md.includes('> hl') && md.includes('**Why?**') && md.includes('[[B]]'));

const idx = [];
for (let i = 0; i < 500; i++) { idx.push({ id: 'id' + i, title: i % 2 ? 'Same' : 'T' + i, url: 'https://x.com/' + i, timestamp: '2025-01-01', tags: ['t' + (i % 5)] }); store['articles:rec:id' + i] = { summary: 'S' + i }; }
store['articles:index'] = idx;
store['hl:all'] = [];
const files = await buildArchiveFiles();
assert.equal(files.length, 500);
assert.equal(new Set(files.map(f => f.name.toLowerCase())).size, 500);
const blob = await buildZip(files.slice(0, 3));
const buf = Buffer.from(await blob.arrayBuffer());
assert.equal(buf.readUInt32LE(0), 0x04034b50);
const eocd = buf.length - 22;
assert.equal(buf.readUInt32LE(eocd), 0x06054b50); assert.equal(buf.readUInt16LE(eocd + 10), 3);
const nlen = buf.readUInt16LE(26), size = buf.readUInt32LE(22);
assert.equal(crc32(buf.subarray(30 + nlen, 30 + nlen + size)), buf.readUInt32LE(14));
console.log('ok');
