import { SK, articleRecKey } from './storageKeys.js';
import { pageKeyForUrl } from './pageKey.js';
import { qaMarkdown } from './conversation.js';
import { T } from './feedI18n.js';
// markdownArchive.js
// Bulk export of the History as a .zip of Markdown files (YAML front matter + summary, highlights, pinned Q&A)
// that opens cleanly in Obsidian / Logseq. Pure helpers + a tiny dependency-free "store" zip writer;
// the export yields to the event loop between batches so 500+ articles never freeze the popup.

const BATCH = 25;
const yieldUi = () => new Promise(r => setTimeout(r, 0));
const yamlStr = (v) => `"${String(v == null ? '' : v).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\r?\n/g, ' ')}"`;

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

/** One article → { name, text }. `related` = [fileBaseName] rendered as [[wikilinks]]. */
export function articleToMarkdown(article, { highlights = [], conversation = [], related = [] } = {}) {
    const a = article || {};
    const date = (() => { const d = new Date(a.timestamp); return isNaN(d) ? '' : d.toISOString().split('T')[0]; })();
    const tags = (a.tags || []).map(t => `  - ${yamlStr(t)}`);
    const fm = ['---', `title: ${yamlStr(a.title || 'Untitled')}`, `url: ${yamlStr(a.url || '')}`, `date: ${date}`,
        `mood: ${typeof a.moodScore === 'number' ? a.moodScore : ''}`, tags.length ? 'tags:\n' + tags.join('\n') : 'tags: []', '---'];
    const body = [`# ${a.title || 'Untitled'}`];
    const base = a.summaryBase !== undefined ? a.summaryBase : a.summary;
    const summary = htmlToMarkdown(base);
    if (summary) body.push(`## ${T('Summary')}\n\n${summary}`);
    const user = highlights.filter(h => h && h.type !== 'ghost'), ghost = highlights.filter(h => h && h.type === 'ghost');
    const quote = (h) => `> ${String(h.text || '').replace(/\s*\n\s*/g, '\n> ')}`;
    if (user.length) body.push(`## ${T('Highlights & Notes')}\n\n${user.map(quote).join('\n\n')}`);
    if (ghost.length) body.push(`## ${T('AI Suggested Highlights')}\n\n${ghost.map(quote).join('\n\n')}`);
    const qa = qaMarkdown(conversation);
    if (qa) body.push(qa.trim());
    if (related.length) body.push(`## ${T('Related')}\n\n${related.map(n => `- [[${n}]]`).join('\n')}`);
    return fm.join('\n') + '\n\n' + body.join('\n\n') + '\n';
}

// ── minimal zip writer (method 0 = stored; UTF-8 names) ──
let CRC_TABLE;
export function crc32(bytes) {
    if (!CRC_TABLE) { CRC_TABLE = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; CRC_TABLE[n] = c >>> 0; } }
    let crc = 0xFFFFFFFF;
    for (let i = 0; i < bytes.length; i++) crc = CRC_TABLE[(crc ^ bytes[i]) & 0xFF] ^ (crc >>> 8);
    return (crc ^ 0xFFFFFFFF) >>> 0;
}

/** files: [{ name, text }] → Blob (application/zip). Async so callers' UI stays responsive. */
export async function buildZip(files, { onProgress } = {}) {
    const enc = new TextEncoder();
    const parts = [], central = [];
    let offset = 0;
    const now = new Date();
    const dosTime = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1);
    const dosDate = ((Math.max(1980, now.getFullYear()) - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
    for (let i = 0; i < files.length; i++) {
        const name = enc.encode(files[i].name), data = enc.encode(files[i].text), crc = crc32(data);
        const local = new DataView(new ArrayBuffer(30));
        local.setUint32(0, 0x04034b50, true); local.setUint16(4, 20, true); local.setUint16(6, 0x0800, true); local.setUint16(8, 0, true);
        local.setUint16(10, dosTime, true); local.setUint16(12, dosDate, true); local.setUint32(14, crc, true);
        local.setUint32(18, data.length, true); local.setUint32(22, data.length, true); local.setUint16(26, name.length, true); local.setUint16(28, 0, true);
        const cen = new DataView(new ArrayBuffer(46));
        cen.setUint32(0, 0x02014b50, true); cen.setUint16(4, 20, true); cen.setUint16(6, 20, true); cen.setUint16(8, 0x0800, true); cen.setUint16(10, 0, true);
        cen.setUint16(12, dosTime, true); cen.setUint16(14, dosDate, true); cen.setUint32(16, crc, true);
        cen.setUint32(20, data.length, true); cen.setUint32(24, data.length, true); cen.setUint16(28, name.length, true);
        cen.setUint32(42, offset, true);
        parts.push(local.buffer, name, data);
        central.push(cen.buffer, name);
        offset += 30 + name.length + data.length;
        if ((i + 1) % BATCH === 0) { if (onProgress) onProgress(i + 1, files.length); await yieldUi(); }
    }
    const cenSize = central.reduce((n, p) => n + (p.byteLength || p.length), 0);
    const end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true); end.setUint16(8, files.length, true); end.setUint16(10, files.length, true);
    end.setUint32(12, cenSize, true); end.setUint32(16, offset, true);
    return new Blob([...parts, ...central, end.buffer], { type: 'application/zip' });
}

/** Reads the whole history and returns the [{name,text}] list (files placed under `ai-summary-helper/`). */
export async function buildArchiveFiles({ onProgress } = {}) {
    const get = (k) => new Promise(resolve => chrome.storage.local.get(k, resolve));
    const { [SK.articlesIndex]: index = [], [SK.annotations]: annotations = [] } = await get({ [SK.articlesIndex]: [], [SK.annotations]: [] });
    const list = index.filter(a => a && a.id && !a.feedStub && !a.savedOnly);
    const hlByUrl = new Map();
    for (const h of annotations) { if (h && h.url && !h.dismissed) { if (!hlByUrl.has(h.url)) hlByUrl.set(h.url, []); hlByUrl.get(h.url).push(h); } }

    const used = new Set();
    const names = new Map();
    for (const a of list) {
        let base = safeFileName(a.title), n = 2;
        while (used.has(base.toLowerCase())) base = `${safeFileName(a.title)} (${n++})`;
        used.add(base.toLowerCase()); names.set(a.id, base);
    }
    const byTag = new Map();
    for (const a of list) for (const t of new Set((a.tags || []).map(x => String(x).toLowerCase()))) { if (!byTag.has(t)) byTag.set(t, []); byTag.get(t).push(a.id); }

    const files = [];
    for (let i = 0; i < list.length; i += BATCH) {
        const chunk = list.slice(i, i + BATCH);
        const recs = await get(chunk.map(a => articleRecKey(a.id)));
        for (const a of chunk) {
            const rec = recs[articleRecKey(a.id)] || {};
            const full = { ...a, ...rec };
            const score = new Map();
            for (const t of new Set((a.tags || []).map(x => String(x).toLowerCase()))) for (const id of byTag.get(t) || []) if (id !== a.id) score.set(id, (score.get(id) || 0) + 1);
            const related = [...score.entries()].sort((x, y) => y[1] - x[1]).slice(0, 5).map(([id]) => names.get(id));
            const text = articleToMarkdown(full, {
                highlights: hlByUrl.get(a.url ? pageKeyForUrl(a.url) : '') || [],
                conversation: Array.isArray(rec.conversation) ? rec.conversation : [], related
            });
            files.push({ name: `ai-summary-helper/${names.get(a.id)}.md`, text });
        }
        if (onProgress) onProgress(Math.min(i + BATCH, list.length), list.length);
        await yieldUi();
    }
    return files;
}

/** Builds the zip and triggers the download. Resolves with the number of exported articles. */
export async function exportHistoryMarkdown({ onProgress } = {}) {
    const files = await buildArchiveFiles({ onProgress });
    const blob = await buildZip(files);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `aish_history_${new Date().toISOString().split('T')[0].replace(/-/g, '')}_${files.length}articles.zip`;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    return files.length;
}
