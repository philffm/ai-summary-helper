// Folder store: the same interface as WebDAV on a (fake) directory handle, conditions, listing, permission.
import assert from 'assert';
import path from 'path'; import { pathToFileURL } from 'url';
import { createFakeFolder } from './fakeFolder.mjs';
const { createFolderStore, folderSupported } = await import(pathToFileURL(path.resolve(process.env.AISH_SRC, 'modules/syncFolder.js')).href);
const fake = createFakeFolder();
const st = createFolderStore({ handle: fake.handle, root: 'aish/sync' });
assert.equal(folderSupported(), false, 'no picker in Node');
assert.equal(await st.ping(), true); assert.ok(fake.dirs.has('aish') && fake.dirs.has('aish/sync'), 'the root folders are made');
const a = await st.put('r/a1', new Uint8Array([1, 2, 3])); assert.ok(a.etag);
assert.deepEqual([...(await st.get('r/a1')).bytes], [1, 2, 3]); assert.equal((await st.get('r/a1')).etag, a.etag);
assert.equal(await st.get('r/nope'), null); assert.equal(await st.get('missing/dir/file'), null);
await assert.rejects(() => st.put('r/a1', 'x', { ifNoneMatch: '*' }), (e) => e.status === 412);
await assert.rejects(() => st.put('r/a1', 'x', { ifMatch: 'stale' }), (e) => e.status === 412);
await assert.rejects(() => st.put('r/new', 'x', { ifMatch: 'anything' }), (e) => e.status === 412, 'If-Match on a missing file fails');
const b = await st.put('r/a1', 'two', { ifMatch: a.etag }); assert.notEqual(b.etag, a.etag);
await st.put('meta.json', '{}', { ifNoneMatch: '*' });
assert.deepEqual((await st.list('r')).map((f) => f.path), ['r/a1']); assert.deepEqual((await st.list('')).map((f) => f.path), ['meta.json'], 'folders are not files');
assert.deepEqual(await st.list('none'), []);
assert.equal(await st.remove('r/a1'), true); assert.equal(await st.remove('r/a1'), false);
await assert.rejects(() => createFolderStore({ handle: createFakeFolder({ permission: 'prompt' }).handle }).ping(), (e) => e.kind === 'auth' && /Allow access/.test(e.message));
await assert.rejects(() => createFolderStore({}).ping(), /No folder/);
// a refusal from the browser (protected folder, no permission in this context) is explained, not passed on raw
const refusing = { queryPermission: async () => 'granted', getDirectoryHandle: async () => { throw Object.assign(new Error('The request is not allowed by the user agent or the platform in the current context.'), { name: 'SecurityError' }); } };
await assert.rejects(() => createFolderStore({ handle: refusing, root: 'x' }).ping(), (e) => e.kind === 'auth' && /new folder of your own/.test(e.message) && !/user agent/.test(e.message));
console.log('TEST 201 OK'); process.exit(0);
