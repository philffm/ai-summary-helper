// modules/readerBookmark.js — a reading bookmark: the place in the full text the reader marked, kept on the article as
// `readPlace: { exact, prefix, suffix, at }` (an index field, so it syncs like the other article fields; '' = none).
// The place is the start of a block, found again by its text and the text around it (content/anchor.js, like highlights),
// so it survives a different window width and small edits.
import { ancBuildIndex, ancMakeSelector, ancResolve, ancToRange } from '../content/anchor.js';

export const BLOCKS = 'p,li,blockquote,h2,h3,h4,pre,figcaption,td';
const rectOf = (el) => (typeof el.getBoundingClientRect === 'function' ? el.getBoundingClientRect() : { top: 0, bottom: 0 });

/** The first block of `root` that reaches below `top` (the top edge of the reading area, under the toolbar). */
export function blockAtTop(root, top) {
  for (const b of root.querySelectorAll(BLOCKS)) {
    if (b.textContent.trim().length < 3 || b.closest('.rp-toc')) continue;
    if (rectOf(b).bottom > top + 4) return b;
  }
  return null;
}

/** { exact, prefix, suffix, at } for the start of `block`, or null when it has no text to find it by. */
export function placeOfBlock(root, block, now = () => new Date().toISOString()) {
  const doc = root.ownerDocument;
  const walker = doc.createTreeWalker(block, 4);
  let node = null; for (let n = walker.nextNode(); n; n = walker.nextNode()) if (n.nodeValue.trim()) { node = n; break; }
  if (!node) return null;
  const from = node.nodeValue.search(/\S/);
  const range = doc.createRange(); range.setStart(node, from); range.setEnd(node, Math.min(node.nodeValue.length, from + 100));
  const sel = ancMakeSelector(ancBuildIndex(root), range);
  return sel ? { exact: sel.exact, prefix: sel.prefix, suffix: sel.suffix, at: now() } : null;
}

/** The block a stored place points at, or null when the text changed too much to find it. */
export function blockOfPlace(root, place) {
  if (!place || typeof place !== 'object' || !place.exact) return null;
  const idx = ancBuildIndex(root);
  const hit = ancResolve(idx, place);
  const range = hit && ancToRange(idx, hit.start, hit.end);
  const el = range && range.startContainer.parentElement;
  return el ? (el.closest(BLOCKS) || el) : null;
}
