// Delete buttons: every key in the storage registry is owned by a delete category, and each action removes exactly what its text says.
import assert from 'assert';
import { SK } from '../src/modules/storageKeys.js';
import { CATEGORY_IDS, META_KEYS, uncoveredKeys, deleteData, describeData } from '../src/modules/dataReset.js';

assert.deepEqual(uncoveredKeys(), [], 'every SK key belongs to a delete category (add new keys to dataReset.js)');

const area = (st) => ({
    get: (k, cb) => { const o = {}; (k == null ? Object.keys(st) : [].concat(k)).forEach((x) => { if (x in st) o[x] = st[x]; }); cb(o); },
    remove: (k, cb) => { [].concat(k).forEach((x) => delete st[x]); cb(); },
    clear: (cb) => { Object.keys(st).forEach((x) => delete st[x]); cb(); },
    set: (o, cb) => { Object.assign(st, o); cb(); },
});
const world = () => {
    const local = {
        [SK.articlesIndex]: [{ id: 'a1' }, { id: 'a2' }], [SK.articlesSchema]: 2, 'articles:rec:a1': { content: 'x' }, 'articles:rec:a2': { content: 'y' }, 'article:old': { content: 'z' },
        [SK.annotations]: [{ id: 'h1' }, { id: 'h2' }, { id: 'h3' }],
        [SK.feedSubs]: [{ id: 's1' }], [SK.feedItems]: [{ id: 'i1' }, { id: 'i2' }], [SK.feedRecaps]: { r: 1 }, [SK.feedMood]: { d: 1 }, [SK.feedAudioPos]: { a: 1 }, [SK.feedBgSeen]: { b: [] }, [SK.feedPending]: 3,
        [SK.feedSettings]: { recapLimit: 40 }, [SK.feedUi]: { scope: 'day' },
        [SK.podcasts]: [{ id: 'p1' }], [SK.podcastName]: 'My show', [SK.podcastLength]: 5,
        [SK.servicesConfig]: { openai: { apiKey: 'sk-secret' }, ollama: { endpoint: 'http://localhost:11434' } }, [SK.token]: 'tok', [SK.user]: { email: 'a@b.c' }, [SK.licenseKey]: 'LIC-1', [SK.otpEmail]: 'a@b.c',
        [SK.devices]: [{ id: 'k1', addresses: ['me@kindle.com'] }], [SK.activeDevices]: { kindle: 'k1' }, [SK.localSendIp]: '192.168.1.5',
        [SK.summaryLength]: 250, [SK.summaryMode]: 'extension', [SK.workspace]: { x: 1 },
        [SK.migrationVersion]: 2, [SK.keysSchema]: 1, [SK.installId]: 'inst', [SK.installedAt]: 123,
        pb_token: 'legacy-token', 'unrelated:key': 'from another feature',
    };
    const sync = { selectedLanguage: 'de', prompt: 'my prompt', connectionMode: 'local', servicesConfig: { openai: { apiKey: 'sk-old-sync' } }, licenseKey: 'LIC-OLD' };
    const ls = { cleared: false, clear() { this.cleared = true; } };
    const calls = [];
    return { local, sync, ls, env: { local: area(local), sync: area(sync), session: { clear: (cb) => { calls.push('session'); cb(); } }, alarms: { clearAll: (cb) => { calls.push('alarms'); cb(); } }, action: { setBadgeText: async () => { calls.push('badge'); } }, ls }, calls };
};
const has = (o, ...keys) => keys.every((k) => k in o);
const none = (o, ...keys) => keys.every((k) => !(k in o));

// describe: counts for the dialog
{ const w = world(); const d = await describeData({ local: w.env.local, sync: w.env.sync });
  assert.deepEqual([d.articles, d.highlights, d.feeds, d.feedItems, d.podcasts, d.send], [2, 3, 1, 2, 1, 1]); assert(d.keys >= 2 && d.prefs > 0); }

// "Delete settings": preferences, keys, account, send targets — NOT summaries, highlights, feeds
{ const w = world(); await deleteData(['prefs', 'keys', 'send'], w.env);
  assert(none(w.local, SK.servicesConfig, SK.token, SK.user, SK.licenseKey, SK.otpEmail, 'pb_token', SK.devices, SK.activeDevices, SK.localSendIp, SK.summaryLength, SK.summaryMode, SK.workspace, SK.feedSettings, SK.feedUi, SK.podcastName, SK.podcastLength), 'keys, account, send targets and ui state are gone: ' + Object.keys(w.local));
  assert.deepEqual(Object.keys(w.sync), [], 'sync cleared (preferences, old copies of keys)');
  assert(has(w.local, SK.articlesIndex, 'articles:rec:a1', SK.annotations, SK.feedSubs, SK.feedItems, SK.feedRecaps, SK.podcasts, 'unrelated:key'), 'summaries, highlights, feeds, podcasts stay');
  assert(w.ls.cleared, 'popup localStorage cleared'); assert(!w.calls.length, 'no alarm / badge reset for a partial delete'); }

// "Delete history": summaries + records + highlights — NOT settings, keys, feeds
{ const w = world(); await deleteData(['articles', 'highlights'], w.env);
  assert(none(w.local, SK.articlesIndex, SK.articlesSchema, 'articles:rec:a1', 'articles:rec:a2', 'article:old', SK.annotations));
  assert(has(w.local, SK.servicesConfig, SK.token, SK.feedSubs, SK.feedItems, SK.devices, SK.summaryLength, SK.podcasts, SK.migrationVersion, 'unrelated:key'));
  assert(has(w.sync, 'selectedLanguage', 'prompt'), 'preferences stay'); assert(!w.ls.cleared); }

// feeds only: all RSS data, but not the feed preferences (those are preferences)
{ const w = world(); await deleteData(['feeds'], w.env);
  assert(none(w.local, SK.feedSubs, SK.feedItems, SK.feedRecaps, SK.feedMood, SK.feedAudioPos, SK.feedBgSeen, SK.feedPending));
  assert(has(w.local, SK.feedSettings, SK.feedUi, SK.articlesIndex, SK.servicesConfig)); }

// keys only: old copies in sync storage go too, preferences stay
{ const w = world(); await deleteData(['keys'], w.env);
  assert(none(w.local, SK.servicesConfig, SK.token, SK.licenseKey, 'pb_token')); assert(none(w.sync, 'servicesConfig', 'licenseKey'));
  assert(has(w.sync, 'selectedLanguage', 'prompt')); }

// "Delete all data": everything, both areas, session state, alarms, badge, localStorage
{ const w = world(); const r = await deleteData(CATEGORY_IDS, w.env);
  assert(r.everything); assert.deepEqual(Object.keys(w.local), [], 'local empty incl. unrelated + meta keys: ' + Object.keys(w.local));
  assert.deepEqual(Object.keys(w.sync), []); assert(w.ls.cleared); assert.deepEqual(w.calls.sort(), ['alarms', 'badge', 'session']); }

// nothing chosen → nothing happens
{ const w = world(); const before = JSON.stringify(w.local); const r = await deleteData([], w.env); assert.equal(r.removed, 0); assert.equal(JSON.stringify(w.local), before); }
assert(META_KEYS.includes(SK.migrationVersion)); assert(!META_KEYS.includes(SK.installId));
console.log('TEST 104 OK'); process.exit(0);
