// Writes fixtures/sync-vector.json: what the Android app must reproduce to stay compatible with the extension's sync
// (value hashes, key derivation, file names, encrypted files, merge results).
//   node plugin/tests/gen-sync-vector.mjs            writes the file (then copy it to mobile/android/app/src/test/resources/)
// test208 checks that the committed vector still agrees with the code.
import fs from 'fs'; import path from 'path'; import { fileURLToPath, pathToFileURL } from 'url';
const SRC = process.env.AISH_SRC || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../src');
const imp = (m) => import(pathToFileURL(path.join(SRC, m)).href);
const S = await imp('modules/syncStamps.js'), C = await imp('modules/syncCrypto.js'), M = await imp('modules/syncMerge.js'), P = await imp('modules/syncPassphrase.js'), W = await imp('modules/syncWordlist.js');
import nodeCrypto from 'crypto';

export async function build() {
    const hashValues = [
        'plain', '', 'Grüße 🌍 日本語', 'quote " backslash \\ slash / tab \t newline \n bell \u0007 nul-ish \u0001', '  line sep   para sep', '\ud800 lone surrogate',
        0, 1, -7, 42, 1.5, 0.1, 9007199254740991, true, false, null,
        [], [1, 'a', [2, null], { x: 1 }], {}, { b: 2, a: 1 }, { a: { d: [1, 2], c: 'x' }, b: [] }, { 'key "with" quotes': 'v', 'é': 1 },
        { id: 'h_1', t: 1700000000000, nested: { list: [{ k: 'tag:ai' }, { k: 'tag:ml' }] } },
    ].map((v) => ({ value: v, hash: S.hashValue(v) }));

    const passphrase = 'correct horse battery staple', iterations = 1000;
    const salt = Uint8Array.from({ length: 16 }, (_, i) => i + 1), nonce = Uint8Array.from({ length: 12 }, (_, i) => 0xa0 + i);
    const master = await C.deriveMaster(passphrase, salt, iterations), keys = await C.subKeys(master);
    const checkFile = await C.encryptJson(keys, 'aish-sync-ok', nonce);
    const meta = { aish: 'sync/1', mode: 'encrypted', kdf: 'pbkdf2-sha256', iterations, salt: C.toB64(salt), check: C.toB64(checkFile) };
    const record = { aish: 'rec/1', key: 'article:a1', rev: { t: 1700000000500, d: 'd_phone' }, f: { title: { t: 1700000000500, h: S.hashValue('Grüße 🌍') }, 'tag:ai': { t: 1700000000100, h: S.hashValue('AI') } }, values: { title: 'Grüße 🌍', 'tag:ai': 'AI' } };
    const file = await C.encryptJson(keys, record, nonce);
    const names = [['article', 'a1'], ['hl', 'hl_x_1'], ['note', 'n_abc'], ['coll', 'c-9'], ['article', 'ünï-cödé']];
    const crypto = {
        passphrase, iterations, saltHex: C.toHex(salt), nonceHex: C.toHex(nonce), masterHex: C.toHex(master), meta,
        names: await Promise.all(names.map(async ([type, id]) => ({ type, id, name: await C.nameOf(keys, type, id) }))),
        record, recordFile: C.toB64(file),   // an encrypted record exactly as the extension writes it (gzip bytes may differ between zlib builds: decrypt it, do not compare bytes)
    };

    const h = (v) => ({ t: 0, h: S.hashValue(v) });
    const rec = (d, t, fields, deleted) => deleted ? { rev: { t, d }, f: {}, deleted: true }
        : { rev: { t, d }, f: Object.fromEntries(Object.entries(fields).map(([k, [tt, v]]) => [k, { t: tt, h: S.hashValue(v) }])), values: Object.fromEntries(Object.entries(fields).map(([k, [, v]]) => [k, v])) };
    void h;
    const cases = [
        ['newer field wins per field', rec('A', 30, { title: [10, 'Old'], favorite: [30, true], 'tag:x': [10, 'x'] }), rec('B', 40, { title: [40, 'New'], favorite: [5, false], 'tag:y': [40, 'y'] })],
        ['tie on time: the larger device id wins', rec('A', 50, { title: [50, 'from A'] }), rec('B', 50, { title: [50, 'from B'] })],
        ['same value keeps the earlier stamp', rec('A', 90, { title: [90, 'Same'] }), rec('B', 20, { title: [20, 'Same'] })],
        ['unknown here', null, rec('A', 30, { title: [30, 'x'] })],
        ['unknown there', rec('A', 30, { title: [30, 'x'] }), null],
        ['tombstone beats an older edit', rec('A', 30, { title: [30, 'x'] }), rec('B', 35, {}, true)],
        ['a newer edit beats the tombstone', rec('A', 60, { title: [60, 'again'] }), rec('B', 35, {}, true)],
        ['two tombstones: the later one', rec('A', 40, {}, true), rec('B', 50, {}, true)],
        ['two tombstones, same time: larger device id', rec('A', 50, {}, true), rec('B', 50, {}, true)],
        ['a removal stamp (no value) beats an older element', rec('A', 30, { 'tag:x': [10, 'x'], title: [30, 'T'] }), { rev: { t: 70, d: 'B' }, f: { 'tag:x': { t: 70, h: S.hashValue(undefined) } }, values: {} }],
        ['unicode and nested values', rec('A', 30, { note: [30, { text: 'Grüße 🌍', tags: ['a', 'b'] }] }), rec('B', 31, { note: [31, { tags: ['a', 'b'], text: 'Grüße 🌍!' }] })],
    ].map(([name, local, remote]) => { const r = M.mergeRecord(local, remote); return { name, local, remote, merged: r.merged, changedLocal: r.changedLocal, changedRemote: r.changedRemote }; });

    // the passphrase a device derives its key from: the same spelling on every platform
    const passphrase_inputs = ['  Abandon-ability, ABLE about above  absent ', 'abandon ability able about above absent', 'abandon ability able', 'My Own Phrase 123!', '  spaces kept  ', 'zoo-zoo-zoo-zoo', 'Zoo Zoo Zoo Zoo Zoo Zoo', 'abandon ability able about above absentt', 'ünïcode Pässwörd 🌍'];
    const passphrases = { wordlistSha256: nodeCrypto.createHash('sha256').update(W.WORDS.join('\n') + '\n').digest('hex'), words: W.WORDS.length, cases: passphrase_inputs.map((input) => ({ input, canonical: P.canonicalPassphrase(input) })) };
    return { aish: 'sync-vector/1', note: 'Generated by plugin/tests/gen-sync-vector.mjs from the extension code. The Android tests read a copy of this file.', hashValues, crypto, mergeCases: cases, passphrases };
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
    const out = path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'fixtures/sync-vector.json');
    fs.writeFileSync(out, JSON.stringify(await build(), null, 2) + '\n');
    console.log('wrote', out);
}
