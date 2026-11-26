// The App Store build (modules/storeBuild.js) shows nothing to buy or to unlock; and an account can be deleted in the
// extension, only after a yes, with a live sign-in, and is forgotten here only when the server agreed.
import { setup, imp, tick } from './harness.mjs'; import assert from 'assert';
import fs from 'fs'; import path from 'path';
const { w, store } = setup({});
const d = w.document; globalThis.document = d; globalThis.window = w; globalThis.alert = () => {};
const src = (f) => fs.readFileSync(path.join(process.env.AISH_SRC, f), 'utf8');
for (const f of ['modules/storeBuild.js', 'bg/aiComplete.js']) assert.ok(src(f).includes('/*@store-build*/ false'), f + ' carries the mark the iOS build turns on');
assert.ok(fs.readFileSync(path.join(process.env.AISH_SRC, '..', 'scripts', 'build.js'), 'utf8').includes('useStoreBuild(dir)'));

// Apple allows 112 characters for the extension description: every language that is longer has a shorter one for iOS
const short = JSON.parse(src('../scripts/ios-descriptions.json'));
for (const locale of fs.readdirSync(path.join(process.env.AISH_SRC, '_locales'))) {
    const file = path.join('_locales', locale, 'messages.json');
    if (!fs.existsSync(path.join(process.env.AISH_SRC, file))) continue;
    const said = short[locale] || JSON.parse(src(file)).extensionDescription?.message || '';
    assert.ok(said.length <= 112, `${locale}: ${said.length}`);
}
const { renderSupportPass } = await imp('modules/supportPass.js');
const card = () => d.getElementById('supportPassGroup');
const free = { id: 'abcdefghij12345', email: 'a@example.org', subscription_status: 'free' };
renderSupportPass(d, free);
assert.ok(!card().hidden && card().textContent.includes('€4.99'), 'elsewhere the pass is offered');
globalThis.__aishStoreBuild = true;
renderSupportPass(d, free);
assert.ok(card().hidden && !card().textContent.trim() && !card().querySelector('button, a'), 'no price, no checkout, no key link');
renderSupportPass(d, { ...free, subscription_status: 'active' });
assert.ok(!card().hidden && !/€|Stripe|receipt/i.test(card().textContent), 'a running pass is shown, without a word about paying');
const { settingsEntries } = await imp('modules/settingsIndex.js');
assert.ok(!settingsEntries().some((e) => e.target === 'licenseKey'), 'no key field in the settings search');
const about = await imp('modules/aboutView.js');
about.initAboutView(); await tick(20);
assert.ok(!d.querySelector('.about-donate'), 'no donation button');
globalThis.__aishStoreBuild = false;
about.initAboutView(); await tick(20);
assert.ok(d.querySelector('.about-donate'));

const auth = await imp('modules/authManager.js');
const jwt = (exp) => 'h.' + Buffer.from(JSON.stringify({ exp })).toString('base64url') + '.s';
const live = jwt(Math.floor(Date.now() / 1000) + 30 * 86400);
const signIn = (token = live) => Object.assign(store, { 'account:token': token, 'account:user': { ...free, subscription_status: 'active' }, 'account:licenseKey': 'KEY' });
const calls = []; const asked = [];
const answer = (ok, body) => async (url, init) => { calls.push({ url, init }); return { ok, status: ok ? 200 : 502, json: async () => body }; };
const renew = async () => {};
signIn();
assert.equal(await auth.deleteAccount({ confirm: async (o) => { asked.push(o); return false; }, request: answer(true, { success: true }), renew }), false);
assert.ok(calls.length === 0 && asked[0].text.includes('Cancel a running subscription first'), 'asked first, and warned about a running subscription');
assert.equal(await auth.deleteAccount({ confirm: async () => true, request: answer(false, { success: false, error: 'kept' }), renew }), false);
assert.ok(store['account:token'] === live && store['account:licenseKey'] === 'KEY', 'a refusal keeps everything');
signIn(jwt(1000));
assert.equal(await auth.deleteAccount({ confirm: async () => true, request: answer(true, { success: true }), renew }), false);
assert.equal(calls.length, 1, 'an expired sign-in is not sent');
signIn();
assert.equal(await auth.deleteAccount({ confirm: async () => true, request: answer(true, { success: true }), renew }), true);
const sent = calls.at(-1);
assert.ok(sent.url.endsWith('/v1/auth/delete-account') && sent.init.headers.Authorization === 'Bearer ' + live && JSON.parse(sent.init.body).confirmation === 'DELETE');
assert.ok(!store['account:token'] && !store['account:user'] && !store['account:licenseKey'], 'forgotten here');
assert.ok(d.getElementById('deleteAccountBtn'), 'the button is in the account section');
console.log('store build and account deletion ok');
