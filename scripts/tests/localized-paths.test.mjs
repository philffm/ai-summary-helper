import assert from 'node:assert/strict';
import test from 'node:test';
import * as cheerio from 'cheerio';
import { rewriteNativeSiblingLinks } from '../lib/localized-paths.mjs';

test('rewrites German native education and MCP article links', () => {
    const $ = cheerio.load(
        '<a href="../../education/">Bildung</a>' +
        '<a href="../../blog/ai-apps-mcp.html?ref=blog#setup">MCP</a>'
    );

    rewriteNativeSiblingLinks($, 'de/blog/index.html', 'de');

    assert.equal($('a').eq(0).attr('href'), '../bildung/');
    assert.equal($('a').eq(1).attr('href'), 'ki-apps-mcp.html?ref=blog#setup');
});
