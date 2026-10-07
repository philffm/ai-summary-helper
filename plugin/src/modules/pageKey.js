// modules/pageKey.js
// Stable per-page key for highlights + the list of "feed-like" pages where the
// highlights panel should never appear.

// Query params that identify the *content* of a page (single-page apps keep the
// same path while the content changes: LinkedIn jobs, YouTube watch, …).
const KEEP_PARAMS = ['currentJobId', 'v', 'id', 'item', 'story_fbid', 'pid', 'postId', 'article'];

/** origin + pathname (+ content-identifying query params). Fragment and tracking params are dropped. */
export function pageKeyForUrl(href) {
  try {
    const u = new URL(href);
    const keep = KEEP_PARAMS.filter(k => u.searchParams.get(k)).sort()
      .map(k => `${k}=${u.searchParams.get(k)}`);
    return `${u.origin}${u.pathname}${keep.length ? '?' + keep.join('&') : ''}`;
  } catch (_) {
    return String(href || '').split('#')[0].split('?')[0];
  }
}

// Pages that are streams/lists/inboxes: content changes constantly and there is nothing stable to anchor to.
const NOISE = [
  [/(^|\.)linkedin\.com$/, /^\/(feed|messaging|notifications|mynetwork|jobs\/(search|collections)(\/.*)?)\/?$/],
  [/^(www\.)?(x|twitter)\.com$/, /^\/(home|notifications|messages|explore|i\/.*)?\/?$/],
  [/(^|\.)facebook\.com$/, /^\/(watch|messages|marketplace|groups\/feed|reel|stories)?(\/.*)?$/],
  [/(^|\.)instagram\.com$/, /^\/(explore|reels|direct)?(\/.*)?$/],
  [/(^|\.)youtube\.com$/, /^\/(feed|results|shorts)?(\/.*)?$/],
];

/**
 * True when the highlights UI should stay out of the way: a built-in feed-like page
 * (unless the URL points at one specific item) or a site the user excluded.
 * @param {string} href
 * @param {string[]} excludedHosts hostnames (suffix match)
 */
export function isNoisePage(href, excludedHosts = []) {
  try {
    const u = new URL(href);
    const host = u.hostname.toLowerCase();
    if ((excludedHosts || []).some(h => h && (host === h || host.endsWith('.' + h)))) return true;
    const hasItem = KEEP_PARAMS.some(k => u.searchParams.get(k));
    if (hasItem) return false;
    return NOISE.some(([h, p]) => h.test(host) && p.test(u.pathname));
  } catch (_) { return false; }
}
