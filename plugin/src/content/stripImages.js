// stripImages.js — images of a saved page. Pure string helpers (no DOM, no chrome.*), shared by the content script
// (do not store images) and the Settings cleanup (remove images from what is already saved).

const IMG = /<img\b[^>]*>/gi;
const PICTURE_SOURCE = /<source\b[^>]*>/gi;
const DATA_IMG = /data:image\/[a-z0-9.+-]+;base64,[A-Za-z0-9+/=]+/gi;
const EMPTY_FIGURE = /<figure\b[^>]*>\s*(?:<figcaption\b[^>]*>\s*<\/figcaption>\s*)?<\/figure>/gi;

/** HTML without <img>, <picture> sources and the figures that were left empty. Text, links and captions stay. */
export function stripImages(html) {
    if (!html || typeof html !== 'string') return html || '';
    return html.replace(IMG, '').replace(PICTURE_SOURCE, '').replace(EMPTY_FIGURE, '');
}

/** Bytes taken by inlined (base64) images in the HTML. Remote <img src="https://…"> cost almost nothing and are not counted. */
export function imageBytes(html) {
    if (!html || typeof html !== 'string') return 0;
    let n = 0;
    for (const m of html.matchAll(DATA_IMG)) n += m[0].length;
    return n;
}

/** True when the HTML contains any <img>. */
export function hasImages(html) {
    return typeof html === 'string' && /<img\b/i.test(html);
}
