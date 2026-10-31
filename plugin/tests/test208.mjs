// The shared sync vector (read by the Android tests) still agrees with the extension's code.
import assert from 'assert';
import fs from 'fs'; import path from 'path'; import { fileURLToPath, pathToFileURL } from 'url';
const here = path.dirname(fileURLToPath(import.meta.url));
const imp = (m) => import(pathToFileURL(path.resolve(process.env.AISH_SRC, m)).href);
const { build } = await import(pathToFileURL(path.join(here, 'gen-sync-vector.mjs')).href);
const C = await imp('modules/syncCrypto.js');
const committed = JSON.parse(fs.readFileSync(path.join(here, 'fixtures/sync-vector.json'), 'utf8'));
const fresh = JSON.parse(JSON.stringify(await build()));
// gzip output can differ between zlib builds, so the encrypted bytes are not compared: they are decrypted instead
const strip = (v) => { const c = JSON.parse(JSON.stringify(v)); delete c.crypto.recordFile; delete c.crypto.meta.check; return c; };
assert.deepEqual(strip(committed), strip(fresh), 'sync-vector.json is out of date: run node plugin/tests/gen-sync-vector.mjs and copy it to mobile/android/app/src/test/resources/');
const { crypto } = committed;
const opened = await C.openMeta(crypto.meta, { passphrase: crypto.passphrase });
assert.equal(C.toHex(opened.master), crypto.masterHex, 'the committed meta.json opens with the passphrase');
assert.deepEqual(await C.decryptJson(opened.keys, C.fromB64(crypto.recordFile)), crypto.record, 'the committed record file decrypts to the record');
assert.equal(fs.readFileSync(path.join(here, 'fixtures/sync-vector.json'), 'utf8'), fs.readFileSync(path.join(here, '../../mobile/android/app/src/test/resources/sync-vector.json'), 'utf8'), 'the Android copy is identical');
console.log('TEST 208 OK'); process.exit(0);
