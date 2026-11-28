// Safari on iOS: saved articles go to the app (bg/nativeLibrary.js): what is sent, only changes, again after a new install, never without the permission.
import assert from 'assert';
import fs from 'fs'; import path from 'path'; import vm from 'vm';
const src = process.env.AISH_SRC;
const code = fs.readFileSync(path.join(src, 'bg/nativeLibrary.js'), 'utf8');
const manifest = (p) => JSON.parse(fs.readFileSync(path.join(src, '..', 'platforms', p, 'manifest.json'), 'utf8'));

// Safari decodes a classic background script as Latin-1: everything outside comments must be ASCII
for (const line of code.split('\n')) assert.ok(/^[\x00-\x7f]*$/.test(line.replace(/\/\/.*$|\/\*\*?.*$|^\s*\*.*$/, '')), 'non-ASCII in code: ' + line.trim());

// only iOS asks for the permission and loads the script
assert.ok(manifest('ios').permissions.includes('nativeMessaging') && manifest('ios').background.scripts.includes('bg/nativeLibrary.js'));
for (const p of ['chrome', 'firefox', 'android']) assert.ok(!(manifest(p).permissions || []).includes('nativeMessaging'), p);

const load = (permissions, calls) => {
    const self = {};
    const chrome = { runtime: { getManifest: () => ({ permissions }), sendNativeMessage: (...a) => { calls.push(a); return Promise.resolve({ ok: true, folder: 'f' }); } },
        storage: { local: { get: (k, cb) => cb({}), set: (v, cb) => cb() }, onChanged: { addListener: () => calls.push('listen') } } };
    vm.runInNewContext(code, { self, chrome, URL, setTimeout: () => 0, clearTimeout: () => {}, console });
    return self.AISH_NATIVE;
};
const none = []; load(['storage'], none); assert.deepEqual(none, [], 'without the permission nothing listens and nothing is sent');
const yes = []; const N = load(['nativeMessaging'], yes); assert.deepEqual(yes, ['listen']);

const plain = (v) => JSON.parse(JSON.stringify(v));   // values made in the other context
const entry = { id: 'article_1_a', url: 'https://example.com/a?utm=1', title: 'A', tags: ['tech', '🌐 en'], contentWordCount: 12, timestamp: '2026-11-25T10:00:00.000Z', progress: 0.4 };
const highlights = [{ url: 'https://example.com/a', text: 'one', type: 'ghost' }, { url: 'https://example.com/a', text: 'two', type: 'user' }, { text: '  ' }];
const p = plain(N.toPackage(entry, { summary: '<p>s</p>', content: 'x'.repeat(300000) }, highlights));
assert.deepEqual(p.tags, ['tech']); assert.equal(p.content.length, 200000);
const picture = 'A'.repeat(300000);
const withImages = plain(N.toPackage(entry, { content: `<p>before</p><img src="data:image/jpeg;base64,${picture}" alt="x"><img src="data:image/svg+xml;base64,QUJD"><img src="https://example.com/i.png"><p>after</p>` }));
assert.deepEqual(withImages.images.map((i) => [i.name, i.data.length]), [['0', 300000]], 'pictures travel apart; other kinds are left out');
assert.ok(withImages.content.includes('kaivo-image:0') && withImages.content.endsWith('<p>after</p>') && !withImages.content.includes('base64') && withImages.content.includes('https://example.com/i.png'), 'the text is complete'); assert.equal(p.progress, 0.4); assert.equal(p.words, 12);
assert.deepEqual(p.highlights, [{ text: 'one', ai: true }, { text: 'two', ai: false }]);
assert.ok(!('questions' in p), 'none prepared, none sent');
assert.deepEqual(plain(N.toPackage(entry, { suggested: ['Why so?', 'And then?', ''], suggestedAnswers: { 'Why so?': 'Because of it.' } }, [])).questions,
    [{ q: 'Why so?', a: 'Because of it.' }, { q: 'And then?', a: '' }]);
assert.equal(N.toPackage({ id: '../x', url: 'https://example.com' }), null, 'an id becomes a file name');
assert.equal(N.toPackage({ id: 'ok', url: 'javascript:alert(1)' }), null);

const store = { 'articles:index': [entry], 'articles:rec:article_1_a': { summary: 's', content: 'c' }, 'hl:index': [{ k: 'https://example.com/a' }], 'hl:page:https://example.com/a': highlights };
const storage = { get: (keys, cb) => cb(Object.fromEntries(keys.filter((k) => k in store).map((k) => [k, structuredClone(store[k])]))), set: (v, cb) => { Object.assign(store, structuredClone(plain(v))); cb(); } };
let folder = 'one', accept = true; const got = [];
const pictures = [];
const run = N.createSender({ storage, send: async (m) => { if (m.type === 'hello') return { ok: true, folder }; if (m.type === 'image') { pictures.push(plain(m)); return { ok: accept }; } got.push(plain(m.article)); return { ok: accept }; } });

assert.equal((await run()).sent, 1);
assert.equal(got[0].highlights.length, 2, 'highlights are matched by page, the query of the article does not matter');
assert.equal((await run()).sent, 0, 'unchanged: nothing is sent again');
store['articles:index'][0].progress = 0.9;
assert.equal((await run()).sent, 1);
folder = 'two';
assert.equal((await run()).sent, 1, 'another folder (the app is new): everything again');
store['articles:index'][0].title = 'B'; accept = false;
assert.equal((await run()).ok, false);
accept = true;
assert.equal((await run()).sent, 1, 'what was refused is tried again');
assert.ok(!('images' in got.at(-1)));
store['articles:rec:article_1_a'] = { content: '<img src="data:image/png;base64,QUJDRA==">' };
const order = []; const reads = [];
const counting = { get: (keys, cb) => { reads.push(...keys.filter((k) => k.startsWith('articles:rec:'))); storage.get(keys, cb); }, set: storage.set };
const ordered = N.createSender({ storage: counting, send: async (m) => { order.push(m.type); return { ok: true, folder }; } });
await ordered(); assert.deepEqual([order, reads], [['hello'], []], 'nothing moved: no saved text is read');
ordered.touch(['article_1_a']); order.length = 0;
await ordered(); assert.deepEqual(order, ['hello', 'image', 'article'], 'a changed text is sent');
reads.length = 0; await ordered(); assert.deepEqual(reads, [], 'and not read again afterwards');
const deaf = N.createSender({ storage, send: async () => { throw new Error('no app'); } });
assert.equal((await deaf()).ok, false, 'a missing app is not an error that escapes');

// newest first, and the feed subscriptions go along
const lib = { 'articles:index': [{ ...entry, id: 'old', timestamp: '2026-01-01T00:00:00.000Z' }, { ...entry, id: 'new', timestamp: '2026-11-01T00:00:00.000Z' }],
    'feeds:subs': [{ url: 'https://a.test/feed', title: 'A', customTitle: 'Mine', tags: ['x'], etag: 'e' }, { url: 'ftp://no' }, { url: 'https://b.test/rss', title: 'B' }] };
const box = { get: (keys, cb) => cb(Object.fromEntries(keys.filter((k) => k in lib).map((k) => [k, structuredClone(lib[k])]))), set: (v, cb) => { Object.assign(lib, plain(v)); cb(); } };
const log = []; const both = N.createSender({ storage: box, send: async (m) => { log.push(m.type === 'article' ? m.article.id : m.type === 'feeds' ? plain(m.feeds) : m.type); return { ok: true, folder: 'z' }; } });
await both();
assert.deepEqual(log, ['hello', [{ url: 'https://a.test/feed', title: 'Mine', tags: ['x'] }, { url: 'https://b.test/rss', title: 'B', tags: [] }], 'new', 'old']);
log.length = 0; await both(); assert.deepEqual(log, ['hello'], 'unchanged feeds are not sent again');
lib['feeds:subs'] = lib['feeds:subs'].slice(0, 1); log.length = 0; await both(); assert.equal(log[1].length, 1, 'a changed list is');
// the wake-up alarm covers a run that is cut off; one that ends, even refused, removes it again
{
    const alarms = []; let timer = null;
    const chrome = { runtime: { getManifest: () => ({ permissions: ['nativeMessaging'] }), sendNativeMessage: () => Promise.resolve({ ok: false }) },
        alarms: { create: () => alarms.push('create'), clear: () => alarms.push('clear'), onAlarm: { addListener: () => {} } },
        storage: { local: { get: (k, cb) => cb({}), set: (v, cb) => cb() }, onChanged: { addListener: () => {} } } };
    vm.runInNewContext(code, { self: {}, chrome, URL, setTimeout: (f) => { timer = f; return 1; }, clearTimeout: () => {}, console: { warn: () => {} } });
    await timer();
    assert.deepEqual(alarms, ['create', 'clear']);
}
// a page just saved goes at once, and later writes do not push it back; an import waits for quiet
{
    const waits = []; let listener = null, fire = null;
    const chrome = { runtime: { getManifest: () => ({ permissions: ['nativeMessaging'] }), sendNativeMessage: () => Promise.resolve({ ok: true, folder: 'f' }) },
        storage: { local: { get: (k, cb) => cb({}), set: (v, cb) => cb() }, onChanged: { addListener: (f) => { listener = f; } } } };
    vm.runInNewContext(code, { self: {}, chrome, URL, setTimeout: (f, ms) => { waits.push(ms); fire = f; return waits.length; }, clearTimeout: () => {}, console });
    const list = (...ids) => ids.map((id) => ({ id }));
    waits.length = 0;
    listener({ 'articles:index': { oldValue: list('a'), newValue: list('a', 'b') } }, 'local');
    assert.deepEqual(waits, [300], 'saved: at once');
    listener({ 'articles:rec:b': { newValue: {} } }, 'local');
    assert.deepEqual(waits, [300], 'what follows leaves it be');
    await fire();
    waits.length = 0;
    listener({ 'articles:index': { oldValue: list('a'), newValue: list('a') } }, 'local');
    listener({ 'articles:index': { oldValue: [], newValue: list('a', 'b', 'c', 'd') } }, 'local');
    assert.deepEqual(waits, [4000, 4000], 'a change or an import waits for quiet');
}
console.log('TEST 284 OK');
process.exit(0);
