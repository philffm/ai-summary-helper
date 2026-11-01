#!/usr/bin/env node
// Fails when the locale folders are not structurally on the same level as the English site:
//   - an English page that is neither in locales.json "content" nor "exempt"
//   - a content page that has no translated file in some locale
// Run after scripts/translate.mjs (see .github/workflows/translate.yml).
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { untrackedPages, missingTranslations } from './lib/translation-coverage.mjs';

const ROOT = path.join(process.cwd(), 'docs');
const config = JSON.parse(await readFile(path.join(ROOT, 'i18n', 'locales.json'), 'utf8'));

const problems = [];
for (const p of untrackedPages(ROOT, config)) problems.push(`English page not in locales.json "content" or "exempt": ${p}`);
for (const m of missingTranslations(ROOT, config)) problems.push(`missing [${m.locale}] ${m.file} (for ${m.page})`);

if (problems.length) {
    console.error(`Translation structure differs from the English site:\n- ${problems.join('\n- ')}`);
    process.exit(1);
}
console.log('All translations are structurally in sync with the English site.');
