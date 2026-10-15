// Send targets, step 2: safeFetch rules (origin, https, LAN opt-in, redirects, timeout, limits, error classes).
import assert from 'assert';
import { pathToFileURL } from 'url';
const shared = (rel) => import(pathToFileURL(process.env.AISH_SRC + '/' + rel).href);
const { createSafeFetch, isPrivateHost } = await shared('modules/targets/safeFetch.js');
const { TargetError } = await shared('modules/targets/targetError.js');

const res = (status, body = '', headers = {}) => ({ ok: status >= 200 && status < 300, status, type: 'basic', headers: new Headers(headers), arrayBuffer: async () => new TextEncoder().encode(body).buffer, body: null });
const conn = { id: 'c', baseUrl: 'https://dav.example/remote.php/dav' };
const sent = [];
const sf = (c, fetchFn, o = {}) => createSafeFetch(c, { fetchFn: async (u, i) => { sent.push({ u, i }); return fetchFn(u, i); }, ...o });
const kind = async (p) => { try { await p; return 'none'; } catch (e) { assert(e instanceof TargetError, 'TargetError expected, got ' + e); return e.kind; } };

// ok + the fixed request options
{ const f = sf(conn, async () => res(200, '{"a":1}'));
  const r = await f('/remote.php/dav/files/x.md', { method: 'PUT', body: 'hi' });
  assert.equal(r.status, 200); assert.deepEqual(r.json(), { a: 1 });
  const o = sent.at(-1); assert.equal(o.u, 'https://dav.example/remote.php/dav/files/x.md');
  assert.equal(o.i.redirect, 'error'); assert.equal(o.i.credentials, 'omit'); assert.equal(o.i.cache, 'no-store'); assert(o.i.signal);
  assert.equal(o.i.method, 'PUT');
}
// origin: only the connection's own server
assert.equal(await kind(sf(conn, async () => res(200))('https://evil.example/x')), 'permanent');
assert.equal(await kind(sf(conn, async () => res(200))('https://dav.example.evil.com/x')), 'permanent');
assert.equal(await kind(sf(conn, async () => res(200))('https://dav.example:8443/x')), 'permanent', 'another port is another origin');
// http only with explicit LAN opt-in and a private host
const lan = { id: 'l', baseUrl: 'http://192.168.1.20:8080/dav' };
const before = sent.length;
assert.equal(await kind(sf(lan, async () => res(200))('/dav/x')), 'permanent', 'http without opt-in');
assert.equal(await kind(sf({ ...lan, allowInsecureLan: true }, async () => res(200))('/dav/x')), 'none');
assert.equal(await kind(sf({ baseUrl: 'http://example.com/dav', allowInsecureLan: true }, async () => res(200))('/dav/x')), 'permanent', 'opt-in does not open public hosts');
assert.equal(sent.length, before + 1, 'refused requests never reach fetch');
for (const h of ['10.0.0.5', '172.16.0.1', '172.31.255.1', '192.168.0.1', 'localhost', 'nas.local', '127.0.0.1', '[::1]']) assert(isPrivateHost(h), h);
for (const h of ['172.32.0.1', '172.15.0.1', '8.8.8.8', 'example.com', '192.169.0.1', '10.example.com']) assert(!isPrivateHost(h), h);
// redirect → error (fetch refuses with redirect:'error'; a 3xx that gets through is refused too)
assert.equal(await kind(sf(conn, async () => res(302, '', { location: 'https://evil.example/' }))('/x')), 'permanent');
assert.equal(await kind(sf(conn, async (u, i) => { assert.equal(i.redirect, 'error'); throw new TypeError('redirect mode is set to error'); })('/x')), 'retry', 'network-level failure');
// timeout → retry
{ const f = sf(conn, (u, i) => new Promise((_, rej) => i.signal.addEventListener('abort', () => rej(new DOMException('aborted', 'AbortError')))), { timeoutMs: 30 });
  assert.equal(await kind(f('/x')), 'retry'); }
// status classes
for (const [s, k] of [[401, 'auth'], [403, 'auth'], [408, 'retry'], [429, 'retry'], [500, 'retry'], [503, 'retry'], [400, 'permanent'], [404, 'permanent'], [409, 'permanent'], [412, 'permanent']])
    assert.equal(await kind(sf(conn, async () => res(s))('/x')), k, String(s));
// Retry-After (seconds and date)
{ let e; try { await sf(conn, async () => res(429, '', { 'retry-after': '120' }))('/x'); } catch (x) { e = x; }
  assert.equal(e.retryAfterMs, 120000); assert.equal(e.status, 429);
  const t = 1_800_000_000_000;
  try { await sf(conn, async () => res(503, '', { 'retry-after': new Date(t + 90000).toUTCString() }), { now: () => t })('/x'); } catch (x) { e = x; }
  assert.equal(e.retryAfterMs, 90000); }
// size limits (body and answer)
assert.equal(await kind(sf(conn, async () => res(200))('/x', { method: 'PUT', body: 'x'.repeat(2000) })), 'none');
assert.equal(await kind(sf(conn, async () => res(200), { maxBytes: 1000 })('/x', { method: 'PUT', body: 'x'.repeat(2000) })), 'permanent');
assert.equal(await kind(sf(conn, async () => res(200, 'y'.repeat(2000)), { maxBytes: 1000 })('/x')), 'permanent');
assert.equal(await kind(sf(conn, async () => res(200, 'ok', { 'content-length': '999999999' }))('/x')), 'permanent');
// logging: host and status only
{ const lines = []; await sf(conn, async () => res(200, 'secret-body'), { log: (l) => lines.push(l) })('/files/secret-name.md', { method: 'PUT', headers: { Authorization: 'Bearer tok' }, body: 'private' });
  assert.deepEqual(lines, ['dav.example 200']); }
assert.equal(await kind(createSafeFetch({ baseUrl: 'not a url' })('/x')), 'permanent');
console.log('TEST 172 OK'); process.exit(0);
