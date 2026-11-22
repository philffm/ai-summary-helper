// modules/readerHighlights.js — highlights made and removed in the read mode page (readerPage.js).
// The reader is an extension page: it writes the same records as the website highlighter (id, quote, v: 2), straight
// through the highlight store under its lock (the background's hl:apply takes the page from the sending tab and would not
// know this one). Removing a user highlight also tells the worker (syncHlDeleted), so the next sync does not bring it back;
// an AI (ghost) highlight is dismissed, never removed, or it would return with the next summary.
import { ancBuildIndex, ancMakeSelector, ancResolve, ancToRange } from '../content/anchor.js';
import { pageKeyForUrl } from './pageKey.js';

const newId = () => 'hl_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);

/** The live selection when it is a real passage inside `root`, else null. */
export function selectionIn(root, win = window) {
  const sel = win.getSelection && win.getSelection();
  if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return null;
  const range = sel.getRangeAt(0);
  if (!root.contains(range.commonAncestorContainer)) return null;
  if (range.toString().replace(/\s+/g, ' ').trim().length < 3) return null;
  return range;
}

/** Wraps the text of `range` in <mark> elements (one per text node), skipping text that is already highlighted. */
export function wrapRange(range, attrs) {
  const doc = range.startContainer.ownerDocument;
  const nodes = [];
  const walker = doc.createTreeWalker(range.commonAncestorContainer.nodeType === 3 ? range.commonAncestorContainer.parentNode : range.commonAncestorContainer, 4);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) if (range.intersectsNode(n)) nodes.push(n);
  const marks = [];
  for (const n of nodes) {
    if (!n.nodeValue.trim() || (n.parentElement && n.parentElement.closest('mark'))) continue;
    const from = n === range.startContainer ? range.startOffset : 0;
    const to = n === range.endContainer ? range.endOffset : n.nodeValue.length;
    if (to <= from) continue;
    const mid = n.splitText(from);
    if (to - from < mid.nodeValue.length) mid.splitText(to - from);
    const mk = doc.createElement('mark');
    for (const [k, v] of Object.entries(attrs)) mk.setAttribute(k, v);
    mid.parentNode.replaceChild(mk, mid); mk.appendChild(mid);
    marks.push(mk);
  }
  return marks;
}

/** Replaces the marks by their text again. */
export function unwrapMarks(marks) {
  for (const mk of marks) {
    const parent = mk.parentNode; if (!parent) continue;
    while (mk.firstChild) parent.insertBefore(mk.firstChild, mk);
    parent.removeChild(mk); parent.normalize();
  }
}

/**
 * Draws the saved highlights into the page the way the website's highlighter finds them: by their text AND the text around it
 * (anchor.js), so a sentence that occurs twice is marked at the occurrence that was highlighted. The full text first, the
 * summary for what is not in it. Every place is resolved before anything is changed (wrapping splits the text nodes the index
 * points at). → how many were placed. `annotations[n]` becomes data-hl-n on its marks.
 */
export function paintAll(roots, annotations) {
  const idxs = roots.filter(Boolean).map((r) => ancBuildIndex(r));
  const found = [];
  annotations.forEach((ann, n) => {
    if (!ann || ann.dismissed) return;
    // no pos: it is a place in the website's text, this page's text differs (it adds headings)
    const sel = ann.quote ? { exact: ann.quote.exact, prefix: ann.quote.prefix, suffix: ann.quote.suffix, text: ann.text } : { text: ann.text };
    for (const idx of idxs) {
      const hit = ancResolve(idx, sel);
      const range = hit && ancToRange(idx, hit.start, hit.end);
      if (range) { found.push({ n, ann, range }); return; }
    }
  });
  let placed = 0;
  for (const { n, ann, range } of found) {
    const attrs = { 'data-hl-n': String(n), 'data-hl-type': ann.type === 'ghost' ? 'ghost' : 'user' };
    if (ann.id) attrs['data-hl-id'] = ann.id;
    if (wrapRange(range, attrs).length) placed++;
  }
  return placed;
}

/**
 * store: createHighlightStore(...) · annotations: the array the page was marked with (index n = data-hl-n on its marks)
 * tell: (message) → void, sends to the worker · page: the article's url
 */
export function createReaderHighlights({ store, annotations, page, tell = () => {} }) {
  const key = pageKeyForUrl(page);
  const marksOf = (root, n) => [...root.querySelectorAll(`mark[data-hl-n="${n}"]`)];
  return {
    /** Highlights `range` (inside `root`). → the new annotation, or null when the text cannot be anchored. */
    async add(root, range) {
      const sel = ancMakeSelector(ancBuildIndex(root), range);
      if (!sel) return null;
      // pos is a place in this page's text, the website's text differs (the reader adds a heading): the quote and its context anchor it
      const ann = { id: newId(), url: page, text: sel.exact, type: 'user', timestamp: new Date().toISOString(), v: 2, quote: { exact: sel.exact, prefix: sel.prefix, suffix: sel.suffix } };
      const marks = wrapRange(range, { 'data-hl-n': String(annotations.length), 'data-hl-id': ann.id, 'data-hl-type': 'user' });
      if (!marks.length) return null;
      annotations.push(ann);
      try { await store.apply([{ op: 'add', hl: ann }]); } catch (e) { unwrapMarks(marks); annotations.pop(); throw e; }
      return ann;
    },
    /** Removes highlight number n (user) or dismisses it (AI). */
    /** root: any element or the document that holds the marks. */
    async remove(root, n) {
      const ann = annotations[n]; if (!ann || ann._gone) return false;
      const ghost = ann.type === 'ghost';
      const op = ghost && ann.id ? { op: 'dismiss', page: key, id: ann.id }
        : ann.id ? { op: 'remove', page: key, id: ann.id }
          : { op: 'removeText', page: key, text: ann.text, type: ghost ? 'ghost' : 'user' };
      await store.apply([op]);
      if (!ghost && ann.id) tell({ action: 'syncHlDeleted', ids: [ann.id] });
      ann._gone = true; unwrapMarks(marksOf(root, n));
      return true;
    },
  };
}
