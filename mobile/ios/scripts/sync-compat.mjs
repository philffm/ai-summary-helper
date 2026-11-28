#!/usr/bin/env node
// The other end of the app's sync tests: the extension's own modules, run in Node, with a place held in memory.
//     node mobile/ios/scripts/sync-compat.mjs make            writes Tests/Fixtures/sync-place.json, a place as the
//                                                             extension writes it; SyncTests joins it with the app's code
//     node mobile/ios/scripts/sync-compat.mjs check <folder>  joins the place the app wrote in SyncTests
//                                                             (TEST_RUNNER_KAIVO_SYNC_OUT=<folder>) and checks what arrives
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const load = (name) => import(path.resolve(here, '../../../plugin/src/modules', name));
const { createStampStore } = await load('syncStampStore.js');
const { createSyncService } = await load('syncService.js');
const { createHighlightStore } = await load('highlightStore.js');
const { createNotesStore } = await load('notesStore.js');
const { TargetError } = await load('targets/targetError.js');
const PASSPHRASE = 'abandon ability able about above';

function memoryStorage() {
    const data = new Map(), clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
    return {
        async get(query) {
            const names = query == null ? [...data.keys()] : typeof query === 'string' ? [query] : Array.isArray(query) ? query : Object.keys(query);
            const out = query && typeof query === 'object' && !Array.isArray(query) ? { ...query } : {};
            for (const k of names) if (data.has(k)) out[k] = clone(data.get(k));
            return out;
        },
        async set(items) { for (const [k, v] of Object.entries(items)) data.set(k, clone(v)); },
        async remove(keys) { for (const k of [].concat(keys)) data.delete(k); },
        async getKeys() { return [...data.keys()]; },
    };
}
function memoryStore(files) {
    const refuse = (message) => new TargetError({ kind: 'permanent', status: 412, message });
    let n = files.size;
    return {
        async ping() { return true; },
        async put(file, body, { ifMatch, ifNoneMatch } = {}) {
            const old = files.get(file);
            if ((ifNoneMatch === '*' && old) || (ifMatch && (!old || old.etag !== ifMatch))) throw refuse('changed');
            const bytes = typeof body === 'string' ? new TextEncoder().encode(body) : new Uint8Array(body);
            files.set(file, { bytes, etag: 'n' + (++n) });
            return { etag: 'n' + n };
        },
        async get(file) { const f = files.get(file); return f ? { bytes: f.bytes, etag: f.etag } : null; },
        async remove(file) { return files.delete(file); },
        async list(prefix) { return [...files].filter(([f]) => f.startsWith(prefix + '/') && !f.slice(prefix.length + 1).includes('/')).map(([f, v]) => ({ path: f, etag: v.etag, size: v.bytes.length })); },
    };
}
async function device(files, extra = {}) {
    const storage = memoryStorage();
    const service = createSyncService({ storage, makeStore: async () => memoryStore(files), stampStore: createStampStore({ storage }) });
    const join = async () => {
        const place = await service.add({ connection: { service: 'webdav', url: 'https://dav.test/files/', username: 'u' }, secret: { password: 'p' },
            place: { mode: 'encrypted', direction: 'twoway', root: 'kaivo-test', passphrase: PASSPHRASE, ...extra } });
        const result = (await service.syncNow(place.id))[place.id];
        assert.ok(result && !result.error && !result.errors.length, JSON.stringify(result));
        return result;
    };
    return { storage, join, highlights: createHighlightStore({ storage }) };
}

const [mode, folder] = process.argv.slice(2);
if (mode === 'make') {
    const files = new Map(), a = await device(files);
    await a.storage.set({
        'articles:index': [{ id: 'x1', url: 'https://example.org/from-the-browser', title: 'Written in the browser', tags: ['science', 'Schlaf'], timestamp: '2026-11-02T08:30:00.000Z', progress: 0.35, archived: false, favorite: true }],
        'articles:rec:x1': { conversation: [
            { id: 'q_saved', q: 'Why does sleep help?', a: 'It **replays** the day.\n\n- first\n- second', sources: [], pinned: false, noted: true, ts: '2026-11-02T08:40:00.000Z' },
            { id: 'q_other', q: 'Asked, not saved', a: 'Left out.', sources: [], pinned: false, ts: '2026-11-02T08:41:00.000Z' },
        ], content: '<h2>Heading</h2><p>Grüße aus dem Browser 🌍, with a "quote" &amp; more.</p><p>' + 'A sentence that repeats. '.repeat(200) + '</p><p>Keep this suggestion.</p><p>Turn this down.</p><p>Remove this mark.</p>', summary: '<p>Short.</p>' },
    });
    const marked = (id, text, type, minute) => ({ op: 'add', hl: { id, url: 'https://example.org/from-the-browser', text, type, timestamp: `2026-11-02T08:${minute}:00.000Z` } });
    await a.highlights.apply([{ op: 'add', hl: { id: 'hl_browser', url: 'https://example.org/from-the-browser', text: 'Grüße aus dem Browser', type: 'user', timestamp: '2026-11-02T08:31:00.000Z', quote: { exact: 'Grüße aus dem Browser', prefix: '', suffix: ' 🌍' } } },
        marked('hl_keep', 'Keep this suggestion.', 'ghost', 32), marked('hl_down', 'Turn this down.', 'ghost', 33), marked('hl_gone', 'Remove this mark.', 'user', 34)]);
    const notes = createNotesStore({ storage: a.storage, now: () => '2026-11-02T08:36:00.000Z', mark: async () => 0 });
    await notes.add({ text: 'A note from the browser', tags: ['todo'], url: 'https://example.org/from-the-browser' });
    await notes.setComment('hl_browser', { text: 'Said in the browser', url: 'https://example.org/from-the-browser' });
    const result = await a.join();
    const out = path.resolve(here, '../Tests/Fixtures/sync-place.json');
    fs.writeFileSync(out, JSON.stringify({ note: 'Generated by scripts/sync-compat.mjs from the extension code.', passphrase: PASSPHRASE,
        files: Object.fromEntries([...files].map(([f, v]) => [f, Buffer.from(v.bytes).toString('base64')])),
        expect: { index: (await a.storage.get('articles:index'))['articles:index'][0], record: (await a.storage.get('articles:rec:x1'))['articles:rec:x1'], highlights: await a.highlights.all({ dismissed: true }),
            notes: await notes.list().then((l) => Object.fromEntries([...l.notes, ...Object.values(l.comments)].map((r) => [r.id, r]))) } }, null, 2) + '\n');
    console.log(`wrote ${out}: ${files.size} files, ${result.pushed} records`);
} else if (mode === 'check' && folder) {
    const files = new Map();
    const walk = (dir, rel) => { for (const e of fs.readdirSync(dir, { withFileTypes: true })) e.isDirectory() ? walk(path.join(dir, e.name), rel + e.name + '/') : files.set(rel + e.name, { bytes: new Uint8Array(fs.readFileSync(path.join(dir, e.name))), etag: 'a-' + e.name }); };
    walk(folder, '');
    const b = await device(files, { ackBackup: true }), result = await b.join();
    const expected = JSON.parse(fs.readFileSync(path.join(folder, '..', 'expect.json'), 'utf8'));
    const got = await b.storage.get(['articles:index', 'articles:rec:a1']);
    const entry = got['articles:index'].find((e) => e.id === 'a1');
    assert.equal(entry.title, expected.title);
    assert.equal(entry.progress, expected.progress);
    assert.deepEqual(entry.tags, expected.tags);
    assert.equal(got['articles:rec:a1'].content, expected.content);
    const marks = await b.highlights.all({ dismissed: true });
    assert.deepEqual(marks.map((h) => [h.id, h.text, !!h.dismissed]).sort(), expected.highlights.sort());
    console.log(`the extension reads what the app wrote: ${files.size} files, ${result.pulled} pulled, ${result.applied} applied`);
} else if (mode === 'back' && folder) {
    // what the app wrote back into the place made by `make` (SyncTests: testWritesBackReadingAndHighlightsAndNothingElse)
    const made = JSON.parse(fs.readFileSync(path.resolve(here, '../Tests/Fixtures/sync-place.json'), 'utf8'));
    const files = new Map();
    const walk = (dir, rel) => { for (const e of fs.readdirSync(dir, { withFileTypes: true })) e.isDirectory() ? walk(path.join(dir, e.name), rel + e.name + '/') : files.set(rel + e.name, { bytes: new Uint8Array(fs.readFileSync(path.join(dir, e.name))), etag: 'a-' + e.name }); };
    walk(path.join(folder, 'place'), '');
    // every record on the server, as it lies there
    const { openMeta, decryptJson } = await load('syncCrypto.js');
    const { keys } = await openMeta(JSON.parse(new TextDecoder().decode(files.get('meta.json').bytes)), { passphrase: made.passphrase });
    const records = [];
    for (const [name, f] of files) if (name !== 'meta.json') records.push(await decryptJson(keys, f.bytes));
    const names = records.map((r) => r.key).sort();
    const browserNote = Object.keys(made.expect.notes).find((id) => id.startsWith('n_'));
    assert.deepEqual(records.filter((r) => r.deleted).map((r) => r.key).sort(), ['hl:hl_gone', 'note:' + browserNote].sort(), 'deletion markers only for what was removed on purpose');
    const articles = records.filter((r) => r.key.startsWith('article:'));
    assert.deepEqual(articles.map((r) => r.key), ['article:x1'], 'only the library\'s own article is there: ' + names.join(', '));
    const x1 = articles[0].values;
    assert.equal(x1.content, made.expect.record.content, 'the text is byte for byte as the browser wrote it');
    assert.equal(x1.title, made.expect.index.title);
    assert.equal(x1.summaryBase, made.expect.record.summary);
    assert.equal(x1.progress, 0.95);
    // and as another browser sees it
    const b = await device(files, { ackBackup: true });
    await b.join();
    const index = (await b.storage.get('articles:index'))['articles:index'];
    assert.deepEqual(index.map((e) => [e.id, e.progress]), [['x1', 0.95]]);
    const seen = (await b.highlights.all({ dismissed: true })).map((h) => [h.text, h.type, !!h.dismissed]).sort();
    assert.deepEqual(seen, [
        ['Grüße aus dem Browser', 'user', false],
        ['Keep this suggestion.', 'user', false],
        ['Turn this down.', 'ghost', true],
        ['before joining', 'user', false],
        ['quote', 'user', false],
    ].sort());
    const turns = (await b.storage.get('articles:rec:x1'))['articles:rec:x1'].conversation;
    assert.deepEqual(turns.map((t) => [t.q, !!t.noted]), [['Why does sleep help?', true], ['Asked, not saved', false], ['Why on the phone?', true]], 'the question asked on the phone arrived, the others are as they were');
    assert.equal((await b.storage.get('articles:index'))['articles:index'][0].qaCount, 3);
    const kept = createNotesStore({ storage: b.storage, mark: async () => 0 });
    const listed = await kept.list();
    assert.deepEqual(listed.notes.map((n) => [n.text, n.tags]), [['From the phone', ['idea']]], 'the note written on the phone, and only that one');
    assert.deepEqual(Object.values(listed.comments).map((c) => [c.highlightId, c.text]).sort(), [['hl_browser', 'Said in the browser'], ['hl_keep', 'Said on the phone']]);
    console.log(`the extension reads what the app wrote back: ${records.length} records, progress ${x1.progress}, ${seen.length} highlights`);
} else {
    console.error('Usage: sync-compat.mjs make | check <folder> | back <folder>');
    process.exit(2);
}
process.exit(0);
