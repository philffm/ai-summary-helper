// scripts/lib/localized-paths.mjs
//
// One place that knows where a translated page lives. By default it is <locale folder>/<English path>; docs/i18n/slugs.json
// can give a page a localized path (e.g. blog/feeds-recap.html -> de/blog/ein-rueckblick-statt-40-feeds.html).
// The old English-named path stays as a redirect page (see redirectStub), so existing links and a submitted sitemap keep working.
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import * as cheerio from 'cheerio';

const SITE = 'https://ai-summary-helper.byphil.eu';
const SITE_ORIGIN = new URL(SITE).origin;
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
 * Rewrites the relative links of a page so they point at available localized paths.
 * `page` is the English path of the page that holds the links, `code` the locale it is written for.
 * Absolute links, fragments, mailto:, assets/ and demo/ are left alone.
 */
export function rewriteLocalizedLinks($, page, code, inventory) {
    const baseEn = path.posix.dirname(page);
    const baseLoc = path.posix.dirname(localizedPath(page, code));
    $('a[href]').each((_, el) => {
        const val = $(el).attr('href');
        if (!val || /^(https?:)?\/\//.test(val) || /^(#|mailto:|tel:|javascript:|\/)/.test(val) || val.includes('assets/') || val.startsWith('demo/')) return;
        const m = val.match(/^([^#?]*)([#?].*)?$/); const p = m[1], rest = m[2] || '';
        if (!p) return;
        let target = path.posix.normalize(path.posix.join(baseEn, p));
        if (p.endsWith('/')) target = path.posix.join(target, 'index.html');
        const loc = inventory ? inventory[code]?.[target] : localizedPath(target, code);
        if (!loc) return;
        if (loc === target) return;
        const localizedPathTarget = p.endsWith('/') && loc.endsWith('/index.html') ? path.posix.dirname(loc) : loc;
        let rel = path.posix.relative(baseLoc, localizedPathTarget);
        if (p.endsWith('/')) rel = rel ? `${rel.replace(/\/$/, '')}/` : './';
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

function pagePath(urlPath) {
    let rel = urlPath;
    try { rel = decodeURIComponent(rel); } catch { rel = urlPath; }
    rel = rel.replace(/^\/+/, '');
    if (!rel || rel.endsWith('/')) rel += 'index.html';
    return path.posix.normalize(rel);
}

function htmlFiles(dir) {
    if (!existsSync(dir)) return [];
    const files = [];
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const file = path.join(dir, entry.name);
        if (entry.isDirectory()) files.push(...htmlFiles(file));
        else if (entry.isFile() && entry.name.endsWith('.html')) files.push(file);
    }
    return files;
}

/** Build a source-page -> localized-page map from existing pages and their English alternates. */
export function buildLocalizedPageInventory(config, docsRoot = path.join(process.cwd(), 'docs')) {
    const inventory = Object.fromEntries(Object.keys(config.locales).map((code) => [code, {}]));
    const localeDirs = Object.entries(config.locales)
        .map(([code, locale]) => ({ code, dir: locale.dir }))
        .sort((a, b) => b.dir.length - a.dir.length);

    for (const [code, locale] of Object.entries(config.locales)) {
        for (const source of config.content || []) {
            const target = localizedPath(source, code);
            inventory[code][pagePath(source)] = pagePath(target);
        }
    }

    for (const file of htmlFiles(docsRoot)) {
        const fileRel = path.relative(docsRoot, file).split(path.sep).join('/');
        const locale = localeDirs.find(({ dir }) => fileRel.startsWith(`${dir}/`));
        if (!locale) continue;

        const $ = cheerio.load(readFileSync(file, 'utf8'));
        const englishHref = $('link[rel="alternate"][hreflang="en"]').attr('href');
        if (!englishHref) continue;

        let sourcePath;
        try {
            const englishUrl = new URL(englishHref, `${SITE}/`);
            if (englishUrl.origin !== SITE_ORIGIN) continue;
            sourcePath = pagePath(englishUrl.pathname);
        } catch {
            continue;
        }
        const targetPath = path.posix.relative(locale.dir, fileRel);
        if (targetPath && !targetPath.startsWith('../')) inventory[locale.code][sourcePath] = targetPath;
    }

    return inventory;
}

/**
 * `pageRootPath` is the page's path from docs/ (e.g. "de/blog/x.html"); targets come from the locale inventory.
 */
export function rewriteAvailablePageLinks($, pageRootPath, code, inventory, localeDir) {
    const localePage = path.posix.relative(localeDir, pageRootPath);
    const englishPage = Object.entries(inventory[code] || {}).find(([, target]) => target === localePage)?.[0] || localePage;
    const sourceDir = path.posix.dirname(englishPage);
    const localePageDir = path.posix.dirname(pageRootPath);
    const localePages = inventory[code] || {};
    const englishPathForLocale = new Map(Object.entries(localePages).map(([source, target]) => [target, source]));
    $('a[href]').each((_, el) => {
        const val = $(el).attr('href');
        if (!val || /^(https?:)?\/\/|^(#|mailto:|tel:|javascript:|\/)/.test(val)) return;
        const m = val.match(/^([^#?]*)([#?].*)?$/); const p = m[1], rest = m[2] || '';
        if (!p) return;
        const physicalTarget = path.posix.normalize(path.posix.join(localePageDir, p));
        const localeTarget = path.posix.relative(localeDir, physicalTarget);
        const localSource = englishPathForLocale.get(pagePath(localeTarget));
        const sourceTargets = [
            pagePath(path.posix.join(sourceDir, p)),
            ...(localeTarget.startsWith('../') ? [pagePath(physicalTarget)] : [localSource || pagePath(localeTarget)]),
        ];
        const sourceTarget = sourceTargets.find((target) => localePages[target]);
        const localizedTarget = sourceTarget && localePages[sourceTarget];
        if (!localizedTarget) return;
        const targetFile = path.posix.join(localeDir, localizedTarget);
        const targetPath = p.endsWith('/') && targetFile.endsWith('/index.html')
            ? path.posix.dirname(targetFile)
            : targetFile;
        let href = path.posix.relative(localePageDir, targetPath);
        if (p.endsWith('/')) href = href ? `${href.replace(/\/$/, '')}/` : './';
        $(el).attr('href', href + rest);
    });
}
