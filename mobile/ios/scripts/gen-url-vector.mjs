#!/usr/bin/env node
// Writes Tests/Fixtures/url-vector.json: what a real URL implementation (Node's, the same standard as the browsers') answers,
// for the stand-in of the iOS app (js/host.js) to agree with. Also the page keys highlights are filed under.
//     node mobile/ios/scripts/gen-url-vector.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
const { pageKeyForUrl } = await import(path.resolve(here, '../../../plugin/src/modules/pageKey.js'));

const inputs = [
    'https://example.org', 'https://example.org/', 'HTTPS://Example.ORG:443/A/b?c=D#E', 'http://example.org:80/x', 'http://192.168.1.20:8080/dav/',
    'https://cloud.example.com/remote.php/dav/files/phil/', 'https://example.org/a b/ü?q=ö x&y=%20#frag ment', 'https://example.org/%41%2f?x=%zz',
    'https://example.org/a/./b/../c/.%2e/d', 'https://example.org/a/..', 'https://example.org/a/.', 'https://example.org//double//slash/',
    'https://user:pa ss@example.org/x', 'https://s3.test:9000/bucket/aish%20sync/r/abc?list-type=2&delimiter=%2F&prefix=a%2Fb%2F',
    "https://example.org/'quote'?q='x'&r=\"y\"", 'https://example.org/p[1]|2^3{4}`5', 'https://bücher.example/straße', 'https://[::1]:8443/x',
    'https:\\\\example.org\\back\\slash', '  https://example.org/trim  ', 'https://example.org?only=query', 'https://example.org#only',
    'https://www.youtube.com/watch?v=abc123&t=42s', 'https://www.linkedin.com/jobs/view/?currentJobId=99&utm=x', 'https://news.ycombinator.com/item?id=1&p=2',
    'https://example.org/article?utm_source=x&id=7&fbclid=y', 'https://archive.ph/2024/https://example.org/x', 'https://web.archive.org/web/20240101000000/https://example.org/y?v=1',
    'mailto:someone@example.org', 'file:///etc/hosts', 'about:blank', 'not a url', '', '/relative/only', 'https://', 'https://exa mple.org/', 'https://example.org:99999/',
    'https://example.org/emoji/😀?😀=1', 'https://example.org/a+b?c+d=e+f',
];
const relative = [
    ['x', 'https://example.org/a/b'], ['./y?z', 'https://example.org/a/b/'], ['../../q', 'https://example.org/a/b/c'], ['/root', 'https://example.org/a/b?c#d'],
    ['?only', 'https://example.org/a/b?c'], ['#h', 'https://example.org/a/b?c'], ['//other.test/p', 'https://example.org/a'], ['https://abs.test/z', 'https://example.org/'],
    ['', 'https://example.org/a?b'], ['aish-sync/r/', 'https://cloud.example.com/remote.php/dav/files/phil/'],
];
const one = (input, base) => {
    try {
        const u = base === undefined ? new URL(input) : new URL(input, base);
        return { input, ...(base === undefined ? {} : { base }), href: u.href, protocol: u.protocol, host: u.host, hostname: u.hostname, origin: u.origin, pathname: u.pathname, search: u.search, query: [...u.searchParams.entries()] };
    } catch (_) { return { input, ...(base === undefined ? {} : { base }), invalid: true }; }
};
const out = { urls: [...inputs.map((i) => one(i)), ...relative.map(([i, b]) => one(i, b))], pageKeys: inputs.map((input) => ({ input, key: pageKeyForUrl(input) })) };
const file = path.resolve(here, '../Tests/Fixtures/url-vector.json');
fs.mkdirSync(path.dirname(file), { recursive: true });
fs.writeFileSync(file, JSON.stringify(out, null, 2) + '\n');
console.log(`wrote ${file}: ${out.urls.length} addresses, ${out.pageKeys.length} page keys`);
