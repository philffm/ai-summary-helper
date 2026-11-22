// Syncthing as a place: the folder store finds the conflict copies Syncthing leaves; the connection keeps its flavor.
import assert from 'assert'; import fs from 'fs'; import path from 'path'; import { pathToFileURL } from 'url';
import { setup, imp } from './harness.mjs';
import { createFakeFolder } from './fakeFolder.mjs';
setup({});
const F = await import(pathToFileURL(path.resolve(process.env.AISH_SRC, 'modules/syncFolder.js')).href);
const S = await imp('modules/syncService.js');
const fake = createFakeFolder();
const store = F.createFolderStore({ handle: fake.handle, root: 'aish-sync' });
await store.put('library/index.json', '{}');
await store.put('library/index.sync-conflict-20260101-120000-ABCDEFG.json', '{}');
await store.put('notes.sync-conflict-20260102-083000-ZZZZZZZ.json', '{}');
await store.put('library/index.json.crswap', 'x');
const found = (await store.conflicts()).sort();
assert.deepEqual(found, ['library/index.sync-conflict-20260101-120000-ABCDEFG.json', 'notes.sync-conflict-20260102-083000-ZZZZZZZ.json'], 'only the Syncthing conflict copies, found in subfolders too');
assert.equal((await store.conflicts(1)).length, 1, 'capped');
assert.deepEqual(await F.createFolderStore({ handle: createFakeFolder().handle, root: 'none' }).conflicts(), [], 'an empty or missing folder has none');
assert(F.SYNC_CONFLICT.test('a.sync-conflict-20260101-120000-ABC.txt') && !F.SYNC_CONFLICT.test('sync-conflict.txt'));

assert.equal(S.cleanConnection({ service: 'folder', name: 'Docs', flavor: 'syncthing' }).flavor, 'syncthing', 'the flavor stays on the folder connection');
assert.ok(!('flavor' in S.cleanConnection({ service: 'folder', name: 'Docs', flavor: 'x' })), 'an unknown flavor is dropped');
assert.ok(!('flavor' in S.cleanConnection({ service: 's3', name: 'b', url: 'https://s3.test', username: 'a', bucket: 'my-bucket', region: 'eu-1', flavor: 'syncthing' })), 'only folders have one');
const view = fs.readFileSync(path.resolve(process.env.AISH_SRC, 'modules/syncView.js'), 'utf8');
assert(/chooseFolder\('syncthing'\)/.test(view) && /Check for conflicting copies/.test(view) && /\*\.crswap/.test(view), 'Syncthing is its own row, with the .stignore tip and the conflict check');
console.log('TEST 279 OK'); process.exit(0);
