// Summary language list: Traditional Chinese present, model gets English names.
import assert from 'assert';
import { setup, imp } from './harness.mjs';
setup({});
const L = await imp('modules/languages.js');
const codes = L.LANGUAGES.map(l => l.code);
assert(codes.includes('tw') && codes.includes('cn'));
assert.equal(new Set(codes).size, codes.length, 'unique codes');
assert(/Traditional/.test(L.languageEnglishName('tw')) && /Simplified/.test(L.languageEnglishName('cn')));
assert.equal(L.languageEnglishName('jp'), 'Japanese');
assert.equal(L.languageEnglishName('en-US'), 'en-US', 'unknown stays as is');
for (const c of ['el','cs','hu','fi','no','he','ms','ta','te','mr','ca','hr']) assert(codes.includes(c), c);
assert(L.languageMatches('kr', 'korean') && L.languageMatches('kr', 'Hangul') && L.languageMatches('kr', '한국'), 'korean synonyms');
assert(L.languageMatches('tw', 'traditional') && L.languageMatches('tw', 'taiwan') && L.languageMatches('cn', 'chinese'), 'chinese synonyms');
assert(L.languageMatches('de', 'german') && L.languageMatches('de', 'Deutsch') && L.languageMatches('tr', 'turkce') && L.languageMatches('cs', 'cesky'));
assert(!L.languageMatches('kr', 'japanese') && L.languageMatches('jp', 'japan'));
console.log('TEST 50 OK');
