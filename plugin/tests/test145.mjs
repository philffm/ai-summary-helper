// Articles for the phone: HTML → text blocks, gzip + AES-GCM envelope v2, the shared article vector, size cap, pairing code with both inboxes.
import assert from 'assert';
import fs from 'fs';
import path from 'path';
import { imp, setup } from './harness.mjs';
setup();

const C = await imp('modules/inboxCrypto.js');
const B = await imp('modules/articleBlocks.js');
const vecPath = path.join(process.env.AISH_TESTS, 'fixtures/inbox-vector.json');
const vec = JSON.parse(fs.readFileSync(vecPath, 'utf8'));

// 1) HTML → blocks: reading order, headings, lists, quotes, code; scripts, nav, images, forms dropped; whitespace squashed
const html = `<article><nav>Menu Home About</nav><h1>Größe  &amp; Wunder</h1><p>First <b>bold</b> and <a href="https://x.test">a link</a>.<br>Second line.</p>
<script>alert(1)</script><style>p{}</style><img src="a.png" alt="x"><h4>Small</h4><ul><li>One</li><li>Two <em>em</em><ul><li>Nested</li></ul></li></ul>
<blockquote>Quoted <i>text</i></blockquote><pre>line 1\n  line 2\n</pre><form><input value="no"></form><footer>Footer</footer><p> </p><div>Loose <span>div</span> text</div></article>`;
const doc = new DOMParser().parseFromString(html, 'text/html');
const blocks = B.htmlToBlocks(doc.body);
assert.deepEqual(blocks, [
    ['h1', 'Größe & Wunder'], ['p', 'First bold and a link. Second line.'], ['h3', 'Small'],
    ['li', 'One'], ['li', 'Two em'], ['li', 'Nested'], ['q', 'Quoted text'], ['pre', 'line 1\n  line 2'], ['p', 'Loose div text'],
]);
assert.deepEqual(B.textToBlocks('A\n\nB  b\n\n\n\nC'), [['p', 'A'], ['p', 'B b'], ['p', 'C']]);
assert.deepEqual(B.cleanBlocks([['p', ' ok '], ['script', 'x'], ['p', 5], 'x', ['h2', '   ']]), [['p', 'ok']]);
const af = B.articleForPhone({ url: 'https://www.example.com/a', title: ' T ', content: '<p>Hi</p>', summary: 'S', language: 'de' }, (h) => new DOMParser().parseFromString(h, 'text/html').body);
assert.deepEqual(af, { url: 'https://www.example.com/a', title: 'T', site: 'example.com', byline: '', lang: 'de', summary: 'S', blocks: [['p', 'Hi']] });

// 2) the shared vector (optionally regenerated with AISH_WRITE_VECTOR=1) decrypts; plaintext is gzip of JSON
const av = vec.article;
if (process.env.AISH_WRITE_VECTOR === '1') {
    const secrets = { inboxId: 'q6ytrq2trK2urq2urq2urg', encKey: vec.encKey };
    const message = { url: 'https://example.com/größe?a=1&b=2', sentAt: 1760000000000, title: 'Größe & Wunder ✓', site: 'example.com', byline: 'Jörg Müller', lang: 'de',
        summary: '- Punkt eins\n- Punkt zwei', blocks: [['h2', 'Überschrift 日本語'], ['p', 'Ein Absatz mit Emoji 🙂 und Umlauten äöüß.'], ['li', 'Listenpunkt'], ['q', 'Zitat'], ['pre', 'a\n  b']] };
    const nonce = Uint8Array.from(Buffer.from('303132333435363738393a3b', 'hex'));
    const sealed = await C.encryptArticle(secrets, message, { iv: nonce });
    vec.article = { _about: 'Article for the phone, envelope v2. Decrypt with encKey and inboxId (the extension→phone inbox) using AES-256-GCM, then gunzip, then parse JSON. Must equal `message`.', inboxId: secrets.inboxId, nonceHex: '303132333435363738393a3b', message: C.cleanArticleMessage(message), envelope: sealed.envelope };
    fs.writeFileSync(vecPath, JSON.stringify(vec, null, 2) + '\n');
    console.log('vector written');
}
const av2 = JSON.parse(fs.readFileSync(vecPath, 'utf8')).article;
const asec = { inboxId: av2.inboxId, encKey: vec.encKey };
assert.deepEqual(await C.decryptArticle(asec, av2.envelope), av2.message);
assert.equal(av2.envelope.v, 2);

// 3) round trip, random nonce, tamper / replay / wrong key / wrong version rejected, links stay web-only
const s = C.newInboxSecrets();
const msg = { url: 'https://example.com/p', title: 'Hello', blocks: [['p', 'World']], sentAt: 5 };
const e1 = await C.encryptArticle(s, msg), e2 = await C.encryptArticle(s, msg);
assert.notEqual(e1.envelope.data, e2.envelope.data);
assert.deepEqual(await C.decryptArticle(s, e1.envelope), { ...C.cleanArticleMessage(msg) });
const flip = (str, at) => { const b = C.fromB64u(str); b[at] ^= 1; return C.toB64u(b); };
for (const at of [0, 14, C.fromB64u(e1.envelope.data).length - 1]) await assert.rejects(C.decryptArticle(s, { v: 2, data: flip(e1.envelope.data, at) }));
await assert.rejects(C.decryptArticle({ ...s, inboxId: C.newInboxSecrets().inboxId }, e1.envelope), undefined, 'AAD binds the inbox');
await assert.rejects(C.decryptArticle({ ...s, encKey: C.newInboxSecrets().encKey }, e1.envelope), undefined, 'wrong key');
await assert.rejects(C.decryptArticle(s, { v: 1, data: e1.envelope.data }), /Unsupported/);
await assert.rejects(C.encryptArticle(s, { ...msg, url: 'javascript:alert(1)' }), /web link/);
await assert.rejects(C.encryptArticle(s, { ...msg, blocks: [] }), /Empty/);
await assert.rejects(C.decryptMessage(s, e1.envelope), /Unsupported/, 'a link reader never accepts an article envelope');

// 4) size: a huge article is shortened to fit the gzip cap, ciphertext stays under the server's 190,000 characters
let seed = 12345; const rnd = () => { seed = (Math.imul(seed, 1103515245) + 12345) & 0x7fffffff; return seed >>> 8; };
const word = () => Array.from({ length: 3 + (rnd() % 8) }, () => String.fromCharCode(97 + (rnd() % 26))).join('');
const big = Array.from({ length: 5000 }, () => ['p', Array.from({ length: 120 }, word).join(' ')]);
const eb = await C.encryptArticle(s, { url: 'https://example.com/big', title: 'Big', blocks: big });
assert(eb.truncated && eb.blocks < big.length && eb.blocks > 100, 'shortened: ' + eb.blocks);
assert(eb.bytes <= C.MAX_ARTICLE_GZ);
assert(eb.envelope.data.length < 190000, 'under the server cap: ' + eb.envelope.data.length);
const back = await C.decryptArticle(s, eb.envelope);
assert.equal(back.truncated, true); assert.equal(back.blocks.length, eb.blocks);
// a decompression bomb is refused (200 MB of zeros gzip to about 200 KB; sealed with the right key it still must not inflate)
const zlib = await import('zlib');
const bomb = zlib.gzipSync(Buffer.alloc(200 * 1024 * 1024));
const iv = crypto.getRandomValues(new Uint8Array(12));
const key = await crypto.subtle.importKey('raw', C.fromB64u(s.encKey), { name: 'AES-GCM' }, false, ['encrypt']);
const sealedBomb = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: new TextEncoder().encode(s.inboxId), tagLength: 128 }, key, bomb));
const all = new Uint8Array(12 + sealedBomb.length); all.set(iv); all.set(sealedBomb, 12);
await assert.rejects(C.decryptArticle(s, { v: 2, data: C.toB64u(all) }), /too large/i);

// 5) pairing code: old shape unchanged, new shape carries the second inbox (id + READ token only)
const p1 = C.pairingPayload(s);
assert.equal(p1, `aish-inbox://v1?i=${s.inboxId}&k=${s.encKey}&w=${s.writeToken}`);
assert.equal(C.parsePairingPayload(p1).toPhone, null);
const t = { inboxId: C.newInboxSecrets().inboxId, readToken: C.newInboxSecrets().readToken, writeToken: C.newInboxSecrets().writeToken };
const p2 = C.pairingPayload({ ...s, toPhone: t });
assert(p2.startsWith(p1) && p2.includes('&ti=' + t.inboxId + '&tr=' + t.readToken));
assert(!p2.includes(t.writeToken) && !p2.includes(s.readToken), 'no write token of the second inbox, no read token of the first');
assert.deepEqual(C.parsePairingPayload(p2).toPhone, { inboxId: t.inboxId, readToken: t.readToken });
assert.throws(() => C.parsePairingPayload(p1 + '&ti=short&tr=x'), /Invalid/);
console.log('ok');

// 7) the AI summary is stored as HTML: the phone gets readable text (bullets as "- ", no tags)
{
    const parse = (h) => new DOMParser().parseFromString(h, 'text/html').body;
    assert.equal(B.summaryToText('<p>Intro <b>bold</b></p><ul><li>One &amp; two</li><li>Three</li></ul>', parse), 'Intro bold\n\n- One & two\n- Three');
    assert.equal(B.summaryToText('- already\n- plain', parse), '- already\n- plain');
    assert.equal(B.summaryToText('', parse), '');
    const af2 = B.articleForPhone({ url: 'https://example.com/a', title: 'T', content: '<p>x</p>', summary: '<ul><li>A</li></ul>' }, parse);
    assert.equal(af2.summary, '- A');
}
