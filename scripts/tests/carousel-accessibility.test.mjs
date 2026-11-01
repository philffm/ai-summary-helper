import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import * as cheerio from 'cheerio';

const ROOT = path.resolve(import.meta.dirname, '../..');

function htmlFiles(directory) {
    return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
        const file = path.join(directory, entry.name);
        if (entry.isDirectory()) return htmlFiles(file);
        return entry.isFile() && entry.name.endsWith('.html') ? [file] : [];
    });
}

test('carousel slides retain their native list-item role', () => {
    const files = ['docs', 'site-src/pages'].flatMap(directory => htmlFiles(path.join(ROOT, directory)));

    for (const file of files) {
        const $ = cheerio.load(fs.readFileSync(file, 'utf8'));
        assert.equal($('.cx-track > li[role="group"]').length, 0, `${path.relative(ROOT, file)} overrides a carousel list item role`);
    }
});
