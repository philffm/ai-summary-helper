// Safari on iOS: the app gets the model connection that is active in the extension, with that one key only (bg/nativeLibrary.js).
import assert from 'assert';
import fs from 'fs'; import path from 'path'; import vm from 'vm';
const src = process.env.AISH_SRC;
const code = fs.readFileSync(path.join(src, 'bg/nativeLibrary.js'), 'utf8');
const services = JSON.parse(fs.readFileSync(path.join(src, 'services.json'), 'utf8'));
const self = {};
vm.runInNewContext(code, { self, URL, setTimeout: () => 0, clearTimeout: () => {}, console });
const { toModel, createSender } = self.AISH_NATIVE;
const plain = (v) => JSON.parse(JSON.stringify(v));

const local = {
    'account:token': 'tok-1', 'account:licenseKey': 'lic-1', 'account:installId': 'inst-1',
    'config:services': { openai: { apiKey: 'key-openai' }, mistral: { apiKey: 'key-mistral', activeModelId: 'mistral-small' }, gemini: { apiKey: 'key-gemini' },
        deepseek: {}, custom: { endpointUrl: 'https://box.example/v1/chat/completions', customModel: [{ id: 'm-1' }] } },
};
const own = (activeService) => plain(toModel({ connectionMode: 'local', activeService }, local, services));

const cloud = plain(toModel({ cloudRegionPref: 'prefer-eu' }, local, services, () => false));
assert.deepEqual([cloud.mode, cloud.key, cloud.installId, cloud.region], ['cloud', 'tok-1', 'inst-1', 'prefer-eu'], 'the hosted service is the default');
assert.equal(plain(toModel({}, local, services, () => true)).key, 'lic-1', 'an expired sign-in is not handed over');
for (const secret of ['key-openai', 'key-mistral', 'key-gemini']) assert.ok(!JSON.stringify(cloud).includes(secret));

const mistral = own('mistral');
assert.deepEqual([mistral.url, mistral.model, mistral.key, mistral.format], ['https://api.mistral.ai/v1/chat/completions', 'mistral-small', 'key-mistral', 'openai']);
for (const secret of ['key-openai', 'key-gemini', 'tok-1', 'lic-1', 'inst-1']) assert.ok(!JSON.stringify(mistral).includes(secret), 'only the key in use: ' + secret);
const gemini = own('gemini');
assert.ok(gemini.url.endsWith(':generateContent') && gemini.url.includes(gemini.model) && gemini.format === 'gemini' && !gemini.url.includes('key-gemini'));
const custom = own('custom');
assert.deepEqual([custom.url, custom.model, custom.key], ['https://box.example/v1/chat/completions', 'm-1', ''], 'the address as it is, no key needed');
assert.equal(own('deepseek'), null, 'a provider without a key is no connection');
assert.equal(own('ollama'), null, 'without a model');

// the sender: told once, again on change, and told when there is none; what is remembered holds no secret
const store = { 'native:sent': { folder: 'f', items: {} } };
const storage = { get: (keys, cb) => cb(Object.fromEntries(keys.filter((k) => k in store).map((k) => [k, structuredClone(store[k])]))), set: (v, cb) => { Object.assign(store, structuredClone(plain(v))); cb(); } };
const got = []; let current = mistral; let accept = true;
const run = createSender({ storage, send: async (m) => { if (m.type === 'hello') return { ok: true, folder: 'f' }; got.push(plain(m)); return { ok: accept }; }, connection: async () => current });
await run(); await run();
assert.equal(got.length, 1); assert.equal(got[0].connection.key, 'key-mistral');
assert.ok(!JSON.stringify(store).includes('key-mistral') && !('model' in (store['native:sent'] || {})), 'nothing of it is stored');
const restarted = createSender({ storage, send: async (m) => { if (m.type === 'hello') return { ok: true, folder: 'f' }; got.push(plain(m)); return { ok: true }; }, connection: async () => current });
await restarted();
assert.equal(got.length, 2, 'a restarted background tells the app again'); got.pop();
const told = []; await createSender({ storage, send: async (m) => { told.push(plain(m)); return { ok: true, folder: 'f' }; }, connection: async () => { throw new Error('no services'); } })();
assert.deepEqual(told.filter((m) => m.type.startsWith('model')), [{ type: 'model-error', error: 'no services' }], 'a failure is told, and nothing is forgotten');
accept = false; current = gemini; await run(); accept = true; await run();
assert.deepEqual(got.slice(1).map((m) => m.connection.service), ['gemini', 'gemini'], 'a refused hand-over is tried again');
current = null; await run();
assert.equal(got.at(-1).connection, null, 'signing out or removing the key is told');
console.log('ok');
