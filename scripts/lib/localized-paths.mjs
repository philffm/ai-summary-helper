// scripts/lib/localized-paths.mjs
//
// One place that knows where a translated page lives. By default it is <locale folder>/<English path>; docs/i18n/slugs.json
// can give a page a localized path (e.g. blog/feeds-recap.html -> de/blog/ein-rueckblick-statt-40-feeds.html).
// The old English-named path stays as a redirect page (see redirectStub), so existing links and a submitted sitemap keep working.
import { readFileSync } from 'node:fs';
import path from 'node:path';

const SITE = 'https://ai-summary-helper.byphil.eu';
let MAP = {};
try { MAP = JSON.parse(readFileSync(path.join(process.cwd(), 'docs', 'i18n', 'slugs.json'), 'utf8')); } catch { MAP = {}; }
delete MAP._about;

/** English path -> path inside the locale folder (unchanged when there is no entry). */
export function localizedPath(relPath, code) { return (MAP[relPath] && MAP[relPath][code]) || relPath; }

/** Path inside a locale folder -> English path (unchanged when it is not a localized name). */
export function englishPath(localRel, code) {
    for (const [en, m] of Object.entries(MAP)) if (m[code] === localRel) return en;
    return localRel;
}

/** Entries of the table for one locale: [[englishPath, localizedPath], ...]. */
export function slugEntries(code) { return Object.entries(MAP).filter(([, m]) => m[code]).map(([en, m]) => [en, m[code]]); }

/**
 * Rewrites the relative links of a page so they point at localized paths.
 * `page` is the English path of the page that holds the links, `code` the locale it is written for.
 * Absolute links, fragments, mailto:, assets/ and demo/ are left alone.
 */
export function rewriteLocalizedLinks($, page, code) {
    const baseEn = path.posix.dirname(page);
    const baseLoc = path.posix.dirname(localizedPath(page, code));
    $('a[href]').each((_, el) => {
        const val = $(el).attr('href');
        if (!val || /^(https?:)?\/\//.test(val) || /^(#|mailto:|tel:|javascript:|\/)/.test(val) || val.includes('assets/') || val.startsWith('demo/')) return;
        const m = val.match(/^([^#?]*)([#?].*)?$/); const p = m[1], rest = m[2] || '';
        if (!p) return;
        let target = path.posix.normalize(path.posix.join(baseEn, p));
        if (p.endsWith('/')) target = path.posix.join(target, 'index.html');
        const loc = localizedPath(target, code);
        if (loc === target) return;
        let rel = path.posix.relative(baseLoc, loc);
        $(el).attr('href', rel + rest);
    });
}

/** A tiny page for the old (English-named) address of a localized page: canonical to the new one, immediate refresh. */
export function redirectStub({ lang, newRel, newAbs, title }) {
    const t = String(title || 'Redirect').replace(/[<>&"]/g, '');
    return `<!DOCTYPE html>
<html lang="${lang}">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${t}</title>
<meta name="aish:redirect" content="${newAbs}">
<link rel="canonical" href="${newAbs}">
<meta http-equiv="refresh" content="0; url=${newRel}">
<script>location.replace(${JSON.stringify(newRel)} + location.search + location.hash);</script>
</head>
<body>
<p><a href="${newRel}">${t}</a></p>
</body>
</html>
`;
}
export const SITE_URL = SITE;

/** Hand-written pages with a different address per language: root path of the English page -> root path per locale folder. */
const NATIVE_SIBLINGS = {
    'education/': { de: 'de/bildung/' },
    'blog/ai-apps-mcp.html': { de: 'de/blog/ki-apps-mcp.html' },
};

/**
 * Links to a page that exists natively in this language (e.g. /education/ -> /de/bildung/) point at the native one.
 * `pageRootPath` is the page's path from docs/ (e.g. "de/blog/x.html"), links are resolved from there.
 */
export function rewriteNativeSiblingLinks($, pageRootPath, code) {
    const dirRoot = path.posix.dirname(pageRootPath);
    $('a[href]').each((_, el) => {
        const val = $(el).attr('href');
        if (!val || /^(https?:)?\/\/|^(#|mailto:|tel:|javascript:|\/)/.test(val)) return;
        const m = val.match(/^([^#?]*)([#?].*)?$/); const p = m[1], rest = m[2] || '';
        if (!p) return;
        const t = path.posix.normalize(path.posix.join(dirRoot, p));
        const target = p.endsWith('/') && t && !t.endsWith('/') ? `${t}/` : t;
        const to = NATIVE_SIBLINGS[target] && NATIVE_SIBLINGS[target][code];
        if (!to) return;
        $(el).attr('href', path.posix.relative(dirRoot, to) + rest);
    });
}
