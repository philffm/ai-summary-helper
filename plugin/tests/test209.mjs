// Passphrases for encrypted places: random word suggestions, one canonical spelling, a cautious strength check.
import assert from 'assert';
import path from 'path'; import { pathToFileURL } from 'url';
import crypto from 'crypto';
const imp = (m) => import(pathToFileURL(path.resolve(process.env.AISH_SRC, m)).href);
const P = await imp('modules/syncPassphrase.js'), { WORDS } = await imp('modules/syncWordlist.js');
assert.equal(WORDS.length, 2048); assert.equal(new Set(WORDS).size, 2048); assert.equal(new Set(WORDS.map((w) => w.slice(0, 4))).size, 2048, 'the first four letters identify a word');
assert.equal(crypto.createHash('sha256').update(WORDS.join('\n') + '\n').digest('hex'), '2f5eed53a4727b4bf8880d8f3f199efc90e58503646d9ff8eff3a2ed3b24dbda', 'the official BIP-39 English list');
// suggestions: six words from the list, different every time, uniformly spread
const seen = new Set(); const counts = new Uint32Array(2048);
for (let i = 0; i < 4000; i++) { const s = P.suggest(); const w = s.split(' '); assert.equal(w.length, 6); w.forEach((x) => { assert.ok(WORDS.includes(x)); counts[WORDS.indexOf(x)]++; }); seen.add(s); }
assert.equal(seen.size, 4000, 'no repeats'); assert.ok(Math.max(...counts) < 30 && Math.min(...counts) >= 0, 'no word is favoured: ' + Math.max(...counts));
assert.equal(P.suggest(3).split(' ').length, 3);
// the random source is used as given (a fixed one makes a fixed phrase)
assert.equal(P.suggest(2, (a) => { a[0] = 0; a[1] = 2047 + 2048; }), 'abandon zoo');
// one spelling
assert.equal(P.canonicalPassphrase('  Abandon-ability, ABLE about above  absent '), 'abandon ability able about above absent');
assert.equal(P.canonicalPassphrase('abandon ability able'), 'abandon ability able', 'three words are not treated as a suggestion');
assert.equal(P.canonicalPassphrase('My Own Phrase 123!'), 'My Own Phrase 123!'); assert.equal(P.canonicalPassphrase('  spaces kept  '), '  spaces kept  ');
assert.equal(P.canonicalPassphrase('abandon ability able about above absentt'), 'abandon ability able about above absentt', 'one wrong word and it is just text');
// checks
assert.match(P.passphraseProblem('short'), /at least 12/); assert.match(P.passphraseProblem('aaaaaaaaaaaaaa'), /too easy/); assert.match(P.passphraseProblem('password1234'), /too easy/);
assert.equal(P.passphraseProblem('a long passphrase'), ''); assert.equal(P.passphraseProblem(P.suggest()), ''); assert.equal(P.passphraseProblem('abandon ability able about above'), '', 'five list words are accepted');
assert.equal(P.strengthOf(P.suggest()), 'strong'); assert.equal(P.strengthOf('a long passphrase'), 'fine'); assert.equal(P.strengthOf('short'), 'weak'); assert.equal(P.strengthOf('Tr0ub4dor&3 horse is long!'), 'strong'); assert.equal(P.strengthOf('abandon ability able about above'), 'fine');
// the join screen has one field for the words or the recovery key: the key is told apart by its shape, words never are mistaken for it
{ const C = await import(pathToFileURL(path.resolve(process.env.AISH_SRC, 'modules/syncCrypto.js')).href);
  const key = C.recoveryKeyOf(new Uint8Array(32).fill(7));
  assert.equal(P.looksLikeRecoveryKey(key), true, 'a recovery key as shown'); assert.equal(P.looksLikeRecoveryKey(key.toLowerCase()), true, 'in any capitalisation');
  assert.equal(P.looksLikeRecoveryKey(key.replace(/-/g, ' ')), true, 'with spaces instead of dashes'); assert.equal(P.looksLikeRecoveryKey(' ' + key + ' \n'), true, 'pasted with spaces around it');
  assert.equal(P.looksLikeRecoveryKey(key.replace(/-/g, '')), true, 'without separators');
  assert.equal(P.looksLikeRecoveryKey(P.suggest()), false, 'six random words'); assert.equal(P.looksLikeRecoveryKey('orbit-lemon-tunnel-paper-river-cloud-sunny-green'), false, 'any number of words');
  assert.equal(P.looksLikeRecoveryKey('my own long passphrase 2026'), false); assert.equal(P.looksLikeRecoveryKey(''), false); assert.equal(P.looksLikeRecoveryKey('AAAA-BBBB'), false, 'a short one is not a key'); }
console.log('TEST 209 OK'); process.exit(0);
