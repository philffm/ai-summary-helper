// Page metadata is collected and saved with the summary (record + lean favicon in the index), then reused on resume.
import assert from 'assert';
import { setup, imp, tick } from './harness.mjs';
const { w, store } = setup({}); const d = w.document;
const core = await imp('content/core.js');
const { SK } = await imp('modules/storageKeys.js');
d.head.innerHTML = `<meta name="description" content="  A long   description
 of the page "><meta property="og:site_name" content="Example Mag"><meta property="og:image" content="/img/cover.png">
<meta name="author" content="Ada"><link rel="icon" href="/static/fav.png">`;
d.documentElement.setAttribute('lang', 'de');
const meta = core.collectPageMeta(d, { href: 'https://ex.com/a/b', origin: 'https://ex.com' });
assert.equal(meta.description, 'A long description of the page');
assert.equal(meta.favicon, 'https://ex.com/static/fav.png'); assert.equal(meta.image, 'https://ex.com/img/cover.png');
assert.equal(meta.siteName, 'Example Mag'); assert.equal(meta.author, 'Ada'); assert.equal(meta.lang, 'de'); assert(!('published' in meta));
d.head.innerHTML = '';
assert.equal(core.collectPageMeta(d, { href: 'https://ex.com/a', origin: 'https://ex.com' }).favicon, 'https://ex.com/favicon.ico', 'favicon fallback');
assert(core.collectPageMeta(d, { href: 'https://ex.com/a', origin: 'https://ex.com' }).description === undefined);
const saved = await core.saveToLocalStorage('<p>c</p>', '<p>s</p>', 'https://ex.com/a/b', 'T', '', ['x'], 'm', 200, undefined, undefined, meta);
const rec = store['articles:rec:' + saved.id];
assert.equal(rec.meta.siteName, 'Example Mag'); assert.equal(rec.description, 'A long description of the page');
assert.equal(store[SK.articlesIndex][0].favicon, 'https://ex.com/static/fav.png');
assert(!('meta' in store[SK.articlesIndex][0]), 'index stays lean');
const { default: SM } = await imp('modules/storageManager.js');
const full = await SM.getArticleFull(saved.id);
assert.equal(full.meta.author, 'Ada'); assert.equal(full.title, 'T');
console.log('TEST 47 OK');
