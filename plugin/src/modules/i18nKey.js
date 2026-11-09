// modules/i18nKey.js — the message key for an English UI string: T('Mark read') looks up `f_mark_read_<hash>` in
// _locales/<lang>/messages.json. Its own file so content scripts (which cannot load the dictionary through i18n.js and
// use chrome.i18n.getMessage instead) compute the same keys as the popup.
// FNV-1a, 4 hex chars: keeps keys unique even when two texts share a slug.
export function i18nKey(en) {
    let h = 0x811c9dc5;
    for (let i = 0; i < en.length; i++) { h ^= en.charCodeAt(i); h = Math.imul(h, 0x01000193); }
    const slug = en.toLowerCase().replace(/\{[a-z]+\}/g, '').replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 28);
    return `f_${slug}_${(h >>> 0).toString(16).slice(-4)}`;
}
