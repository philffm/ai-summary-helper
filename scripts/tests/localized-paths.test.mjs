import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import * as cheerio from 'cheerio';
import { buildLocalizedPageInventory, localizedPath, rewriteAvailablePageLinks, rewriteLocalizedLinks } from '../lib/localized-paths.mjs';

test('rewrites links to pages present in the locale inventory', () => {
    const docs = fs.mkdtempSync(path.join(os.tmpdir(), 'localized-pages-'));
    const write = (file, englishUrl) => {
        const absolute = path.join(docs, file);
        fs.mkdirSync(path.dirname(absolute), { recursive: true });
        fs.writeFileSync(absolute, `<link rel="alternate" hreflang="en" href="https://ai-summary-helper.byphil.eu${englishUrl}">`);
    };

    try {
        write('de/blog/index.html', '/blog/');
        write('de/bildung/index.html', '/education/');
        write('de/blog/ki-apps-mcp.html', '/blog/ai-apps-mcp.html');
        const inventory = buildLocalizedPageInventory({
            locales: { de: { dir: 'de' } },
            content: ['blog/ai-apps-mcp.html'],
        }, docs);
        const $ = cheerio.load(
            '<a href="../../education/">Bildung</a>' +
            '<a href="../../blog/ai-apps-mcp.html?ref=blog#setup">MCP</a>' +
            '<a href="../../blog/not-translated.html">Untranslated</a>' +
            '<a href="../blog/">Blog</a>'
        );

        rewriteAvailablePageLinks($, 'de/blog/index.html', 'de', inventory, 'de');

        assert.equal($('a').eq(0).attr('href'), '../bildung/');
        assert.equal($('a').eq(1).attr('href'), 'ki-apps-mcp.html?ref=blog#setup');
        assert.equal($('a').eq(2).attr('href'), '../../blog/not-translated.html');
        assert.equal($('a').eq(3).attr('href'), './');
        assert.equal(localizedPath('blog/ai-apps-mcp.html', 'de'), 'blog/ki-apps-mcp.html');

        const demo = cheerio.load('<a href="../demo/index.html">Demo</a>');
        rewriteAvailablePageLinks(demo, 'de/pdf-summarizer/index.html', 'de', inventory, 'de');
        assert.equal(demo('a').attr('href'), '../../demo/index.html');

        const source = cheerio.load(
            '<a href="../education/">Bildung</a>' +
            '<a href="ai-apps-mcp.html">MCP</a>' +
            '<a href="not-translated.html">Untranslated</a>'
        );
        rewriteLocalizedLinks(source, 'blog/index.html', 'de', inventory);
        assert.equal(source('a').eq(0).attr('href'), '../bildung/');
        assert.equal(source('a').eq(1).attr('href'), 'ki-apps-mcp.html');
        assert.equal(source('a').eq(2).attr('href'), 'not-translated.html');
    } finally {
        fs.rmSync(docs, { recursive: true, force: true });
    }
});
