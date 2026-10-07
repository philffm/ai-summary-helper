// Storage key registry: migration, backup renaming, background copy, and "no unregistered keys".
import fs from 'fs'; import path from 'path'; import assert from 'assert';
import { execFileSync } from 'child_process';
import { setup, imp, tick } from './harness.mjs';
const { store } = setup({});
const K = await imp('modules/storageKeys.js');
const { SK, SK_LEGACY, migrateStorageKeys, renameKey, renameKeys } = K;

// 1) migration moves everything, keeps data, removes dead/legacy names, is idempotent
Object.assign(store, {
  articlesIndex: [{ id: 'a1' }], 'article:a1': { content: 'c' }, 'article:a2': { content: 'd' }, articlesSchemaVersion: 2,
  annotations: [{ id: 'h' }], feedSubs: [1], feedMoodDaily: { d: 1 }, pb_token: 't', pending_otp_id: 'o', devices: [{ id: 'k' }],
  activeDeviceIds: { kindle: 'k' }, lastPodcastName: 'P', ws_layout: { layout: 'x' }, servicesConfig: { openai: { apiKey: 'k' } },
  ghostHighlights: [], articleHistory: [], prompt: 'sync pref stays', articles: [{ id: 'legacy' }]
});
const n = await migrateStorageKeys(chrome.storage.local);
assert(n >= 12, 'moved ' + n);
assert.deepEqual(store[SK.articlesIndex], [{ id: 'a1' }]);
assert.equal(store['articles:rec:a1'].content, 'c'); assert.equal(store['articles:rec:a2'].content, 'd');
assert.equal(store[SK.token], 't'); assert.deepEqual(store[SK.feedMood], { d: 1 }); assert.equal(store[SK.podcastName], 'P');
assert.deepEqual(store[SK.workspace], { layout: 'x' }); assert.equal(store[SK.servicesConfig].openai.apiKey, 'k');
for (const old of [...Object.keys(SK_LEGACY).filter(k => SK_LEGACY[k] !== k), 'article:a1', 'article:a2', 'ghostHighlights', 'articleHistory']) assert(!(old in store), 'old key left: ' + old);
assert.equal(store.prompt, 'sync pref stays'); assert(Array.isArray(store.articles), 'legacy blob left for the articles migration');
assert.equal(store[SK.keysSchema], 1);
// idempotent + fast path (flag set) → nothing moves even if an old key reappears
store.pb_token = 'late'; assert.equal(await migrateStorageKeys(chrome.storage.local), 0); assert.equal(store[SK.token], 't');
// new value wins when both exist (flag cleared to force a run)
delete store[SK.keysSchema]; store.pb_token = 'old'; await migrateStorageKeys(chrome.storage.local); assert.equal(store[SK.token], 't'); assert(!('pb_token' in store));

// 2) backup import mapping (v2 backups use old names)
assert.equal(renameKey('feedItems'), 'feeds:items'); assert.equal(renameKey('article:x'), 'articles:rec:x'); assert.equal(renameKey('articles:index'), 'articles:index'); assert.equal(renameKey('prompt'), 'prompt');
assert.deepEqual(renameKeys({ feedSubs: 1, 'article:z': 2, prompt: 3 }), { 'feeds:subs': 1, 'articles:rec:z': 2, prompt: 3 });
assert.deepEqual(renameKeys({ pb_token: 'old', 'account:token': 'new' }), { 'account:token': 'new' });

// 3) background.js carries an identical copy of the registry
execFileSync(process.execPath, [path.join(process.env.AISH_SRC, '../scripts/sync-storage-keys.mjs'), '--check']);

// 4) no unregistered keys: every SK.<name> exists, no registry key is used as a bare literal in storage calls,
//    and the old literals never appear in storage calls again
const walk = d => fs.readdirSync(d, { withFileTypes: true }).flatMap(e => e.isDirectory() ? (['lib', '_locales'].includes(e.name) ? [] : walk(path.join(d, e.name))) : e.name.endsWith('.js') ? [path.join(d, e.name)] : []);
const oldNames = Object.keys(SK_LEGACY).filter(k => SK_LEGACY[k] !== k && !['installId', 'installedAt', 'licenseKey', 'devices', 'podcasts', 'annotations'].includes(k) || ['annotations', 'devices', 'podcasts'].includes(k));
const bad = [];
for (const f of walk(process.env.AISH_SRC)) {
  if (f.endsWith('storageKeys.js')) continue;
  const lines = fs.readFileSync(f, 'utf8').split('\n');
  lines.forEach((ln, i) => {
    for (const m of ln.matchAll(/\bSK\.([A-Za-z]+)\b/g)) if (!(m[1] in SK)) bad.push(`${path.basename(f)}:${i + 1} unknown SK.${m[1]}`);
    if (/storage\??\.(local|session)\.(get|set|remove)\(|getLocal\(|setLocal\(/.test(ln) && !f.endsWith('background.js')) {
      for (const o of oldNames) if (new RegExp(`['"\`]${o}['"\`]|[{,]\\s*${o}\\s*[:},]`).test(ln)) bad.push(`${path.basename(f)}:${i + 1} old key '${o}' in storage call`);
      if (/['"`]article:/.test(ln) || /\barticles?:\$\{/.test(ln)) bad.push(`${path.basename(f)}:${i + 1} literal article record key (use articleRecKey)`);
    }
  });
}
assert.deepEqual(bad, [], 'unregistered / legacy storage keys:\n' + bad.join('\n'));
console.log('TEST 41 OK');
