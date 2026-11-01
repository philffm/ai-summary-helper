// The code a phone scans to join an encrypted place: format, escaping, what it leaves out, and the service method that makes it.
import assert from 'assert';
import path from 'path'; import { pathToFileURL } from 'url';
const imp = (m) => import(pathToFileURL(path.resolve(process.env.AISH_SRC, m)).href);
const { buildPhoneCode, parsePhoneCode } = await imp('modules/syncPhoneCode.js');

const dav = { service: 'webdav', url: 'https://cloud.example.com/remote.php/dav/files/phil/', username: 'phil', id: 'cn_1' };
const place = { id: 'pl_1', mode: 'encrypted', root: 'aish-sync', connectionId: 'cn_1' };
const words = 'orbit lemon tunnel paper river cloud';
const code = buildPhoneCode({ connection: dav, secret: { password: 'abc-DEF/12+&=?' }, place, words });
assert.match(code, /^aish-library:\/\/v1\?k=webdav&u=https%3A%2F%2Fcloud\.example\.com/);
assert.deepEqual(parsePhoneCode(code), { kind: 'webdav', url: dav.url, username: 'phil', password: 'abc-DEF/12+&=?', root: 'aish-sync', words }, 'every awkward character survives the round trip');
assert.ok(!/[?&]w=/.test(buildPhoneCode({ connection: dav, secret: { password: 'x' }, place })), 'an own passphrase is not in the code');
const s3 = { service: 's3', url: 'https://s3.eu-central-1.amazonaws.com', username: 'AKIATEST', bucket: 'my-bucket', region: 'eu-central-1', id: 'cn_2' };
assert.deepEqual(parsePhoneCode(buildPhoneCode({ connection: s3, secret: { password: 'sEcReT/key+1' }, place: { ...place, root: 'lib' }, words })),
    { kind: 's3', url: s3.url, username: 'AKIATEST', password: 'sEcReT/key+1', root: 'lib', region: 'eu-central-1', bucket: 'my-bucket', words });
assert.throws(() => buildPhoneCode({ connection: { service: 'folder' }, secret: {}, place }), /folder on this computer/);
assert.throws(() => buildPhoneCode({ connection: dav, secret: {}, place }), /login of this server is not saved/);
assert.throws(() => buildPhoneCode({ connection: dav, secret: { password: 'x' }, place: { ...place, mode: 'readable' } }), /Only an encrypted place/);
for (const bad of ['', 'https://example.com', 'aish-inbox://v1?i=1', 'aish-library://v1?k=ftp&u=x', 'aish-library://v1?k=webdav&u=%E0%A4%A']) assert.equal(parsePhoneCode(bad), null, 'not a library code: ' + bad);
console.log('TEST 213 OK');
