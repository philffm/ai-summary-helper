// modules/articleFormat.js
// One source for the formats an article leaves the extension in. See plugin/formats/article-json-v1.md.
//   toArticleJson()        the saved article (+ highlights, pinned Q&A) as "AISH Article JSON v1"
//   assignFileBases()      stable note file names that do not depend on the order of the archive
//   frontMatter()          YAML front matter built from the JSON object (same keys on Android, see ArticleMarkdown.kt)
// Pure: no chrome.*, no fetch, no DOM unless the caller passes `parseHtml`.
import { siteOf, authorOf, langOf, oneLine } from './articleMeta.js';
import { htmlToBlocks, textToBlocks } from './articleBlocks.js';

export const FORMAT = 'article/1';
export const FORMAT_VERSION = 1;

/** Summary HTML → Markdown (regex pass, no DOM: cheap enough for hundreds of articles). */
export function htmlToMarkdown(html) {
    return String(html || '')
        .replace(/<\s*(script|style)[\s\S]*?<\/\s*\1\s*>/gi, '')
        .replace(/<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/gi, (_, n, t) => `\n\n${'#'.repeat(Math.min(6, +n + 1))} ${t.replace(/<[^>]+>/g, '').trim()}\n\n`)
        .replace(/<(strong|b)>([\s\S]*?)<\/\1>/gi, '**$2**')
        .replace(/<(em|i)>([\s\S]*?)<\/\1>/gi, '*$2*')
        .replace(/<a\s[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, '[$2]($1)')
        .replace(/<li[^>]*>/gi, '\n- ')
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<\/(p|div|ul|ol|blockquote)>/gi, '\n\n')
        .replace(/<[^>]+>/g, '')
        .replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&')
        .replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

/** Filesystem-safe base name (no extension). */
export function safeFileName(title) {
    const s = String(title || '').replace(/[\\/:*?"<>|#^[\]\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim().replace(/^\.+/, '').slice(0, 80).trim();
    return s || 'Untitled';
}

const tsOf = (a) => { const t = new Date(a && a.timestamp).getTime(); return isNaN(t) ? 0 : t; };
const isoOrEmpty = (ts) => { const d = new Date(ts); return isNaN(d) ? '' : d.toISOString(); };

/**
 * The article as AISH Article JSON v1.
 *   article       index entry merged with its record ({ ...entry, ...rec })
 *   highlights    annotations of the page ({ type, text, timestamp })
 *   conversation  the article's Q&A turns; only pinned ones are exported
 *   includeBlocks add the full text as blocks (off by default: bodies get large)
 *   parseHtml     (html) → DOM root, needed for blocks when the text is HTML (DOMParser in the browser)
 */
export function toArticleJson(article, { highlights = [], conversation = [], includeBlocks = false, parseHtml } = {}) {
    const a = article || {};
    const base = a.summaryBase !== undefined ? a.summaryBase : a.summary;
    const out = {
        aish: FORMAT,
        id: String(a.id || ''),
        url: String(a.url || ''),
        title: oneLine(a.title),
        site: siteOf(a.url),
    };
    const author = authorOf(a); if (author) out.author = author;
    const lang = langOf(a); if (lang) out.lang = lang;
    const savedAt = isoOrEmpty(a.timestamp); if (savedAt) out.savedAt = savedAt;
    out.tags = (Array.isArray(a.tags) ? a.tags : []).map(String).filter(Boolean);
    if (typeof a.moodScore === 'number' && isFinite(a.moodScore)) out.mood = a.moodScore;
    out.summary = { md: htmlToMarkdown(base) };
    out.highlights = (Array.isArray(highlights) ? highlights : []).filter((h) => h && h.text && !h.dismissed)
        .map((h) => { const o = { type: h.type === 'ghost' ? 'ghost' : 'user', text: String(h.text) }; const at = isoOrEmpty(h.timestamp); if (at) o.at = at; return o; });
    const qa = (Array.isArray(conversation) ? conversation : []).filter((t) => t && t.pinned && t.q)
        .map((t) => ({ q: String(t.q), a: String(t.a || '') }));
    if (qa.length) out.qa = qa;
    if (includeBlocks) {
        const html = String(a.content || a.html || a.text || '');
        let blocks = [];
        if (html) {
            const hasTags = /<[a-z][\s\S]*>/i.test(html);
            try { blocks = hasTags && parseHtml ? htmlToBlocks(parseHtml(html)) : textToBlocks(hasTags ? html.replace(/<[^>]*>/g, ' ') : html); }
            catch (_) { blocks = textToBlocks(html.replace(/<[^>]*>/g, ' ')); }
        }
        out.blocks = blocks;
    }
    if (a.modelId) out.model = String(a.modelId);
    return out;
}

/** Last six letters/digits of the id, enough to tell two notes with the same title apart. */
export const idTail = (id) => String(id || '').replace(/[^A-Za-z0-9]/g, '').slice(-6) || 'x';

/**
 * File base names for a set of articles ({ id, title, timestamp }). A name depends only on the article and on the other
 * articles with the same title, never on the order of the list: the oldest keeps the plain title, the others get
 * " (<id tail>)". A note without a title is always "Untitled (<id tail>)". Returns Map(id → base name).
 */
export function assignFileBases(list) {
    const groups = new Map();
    for (const a of list || []) {
        if (!a || !a.id) continue;
        const titled = !!oneLine(a.title);
        const key = (titled ? safeFileName(a.title) : '\u0000untitled').toLowerCase();
        if (!groups.has(key)) groups.set(key, { titled, items: [] });
        groups.get(key).items.push(a);
    }
    const names = new Map(), taken = new Set();
    const give = (a, name) => {
        let n = name;
        for (let i = 2; taken.has(n.toLowerCase()); i++) n = `${name} ${i}`;   // only when a title literally ends in another note's tail
        taken.add(n.toLowerCase()); names.set(a.id, n);
    };
    const plain = [], suffixed = [];
    for (const g of groups.values()) {
        const items = g.items.slice().sort((x, y) => tsOf(x) - tsOf(y) || String(x.id).localeCompare(String(y.id)));
        items.forEach((a, i) => {
            const base = safeFileName(a.title);   // the article's own title, so the name does not depend on who else is in the group
            if (g.titled && i === 0) plain.push([a, base]); else suffixed.push([a, `${base} (${idTail(a.id)})`]);
        });
    }
    plain.forEach(([a, n]) => give(a, n));      // plain titles are placed first so a suffixed name can never take one
    suffixed.forEach(([a, n]) => give(a, n));
    return names;
}

const yamlStr = (v) => `"${String(v == null ? '' : v).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\r?\n/g, ' ')}"`;

/**
 * YAML front matter from the JSON object. Keys match the Android app's notes. `url` and `date` repeat `source` and `created`
 * for a transition period so existing Obsidian/Dataview queries keep working.
 */
export function frontMatter(json) {
    const created = json.savedAt ? json.savedAt.split('T')[0] : '';
    const lines = ['---', `title: ${yamlStr(json.title || 'Untitled')}`, `source: ${yamlStr(json.url)}`];
    if (json.author) lines.push(`author: ${yamlStr(json.author)}`);
    if (json.site) lines.push(`site: ${yamlStr(json.site)}`);
    lines.push(`created: ${created}`);
    lines.push(json.tags.length ? 'tags:\n' + json.tags.map((t) => `  - ${yamlStr(t)}`).join('\n') : 'tags: []');
    if (typeof json.mood === 'number') lines.push(`mood: ${json.mood}`);
    if (json.id) lines.push(`aish_id: ${yamlStr(json.id)}`);
    lines.push(`aish_format: ${FORMAT_VERSION}`);
    lines.push(`url: ${yamlStr(json.url)}`, `date: ${created}`, '---');
    return lines.join('\n');
}
