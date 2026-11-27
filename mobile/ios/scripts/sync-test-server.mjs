#!/usr/bin/env node
// A WebDAV server on this Mac with a library in it, for trying the app's sync over a real connection. The library is made by
// the extension's own modules, which upload it through this server as a browser would.
//     node mobile/ios/scripts/sync-test-server.mjs [--articles=600] [--images=0] [--image-mb=3] [--out=<file.json>]
// --images: that many articles carry a picture of --image-mb megabytes inside their text, as saved pages do.
// It prints (and writes to --out) the code a phone joins with, the passphrase and what must arrive; then it serves until it
// is stopped. GET /_stats tells what was asked of it. Listens on 127.0.0.1 only; the login is made up on every start.
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const load = (name) => import(path.resolve(here, '../../../plugin/src/modules', name));
const { createStampStore } = await load('syncStampStore.js');
const { createSyncService } = await load('syncService.js');
const { makeStore } = await load('syncStores.js');
const { createHighlightStore } = await load('highlightStore.js');
const { buildPhoneCode } = await load('syncPhoneCode.js');
const { hashValue } = await load('syncStamps.js');

const arg = (name, fallback) => (process.argv.find((a) => a.startsWith(`--${name}=`)) || '').split('=')[1] || fallback;
const COUNT = Number(arg('articles', '600')), OUT = arg('out', '');
const PICTURES = Number(arg('images', '0')), PICTURE_MB = Number(arg('image-mb', '3'));
const PASSPHRASE = 'abandon ability able about above';
const user = 'tester', password = crypto.randomBytes(12).toString('hex');

// ── the server ──
const files = new Map(), folders = new Set(['/dav']);
let version = 0, stats = {};
const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    if (url.pathname === '/_stats') { res.end(JSON.stringify(stats)); return; }
    if (url.pathname === '/_stats/reset') { stats = {}; res.end('{}'); return; }
    const name = decodeURIComponent(url.pathname).replace(/\/+$/, ''), parent = name.slice(0, name.lastIndexOf('/'));
    stats[req.method] = (stats[req.method] || 0) + 1;
    const done = (code, headers = {}, body = '') => { res.writeHead(code, headers); res.end(body); };
    if (req.headers.authorization !== 'Basic ' + Buffer.from(`${user}:${password}`).toString('base64')) return done(401);
    const parts = [];
    req.on('data', (d) => parts.push(d));
    req.on('end', () => {
        const old = files.get(name);
        if (req.method === 'MKCOL') { if (folders.has(name)) return done(405); if (!folders.has(parent)) return done(409); folders.add(name); return done(201); }
        if (req.method === 'PUT') {
            if (!folders.has(parent)) return done(409);
            if ((req.headers['if-none-match'] === '*' && old) || (req.headers['if-match'] && (!old || req.headers['if-match'] !== `"${old.etag}"`))) return done(412);
            files.set(name, { data: Buffer.concat(parts), etag: 'v' + (++version) });
            return done(old ? 204 : 201, { etag: `"v${version}"` });
        }
        if (req.method === 'GET') return old ? done(200, { etag: `"${old.etag}"` }, old.data) : done(404);
        if (req.method === 'DELETE') return done(files.delete(name) ? 204 : 404);
        if (req.method === 'PROPFIND') {
            if (!folders.has(name) && !old) return done(404);
            const entry = (href, inner) => `<d:response><d:href>${href.split('/').map(encodeURIComponent).join('/')}</d:href><d:propstat><d:prop>${inner}</d:prop></d:propstat></d:response>`;
            let list = entry(name + '/', '<d:resourcetype><d:collection/></d:resourcetype>');
            if (req.headers.depth === '1') for (const [f, v] of files) if (f.slice(0, f.lastIndexOf('/')) === name) list += entry(f, `<d:getetag>"${v.etag}"</d:getetag><d:getcontentlength>${v.data.length}</d:getcontentlength><d:resourcetype/>`);
            return done(207, { 'content-type': 'application/xml' }, `<?xml version="1.0"?><d:multistatus xmlns:d="DAV:">${list}</d:multistatus>`);
        }
        return done(405);
    });
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const address = `http://127.0.0.1:${server.address().port}/dav/`;

// ── the library, made as the extension makes one ──
const data = new Map(), clone = (v) => JSON.parse(JSON.stringify(v));
const storage = {
    async get(q) { const names = q == null ? [...data.keys()] : typeof q === 'string' ? [q] : Array.isArray(q) ? q : Object.keys(q); const out = q && typeof q === 'object' && !Array.isArray(q) ? { ...q } : {}; for (const k of names) if (data.has(k)) out[k] = clone(data.get(k)); return out; },
    async set(items) { for (const [k, v] of Object.entries(items)) data.set(k, clone(v)); },
    async remove(keys) { for (const k of [].concat(keys)) data.delete(k); },
    async getKeys() { return [...data.keys()]; },
};
const words = 'sleep memory reading source water library feed article research brain energy city design privacy model signal'.split(' ');
let seed = 7;
const next = () => (seed = (seed * 48271) % 2147483647);
const sentence = () => Array.from({ length: 9 + (next() % 14) }, () => words[next() % words.length]).join(' ') + '.';
const index = [], marks = [];
for (let i = 0; i < COUNT; i++) {
    const id = 't' + i, url = `https://example.org/articles/${i}`;
    // random bytes, so that compression cannot make a large picture small
    const picture = i < PICTURES ? `<img src="data:image/jpeg;base64,${crypto.randomBytes(PICTURE_MB * 1024 * 1024).toString('base64')}">` : '';
    const content = `<h2>Part ${i}</h2>` + Array.from({ length: 12 + (next() % 30) }, () => `<p>${sentence()} ${sentence()}</p>`).join('') + picture + '<p>Grüße 🌍</p>';
    index.push({ id, url, title: `Test article ${i}: ${sentence()}`, tags: [words[i % words.length]], timestamp: new Date(Date.UTC(2026, 0, 1, 0, i)).toISOString(), progress: (i % 10) / 10, archived: false });
    await storage.set({ [`articles:rec:${id}`]: { content, summary: `<p>${sentence()}</p>` } });
    if (i % 3 === 0) marks.push({ op: 'add', hl: { id: 'hl_t' + i, url, text: `Part ${i}`, type: i % 6 ? 'user' : 'ghost', timestamp: new Date(Date.UTC(2026, 0, 2, 0, i)).toISOString() } });
}
await storage.set({ 'articles:index': index });
await createHighlightStore({ storage }).apply(marks);
const service = createSyncService({ storage, makeStore, stampStore: createStampStore({ storage }) });
const connection = { service: 'webdav', url: address, username: user, allowInsecureLan: true };
const place = await service.add({ connection, secret: { password }, place: { mode: 'encrypted', direction: 'twoway', root: 'kaivo-test', passphrase: PASSPHRASE } });
for (;;) { const r = (await service.syncNow(place.id))[place.id]; if (r.error || r.errors.length) throw new Error(JSON.stringify(r)); if (!r.more) break; }

const records = await storage.get(index.map((e) => `articles:rec:${e.id}`));
const expect = {
    articles: COUNT, highlights: marks.length,
    // order and key order mean nothing: each side sorts by id and hashes the same fields
    hash: hashValue(index.slice().sort((a, b) => a.id.localeCompare(b.id)).map((e) => [e.id, e.url, e.title, e.tags, e.progress, records[`articles:rec:${e.id}`].content])),
};
const code = buildPhoneCode({ connection, secret: { password }, place, words: '' });
const info = { code, passphrase: PASSPHRASE, stats: address.replace('/dav/', '/_stats'), expect, files: files.size, bytes: [...files.values()].reduce((n, f) => n + f.data.length, 0) };
stats = {};
if (OUT) fs.writeFileSync(OUT, JSON.stringify(info, null, 2));
console.log(`ready: ${COUNT} articles, ${marks.length} highlights, ${info.files} files, ${(info.bytes / 1e6).toFixed(1)} MB on ${address}`);
