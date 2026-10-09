// Worker feed parser handles RSS/Atom, CDATA, relative links, duplicate IDs, and bounded request plans.
import assert from 'assert';
import { setup, imp, tick } from './harness.mjs';
import { SK } from '../src/modules/storageKeys.js';
import { CATEGORY_IDS, CATEGORIES, SECRET_KEYS } from '../src/modules/dataReset.js';
import { filterBackupSecrets, hasBackupSecrets, prepareImportedData } from '../src/modules/backupUtils.js';
const [{ parseWorkerFeed, feedItemId, mergeWorkerItems, boundedLibraryPlan }, { hash }] = await Promise.all([
    imp('modules/feedWorker.js'), imp('modules/feedHash.js')
]);
const sub = { id: 'source-1' };
const now = Date.UTC(2026, 9, 9);
const rss = `<rss><channel><item>
  <guid>stable-guid</guid><title><![CDATA[Feed <b>headline</b>]]></title>
  <link>/story?a=1&amp;b=2</link><pubDate>Fri, 09 Oct 2026 10:00:00 GMT</pubDate>
  <description><![CDATA[<p>CDATA <b>snippet</b></p>]]></description>
  <enclosure url="../audio/episode.mp3" type="audio/mpeg"/><duration>1:02</duration>
</item></channel></rss>`;
const parsed = parseWorkerFeed(rss, 'https://example.test/rss/feed.xml', sub, now);
assert.equal(parsed.length, 1);
assert.equal(parsed[0].id, hash('source-1|stable-guid'));
assert.equal(parsed[0].id, feedItemId(sub, parsed[0]), 'worker id matches feed manager hash formula');
assert.equal(parsed[0].title, 'Feed headline');
assert.equal(parsed[0].snippet, 'CDATA snippet');
assert.equal(parsed[0].link, 'https://example.test/story?a=1&b=2');
assert.equal(parsed[0].audio, 'https://example.test/audio/episode.mp3');
assert.equal(parsed[0].dur, 62);
assert.equal(parseWorkerFeed(rss, 'https://example.test/rss/feed.xml', sub, now)[0].id, parsed[0].id, 'repeated feeds deduplicate by stable id');
const duplicateFeed = rss.replace('</channel>', rss.match(/<item>[\s\S]*?<\/item>/)[0] + '</channel>');
assert.equal(parseWorkerFeed(duplicateFeed, 'https://example.test/rss/feed.xml', sub, now).length, 1, 'duplicate entries collapse by id');

const atom = `<feed xmlns="http://www.w3.org/2005/Atom"><entry>
  <id>tag:example.test,2026:2</id><title><![CDATA[Atom &amp; news]]></title>
  <link rel="alternate" href="../story/2"/><updated>2026-10-09T09:30:00Z</updated>
  <summary><![CDATA[<p>Atom <em>summary</em></p>]]></summary>
  <link rel="enclosure" href="../audio/2.ogg" type="audio/ogg"/>
</entry></feed>`;
const atomItem = parseWorkerFeed(atom, 'https://example.test/feeds/current.xml', sub, now)[0];
assert.equal(atomItem.title, 'Atom & news');
assert.equal(atomItem.link, 'https://example.test/story/2');
assert.equal(atomItem.audio, 'https://example.test/audio/2.ogg');
assert.equal(atomItem.published, Date.parse('2026-10-09T09:30:00Z'));
const namespacedAtom = atom.replaceAll('<feed ', '<atom:feed ').replaceAll('</feed>', '</atom:feed>')
    .replaceAll('<entry>', '<atom:entry>').replaceAll('</entry>', '</atom:entry>');
assert.equal(parseWorkerFeed(namespacedAtom, 'https://example.test/feeds/current.xml', sub, now).length, 1);

const relativeDate = parseWorkerFeed('<rss><item><title>New</title><link>https://example.test/new</link><pubDate>yesterday</pubDate></item></rss>', 'https://example.test/feed', sub, now)[0];
assert.equal(relativeDate.published, now, 'unparseable/relative dates fall back to fetch time');
const retained = mergeWorkerItems([], [
    { id: 'expired', published: now - 3 * 86400000 },
    { id: 'favorite', published: now - 3 * 86400000, favorite: true },
    { id: 'current', published: now }
], 1, now, 1);
assert.deepEqual(retained.map(item => item.id).sort(), ['current', 'favorite'], 'retention and total cap preserve favorites');

const plan = boundedLibraryPlan({ rate: Array.from({ length: 100 }, (_, id) => ({ id })), days: [] }, 10, 3);
assert.equal(plan.rate.length, 30);
assert.ok(Math.ceil(plan.rate.length / 10) <= 3, 'bounded plan has at most three AI requests');
const withRecaps = boundedLibraryPlan({ rate: [], days: Array.from({ length: 4 }, (_, day) => ({ day, todo: Array.from({ length: 25 }, (_, id) => ({ id })) })) }, 10, 3);
assert.ok(withRecaps.days.reduce((n, day) => n + Math.ceil(day.todo.length / 10), 0) <= 3);
const feedAi = await imp('modules/feedAi.js');
let transportService = '';
feedAi.setAiTransport(async request => {
    transportService = request.service;
    return '{"scores":[0.5],"labels":["Tech"]}';
});
const scored = await feedAi.scoreItems([{ title: 'Local story', snippet: '' }], () => 'Source', { service: 'ollama' });
assert.deepEqual(scored, { scores: [0.5], labels: ['Tech'] });
assert.equal(transportService, 'ollama', 'worker can route shared feed AI logic directly without messaging itself');
feedAi.setAiTransport(null);
// Backup exports omit secrets by default, opt-in backups are marked, and imports preserve or confirm secrets.

assert.deepEqual(CATEGORIES.keys.keys, SECRET_KEYS, 'backup and delete use the same secret-key registry');
assert(SECRET_KEYS.includes(SK.installId) && CATEGORY_IDS.includes('keys'));

const secrets = {
    [SK.servicesConfig]: { openai: { apiKey: 'sentinel-api', endpoint: 'https://api.example', model: 'gpt-test' } },
    [SK.token]: 'sentinel-token',
    [SK.user]: { email: 'sentinel@example.test' },
    [SK.otpId]: 'sentinel-otp',
    [SK.installId]: 'sentinel-install',
    [SK.licenseKey]: 'sentinel-license',
    pb_token: 'sentinel-legacy-token',
    servicesConfig: { old: { apiKey: 'sentinel-old-api', endpoint: 'http://localhost' } },
    licenseKey: 'sentinel-old-license',
    selectedLanguage: 'de'
};
const safe = filterBackupSecrets(secrets, false);
const safeJson = JSON.stringify(safe);
for (const sentinel of ['sentinel-api', 'sentinel-token', 'sentinel@example.test', 'sentinel-otp', 'sentinel-install', 'sentinel-license', 'sentinel-old-api', 'sentinel-old-license']) {
    assert(!safeJson.includes(sentinel), `default export excludes ${sentinel}`);
}
assert.equal(safe[SK.servicesConfig].openai.endpoint, 'https://api.example');
assert.equal(safe[SK.servicesConfig].openai.model, 'gpt-test');
assert.equal(safe.selectedLanguage, 'de');
assert.equal(filterBackupSecrets(secrets, true)[SK.servicesConfig].openai.apiKey, 'sentinel-api');

assert(hasBackupSecrets({ settings: { [SK.token]: 'legacy-v3-token' } }), 'detects secrets in a v2/v3 backup');
assert(hasBackupSecrets({ _contains_secrets: true }), 'detects the marker');
assert(!hasBackupSecrets({ local: safe[SK.servicesConfig] }), 'a sanitized provider setup is not a secret');
const prepared = prepareImportedData({ [SK.servicesConfig]: safe[SK.servicesConfig] }, {
    [SK.servicesConfig]: { openai: { apiKey: 'current-api' }, gemini: { apiKey: 'current-gemini' } }
});
assert.equal(prepared[SK.servicesConfig].openai.apiKey, 'current-api', 'secret-free restore keeps current API key');
assert.equal(prepared[SK.servicesConfig].gemini.apiKey, 'current-gemini', 'providers omitted by backup keep current keys');
assert.equal(prepareImportedData({ [SK.servicesConfig]: { openai: { apiKey: 'backup-api' } } }, {})[SK.servicesConfig].openai.apiKey, 'backup-api');

const { store, w } = setup({});
const syncStore = {};
const syncArea = {
    get: (keys, cb) => {
        const out = {};
        (keys == null ? Object.keys(syncStore) : [].concat(keys)).forEach((key) => { if (key in syncStore) out[key] = syncStore[key]; });
        cb(out);
    },
    set: (data, cb) => { Object.assign(syncStore, data); cb?.(); },
    remove: (keys, cb) => { [].concat(keys).forEach((key) => delete syncStore[key]); cb?.(); }
};
chrome.storage.sync = syncArea;
globalThis.window = w;
globalThis.document = w.document;
globalThis.FileReader = w.FileReader;
globalThis.URL = w.URL;
const manager = await imp('modules/settingsManager.js');
let exportedText, exportConfirms = 0, importConfirms = 0, reloads = 0;
globalThis.Blob = class { constructor(parts) { this.parts = parts; } };
w.URL.createObjectURL = (blob) => { exportedText = blob.parts[0]; return 'blob:backup'; };
w.URL.revokeObjectURL = () => {};
w.HTMLAnchorElement.prototype.click = function () {};
w.confirm = () => { exportConfirms++; return true; };
w.alert = () => {};
globalThis.alert = () => {};
chrome.runtime.reload = () => { reloads++; };
Object.assign(store, {
    [SK.servicesConfig]: { openai: { apiKey: 'sentinel-api', endpoint: 'https://api.example' } },
    [SK.token]: 'sentinel-token',
    [SK.licenseKey]: 'sentinel-license',
    [SK.installId]: 'sentinel-install'
});
manager.initBackupRestore();
await tick();
w.document.getElementById('exportSettingsButton').click();
w.document.getElementById('exportFullBackup').click();
await tick();
const defaultBackup = JSON.parse(exportedText);
assert.equal(defaultBackup._contains_secrets, false);
assert(!JSON.stringify(defaultBackup).includes('sentinel-'));
assert.equal(defaultBackup.local[SK.servicesConfig].openai.endpoint, 'https://api.example');

w.document.getElementById('exportSettingsButton').click();
w.document.getElementById('includeBackupSecrets').checked = true;
w.document.getElementById('exportFullBackup').click();
await tick();
const secretBackup = JSON.parse(exportedText);
assert.equal(secretBackup._contains_secrets, true);
assert.equal(secretBackup.local[SK.servicesConfig].openai.apiKey, 'sentinel-api');
assert.equal(exportConfirms, 1, 'opt-in export warns before creating a file');

store[SK.servicesConfig].openai.apiKey = 'current-api';
importConfirms = 0;
w.confirm = () => { importConfirms++; return true; };
const importFile = async (data) => {
    const input = w.document.getElementById('importSettingsFile');
    Object.defineProperty(input, 'files', { configurable: true, value: [new w.File([JSON.stringify(data)], 'backup.json', { type: 'application/json' })] });
    input.dispatchEvent(new w.Event('change'));
    await tick(50);
};
await importFile(defaultBackup);
assert.equal(importConfirms, 0, 'secret-free import does not prompt');
assert.equal(store[SK.servicesConfig].openai.apiKey, 'current-api', 'secret-free import does not replace current key');
assert.equal(store[SK.token], 'sentinel-token', 'secret-free import does not erase current sign-in');
await importFile(secretBackup);
assert.equal(importConfirms, 1, 'secret-containing import asks for confirmation');
assert.equal(store[SK.servicesConfig].openai.apiKey, 'sentinel-api', 'confirmed import restores API key');
assert.equal(reloads, 2);
console.log('TEST 106 OK');
