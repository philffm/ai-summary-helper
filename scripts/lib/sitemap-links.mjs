import fs from 'node:fs';
import path from 'node:path';
import * as cheerio from 'cheerio';

function isFileInRoot(file, root) {
    const resolved = path.resolve(file);
    if (resolved !== root && !resolved.startsWith(root + path.sep)) return false;
    try { return fs.statSync(resolved).isFile(); } catch { return false; }
}

function candidatesFor(pathname, root) {
    let relative;
    try { relative = decodeURIComponent(pathname).replace(/^\/+/, ''); } catch { return []; }
    const base = path.resolve(root, relative);
    if (pathname.endsWith('/')) return [path.join(base, 'index.html')];
    if (path.extname(relative)) return [base];
    return [base, `${base}.html`, path.join(base, 'index.html')];
}

export function findMissingLocalLinks(html, pageUrl, { siteBase, docsDir, publishedRoots = [] }) {
    const siteOrigin = new URL(siteBase).origin;
    const roots = [
        ...publishedRoots.map(({ urlPrefix, directory }) => ({
            urlPrefix: urlPrefix.endsWith('/') ? urlPrefix : `${urlPrefix}/`,
            directory: path.resolve(directory),
        })).sort((a, b) => b.urlPrefix.length - a.urlPrefix.length),
        { urlPrefix: '/', directory: path.resolve(docsDir) },
    ];
    const $ = cheerio.load(html);
    const missing = [];

    $('a[href]').each((_, el) => {
        const href = $(el).attr('href');
        if (href.startsWith('#')) return;
        let target;
        try { target = new URL(href, pageUrl); } catch { missing.push(href); return; }
        if (target.origin !== siteOrigin) return;

        const root = roots.find(({ urlPrefix }) => target.pathname.startsWith(urlPrefix));
        if (!root) { missing.push(href); return; }
        const targetFiles = candidatesFor(target.pathname.slice(root.urlPrefix.length), root.directory);
        if (!targetFiles.some((file) => isFileInRoot(file, root.directory))) missing.push(href);
    });

    return missing;
}
