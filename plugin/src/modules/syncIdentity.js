// modules/syncIdentity.js
// When are two saved articles "the same article"? Used by the sync engine to merge copies that two devices saved independently.
// Deliberately stricter than pageKey.js (which drops most query parameters so that highlights follow a page): here a false match
// loses data, a missed match only leaves a duplicate. So only tracking parameters, the fragment, the scheme, `www.`, a default
// port and a trailing slash are ignored; every other query parameter is part of the identity (`?p=12` is not `?p=13`).
import { unwrapArchiveUrl } from './archiveUrl.js';

const TRACKING = /^(utm_[a-z0-9_]*|fbclid|gclid|dclid|msclkid|yclid|mc_cid|mc_eid|igshid|ref_src|ref_url|_hsenc|_hsmi|vero_id|oly_enc_id|oly_anon_id)$/i;

/** Identity of an article's URL, or '' when there is none worth matching on (not http, no path). */
export function articleKey(href) {
    try {
        const u = new URL(unwrapArchiveUrl(href));   // a copy on archive.ph or the Wayback Machine is the original article
        if (u.protocol !== 'http:' && u.protocol !== 'https:') return '';
        const q = [...u.searchParams.entries()].filter(([k]) => !TRACKING.test(k)).sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0)).map(([k, v]) => `${k}=${v}`).join('&');
        const path = u.pathname.replace(/\/+$/, '') || '';
        if (!path && !q) return '';   // a bare site address is not an article
        return `${u.hostname.toLowerCase().replace(/^www\./, '')}${path}${q ? '?' + q : ''}`;
    } catch (_) { return ''; }
}

/** Order for picking the one article that stays: the earliest saved, then the smaller id. Every device sorts the same way. */
export function canonicalOrder(a, b) {
    const ta = Date.parse(a.timestamp), tb = Date.parse(b.timestamp);
    const x = Number.isFinite(ta) ? ta : Infinity, y = Number.isFinite(tb) ? tb : Infinity;
    return x !== y ? (x < y ? -1 : 1) : (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

/** Fields that say which article this is: never copied from the copy that goes away. */
export const IDENTITY_FIELDS = new Set(['id', 'url', 'timestamp', 'title']);
