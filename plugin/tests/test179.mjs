// Archive links (archive.ph, Wayback, 12ft…): saving stores the original article URL, duplicates and highlight keys match the original.
import assert from 'assert';
import { unwrapArchiveUrl, isArchiveHost } from '../src/modules/archiveUrl.js';
import { normalizeUrl } from '../src/modules/textUtils.js';
import { pageKeyForUrl } from '../src/modules/pageKey.js';

const NYT = 'https://www.nytimes.com/2026/10/20/technology/ai.html';
const cases = [
    [`https://archive.ph/2026.10.20-101500/${NYT}`, NYT],
    [`https://archive.today/newest/${NYT}`, NYT],
    [`https://archive.is/o/AbCd1/${NYT}`, NYT],
    [`https://web.archive.org/web/20261020101500/${NYT}`, NYT],
    ['https://web.archive.org/web/20261020101500id_/https:/example.com/post?x=1', 'https://example.com/post?x=1'],
    [`https://12ft.io/${NYT}`, NYT],
    ['https://archive.ph/submit/?url=https%3A%2F%2Fexample.com%2Fa%3Fb%3D1', 'https://example.com/a?b=1'],
    // no embedded URL / not an archive host → unchanged
    ['https://archive.ph/AbCd1', 'https://archive.ph/AbCd1'],
    ['https://example.com/redirect?to=https://other.com/x', 'https://example.com/redirect?to=https://other.com/x'],
    ['https://www.google.com/url?q=https://other.com/x', 'https://www.google.com/url?q=https://other.com/x'],
    ['not a url', 'not a url'],
    ['', ''],
];
for (const [input, want] of cases) assert.strictEqual(unwrapArchiveUrl(input), want, input);

assert.ok(isArchiveHost('archive.ph') && isArchiveHost('web.archive.org') && !isArchiveHost('notarchive.ph') && !isArchiveHost('example.com'));
// an archive inside an archive is not unwrapped into another archive
assert.strictEqual(unwrapArchiveUrl('https://archive.ph/x/https://web.archive.org/web/1/https://a.com/'), 'https://archive.ph/x/https://web.archive.org/web/1/https://a.com/');

// duplicates and highlight keys: the archive copy is the original article
assert.strictEqual(normalizeUrl(`https://archive.ph/2026.10.20-101500/${NYT}`), normalizeUrl(NYT));
assert.strictEqual(pageKeyForUrl(`https://web.archive.org/web/20261020101500/${NYT}#top`), pageKeyForUrl(NYT));

console.log('test179 ok');
