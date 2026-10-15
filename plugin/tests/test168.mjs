// AISH Article JSON v1 and the Markdown note: exact output against the shared vector, stable file names, the aid in the phone envelope.
import assert from 'assert';
import fs from 'fs';
import path from 'path';
import { pathToFileURL } from 'url';
const src = process.env.AISH_SRC;
const F = await import(pathToFileURL(path.join(src, 'modules/articleFormat.js')).href);
const M = await import(pathToFileURL(path.join(src, 'modules/markdownArchive.js')).href);
const B = await import(pathToFileURL(path.join(src, 'modules/articleBlocks.js')).href);
const C = await import(pathToFileURL(path.join(src, 'modules/inboxCrypto.js')).href);
const vec = JSON.parse(fs.readFileSync(path.join(process.env.AISH_TESTS, 'fixtures/article-v1-vector.json'), 'utf8'));
const { entry, record, highlights } = vec.input;
const full = { ...entry, ...record };

// 1) JSON v1 and Markdown are exactly the vector
const json = F.toArticleJson(full, { highlights, conversation: record.conversation });
assert.deepEqual(json, vec.expectedJson);
assert.equal(json.aish, 'article/1');
assert.ok(!('blocks' in json), 'blocks only on request');
assert.equal(M.articleToMarkdown(full, { highlights, conversation: record.conversation, related: ['Anderer Artikel'] }), vec.expectedMarkdown);
assert.ok(F.frontMatter(json).includes('aish_id: "' + entry.id + '"') && F.frontMatter(json).includes('aish_format: 1'));
// no secrets or internal keys
assert.ok(!/apiKey|license|articles:rec|chrome\./i.test(JSON.stringify(json)));
// blocks on request
const withBlocks = F.toArticleJson({ ...full, content: 'Erster Absatz.\n\nZweiter Absatz.' }, { includeBlocks: true });
assert.deepEqual(withBlocks.blocks, [['p', 'Erster Absatz.'], ['p', 'Zweiter Absatz.']]);
// missing optional fields are left out, not empty
const bare = F.toArticleJson({ id: 'article_1_x', url: 'https://a.example/x', title: 'T', timestamp: 0 });
assert.deepEqual(Object.keys(bare), ['aish', 'id', 'url', 'title', 'site', 'savedAt', 'tags', 'summary', 'highlights']);

// 2) file names: same names whatever the order, and adding an article does not rename the others
const { articles, expected } = vec.names;
const asObj = (m) => Object.fromEntries(m);
assert.deepEqual(asObj(F.assignFileBases(articles)), expected);
assert.deepEqual(asObj(F.assignFileBases(articles.slice().reverse())), expected, 'order of the archive does not matter');
const later = { id: 'article_1760000009999_eeeeee', title: 'Same title', timestamp: 1760000009999 };
const grown = asObj(F.assignFileBases([later, ...articles]));
for (const [id, name] of Object.entries(expected)) assert.equal(grown[id], name, 'existing name kept: ' + name);
assert.equal(grown[later.id], 'Same title (eeeeee)');
// ISO strings as timestamps (older records) sort the same way
const iso = (a) => ({ ...a, timestamp: new Date(a.timestamp).toISOString() });
assert.deepEqual(asObj(F.assignFileBases(articles.map(iso))), expected);

// 3) the archive export uses those names and puts the id in every note
globalThis.chrome = { storage: { local: { get(k, cb) {
    const idx = articles.map((a) => ({ ...a, url: 'https://e.example/' + a.id, summary: '<p>s</p>' }));
    const out = {}; const keys = typeof k === 'object' && !Array.isArray(k) ? Object.keys(k) : [].concat(k);
    for (const key of keys) out[key] = key === 'articles:index' ? idx : key === 'hl:all' ? [] : undefined;
    cb(out);
} } } };
const files = await M.buildArchiveFiles({});
assert.deepEqual(files.map((f) => f.name.replace(/^ai-summary-helper\//, '').replace(/\.md$/, '')).sort(), Object.values(expected).sort());
for (const f of files) assert.ok(/^aish_id: "article_\d+_[a-z]{6}"$/m.test(f.text) && /^aish_format: 1$/m.test(f.text), f.name);

// 4) phone envelope: carries the article id as `aid`; old senders without it stay valid; only plain ids pass
const msg = B.articleForPhone({ ...full, content: '<p>Text.</p>' }, undefined, []);
assert.equal(msg.aid, entry.id);
assert.equal(C.cleanArticleMessage({ ...msg, v: 2 }).aid, entry.id);
const { aid, ...old } = msg;
assert.ok(!('aid' in C.cleanArticleMessage(old)));
assert.ok(!('aid' in C.cleanArticleMessage({ ...msg, aid: '../../etc' })));
// the shared phone vector (no aid) still decrypts and the same message with aid round-trips
const iv = Buffer.from(vec.phone.nonceHex, 'hex');
const sealed = await C.encryptArticle({ inboxId: vec.phone.inboxId, encKey: vec.phone.encKey }, vec.phone.message, { iv });
// The gzip step is zlib-version dependent (Node 22 and 26 emit different bytes), so the envelope is compared by what it
// carries, not byte for byte: same version and nonce prefix, and both decrypt to the same message.
assert.equal(sealed.envelope.v, vec.phone.envelope.v);
assert.equal(sealed.envelope.data.slice(0, 16), vec.phone.envelope.data.slice(0, 16), 'same nonce');
assert.deepEqual(await C.decryptArticle({ inboxId: vec.phone.inboxId, encKey: vec.phone.encKey }, sealed.envelope), await C.decryptArticle({ inboxId: vec.phone.inboxId, encKey: vec.phone.encKey }, vec.phone.envelope), 'same message as the vector');
assert.equal((await C.decryptArticle({ inboxId: vec.phone.inboxId, encKey: vec.phone.encKey }, vec.phone.envelope)).aid, vec.phone.message.aid);
console.log('TEST 168 OK'); process.exit(0);
