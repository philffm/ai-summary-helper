// content/anchor.js
// Text anchoring for highlights: a highlight is identified by exact text PLUS
// the text around it (and a rough position), searched only inside the article.
// Pure DOM helpers — no storage, no chrome.* — so they are unit-testable in jsdom.
// NOTE: the content bundler inlines every module into one scope: keep names
// unique (everything here is prefixed `anc`).

const ANC_CONTEXT = 32;
const ANC_SKIP = [
  'script', 'style', 'noscript', 'nav', 'header', 'footer', 'aside', 'form',
  '[role="navigation"]', '[role="banner"]', '[role="contentinfo"]',
  '#comments', '.comments', '[data-aish-ui]', '#ai-summary-hybrid-sidebar', '[id^="aish-"]', '[id^="ai-summary"]'
].join(',');
const ANC_BLOCK = 'p,div,li,ul,ol,h1,h2,h3,h4,h5,h6,blockquote,td,th,tr,section,article,pre,figcaption,dd,dt,br';

/**
 * The element matching `selector` that holds the story. Same as `querySelector` (first in DOM order) in every
 * ordinary case; it only deviates when that first match is not the story: a sign-in popup, cookie banner or teaser
 * that precedes the real article. Then the first match containing the page's <h1> wins. Matches inside dialogs/modals
 * are ignored. Returns null when nothing matches.
 */
export function ancLargestMatch(doc, selector) {
  const all = [...doc.querySelectorAll(selector)]
    .filter(el => !el.closest('[role="dialog"],[role="alertdialog"],[aria-modal="true"],dialog'));
  const first = all[0] || null;
  if (!first || first.querySelector('h1')) return first;
  return all.find(el => el.querySelector('h1')) || first;
}

/** Article, else [role=main], else main: first non-empty tier wins (a <main> wrapping the <article> must not beat it). */
export function ancArticleRoot(doc) {
  return ancLargestMatch(doc, 'article') || ancLargestMatch(doc, '[role="main"]') || ancLargestMatch(doc, 'main');
}

/** The article body: same candidates the extractor uses, falling back to <body>. */
export function ancScopeRoot(doc = document) {
  return doc.querySelector('#storytext') || ancArticleRoot(doc) || doc.body;
}

// One normalised character per source character (or none): curly quotes → straight,
// nbsp → space, zero-width removed; whitespace runs collapse to one space.
function ancChar(c) {
  if (c === '‘' || c === '’') return "'";
  if (c === '“' || c === '”') return '"';
  if (c === ' ') return ' ';
  if (c === '​' || c === '‌' || c === '‍' || c === '﻿') return '';
  return c;
}
export function ancNormalize(s) {
  let out = '';
  for (const raw of String(s || '')) {
    const c = ancChar(raw);
    if (!c) continue;
    if (/\s/.test(c)) { if (out && out[out.length - 1] !== ' ') out += ' '; } else out += c;
  }
  return out.trim();
}

/**
 * Normalised text of `root` with a map back to DOM positions.
 * Returns { root, text, entries[], byNode: Map }. entries: { node, nStart, nEnd, offs:Int32Array }
 */
export function ancBuildIndex(root) {
  const doc = root.ownerDocument || document;
  const walker = doc.createTreeWalker(root, 4 /* SHOW_TEXT */, {
    acceptNode(node) {
      if (!node.nodeValue || !node.nodeValue.trim()) return 2; // REJECT
      const parent = node.parentElement;
      if (!parent) return 2;
      const hit = parent.closest(ANC_SKIP);
      if (hit && hit !== root && root.contains(hit)) return 2;
      return 1;
    }
  });
  const entries = []; const byNode = new Map();
  let text = ''; let prevBlock = null; let n;
  while ((n = walker.nextNode())) {
    const block = n.parentElement.closest(ANC_BLOCK);
    if (text && text[text.length - 1] !== ' ' && block !== prevBlock) text += ' '; // virtual separator between blocks
    prevBlock = block;
    const raw = n.nodeValue;
    const offs = []; const nStart = text.length;
    for (let i = 0; i < raw.length; i++) {
      const c = ancChar(raw[i]);
      if (!c) continue;
      if (/\s/.test(c)) { if (!text.length || text[text.length - 1] === ' ') continue; text += ' '; } else text += c;
      offs.push(i);
    }
    if (offs.length) { const e = { node: n, nStart, nEnd: text.length, offs: Int32Array.from(offs) }; entries.push(e); byNode.set(n, e); }
  }
  return { root, text, entries, byNode };
}

// Normalised index for a DOM boundary point (container, offset).
function ancToNorm(idx, container, offset, isEnd) {
  const e = container.nodeType === 3 ? idx.byNode.get(container) : null;
  if (e) {
    // first normalised char whose raw offset >= offset
    let lo = 0, hi = e.offs.length;
    while (lo < hi) { const m = (lo + hi) >> 1; if (e.offs[m] < offset) lo = m + 1; else hi = m; }
    return e.nStart + lo;
  }
  // Element boundary or a node outside the index: compare against every indexed node.
  const doc = container.ownerDocument || document;
  const probe = doc.createRange();
  probe.setStart(container, offset); probe.collapse(true);
  if (isEnd) {
    let last = 0;
    for (const en of idx.entries) { if (probe.comparePoint(en.node, 0) <= 0) last = en.nEnd; else break; }
    return last;
  }
  for (const en of idx.entries) { if (probe.comparePoint(en.node, 0) >= 0) return en.nStart; }
  return idx.text.length;
}

/** Selector for a Range: exact text + 32 chars before/after + rough position. */
export function ancMakeSelector(idx, range) {
  const s = ancToNorm(idx, range.startContainer, range.startOffset, false);
  const e = Math.max(s, ancToNorm(idx, range.endContainer, range.endOffset, true));
  const exact = idx.text.slice(s, e).trim();
  if (!exact) return null;
  const lead = idx.text.slice(s, e).indexOf(exact);
  const st = s + Math.max(0, lead);
  return {
    exact,
    prefix: idx.text.slice(Math.max(0, st - ANC_CONTEXT), st),
    suffix: idx.text.slice(st + exact.length, st + exact.length + ANC_CONTEXT),
    pos: st
  };
}

function ancCommonSuffix(a, b) { let i = 0; while (i < a.length && i < b.length && a[a.length - 1 - i] === b[b.length - 1 - i]) i++; return i; }
function ancCommonPrefix(a, b) { let i = 0; while (i < a.length && i < b.length && a[i] === b[i]) i++; return i; }

/** All places where `exact` occurs (normalised, case-sensitive first, then case-insensitive). */
export function ancOccurrences(idx, exact) {
  const out = [];
  const find = (hay, needle) => { let i = hay.indexOf(needle); while (i !== -1 && out.length < 500) { out.push(i); i = hay.indexOf(needle, i + 1); } };
  find(idx.text, exact);
  if (!out.length) find(idx.text.toLowerCase(), exact.toLowerCase());
  return out;
}

/**
 * Find the one place a highlight belongs. Returns { start, end, ambiguous } or null (lost).
 * sel: { exact, prefix?, suffix?, pos? } — prefix/suffix absent for legacy text-only highlights.
 */
export function ancResolve(idx, sel) {
  const exact = ancNormalize(sel.exact || sel.text);
  if (!exact) return null;
  const occ = ancOccurrences(idx, exact);
  if (!occ.length) return null;
  const prefix = sel.prefix || '', suffix = sel.suffix || '';
  const hasCtx = !!(prefix || suffix);
  if (occ.length === 1) return { start: occ[0], end: occ[0] + exact.length, ambiguous: false };
  let best = occ[0], bestScore = -1;
  for (const i of occ) {
    let score = 0;
    if (prefix) score += ancCommonSuffix(idx.text.slice(Math.max(0, i - prefix.length), i), prefix) / prefix.length;
    if (suffix) score += ancCommonPrefix(idx.text.slice(i + exact.length, i + exact.length + suffix.length), suffix) / suffix.length;
    if (typeof sel.pos === 'number') score += 0.2 / (1 + Math.abs(i - sel.pos) / 200);
    if (score > bestScore) { bestScore = score; best = i; }
  }
  return { start: best, end: best + exact.length, ambiguous: !hasCtx };
}

/** Normalised [start,end) → DOM Range (skips virtual separators). */
export function ancToRange(idx, start, end) {
  if (!idx.entries.length || end <= start) return null;
  const find = (pos, fwd) => {
    for (const e of idx.entries) {
      if (pos >= e.nStart && pos < e.nEnd) return { e, i: pos - e.nStart };
      if (fwd && e.nStart >= pos) return { e, i: 0 };
    }
    return null;
  };
  const a = find(start, true);
  let b = find(end - 1, false);
  if (!b) { for (let k = idx.entries.length - 1; k >= 0; k--) { const e = idx.entries[k]; if (e.nEnd <= end) { b = { e, i: e.nEnd - e.nStart - 1 }; break; } } }
  if (!a || !b) return null;
  const doc = idx.root.ownerDocument || document;
  const r = doc.createRange();
  r.setStart(a.e.node, a.e.offs[a.i]);
  r.setEnd(b.e.node, b.e.offs[b.i] + 1);
  return r.collapsed ? null : r;
}

/** AI quotes: long enough and unique in the article, otherwise dropped. */
export function ancQuoteUsable(idx, quote, minWords = 8) {
  const exact = ancNormalize(quote);
  if (exact.length < 5) return null;
  const occ = ancOccurrences(idx, exact);
  if (!occ.length) return null;
  if (occ.length > 1 && exact.split(' ').length < minWords) return null;
  return exact;
}
