// Silent login renewal: refreshSession() swaps a token that is close to expiry and otherwise leaves everything alone.
import assert from 'assert';
import path from 'path';
import { pathToFileURL } from 'url';
const M = await import(pathToFileURL(path.join(process.env.AISH_SRC, 'modules/sessionToken.js')).href);
const jwt = (exp) => 'h.' + Buffer.from(JSON.stringify({ exp })).toString('base64url') + '.s';
const t0 = 1_800_000_000_000, sec = (ms) => Math.floor(ms / 1000), DAY = 86400e3;
let clock = t0; const now = () => clock;

assert.equal(M.needsRefresh(jwt(sec(t0 + 3 * DAY)), t0), true, '3 days left: renew');
assert.equal(M.needsRefresh(jwt(sec(t0 + 30 * DAY)), t0), false, 'plenty left');
assert.equal(M.needsRefresh(jwt(sec(t0 - 1000)), t0), false, 'already expired: renewing is not possible');
assert.equal(M.needsRefresh('not-a-jwt', t0), false);
assert.equal(M.tokenExpiresAt(jwt(100)), 100000); assert.equal(M.tokenExpiresAt(''), null);

const mk = (stored) => { const st = { ...stored }; return { st, storage: { get: async (k) => Object.fromEntries([].concat(k).filter((x) => x in st).map((x) => [x, st[x]])), set: async (o) => { Object.assign(st, o); } } }; };
const reply = (status, body) => async () => ({ status, ok: status >= 200 && status < 300, json: async () => body });
const K = { token: 'account:token', user: 'account:user', lic: 'account:licenseKey' };
const fresh = jwt(sec(t0 + 30 * DAY));

// near expiry → new token, user record and license key stored; the request carries the old token
{ M._resetRefreshState(); const old = jwt(sec(t0 + DAY)); const { st, storage } = mk({ [K.token]: old, [K.user]: { id: 'u0' } });
  let seen; const fetchFn = async (url, o) => { seen = { url, o }; return reply(200, { success: true, token: fresh, record: { id: 'u1', license_key: 'LIC' } })(); };
  assert.equal(await M.refreshSession({ apiBase: 'https://api.test', storage, fetchFn, now }), 'refreshed');
  assert.equal(seen.url, 'https://api.test/v1/auth/refresh'); assert.equal(seen.o.method, 'POST'); assert.equal(seen.o.headers.Authorization, 'Bearer ' + old);
  assert.equal(st[K.token], fresh); assert.equal(st[K.user].id, 'u1'); assert.equal(st[K.lic], 'LIC'); }

// not near expiry / no token → no request at all
for (const stored of [{ [K.token]: fresh }, {}]) { M._resetRefreshState(); const { storage } = mk(stored); let calls = 0;
  assert.equal(await M.refreshSession({ apiBase: 'x', storage, fetchFn: async () => { calls++; return reply(200, {})(); }, now }), 'skipped'); assert.equal(calls, 0); }

// server says no / is down / sends garbage: old token stays, never throws, and it backs off for a while
for (const [status, body, want] of [[401, {}, 'rejected'], [404, {}, 'error'], [500, {}, 'error'], [200, { success: true }, 'error']]) {
  M._resetRefreshState(); clock = t0; const old = jwt(sec(t0 + DAY)); const { st, storage } = mk({ [K.token]: old }); let calls = 0;
  const fetchFn = async () => { calls++; return reply(status, body)(); };
  assert.equal(await M.refreshSession({ apiBase: 'x', storage, fetchFn, now }), want, String(status));
  assert.equal(st[K.token], old, 'old token kept');
  assert.equal(await M.refreshSession({ apiBase: 'x', storage, fetchFn, now }), 'skipped', 'backs off'); assert.equal(calls, 1);
  clock = t0 + 11 * 60e3; await M.refreshSession({ apiBase: 'x', storage, fetchFn, now }); assert.equal(calls, 2, 'tries again after the back-off'); }

// network error → 'error', no throw
{ M._resetRefreshState(); clock = t0; const { storage } = mk({ [K.token]: jwt(sec(t0 + DAY)) });
  assert.equal(await M.refreshSession({ apiBase: 'x', storage, fetchFn: async () => { throw new TypeError('offline'); }, now }), 'error'); }

// two callers at once share one request
{ M._resetRefreshState(); clock = t0; const { storage } = mk({ [K.token]: jwt(sec(t0 + DAY)) }); let calls = 0;
  const fetchFn = async () => { calls++; await new Promise((r) => setTimeout(r, 5)); return reply(200, { success: true, token: fresh, record: { id: 'u' } })(); };
  const [a, b] = await Promise.all([M.refreshSession({ apiBase: 'x', storage, fetchFn, now }), M.refreshSession({ apiBase: 'x', storage, fetchFn, now })]);
  assert.equal(a, 'refreshed'); assert.equal(b, 'refreshed'); assert.equal(calls, 1); }
console.log('TEST 174 OK'); process.exit(0);
