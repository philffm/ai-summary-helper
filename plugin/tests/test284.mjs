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
const order = []; const ordered = N.createSender({ storage, send: async (m) => { order.push(m.type); return { ok: true, folder }; } });
await ordered(); assert.deepEqual(order, ['hello', 'image', 'article']);
const deaf = N.createSender({ storage, send: async () => { throw new Error('no app'); } });
assert.equal((await deaf()).ok, false, 'a missing app is not an error that escapes');

console.log('TEST 284 OK');
process.exit(0);
