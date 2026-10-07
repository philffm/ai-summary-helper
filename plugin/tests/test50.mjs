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
console.log('TEST 50 OK');
