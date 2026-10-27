// modules/archiveUrl.js
// Archive / paywall-mirror links carry the original article URL inside them, e.g.
//   https://archive.ph/2026.10.20-101500/https://www.nytimes.com/2026/10/20/tech/ai.html
//   https://web.archive.org/web/20261020101500/https://example.com/post
//   https://12ft.io/https://example.com/post
// When an article is saved from such a page, AISH stores the original URL (and keeps the archive link as archiveUrl),
// so the library, duplicate checks and highlights all point at the real article.
// Short archive links without an embedded URL (archive.ph/AbCd1) are left as they are.

const ARCHIVE_HOSTS = [
    /^archive\.(ph|today|is|li|vn|fo|md)$/,
    /^(web\.|wayback\.)?archive\.org$/,
    /^wayback\.archive-it\.org$/,
    /^webcache\.googleusercontent\.com$/,
    /^(www\.)?12ft\.io$/,
    /^(www\.)?removepaywall\.com$/,
    /^(www\.)?ghostarchive\.org$/,
];

/** True for a known archive / mirror host. */
export function isArchiveHost(hostname) {
    const h = String(hostname || '').toLowerCase().replace(/^www\.(?=archive\.)/, '');
    return ARCHIVE_HOSTS.some((re) => re.test(h));
}

/**
 * The original URL inside an archive link, or the input unchanged when it is not an archive link
 * or has no embedded http(s) URL. Handles plain (https://…), collapsed (https:/…) and percent-encoded (https%3A%2F%2F…) forms.
 * @param {string} url
 * @returns {string}
 */
export function unwrapArchiveUrl(url) {
    const raw = String(url || '').trim();
    let u;
    try { u = new URL(raw); } catch (_) { return raw; }
    if (!isArchiveHost(u.hostname)) return raw;
    const rest = raw.slice(u.origin.length);   // path + query + hash, as typed (URL() would collapse "//")
    let m = rest.match(/https?:\/\/?[^\s]+/i) || rest.match(/https?%3A%2F%2F[^\s&]+/i);
    if (!m) return raw;
    let inner = m[0];
    if (/%3A%2F%2F/i.test(inner)) { try { inner = decodeURIComponent(inner); } catch (_) { return raw; } }
    inner = inner.replace(/^(https?):\/(?!\/)/i, '$1://');   // web.archive.org/web/2026/https:/example.com
    try {
        const out = new URL(inner);
        if (!/^https?:$/.test(out.protocol) || isArchiveHost(out.hostname)) return raw;
        return out.href;
    } catch (_) { return raw; }
}
