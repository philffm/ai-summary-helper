// App Store build: no text goes to an AI service on the internet before the person allowed that host. The background
// refuses, the extension asks (naming who receives it), a model in the local network needs no yes, and it can be withdrawn.
import { setup, imp, tick } from './harness.mjs'; import assert from 'assert';
import fs from 'fs'; import path from 'path';
const { w, store, sent } = setup({});
const d = w.document; globalThis.document = d; globalThis.window = w;
const src = (f) => fs.readFileSync(path.join(process.env.AISH_SRC, f), 'utf8');
const consent = await imp('modules/aiConsent.js');

// one rule for "this is not a third party", in the page and in the background
const rule = (f, name) => src(f).match(new RegExp(name + ' = (/.*/i);'))[1];
assert.equal(rule('bg/aiComplete.js', 'AI_PRIVATE_HOST'), rule('modules/aiConsent.js', 'PRIVATE_HOST'));
for (const url of ['http://localhost:11434/api/chat', 'http://127.0.0.1:1234/v1', 'http://192.168.1.20:11434/', 'http://10.0.0.4/', 'http://172.20.1.1/', 'http://mac-mini.local:11434/', 'http://[::1]:8080/']) assert.equal(consent.outsideHost(url), '', url);
for (const url of ['https://api.byphil.eu/v1', 'https://api.openai.com/v1', 'https://172.32.0.1/', 'https://local.example.com/', 'https://192.168.example.com/']) assert.ok(consent.outsideHost(url), url);

// the background, as a worker would load it
const bg = new Function('chrome', 'SK', 'fetch', src('bg/aiComplete.js') + '\nreturn { aiFetch };');
const fetched = [];
const { aiFetch } = bg(chrome, { aiConsent: 'ai:consent' }, async (url) => { fetched.push(String(url)); return new Response('data: {}'); });
const post = (url) => aiFetch(url, { method: 'POST', body: '{"model":"m"}' });
await post('https://api.openai.com/v1/chat/completions');
assert.equal(fetched.length, 1, 'other builds are unchanged');
globalThis.__aishStoreBuild = true;
await assert.rejects(post('https://api.openai.com/v1/chat/completions'), (e) => e.code === 'ai-consent' && e.message.includes('api.openai.com'));
await post('http://192.168.1.20:11434/v1/chat/completions');
assert.deepEqual(fetched.slice(1), ['http://192.168.1.20:11434/v1/chat/completions'], 'nothing went out');
store['ai:consent'] = { 'api.openai.com': '2026-11-26' };
await post('https://api.openai.com/v1/chat/completions');
await assert.rejects(post('https://api.mistral.ai/v1/chat/completions'), /mistral/, 'every host needs its own yes');
delete store['ai:consent'];

// asking
const asked = [];
const say = (v) => ({ confirm: async (o) => { asked.push(o); await tick(5); return v; } });
assert.equal(await consent.ensureAiConsent({}, say(false)), false);
assert.ok(asked[0].text.includes('OpenRouter') && !store['ai:consent'], 'the default connection names who receives the text; a no stores nothing');
const both = await Promise.all([consent.ensureAiConsent({}, say(true)), consent.ensureAiConsent({}, say(true))]);
assert.deepEqual(both, [true, true]);
assert.equal(asked.length, 2, 'parallel requests share one question');
assert.ok(store['ai:consent']['api.byphil.eu']);
assert.equal(await consent.ensureAiConsent({}, say(false)), true, 'asked once');
Object.assign(store, { connectionMode: 'local', activeService: 'ollama', 'ai:servicesConfig': {} });
const { SK } = await imp('modules/storageKeys.js');
store[SK.servicesConfig] = { ollama: { endpointUrl: 'http://192.168.1.20:11434/api/chat' } };
assert.equal(await consent.ensureAiConsent({}, say(false)), true);
assert.equal(asked.length, 2, 'your own machine is not asked about');
Object.assign(store, { activeService: 'gemini' });
assert.equal(await consent.ensureAiConsent({}, say(false)), false);
assert.ok(asked[2].text.includes('generativelanguage.googleapis.com'));

// settings: what is allowed, and the way back
await consent.renderAiConsent(d);
const box = d.getElementById('aiConsentGroup');
assert.ok(!box.hidden && box.querySelectorAll('button').length === 2, 'the current service and the allowed one');
[...box.querySelectorAll('button')].find((b) => b.textContent === 'Withdraw').click(); await tick(30);
assert.deepEqual(store['ai:consent'], {});

// the host the extension asks about is the host the background checks, for every service and a server of one's own
{
    const services = JSON.parse(src('services.json'));
    globalThis.fetch = async () => ({ ok: true, json: async () => services });
    chrome.runtime.getURL = (p) => 'chrome-extension://abc/' + p;
    const { aiComplete: send } = new Function('chrome', 'SK', 'fetch', 'localGet', src('bg/aiComplete.js') + '\nreturn { aiComplete };')(
        chrome, SK, async () => ({ ok: true, json: async () => services }), (keys) => chrome.storage.local.get(keys));
    const cases = [{ mode: 'cloud', id: 'openai', config: {} }, ...services.map((s) => ({ mode: 'local', id: s.id, config: {} })),
        { mode: 'local', id: 'custom', config: { endpointUrl: 'https://llm.example.org/v1/chat/completions' } }];
    let compared = 0;
    for (const c of cases) {
        Object.assign(store, { connectionMode: c.mode, activeService: c.id, 'ai:consent': {}, [SK.servicesConfig]: { [c.id]: { apiKey: 'k', model: 'm', ...c.config } } });
        const host = consent.outsideHost(await consent.aiAddress());
        if (!host) continue;
        await assert.rejects(send({ system: 's', user: 'u' }), (e) => e.message.includes(` ${host} `), `${c.mode}/${c.id}`);
        compared++;
    }
    assert.equal(compared, 8, 'cloud, the six hosted services and a server of one’s own');
    Object.assign(store, { 'ai:consent': {}, connectionMode: 'cloud' });
}

// the extension page asks before a request is handed to the background
store.connectionMode = 'cloud';
const { aiComplete } = await imp('modules/feedAi.js');
const refused = aiComplete('system', 'secret text').then(() => 'sent', (e) => e.code);
await tick(30);
const sheet = d.querySelector('.confirm-sheet');
assert.ok(sheet, 'a sheet asks');
sheet.querySelector('.button-secondary').click();
assert.equal(await refused, 'ai-consent');
assert.ok(!sent.some((m) => m && m.action === 'aiComplete'), 'nothing left the page');
assert.ok((await imp('modules/dataReset.js')).TRANSIENT_KEYS.includes(SK.aiConsent), 'a backup never carries a yes to another device');
console.log('ai consent ok'); process.exit(0);
