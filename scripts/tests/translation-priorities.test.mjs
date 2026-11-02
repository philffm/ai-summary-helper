import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..', '..');
const config = JSON.parse(await readFile(path.join(root, 'docs/i18n/locales.json'), 'utf8'));

test('translation priorities cover every configured locale exactly once', () => {
    const groups = config.translationPriorities;
    const assigned = Object.values(groups).flat();

    assert.deepEqual(new Set(assigned).size, assigned.length);
    assert.deepEqual(new Set(assigned), new Set(Object.keys(config.locales)));
    assert.deepEqual(groups['1'], ['de']);
});

test('SEO landing pages are included in staged translation coverage', () => {
    for (const page of [
        'knowledge-graph/index.html',
        'local-ai/index.html',
        'mcp/index.html',
        'obsidian-integration/index.html',
        'pdf-summarizer/index.html',
        'research-papers/index.html',
        'youtube-summarizer/index.html'
    ]) {
        assert.ok(config.content.includes(page), `${page} should be translated through the regular pipeline`);
        assert.ok(!config.exempt.includes(page), `${page} should not remain exempt after rollout`);
        assert.ok(config.stagedTranslationPages.includes(page), `${page} should be marked as staged during rollout`);
    }
});
