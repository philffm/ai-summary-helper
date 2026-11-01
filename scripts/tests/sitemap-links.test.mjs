import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { findMissingLocalLinks } from '../lib/sitemap-links.mjs';

test('accepts existing localized pages, clean directory URLs, and the separately published demo', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sitemap-links-'));
    const docs = path.join(root, 'docs');
    const demo = path.join(root, 'demo');
    fs.mkdirSync(path.join(docs, 'fr', 'blog'), { recursive: true });
    fs.mkdirSync(demo);
    fs.writeFileSync(path.join(docs, 'fr', 'guide.html'), '');
    fs.writeFileSync(path.join(docs, 'fr', 'blog', 'index.html'), '');
    fs.writeFileSync(path.join(demo, 'index.html'), '');

    try {
        const links = '<a href="guide.html?from=nav">Guide</a>' +
            '<a href="blog/">Blog</a><a href="../../demo/">Demo</a>' +
            '<a href="#section">Section</a>';
        assert.deepEqual(findMissingLocalLinks(links, 'https://example.test/fr/', {
            siteBase: 'https://example.test/',
            docsDir: docs,
            publishedRoots: [{ urlPrefix: '/demo/', directory: demo }],
        }), []);
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test('reports broken relative and same-site links, including outdated localized slugs', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sitemap-links-'));
    const docs = path.join(root, 'docs');
    fs.mkdirSync(path.join(docs, 'fr'), { recursive: true });

    try {
        const links = '<a href="ancien-slug.html">Old route</a>' +
            '<a href="/fr/missing.html">Missing route</a>' +
            '<a href="https://elsewhere.test/page">External</a>';
        assert.deepEqual(findMissingLocalLinks(links, 'https://example.test/fr/', {
            siteBase: 'https://example.test/',
            docsDir: docs,
        }), ['ancien-slug.html', '/fr/missing.html']);
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});
