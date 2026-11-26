// Sync device id and stamp sidecars are per device: never exported, never restored, cleared with the library.
// Sync servers and places are part of a backup; a restore adds them paused next to this device's own.
import assert from 'assert';
import { setup, imp } from './harness.mjs';
setup({});
const K = await imp('modules/storageKeys.js');
const R = await imp('modules/dataReset.js');
const B = await imp('modules/backupUtils.js');
const { SK, syncStampsKey, isSyncStampsKey, SYNC_STAMPS, syncLedgerKey, isSyncLedgerKey, SYNC_LEDGER } = K;

assert.equal(syncStampsKey('0a'), 'sync:stamps:0a'); assert.ok(isSyncStampsKey('sync:stamps:ff')); assert.ok(!isSyncStampsKey('sync:deviceId'));
assert.equal(SK.syncDeviceId, 'sync:deviceId');

// export: neither the device id nor the stamps, even when secrets are included
const data = { [SK.syncDeviceId]: 'dev-1', [syncStampsKey('00')]: { a: 1 }, [syncLedgerKey('p1')]: { a1: { rev: 1 } }, [SK.syncPlaces]: [{ id: 'p1' }], [SK.syncStatus]: { p1: {} }, [SK.articlesIndex]: [{ id: 'a' }], [SK.token]: 't' };
for (const withSecrets of [false, true]) {
    const out = B.filterBackupSecrets(data, withSecrets);
    assert.ok(!(SK.syncDeviceId in out) && !(syncStampsKey('00') in out) && !(syncLedgerKey('p1') in out) && !(SK.syncStatus in out), 'not exported (secrets=' + withSecrets + ')');
    assert.deepEqual(out[SK.articlesIndex], [{ id: 'a' }]);
    assert.deepEqual(out[SK.syncPlaces], [{ id: 'p1' }], 'the places are exported');
}
// import: a file that carries them (old or hand-made) does not overwrite this device's
const imported = B.prepareImportedData({ ...data }, {});
assert.ok(!(SK.syncDeviceId in imported) && !(syncStampsKey('00') in imported) && !(syncLedgerKey('p1') in imported) && !(SK.syncStatus in imported));
assert.deepEqual(imported[SK.syncPlaces], [], 'a place without a usable server is dropped');
assert.deepEqual(imported[SK.articlesIndex], [{ id: 'a' }]);

// reset: the stamps go with the library, the device id only with "everything"
assert.ok(R.CATEGORIES.articles.prefixes.includes(SYNC_STAMPS), 'resetting the library clears its stamps');
assert.ok(R.TRANSIENT_KEYS.includes(SK.syncDeviceId) && R.TRANSIENT_PREFIXES.includes(SYNC_STAMPS) && R.TRANSIENT_PREFIXES.includes(SYNC_LEDGER));
assert.ok(isSyncLedgerKey('sync:ledger:p1'));
// the places' passwords are secrets: left out of a backup unless the user includes secrets
assert.ok(R.SECRET_KEYS.includes(SK.syncSecrets));
assert.ok(!(SK.syncSecrets in B.filterBackupSecrets({ [SK.syncSecrets]: { p1: { password: 'x' } } }, false)));
assert.ok(R.META_KEYS.includes(SK.syncDeviceId), 'a partial reset keeps the device id');

// restore: servers and places arrive next to this device's own, paused; nothing here is replaced
const server = (id, url) => ({ id, name: id, service: 'webdav', url, username: 'u' });
const place = (id, connectionId, more = {}) => ({ id, name: id, connectionId, root: 'r', mode: 'encrypted', direction: 'twoway', enabled: true, created: '2026-01-01T00:00:00.000Z', ...more });
const here = {
    [SK.syncConnections]: [server('cn_here', 'https://here.example/dav/')],
    [SK.syncPlaces]: [place('pl_here', 'cn_here')],
    [SK.syncSecrets]: { cn_here: { password: 'current' } },
};
const file = {
    [SK.syncConnections]: [server('cn_here', 'https://other.example/dav/'), server('cn_new', 'https://new.example/dav/'), server('cn_bad', 'ftp://nope.example/'), { id: 'cn_dir', service: 'folder', name: 'Folder' }, null],
    [SK.syncPlaces]: [
        place('pl_here', 'cn_here', { name: 'from the file' }), place('pl_new', 'cn_new'), place('pl_dir', 'cn_dir'),
        place('pl_bad', 'cn_bad'), place('pl_orphan', 'cn_gone'), { id: 'pl_odd', connectionId: 'cn_new', mode: 'readable', direction: 'publish' },
    ],
    [SK.syncSecrets]: { cn_here: { password: 'old' }, cn_new: { password: 'n' }, 'k:pl_new': { master: 'bQ==' } },
};
const restored = B.prepareImportedData(file, here);
assert.deepEqual(restored[SK.syncConnections].map((c) => c.id), ['cn_here', 'cn_new', 'cn_dir']);
assert.equal(restored[SK.syncConnections][0].url, 'https://here.example/dav/', 'this device keeps its own server, so its login is not sent elsewhere');
assert.deepEqual(restored[SK.syncPlaces].map((p) => p.id), ['pl_here', 'pl_new', 'pl_dir']);
assert.equal(restored[SK.syncPlaces][0].name, 'pl_here');
assert.deepEqual(restored[SK.syncPlaces].map((p) => p.enabled), [true, false, false], 'restored places are paused');
assert.deepEqual(restored[SK.syncSecrets], { cn_here: { password: 'current' }, cn_new: { password: 'n' }, 'k:pl_new': { master: 'bQ==' } });
// without secrets in the file, this device's logins are not touched
assert.ok(!(SK.syncSecrets in B.prepareImportedData({ [SK.syncPlaces]: [] }, here)));
// a file without any sync data changes nothing about sync
const plain = B.prepareImportedData({ [SK.articlesIndex]: [] }, here);
assert.ok(!(SK.syncPlaces in plain) && !(SK.syncConnections in plain));
// a settings-only backup takes the sync keys from local storage too
assert.deepEqual(B.SETTINGS_LOCAL_KEYS, [SK.syncConnections, SK.syncPlaces, SK.syncSecrets]);

console.log('TEST 183 OK');
process.exit(0);
