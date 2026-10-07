// Highlights: stable page key (content-identifying params), feed-like pages are skipped, user exclusions.
import assert from 'assert';
import { setup, imp } from './harness.mjs';
setup({});
const { pageKeyForUrl, isNoisePage } = await imp('modules/pageKey.js');
assert.equal(pageKeyForUrl('https://www.linkedin.com/jobs/search/?currentJobId=123&keywords=ux&trk=x#a'), 'https://www.linkedin.com/jobs/search/?currentJobId=123');
assert.equal(pageKeyForUrl('https://www.linkedin.com/jobs/search/?currentJobId=456'), 'https://www.linkedin.com/jobs/search/?currentJobId=456');
assert.notEqual(pageKeyForUrl('https://www.linkedin.com/jobs/search/?currentJobId=123'), pageKeyForUrl('https://www.linkedin.com/jobs/search/?currentJobId=456'), 'different jobs, different key');
assert.equal(pageKeyForUrl('https://blog.example.com/post?utm_source=x'), 'https://blog.example.com/post', 'tracking params dropped');
assert.equal(pageKeyForUrl('https://www.youtube.com/watch?v=abc&t=3'), 'https://www.youtube.com/watch?v=abc');
assert(isNoisePage('https://www.linkedin.com/feed/'), 'LinkedIn feed');
assert(isNoisePage('https://www.linkedin.com/jobs/search/?keywords=ux'), 'job search list');
assert(!isNoisePage('https://www.linkedin.com/jobs/search/?currentJobId=1'), 'a specific job is fine');
assert(!isNoisePage('https://www.linkedin.com/pulse/some-article/'), 'articles are fine');
assert(isNoisePage('https://x.com/home'));
assert(!isNoisePage('https://blog.example.com/post'));
assert(isNoisePage('https://sub.news.example.com/a', ['example.com']), 'user exclusion matches subdomains');
assert(!isNoisePage('https://notexample.com/a', ['example.com']), 'no partial host match');
console.log('TEST 58 OK'); process.exit(0);
