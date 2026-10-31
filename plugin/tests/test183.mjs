// Sync device id and stamp sidecars are per device: never exported, never restored, cleared with the library.
import assert from 'assert';
import { setup, imp } from './harness.mjs';
setup({});
const K = await imp('modules/storageKeys.js');
const R = await imp('modules/dataReset.js');
const B = await imp('modules/backupUtils.js');
const { SK, syncStampsKey, isSyncStampsKey, SYNC_STAMPS } = K;

assert.equal(syncStampsKey('0a'), 'sync:stamps:0a'); assert.ok(isSyncStampsKey('sync:stamps:ff')); assert.ok(!isSyncStampsKey('sync:deviceId'));
assert.equal(SK.syncDeviceId, 'sync:deviceId');

// export: neither the device id nor the stamps, even when secrets are included
const data = { [SK.syncDeviceId]: 'dev-1', [syncStampsKey('00')]: { a: 1 }, [SK.articlesIndex]: [{ id: 'a' }], [SK.token]: 't' };
for (const withSecrets of [false, true]) {
    const out = B.filterBackupSecrets(data, withSecrets);
    assert.ok(!(SK.syncDeviceId in out) && !(syncStampsKey('00') in out), 'not exported (secrets=' + withSecrets + ')');
    assert.deepEqual(out[SK.articlesIndex], [{ id: 'a' }]);
}
// import: a file that carries them (old or hand-made) does not overwrite this device's
const imported = B.prepareImportedData({ ...data }, {});
assert.ok(!(SK.syncDeviceId in imported) && !(syncStampsKey('00') in imported));
assert.deepEqual(imported[SK.articlesIndex], [{ id: 'a' }]);

// reset: the stamps go with the library, the device id only with "everything"
assert.ok(R.CATEGORIES.articles.prefixes.includes(SYNC_STAMPS), 'resetting the library clears its stamps');
assert.ok(R.TRANSIENT_KEYS.includes(SK.syncDeviceId) && R.TRANSIENT_PREFIXES.includes(SYNC_STAMPS));
assert.ok(R.META_KEYS.includes(SK.syncDeviceId), 'a partial reset keeps the device id');

console.log('TEST 183 OK');
process.exit(0);
