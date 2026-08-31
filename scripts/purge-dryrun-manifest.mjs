#!/usr/bin/env node
// scripts/purge-dryrun-manifest.mjs
//
// One-off repair: remove translations that were accidentally persisted by a
// --dry-run run. Dry-runs had a bug where the mock `[fr] text` placeholders
// were written into docs/i18n/manifest.json as if they were real translations.
//
// This removes every per-locale translation entry that is either:
//   - marked model === 'dry-run', or
//   - whose text literally starts with a `[<locale-code>] ` placeholder.
//
// Real translations and the English source (`en`) are left untouched. After
// running this, the next real `translate.mjs` run will see those strings as
// missing again and actually translate them.
//
// Usage: node scripts/purge-dryrun-manifest.mjs

import { readFile, writeFile } from 'node:fs/promises';

const MANIFEST_PATH = new URL('../docs/i18n/manifest.json', import.meta.url);

const manifest = JSON.parse(await readFile(MANIFEST_PATH, 'utf8'));
manifest.strings = manifest.strings || {};

let removed = 0;
let removedFromEntries = 0;

for (const key of Object.keys(manifest.strings)) {
    const entry = manifest.strings[key];
    const translations = entry.translations || {};
    const kept = {};

    for (const locale of Object.keys(translations)) {
        const t = translations[locale];
        const isDryRun = t?.model === 'dry-run';
        const isPlaceholder = /^\[[a-z-]{2,}\]\s/.test(t?.text || '');
        if (isDryRun || isPlaceholder) {
            removed++;
        } else {
            kept[locale] = t;
        }
    }

    if (Object.keys(kept).length === 0 && Object.keys(translations).length > 0) {
        // All translations for this string were placeholder garbage — drop them
        // entirely (keep the `en` source for reference).
        entry.translations = {};
        removedFromEntries++;
    } else if (Object.keys(kept).length !== Object.keys(translations).length) {
        entry.translations = kept;
        removedFromEntries++;
    }
}

await writeFile(MANIFEST_PATH, JSON.stringify(manifest, null, 2) + '\n', 'utf8');
console.log(`Purged ${removed} polluted translation(s) across ${removedFromEntries} string entrie(s).`);