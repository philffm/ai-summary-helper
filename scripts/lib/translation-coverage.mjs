// scripts/lib/translation-coverage.mjs
//
// Which English pages must exist in every locale, and which of those are missing.
// docs/i18n/locales.json lists them under "content"; pages that are deliberately NOT machine-translated
// (hand-written native pages such as /education/) are listed under "exempt". Any other English page is a mistake
// in the config: translate.mjs picks it up automatically and check-translations.mjs reports it.
import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { localizedPath } from './localized-paths.mjs';

const SKIP_DIRS = new Set(['assets', 'demo', 'i18n']);

/** Every English page (path relative to docs/) that is not inside a locale folder. */
export function listEnglishPages(docsRoot, config) {
    const localeDirs = new Set(Object.values(config.locales).filter(Boolean).map(l => l.dir));
    const out = [];
    const walk = (dir, rel) => {
        for (const e of readdirSync(dir, { withFileTypes: true })) {
            const r = rel ? `${rel}/${e.name}` : e.name;
            if (e.isDirectory()) {
                if (!rel && (SKIP_DIRS.has(e.name) || localeDirs.has(e.name))) continue;
                walk(path.join(dir, e.name), r);
            } else if (e.name.endsWith('.html') && !/^[0-9a-f]{20,}\.html$/.test(e.name)) out.push(r);
        }
    };
    walk(docsRoot, '');
    return out.sort();
}

/** English pages that are neither translated (content) nor exempt. */
export function untrackedPages(docsRoot, config) {
    const known = new Set([...(config.content || []), ...(config.exempt || [])]);
    return listEnglishPages(docsRoot, config).filter(p => !known.has(p));
}

/** [{ locale, page, file }] for every content page whose localized output is missing. */
export function missingTranslations(docsRoot, config, pages = config.content || []) {
    const out = [];
    for (const [code, locale] of Object.entries(config.locales)) {
        if (!locale) continue;
        for (const page of pages) {
            if ((config.stagedTranslationPages || []).includes(page)
                && !(config.translationRolloutLocales || Object.keys(config.locales)).includes(code)) continue;
            const file = path.posix.join(locale.dir, localizedPath(page, code));
            if (!existsSync(path.join(docsRoot, file))) out.push({ locale: code, page, file });
        }
    }
    return out;
}
