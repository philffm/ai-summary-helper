// Backup exports omit secrets by default, opt-in backups are marked, and imports preserve or confirm secrets.
import assert from 'assert';
import { setup, imp, tick } from './harness.mjs';
import { SK } from '../src/modules/storageKeys.js';
import { CATEGORY_IDS, CATEGORIES, SECRET_KEYS } from '../src/modules/dataReset.js';
import { filterBackupSecrets, hasBackupSecrets, prepareImportedData } from '../src/modules/backupUtils.js';

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
