// feedParse.js — RSS/Atom parsing + OPML export (pure functions, moved out of feedManager.js).
import { safeHttpUrl, htmlToText, subTitle } from './feedUtil.js';

// ── Parsing ────────────────────────────────────────────────────────────────
// Namespace-agnostic child lookup (e.g. content:encoded, dc:date).
function childByLocalName(parent, name) {
    for (const c of parent.children) {
        if (c.localName === name) return (c.textContent || '').trim();
    }
    return '';
}

const AUDIO_EXT = /\.(mp3|m4a|aac|ogg|oga|opus|wav|flac)(\?|#|$)/i;
function parseDuration(v) {
    if (!v) return 0;
    const parts = String(v).trim().split(':').map(Number);
    if (parts.some(n => !Number.isFinite(n))) return 0;
    return parts.reduce((t, n) => t * 60 + n, 0);
}
function enclosureOf(e, feedUrl) {
    for (const c of e.children) {
        if (c.localName !== 'enclosure' && !(c.localName === 'link' && c.getAttribute('rel') === 'enclosure')) continue;
        const type = (c.getAttribute('type') || '').toLowerCase();
        const href = c.getAttribute('url') || c.getAttribute('href');
        if (!href) continue;
        if (type.startsWith('audio/') || (!type.startsWith('video/') && AUDIO_EXT.test(href))) {
            const url = safeHttpUrl(href, feedUrl);
            if (url) return url;
        }
    }
    return '';
}

function imageOf(node, base) {
    for (const c of node.children) {
        const n = c.localName;
        if ((n === 'image' || n === 'thumbnail') && (c.getAttribute('href') || c.getAttribute('url'))) {
            const u = safeHttpUrl(c.getAttribute('href') || c.getAttribute('url'), base);
            if (u) return u;
        }
        if (n === 'image') {            // <image><url>…</url></image>
            const u = safeHttpUrl(childByLocalName(c, 'url'), base);
            if (u) return u;
        }
    }
    return '';
}

/** @returns {{title:string, siteUrl:string, items:Array}|null} */
export function parseFeed(xmlText, feedUrl) {
    const doc = new DOMParser().parseFromString(xmlText, 'text/xml');
    if (doc.querySelector('parsererror')) return null;
    const root = doc.documentElement;
    if (!root) return null;
    const rootName = root.localName.toLowerCase();

    if (rootName === 'feed') {                       // Atom
        const title = childByLocalName(root, 'title');
        let siteUrl = '';
        for (const l of root.children) {
            if (l.localName === 'link' && (!l.getAttribute('rel') || l.getAttribute('rel') === 'alternate')) {
                siteUrl = safeHttpUrl(l.getAttribute('href'), feedUrl) || siteUrl;
            }
        }
        const out = [];
        for (const e of root.children) {
            if (e.localName !== 'entry') continue;
            let link = '';
            for (const l of e.children) {
                if (l.localName !== 'link') continue;
                const rel = l.getAttribute('rel');
                if (!rel || rel === 'alternate') { link = safeHttpUrl(l.getAttribute('href'), feedUrl) || link; }
            }
            const when = childByLocalName(e, 'published') || childByLocalName(e, 'updated');
            out.push({
                guid: childByLocalName(e, 'id') || link,
                title: htmlToText(childByLocalName(e, 'title')),
                link,
                published: Date.parse(when) || 0,
                snippet: htmlToText(childByLocalName(e, 'summary') || childByLocalName(e, 'content')).slice(0, 220),
                audio: enclosureOf(e, feedUrl),
                dur: parseDuration(childByLocalName(e, 'duration'))
            });
        }
        return { title, siteUrl, image: '', items: out };
    }

    if (rootName === 'rss' || rootName === 'rdf') {  // RSS 2.0 / RSS 1.0
        const channel = root.querySelector('channel') || root;
        const title = childByLocalName(channel, 'title');
        const siteUrl = safeHttpUrl(childByLocalName(channel, 'link'), feedUrl) || '';
        const nodes = [...doc.getElementsByTagName('item')];
        const out = nodes.map(e => {
            const link = safeHttpUrl(childByLocalName(e, 'link'), feedUrl) || '';
            const when = childByLocalName(e, 'pubDate') || childByLocalName(e, 'date');
            return {
                guid: childByLocalName(e, 'guid') || link,
                title: htmlToText(childByLocalName(e, 'title')),
                link,
                published: Date.parse(when) || 0,
                snippet: htmlToText(childByLocalName(e, 'description') || childByLocalName(e, 'encoded')).slice(0, 220),
                audio: enclosureOf(e, feedUrl),
                dur: parseDuration(childByLocalName(e, 'duration')),
                img: imageOf(e, feedUrl)
            };
        });
        return { title, siteUrl, image: imageOf(channel, feedUrl), items: out };
    }
    return null;
}

function escXml(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }

/** OPML 2.0 document for the subscriptions (first tag = folder for readers without tags; all tags in `category`). */
export function opmlXml(subs) {
    const line = (s, ind) => `${ind}<outline type="rss" text="${escXml(subTitle(s))}" title="${escXml(subTitle(s))}" xmlUrl="${escXml(s.url)}"${s.siteUrl ? ` htmlUrl="${escXml(s.siteUrl)}"` : ''}${(s.tags || []).length ? ` category="${escXml(s.tags.join(','))}"` : ''}/>`;
    // Readers without tags get the first tag as a folder; all tags also go in `category`.
    const first = (s) => (s.tags || [])[0] || '';
    const folders = [...new Set(subs.map(first).filter(Boolean))].sort();
    const out = ['<?xml version="1.0" encoding="UTF-8"?>', '<opml version="2.0">', '  <head><title>AI Summary Helper feeds</title></head>', '  <body>'];
    subs.filter(s => !first(s)).forEach(s => out.push(line(s, '    ')));
    folders.forEach(f => {
        out.push(`    <outline text="${escXml(f)}" title="${escXml(f)}">`);
        subs.filter(s => first(s) === f).forEach(s => out.push(line(s, '      ')));
        out.push('    </outline>');
    });
    out.push('  </body>', '</opml>');
    return out.join('\n');
}
