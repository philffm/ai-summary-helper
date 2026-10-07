// feedUtil.js — stateless helpers for the Feeds feature (moved out of feedManager.js).
import { T, locale } from './feedI18n.js';

export function subTitle(s) { return (s && (s.customTitle || s.title || s.url)) || ''; }

// ── Helpers ────────────────────────────────────────────────────────────────
export function hash(str) {
    let h = 5381;
    for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) | 0;
    return (h >>> 0).toString(36);
}

export function safeHttpUrl(value, base) {
    try {
        const u = new URL(value, base);
        return (u.protocol === 'http:' || u.protocol === 'https:') ? u.href : null;
    } catch (e) {
        return null;
    }
}

export function normalizeInputUrl(raw) {
    let v = (raw || '').trim();
    if (!v) return null;
    if (!/^[a-z][a-z0-9+.-]*:/i.test(v)) v = 'https://' + v;
    return safeHttpUrl(v);
}

export function timeAgo(ts) {
    if (!ts) return '';
    const s = Math.max(0, (Date.now() - ts) / 1000);
    if (s < 3600) return T('{n}m', { n: Math.max(1, Math.round(s / 60)) });
    if (s < 86400) return T('{n}h', { n: Math.round(s / 3600) });
    if (s < 86400 * 30) return T('{n}d', { n: Math.round(s / 86400) });
    return new Date(ts).toLocaleDateString(locale(), { month: 'short', day: 'numeric' });
}

export function htmlToText(html) {
    if (!html) return '';
    const doc = new DOMParser().parseFromString(html, 'text/html');
    return (doc.body.textContent || '').replace(/\s+/g, ' ').trim();
}
