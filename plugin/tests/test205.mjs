// S3 store: the SigV4 signature against AWS's published example, then every store operation against an in-memory S3.
import assert from 'assert';
import path from 'path'; import { pathToFileURL } from 'url';
import { createFakeS3 } from './fakeS3.mjs';
const S = await import(pathToFileURL(path.resolve(process.env.AISH_SRC, 'modules/syncS3.js')).href);

// AWS's documented S3 example "GET Object with a Range header" (Signature Version 4 header-based auth)
const empty = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
const v = await S.signV4({ method: 'GET', url: 'https://examplebucket.s3.amazonaws.com/test.txt', headers: { host: 'examplebucket.s3.amazonaws.com', range: 'bytes=0-9', 'x-amz-content-sha256': empty, 'x-amz-date': '20130524T000000Z' }, payloadHash: empty, accessKeyId: 'AKIAIOSFODNN7EXAMPLE', secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY', region: 'us-east-1', amzDate: '20130524T000000Z' });
assert.match(v.stringToSign, /\n7344ae5b7ee6c3e7e6b0fe0640412a37625d1fbfff95c48bbb2dc43964946972$/, 'the canonical request hashes as published');
assert.equal(v.signature, 'f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41', 'the signature is the published one');

const s3 = createFakeS3();
const cfg = { endpoint: 'https://s3.test', region: 'eu-central-1', bucket: 'b', accessKeyId: 'AKIDTEST', secretAccessKey: 'secret', root: 'aish/sync' };
const st = S.createS3Store(cfg, { fetchFn: s3.fetchFn });
assert.equal(await st.ping(), true);
await assert.rejects(() => S.createS3Store({ ...cfg, bucket: 'nope' }, { fetchFn: s3.fetchFn }).ping(), (e) => e.status === 404 && /bucket was not found/.test(e.message));
await assert.rejects(() => S.createS3Store({ ...cfg, accessKeyId: 'WRONG' }, { fetchFn: s3.fetchFn }).ping(), (e) => e.kind === 'auth');
await assert.rejects(() => S.createS3Store({ ...cfg, endpoint: 'http://s3.test' }, { fetchFn: s3.fetchFn }).ping(), /HTTPS/);

const a = await st.put('r/a1', new Uint8Array([1, 2, 3])); assert.ok(a.etag); assert.ok(s3.files.has('aish/sync/r/a1'), 'keys sit under the place root');
assert.deepEqual([...(await st.get('r/a1')).bytes], [1, 2, 3]); assert.equal((await st.get('r/a1')).etag, a.etag);
assert.equal(await st.get('r/none'), null);
await assert.rejects(() => st.put('r/a1', 'x', { ifNoneMatch: '*' }), (e) => e.status === 412);
await assert.rejects(() => st.put('r/a1', 'x', { ifMatch: 'stale' }), (e) => e.status === 412);
await assert.rejects(() => st.put('r/new', 'x', { ifMatch: 'any' }), (e) => e.status === 412);
const b = await st.put('r/a1', 'two', { ifMatch: a.etag }); assert.notEqual(b.etag, a.etag);
// a provider that ignores the conditional headers is still protected by the HEAD check
const lax = createFakeS3({ enforceConditions: false }); const ls = S.createS3Store(cfg, { fetchFn: lax.fetchFn });
await ls.put('r/x', '1'); await assert.rejects(() => ls.put('r/x', '2', { ifNoneMatch: '*' }), (e) => e.status === 412); await assert.rejects(() => ls.put('r/x', '2', { ifMatch: 'old' }), (e) => e.status === 412);
// names with spaces, unicode and characters that need escaping
await st.put('r/ä ö+&.json', 'u'); assert.equal(new TextDecoder().decode((await st.get('r/ä ö+&.json')).bytes), 'u');
// list: only the files directly in the folder, across pages (3 per page here), without the folder itself
for (let i = 0; i < 7; i++) await st.put('r/f' + i, 'x'); await st.put('meta.json', '{}'); await st.put('deep/er/file', 'x');
const listed = await st.list('r'); assert.equal(listed.length, 9); assert.ok(listed.every((f) => f.path.startsWith('r/') && f.etag && f.size > 0)); assert.ok(listed.some((f) => f.path === 'r/ä ö+&.json'), 'special names come back as they were');
assert.deepEqual((await st.list('')).map((f) => f.path), ['meta.json'], 'folders are not files');
assert.deepEqual(await st.list('nothing'), []);
assert.equal(await st.remove('r/f0'), true); assert.equal(await st.remove('r/f0'), false, 'honest about a file that is not there');
console.log('TEST 205 OK'); process.exit(0);
