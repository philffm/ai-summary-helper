// Support Pass without an order ID (AISH-037 A + B).
// bg/checkoutClaim.js: what the background stores for each answer of POST /v1/auth/claim-checkout, and that it never sends a
// login token when the buyer chose to switch accounts. modules/supportPass.js: the Payment Links carry the account's email and
// id, and only values that look right. Wiring: background handler on our /thanks only, loader claims there, page exists.
import assert from 'assert'; import fs from 'fs'; import path from 'path'; import vm from 'vm'; import { pathToFileURL } from 'url';
const SRC = process.env.AISH_SRC;
const read = (f) => fs.readFileSync(path.join(SRC, f), 'utf8');

// ---------- bg/checkoutClaim.js in a sandbox with the real storage keys ----------
const { SK } = await import(pathToFileURL(path.join(SRC, 'modules', 'storageKeys.js')).href);
const sandbox = { SK, console, URL, atob: (s) => Buffer.from(s, 'base64').toString('binary'), JSON, Date, Number, Promise, Object, String, RegExp };
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(read('bg/checkoutClaim.js'), sandbox, { filename: 'bg/checkoutClaim.js' });
const { claimCheckout } = sandbox;
assert.equal(typeof claimCheckout, 'function');

function area(init = {}) { const d = { ...init }; return { d, get: async (keys) => Object.fromEntries((Array.isArray(keys) ? keys : [keys]).map((k) => [k, d[k]])), set: async (o) => { Object.assign(d, o); } }; }
const jwt = (exp) => 'h.' + Buffer.from(JSON.stringify({ exp })).toString('base64url') + '.s';
const NOW = 1_800_000_000_000;
const SID = 'cs_test_a1B2c3D4e5F6g7';
function api(answers) {
  const calls = [];
  const fetchFn = async (url, init) => {
    calls.push({ url, init, body: init && init.body ? JSON.parse(init.body) : null });
    const a = answers[url.replace('https://api.byphil.eu', '')];
    const r = typeof a === 'function' ? a(calls[calls.length - 1]) : a;
    return { ok: r.status ? r.status < 400 : true, status: r.status || 200, json: async () => r.body };
  };
  return { fetchFn, calls };
}
const run = (o) => claimCheckout({ sessionId: SID, now: () => NOW, ...o });

// signed_in: a new login is stored like a code sign-in, the cloud becomes the default
{
  const local = area(), sync = area({ connectionMode: 'local', activeService: 'openai' });
  const { fetchFn, calls } = api({ '/v1/auth/claim-checkout': { body: { success: true, state: 'signed_in', token: 'tok', record: { id: 'u1', email: 'new@example.com', license_key: 'sub_1' } } } });
  const r = await run({ local, sync, fetchFn });
  assert.equal(r.state, 'signed_in'); assert.equal(r.email, 'new@example.com');
  assert.equal(local.d[SK.token], 'tok'); assert.equal(local.d[SK.user].id, 'u1'); assert.equal(local.d[SK.licenseKey], 'sub_1');
  assert.equal(sync.d.connectionMode, 'cloud', 'no working own API → byPhil cloud');
  assert.equal(calls[0].init.headers.Authorization, undefined, 'nobody was signed in');
  assert.deepEqual(calls[0].body, { session_id: SID });
}
// active with a valid token: the token goes along, the record is refreshed
{
  const local = area({ [SK.token]: jwt(NOW / 1000 + 3600) }), sync = area({ connectionMode: 'cloud' });
  const { fetchFn, calls } = api({ '/v1/auth/claim-checkout': { body: { success: true, state: 'active', record: { id: 'u2', email: 'a@example.com', subscription_status: 'active' } } } });
  const r = await run({ local, sync, fetchFn });
  assert.equal(r.state, 'active');
  assert.ok(calls[0].init.headers.Authorization.startsWith('Bearer '));
  assert.equal(local.d[SK.user].subscription_status, 'active');
}
// an expired token is not sent
{
  const local = area({ [SK.token]: jwt(NOW / 1000 - 10) });
  const { fetchFn, calls } = api({ '/v1/auth/claim-checkout': { body: { success: true, state: 'confirm', paid_email: 'p@x.io', account_email: 'a@x.io' } } });
  const r = await run({ local, sync: area(), fetchFn });
  assert.equal(calls[0].init.headers.Authorization, undefined);
  assert.deepEqual([r.state, r.email, r.account], ['confirm', 'p@x.io', 'a@x.io']);
}
// confirm: 'signed_in' is passed on with the token
{
  const local = area({ [SK.token]: jwt(NOW / 1000 + 3600) });
  const { fetchFn, calls } = api({ '/v1/auth/claim-checkout': { body: { success: true, state: 'active', record: { id: 'u3', email: 'a@x.io' } } } });
  await run({ local, sync: area(), fetchFn, confirm: 'signed_in' });
  assert.equal(calls[0].body.confirm, 'signed_in'); assert.ok(calls[0].init.headers.Authorization);
}
// code_required after "switch": signed out first, no token sent, the code is requested and the popup opens at the code step
{
  const local = area({ [SK.token]: jwt(NOW / 1000 + 3600), [SK.user]: { id: 'old' } });
  const { fetchFn, calls } = api({
    '/v1/auth/claim-checkout': { body: { success: true, state: 'code_required', email: 'buyer@example.com' } },
    '/v1/auth/request-otp': { body: { success: true, otpId: 'otp1', otpExpiresAt: new Date(NOW + 300000).toISOString() } },
  });
  const r = await run({ local, sync: area(), fetchFn, confirm: 'switch' });
  assert.deepEqual([r.state, r.email], ['code_required', 'buyer@example.com']);
  assert.equal(calls[0].init.headers.Authorization, undefined, 'switching never sends the other account’s token');
  assert.deepEqual(calls[1].body, { email: 'buyer@example.com' });
  assert.equal(local.d[SK.token], null); assert.equal(local.d[SK.user], null);
  assert.equal(local.d[SK.otpId], 'otp1'); assert.equal(local.d[SK.otpEmail], 'buyer@example.com');
  assert.equal(local.d[SK.otpExpiresAt], new Date(NOW + 300000).toISOString());
}
// not paid yet → pending (the loader asks again); errors keep their code; bad input never reaches the network
{
  let { fetchFn } = api({ '/v1/auth/claim-checkout': { status: 402, body: { success: false, code: 'not_paid' } } });
  assert.equal((await run({ local: area(), sync: area(), fetchFn })).state, 'pending');
  ({ fetchFn } = api({ '/v1/auth/claim-checkout': { status: 409, body: { success: false, code: 'already_claimed' } } }));
  assert.deepEqual(await run({ local: area(), sync: area(), fetchFn }).then((r) => [r.state, r.code]), ['error', 'already_claimed']);
  const { fetchFn: f2, calls } = api({});
  assert.equal((await claimCheckout({ sessionId: 'javascript:alert(1)', local: area(), sync: area(), fetchFn: f2 })).code, 'bad_session');
  assert.equal((await claimCheckout({ sessionId: SID, confirm: 'everything', local: area(), sync: area(), fetchFn: f2 })).code, 'bad_confirm');
  assert.equal(calls.length, 0);
  const boom = async () => { throw new Error('offline'); };
  assert.equal((await run({ local: area(), sync: area(), fetchFn: boom })).code, 'network');
}

// ---------- modules/supportPass.js ----------
const { checkoutUrl, PASS_LINKS, isPassActive } = await import(pathToFileURL(path.join(SRC, 'modules', 'supportPass.js')).href);
const u = new URL(checkoutUrl('monthly', { id: 'abcdefghij12345', email: 'phil@example.com' }));
assert.equal(u.origin + u.pathname, PASS_LINKS.monthly);
assert.equal(u.searchParams.get('prefilled_email'), 'phil@example.com');
assert.equal(u.searchParams.get('client_reference_id'), 'abcdefghij12345');
const odd = new URL(checkoutUrl('yearly', { id: 'not a pb id!', email: 'nope' }));
assert.equal(odd.searchParams.get('client_reference_id'), null); assert.equal(odd.searchParams.get('prefilled_email'), null);
assert.equal(checkoutUrl('lifetime', {}), null);
assert.equal(isPassActive({ subscription_status: 'active' }), true); assert.equal(isPassActive({ subscription_status: 'free' }), false); assert.equal(isPassActive(null), false);

// ---------- wiring ----------
const bg = read('background.js');
assert(/importScripts\('bg\/checkoutClaim\.js'\)/.test(bg), 'background imports the claim part');
assert(/'aish:claimCheckout': \{ from: 'page'/.test(bg) && /isOwnSite\(url\) && \/\^\\\/thanks/.test(bg), 'handler: page-only, our /thanks only');
const loader = read('loader.js');
assert(/aish:claimCheckout/.test(loader) && /\/\^\\\/thanks\(\\\.html\)\?\$\/\.test\(location\.pathname\)/.test(loader), 'loader claims on /thanks');
assert(/renderSupportPass\(document/.test(read('modules/authManager.js')) && /id="supportPassGroup"/.test(read('popup.html')), 'card wired into Account & Plan');
const site = fs.readFileSync(path.join(SRC, '..', '..', 'site-src', 'pages', 'thanks.html'), 'utf8');
for (const s of ['working', 'pending', 'active', 'signed_in', 'confirm', 'code_required', 'error', 'noext']) assert(new RegExp(`data-for="[^"]*\\b${s}\\b`).test(site), 'thank-you page has a state for ' + s);
assert(/history\.replaceState/.test(site) && /noindex/.test(site), 'page strips the session id and is not indexed');
assert(/session_id=\)\[\^&#\]\*\/, '\$1redacted'/.test(fs.readFileSync(path.join(SRC, '..', '..', 'docs', 'assets', 'analytics.js'), 'utf8')), 'analytics never receives the session id');
console.log('TEST 259 OK');
