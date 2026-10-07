import { SK } from '../modules/storageKeys.js';
// content/highlighter.js
// Text highlighting & annotation persistence for the content script.
//
// A highlight is anchored by exact text + surrounding text (see anchor.js) and
// searched only inside the article. Where supported it is painted with the CSS
// Custom Highlight API (no DOM changes); otherwise it falls back to <mark>.

import { ancScopeRoot, ancBuildIndex, ancMakeSelector, ancResolve, ancToRange, ancQuoteUsable, ancNormalize } from './anchor.js';
import { hlpRender } from './highlightPanel.js';
import { pageKeyForUrl, isNoisePage } from '../modules/pageKey.js';

// ── Shared state (module scope, inlined into the content IIFE by the bundler) ──
let annotationObserver = null;
let annotationUrlWatcher = null;
let storageChangeListenerAttached = false;
let restoreTimer = null;
let restoreScheduledAt = 0;
const RESTORE_MAX_WAIT_MS = 1000;

// Cached settings (set by the orchestrator)
let userHighlightingEnabled = true;
let aiHighlightingEnabled = true;

export function setHighlightingEnabled(user, ai) {
  userHighlightingEnabled = user;
  aiHighlightingEnabled = ai;
}

export function isAnyHighlightingEnabled() {
  return (userHighlightingEnabled || aiHighlightingEnabled) && !isHighlightingSuppressed();
}

// Stable per-page key: origin + pathname (+ content-identifying params such as LinkedIn's currentJobId).
function getPageKey() {
  return pageKeyForUrl(window.location.href);
}

// Sites the user switched the highlights UI off for (sync storage), plus built-in feed-like pages.
let hlExcludedHosts = [];
try {
  chrome.storage.sync.get(['highlightExcludedSites'], (r) => { hlExcludedHosts = Array.isArray(r && r.highlightExcludedSites) ? r.highlightExcludedSites : []; });
  chrome.storage.onChanged.addListener((ch, area) => {
    if (area === 'sync' && ch.highlightExcludedSites) {
      hlExcludedHosts = Array.isArray(ch.highlightExcludedSites.newValue) ? ch.highlightExcludedSites.newValue : [];
      scheduleRestoreAnnotations(60);
    }
  });
} catch (e) { /* context gone */ }
export function isHighlightingSuppressed() { return isNoisePage(window.location.href, hlExcludedHosts); }
let lastObservedUrl = getPageKey();

// Live registry: annotation id → { ann, range, status: 'ok'|'ambiguous'|'lost', marks: [] }
const hlLive = new Map();
const HL_NATIVE = typeof CSS !== 'undefined' && CSS.highlights && typeof Highlight !== 'undefined';
const hlSets = { user: null, ghost: null };
let hlReattachId = null;

function hlNewId() { return 'hl_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8); }

function hlEnsureStyles() {
  if (document.getElementById('aish-hl-styles')) return;
  const st = document.createElement('style');
  st.id = 'aish-hl-styles';
  st.textContent = `
    ::highlight(aish-user) { background-color: #fef08a; color: #1f2937; }
    ::highlight(aish-ghost) { background-color: rgba(186,230,253,0.65); color: #0369a1; text-decoration: underline dashed #0284c7; }
    ::highlight(aish-flash) { background-color: #fde047; color: #1f2937; }
    .aish-hl-flash { outline: 3px solid #fde047 !important; }
  `;
  document.documentElement.appendChild(st);
}

function hlSetFor(type) {
  if (!hlSets[type]) {
    hlSets[type] = new Highlight();
    CSS.highlights.set(type === 'ghost' ? 'aish-ghost' : 'aish-user', hlSets[type]);
  }
  return hlSets[type];
}

// ── Painting ─────────────────────────────────────────────────────────────────

function hlPaint(entry) {
  if (!entry.range) return;
  hlEnsureStyles();
  if (HL_NATIVE) { hlSetFor(entry.ann.type).add(entry.range); return; }
  const isGhost = entry.ann.type === 'ghost';
  const { marks } = wrapRangeAcrossNodes(entry.range, () => {
    const mark = document.createElement('mark');
    if (isGhost) {
      mark.className = 'ai-ghost-highlight';
      mark.title = 'AI highlight — click to keep or dismiss';
      mark.style.cssText = 'background-color:rgba(186,230,253,0.65);color:#0369a1;border-bottom:2px dashed #0284c7;border-radius:2px;padding:0 2px;cursor:pointer;';
    } else {
      mark.className = 'ai-user-highlight';
      mark.title = 'Click to remove highlight';
      mark.style.cssText = 'background-color:#fef08a;color:#1f2937;border-radius:2px;padding:0 2px;cursor:pointer;';
    }
    return mark;
  });
  marks.forEach(m => { m.dataset.hlId = entry.ann.id; m.dataset.annotationText = entry.ann.text; });
  entry.marks = marks;
}

function hlUnpaint(entry) {
  if (HL_NATIVE) {
    if (entry.range && hlSets[entry.ann.type]) hlSets[entry.ann.type].delete(entry.range);
    return;
  }
  (entry.marks || []).forEach(el => {
    const parent = el.parentNode;
    if (!parent) return;
    while (el.firstChild) parent.insertBefore(el.firstChild, el);
    parent.removeChild(el);
    parent.normalize();
  });
  entry.marks = [];
}

function hlRangeAlive(entry) {
  if (!entry.range) return false;
  if (HL_NATIVE) return !entry.range.collapsed && entry.range.startContainer.isConnected;
  return (entry.marks || []).length > 0 && entry.marks.every(m => m.isConnected);
}

export function clearHighlightElements() {
  clearHighlightElementsByType('user');
  clearHighlightElementsByType('ghost');
}

export function clearHighlightElementsByType(type) {
  for (const [id, entry] of [...hlLive]) {
    if (entry.ann.type !== type) continue;
    hlUnpaint(entry);
    hlLive.delete(id);
  }
  if (HL_NATIVE && hlSets[type]) hlSets[type].clear();
  // Anything left over from an older content script instance
  const selector = type === 'ghost' ? '.ai-ghost-highlight' : '.ai-user-highlight';
  document.querySelectorAll(selector).forEach(el => {
    const parent = el.parentNode;
    if (!parent) return;
    while (el.firstChild) parent.insertBefore(el.firstChild, el);
    parent.removeChild(el);
  });
  hlRefreshPanel();
}

// ── Annotation storage (one array for all pages, see storage-schema notes) ──

/** Save (or find) an annotation; returns the stored record. */
export function saveAnnotationToStorage(text, type = 'user', meta = {}) {
  const currentUrl = getPageKey();
  const compactText = (text || '').replace(/\s+/g, ' ').trim();
  if (!compactText) return null;
  const ann = {
    id: meta.id || hlNewId(), url: currentUrl, text: compactText, type,
    timestamp: new Date().toISOString(), v: meta.quote ? 2 : 1,
    ...(meta.quote ? { quote: meta.quote } : {}), ...(typeof meta.pos === 'number' ? { pos: meta.pos } : {})
  };
  getNormalizedAnnotations((annotations) => {
    // Same text in a different place is a different highlight: compare the context too.
    const exists = annotations.some(a => a.url === currentUrl && a.text === compactText && a.type === type &&
      (a.quote ? a.quote.prefix === (meta.quote && meta.quote.prefix) && a.quote.suffix === (meta.quote && meta.quote.suffix) : !meta.quote));
    if (exists) return;
    annotations.push(ann);
    chrome.storage.local.set({ [SK.annotations]: annotations });
  });
  return ann;
}

function hlPatchAnnotation(id, patch) {
  getNormalizedAnnotations((annotations) => {
    const a = annotations.find(x => x.id === id);
    if (!a) return;
    Object.assign(a, patch);
    chrome.storage.local.set({ [SK.annotations]: annotations });
  });
}

/** Remove by id (a dismissed AI highlight is kept as `dismissed` so it never comes back). */
function hlRemoveFromStorage(id, { dismiss = false } = {}) {
  getNormalizedAnnotations((annotations) => {
    const next = dismiss
      ? annotations.map(a => (a.id === id ? { ...a, dismissed: true } : a))
      : annotations.filter(a => a.id !== id);
    chrome.storage.local.set({ [SK.annotations]: next });
  });
}

/** Legacy text-based removal (kept for callers that only know the text). */
export function removeAnnotationFromStorage(text, type = 'user') {
  getNormalizedAnnotations((annotations) => {
    const currentUrl = getPageKey();
    const compactText = (text || '').replace(/\s+/g, ' ').trim();
    if (!compactText) return;
    annotations = annotations.filter(a => !(a.url === currentUrl && a.text === compactText && a.type === type));
    chrome.storage.local.set({ [SK.annotations]: annotations });
  });
}

function normalizeAnnotationEntries(rawAnnotations) {
  if (Array.isArray(rawAnnotations)) {
    return rawAnnotations
      .filter(a => a && typeof a === 'object')
      .map(a => {
        const url = typeof a.url === 'string' ? a.url.split('#')[0].split('?')[0] : '';
        const text = typeof a.text === 'string' ? a.text.replace(/\s+/g, ' ').trim() : '';
        const type = a.type === 'ghost' ? 'ghost' : 'user';
        const timestamp = typeof a.timestamp === 'string' ? a.timestamp : new Date().toISOString();
        const extra = {};
        if (typeof a.id === 'string') extra.id = a.id;
        if (a.quote && typeof a.quote.exact === 'string') extra.quote = { exact: a.quote.exact, prefix: a.quote.prefix || '', suffix: a.quote.suffix || '' };
        if (typeof a.pos === 'number') extra.pos = a.pos;
        if (a.v) extra.v = a.v;
        if (a.dismissed) extra.dismissed = true;
        return { url, text, type, timestamp, ...extra };
      })
      .filter(a => a.url && a.text);
  }

  if (!rawAnnotations || typeof rawAnnotations !== 'object') return [];

  const migrated = [];
  for (const [urlKey, value] of Object.entries(rawAnnotations)) {
    const url = (urlKey || '').split('#')[0].split('?')[0];
    if (!url || !value) continue;

    if (Array.isArray(value)) {
      value.forEach(item => {
        if (typeof item === 'string') {
          const text = item.replace(/\s+/g, ' ').trim();
          if (text) migrated.push({ url, text, type: 'user', timestamp: new Date().toISOString() });
        } else if (item && typeof item === 'object') {
          const text = typeof item.text === 'string' ? item.text.replace(/\s+/g, ' ').trim() : '';
          if (!text) return;
          migrated.push({
            url,
            text,
            type: item.type === 'ghost' ? 'ghost' : 'user',
            timestamp: typeof item.timestamp === 'string' ? item.timestamp : new Date().toISOString()
          });
        }
      });
      continue;
    }

    if (value && typeof value === 'object') {
      const users = Array.isArray(value.user) ? value.user : [];
      const ghosts = Array.isArray(value.ghost) ? value.ghost : [];

      users.forEach(t => {
        if (typeof t !== 'string') return;
        const text = t.replace(/\s+/g, ' ').trim();
        if (text) migrated.push({ url, text, type: 'user', timestamp: new Date().toISOString() });
      });

      ghosts.forEach(t => {
        if (typeof t !== 'string') return;
        const text = t.replace(/\s+/g, ' ').trim();
        if (text) migrated.push({ url, text, type: 'ghost', timestamp: new Date().toISOString() });
      });
    }
  }

  return migrated;
}

// Returns false once the extension has been reloaded/updated, which
// invalidates chrome.runtime for every content script still injected in
// already-open tabs. From that point on any chrome.* call throws
// synchronously, so long-lived loops must self-tear-down instead of
// hammering a dead API forever.
function isExtensionContextValid() {
  try {
    return !!(chrome && chrome.runtime && chrome.runtime.id);
  } catch (e) {
    return false;
  }
}

function getNormalizedAnnotations(callback) {
  if (!isExtensionContextValid()) return; // silently no-op, don't throw
  try {
    chrome.storage.local.get([SK.annotations], (res) => {
      const normalized = normalizeAnnotationEntries(res[SK.annotations]);
      const existing = Array.isArray(res[SK.annotations]) ? res[SK.annotations] : [];
      const shouldWriteBack = !Array.isArray(res[SK.annotations])
        || JSON.stringify(existing) !== JSON.stringify(normalized);

      if (shouldWriteBack) {
        chrome.storage.local.set({ [SK.annotations]: normalized }, () => callback(normalized));
        return;
      }

      callback(normalized);
    });
  } catch (e) {
    return; // context died between the check and the call
  }
}

function isOwnHighlightMutation(mutations) {
  return mutations.every(m => {
    const nodes = [...m.addedNodes, ...m.removedNodes];
    if (m.type === 'characterData') return false; // text edits are never ours
    if (m.target && m.target.closest && m.target.closest('#aish-hl-host')) return true;
    return nodes.every(n =>
      n.nodeType === Node.ELEMENT_NODE &&
      (n.classList?.contains('ai-user-highlight') || n.classList?.contains('ai-ghost-highlight') ||
       n.id === 'ai-highlight-tooltip' || n.id === 'ai-ghost-menu' || n.id === 'aish-hl-host' || n.id === 'aish-hl-styles')
    );
  });
}

export function startAnnotationWatchers() {
  if (!annotationObserver && document.documentElement) {
    annotationObserver = new MutationObserver((mutations) => {
      if (!isExtensionContextValid()) { annotationObserver.disconnect(); return; }
      if (isOwnHighlightMutation(mutations)) return;
      scheduleRestoreAnnotations(220);
    });

    annotationObserver.observe(document.documentElement, {
      childList: true,
      subtree: true,
      characterData: true
    });
  }

  if (!annotationUrlWatcher) {
    annotationUrlWatcher = window.setInterval(() => {
      if (!isExtensionContextValid()) {
        clearInterval(annotationUrlWatcher);
        annotationUrlWatcher = null;
        if (annotationObserver) { annotationObserver.disconnect(); annotationObserver = null; }
        return;
      }
      const currentUrl = getPageKey();
      if (currentUrl !== lastObservedUrl) {
        lastObservedUrl = currentUrl;
        clearHighlightElements();
        scheduleRestoreAnnotations(120);
      }
    }, 700);
  }

  if (!storageChangeListenerAttached) {
    storageChangeListenerAttached = true;
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === 'local' && SK.annotations in changes && isAnyHighlightingEnabled()) {
        scheduleRestoreAnnotations(80);
      }
    });
  }
}


// ── Restore ──────────────────────────────────────────────────────────────────

export function restoreAnnotations() {
  if (isHighlightingSuppressed()) { clearHighlightElements(); hlpRender([], {}); return; }
  if (!isAnyHighlightingEnabled()) return;
  getNormalizedAnnotations((annotations) => {
    const currentUrl = getPageKey();
    const pageAnnotations = annotations.filter(a => {
      if (a.url !== currentUrl || a.dismissed) return false;
      if (a.type === 'ghost') return aiHighlightingEnabled;
      return userHighlightingEnabled;
    });

    // Highlights deleted elsewhere (popup, other tab) disappear here too.
    const ids = new Set(pageAnnotations.map(a => a.id).filter(Boolean));
    for (const [id, entry] of [...hlLive]) {
      if (!ids.has(id) && !String(id).startsWith('legacy_')) { hlUnpaint(entry); hlLive.delete(id); }
    }
    if (!pageAnnotations.length) { hlRefreshPanel(); return; }

    // Resolving walks the article text; defer to idle time so it never competes
    // with painting or scrolling on large pages.
    const run = () => hlResolveAll(pageAnnotations, annotations);
    if (typeof requestIdleCallback === 'function') requestIdleCallback(run, { timeout: 2000 });
    else setTimeout(run, 0);
  });
}

function hlResolveAll(pageAnnotations, allAnnotations) {
  let idx = null, bodyIdx = null, upgraded = false;
  const getIdx = (wide) => {
    if (wide) return bodyIdx || (bodyIdx = ancBuildIndex(document.body));
    return idx || (idx = ancBuildIndex(ancScopeRoot()));
  };
  pageAnnotations.forEach(ann => {
    if (!ann.id) { ann.id = 'legacy_' + hlNewId(); ann._legacy = true; }
    let entry = hlLive.get(ann.id);
    if (entry && hlRangeAlive(entry) && entry.status !== 'lost') return;   // still painted
    if (entry) hlUnpaint(entry);
    const sel = ann.quote ? { ...ann.quote, pos: ann.pos, text: ann.text } : { text: ann.text };
    let res = ancResolve(getIdx(false), sel), usedIdx = getIdx(false);
    if (!res && ancScopeRoot() !== document.body) { usedIdx = getIdx(true); res = ancResolve(usedIdx, sel); }
    entry = { ann, range: null, status: 'lost', marks: [] };
    if (res) {
      entry.range = ancToRange(usedIdx, res.start, res.end);
      entry.status = entry.range ? (res.ambiguous ? 'ambiguous' : 'ok') : 'lost';
    }
    hlLive.set(ann.id, entry);
    if (entry.range) {
      // Upgrade a text-only highlight with its surrounding text, once, so it
      // keeps pointing at THIS occurrence from now on.
      if (!ann.quote) {
        const q = ancMakeSelector(usedIdx, entry.range);
        if (q) { ann.quote = { exact: q.exact, prefix: q.prefix, suffix: q.suffix }; ann.pos = q.pos; ann.v = 2; upgraded = true; }
      }
      hlPaint(entry);
    }
  });
  if (upgraded) {
    const byKey = new Map(pageAnnotations.map(a => [a.text + '|' + a.type, a]));
    const next = allAnnotations.map(a => {
      const u = a.url === getPageKey() ? byKey.get(a.text + '|' + a.type) : null;
      if (!u || !u.quote) return a;
      const { _legacy, ...clean } = u;
      if (_legacy) clean.id = clean.id.replace(/^legacy_/, '');
      return { ...a, ...clean };
    });
    chrome.storage.local.set({ [SK.annotations]: next });
  }
  hlRefreshPanel();
}

export function scheduleRestoreAnnotations(delay = 160) {
  if (!isAnyHighlightingEnabled()) return;

  const now = Date.now();
  if (!restoreTimer) restoreScheduledAt = now;

  // If we've already been waiting for RESTORE_MAX_WAIT_MS, stop pushing the
  // timer back — run on the next tick regardless of new mutations.
  const elapsed = now - restoreScheduledAt;
  const effectiveDelay = elapsed >= RESTORE_MAX_WAIT_MS ? 0 : delay;

  if (restoreTimer) clearTimeout(restoreTimer);
  restoreTimer = setTimeout(() => {
    restoreTimer = null;
    restoreScheduledAt = 0;
    restoreAnnotations();
  }, effectiveDelay);
}

// ── 1. Selecting text ────────────────────────────────────────────────────────

export function handleTextSelection(event) {
  if (!userHighlightingEnabled || isHighlightingSuppressed()) return;
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) return;

  const selectedRange = selection.getRangeAt(0).cloneRange();
  const selectedText = selectedRange.toString().trim();
  if (!selectedText || selectedText.length < 3) return;

  const anchorNode = selection.anchorNode;
  if (anchorNode && anchorNode.parentElement &&
     (anchorNode.parentElement.closest('#ai-summary-hybrid-sidebar, #aish-hl-host') ||
      ['INPUT', 'TEXTAREA'].includes(anchorNode.parentElement.tagName))) return;

  const reattach = hlReattachId;
  showHighlightTooltip(event.pageX, event.pageY, () => {
    if (reattach && hlLive.has(reattach)) hlReattach(reattach, selectedRange);
    else applyHighlightFromRange(selectedRange, selectedText);
    hlReattachId = null;
    selection.removeAllRanges();
  }, reattach ? '🔗 Attach here' : '✏️ Highlight');
}

function hlIndexFor(range) {
  const root = ancScopeRoot();
  const base = root.contains(range.commonAncestorContainer) ? root : document.body;
  return ancBuildIndex(base);
}

export function applyHighlightFromRange(range, text) {
  if (!range || range.collapsed) return null;
  const idx = hlIndexFor(range);
  const sel = ancMakeSelector(idx, range);
  if (!sel) return null;
  const ann = saveAnnotationToStorage(sel.exact || text, 'user', { quote: { exact: sel.exact, prefix: sel.prefix, suffix: sel.suffix }, pos: sel.pos });
  if (!ann) return null;
  const entry = { ann, range: range.cloneRange(), status: 'ok', marks: [] };
  hlLive.set(ann.id, entry);
  hlPaint(entry);
  hlRefreshPanel();
  return ann;
}

/** Context-menu highlight: use the live selection when it matches, else the first match in the article. */
export function highlightFromSelectionOrText(text) {
  const clean = ancNormalize(text);
  if (!clean) return null;
  const sel = window.getSelection();
  if (sel && sel.rangeCount && ancNormalize(sel.toString()) === clean) return applyHighlightFromRange(sel.getRangeAt(0).cloneRange(), clean);
  const idx = ancBuildIndex(ancScopeRoot());
  const res = ancResolve(idx, { text: clean });
  const range = res && ancToRange(idx, res.start, res.end);
  return range ? applyHighlightFromRange(range, clean) : null;
}

// Compatibility shim: callers that only have text (first match in the article).
export function highlightTextOnPage(element, text, isGhost) {
  if (isGhost) return applyGhostHighlights([text]);
  return highlightFromSelectionOrText(text);
}

function hlReattach(id, range) {
  const entry = hlLive.get(id);
  if (!entry) return;
  const idx = hlIndexFor(range);
  const sel = ancMakeSelector(idx, range);
  if (!sel) return;
  hlUnpaint(entry);
  entry.ann = { ...entry.ann, text: sel.exact, quote: { exact: sel.exact, prefix: sel.prefix, suffix: sel.suffix }, pos: sel.pos, v: 2 };
  entry.range = range.cloneRange(); entry.status = 'ok';
  hlPatchAnnotation(id, { text: sel.exact, quote: entry.ann.quote, pos: sel.pos, v: 2 });
  hlPaint(entry);
  hlRefreshPanel();
}

function showHighlightTooltip(x, y, onClick, label = '✏️ Highlight') {
  let tooltip = document.getElementById('ai-highlight-tooltip');
  if (!tooltip) {
    tooltip = document.createElement('button');
    tooltip.id = 'ai-highlight-tooltip';
    tooltip.innerHTML = '✏️ Highlight';
    tooltip.style.cssText = `
      position: absolute; z-index: 2147483646;
      background: #fef08a; color: #854d0e;
      border: 1px solid #fde047; border-radius: 6px;
      padding: 4px 10px; font-size: 12px; font-weight: bold;
      cursor: pointer; box-shadow: 0 4px 12px rgba(0,0,0,0.15);
      transition: transform 0.1s ease;
    `;
    document.body.appendChild(tooltip);
  }
  tooltip.innerHTML = label;
  tooltip.style.left = `${x + 5}px`;
  tooltip.style.top  = `${y - 35}px`;
  tooltip.style.display = 'block';

  tooltip.addEventListener('click', (e) => {
    e.preventDefault(); e.stopPropagation();
    onClick();
    tooltip.style.display = 'none';
  }, { once: true });

  setTimeout(() => {
    document.addEventListener('click', function hideTooltip() {
      if (tooltip) tooltip.style.display = 'none';
      document.removeEventListener('click', hideTooltip);
    }, { once: true });
  }, 100);
}

function generateHighlightGroupId() {
  return 'hl_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
}

// Wraps a Range that may span multiple block-level elements by wrapping each
// intersecting text node individually (splitting partial nodes at the
// boundary as needed), instead of surroundContents()-ing the whole range at
// once. range.surroundContents() throws InvalidStateError whenever the range
// partially contains a non-Text node — i.e. any selection spanning more than
// one paragraph/list item/block. Wrapping per text node is always confined
// to a single node, so the restriction never applies, no matter how many
// blocks the highlight visually spans. CSS makes the fragments look like one
// continuous highlight.
function wrapRangeAcrossNodes(range, createMark) {
  const groupId = generateHighlightGroupId();
  const root = range.commonAncestorContainer;
  const walker = document.createTreeWalker(
    root.nodeType === Node.TEXT_NODE ? root.parentNode : root,
    NodeFilter.SHOW_TEXT,
    { acceptNode: (node) => range.intersectsNode(node) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT }
  );

  // Collect nodes fully before mutating anything — splitting/wrapping while
  // the walker is mid-traversal would disrupt it.
  const textNodes = [];
  let n;
  while ((n = walker.nextNode())) textNodes.push(n);

  const marks = [];
  for (const node of textNodes) {
    const parent = node.parentElement;
    if (parent && parent.closest('script, style, noscript')) continue;

    let start = node === range.startContainer ? range.startOffset : 0;
    let end = node === range.endContainer ? range.endOffset : node.nodeValue.length;
    if (start >= end) continue;

    // Isolate exactly the intersecting substring as its own text node.
    let target = node;
    if (end < target.nodeValue.length) target.splitText(end);
    if (start > 0) target = target.splitText(start);

    const nodeRange = document.createRange();
    nodeRange.selectNode(target);

    const mark = createMark();
    mark.dataset.highlightGroup = groupId; // ties fragments of one logical highlight together
    nodeRange.surroundContents(mark); // always safe — confined to one text node
    marks.push(mark);
  }

  return { groupId, marks };
}

// ── Clicking a highlight ─────────────────────────────────────────────────────

function hlEntryAt(event) {
  const mark = event.target && event.target.closest && event.target.closest('[data-hl-id]');
  if (mark) return hlLive.get(mark.dataset.hlId) || null;
  if (!HL_NATIVE) return null;
  const sel = window.getSelection();
  if (sel && !sel.isCollapsed) return null;               // a drag-select, not a click
  let node = null, offset = 0;
  if (document.caretPositionFromPoint) {
    const p = document.caretPositionFromPoint(event.clientX, event.clientY);
    if (p) { node = p.offsetNode; offset = p.offset; }
  } else if (document.caretRangeFromPoint) {
    const r = document.caretRangeFromPoint(event.clientX, event.clientY);
    if (r) { node = r.startContainer; offset = r.startOffset; }
  }
  if (!node) return null;
  for (const entry of hlLive.values()) {
    if (!entry.range) continue;
    try {
      if (entry.range.isPointInRange(node, offset)) {
        // the caret can land next to the text: confirm the pointer is inside a rect
        const inside = Array.from(entry.range.getClientRects()).some(r => event.clientX >= r.left - 1 && event.clientX <= r.right + 1 && event.clientY >= r.top - 1 && event.clientY <= r.bottom + 1);
        if (inside) return entry;
      }
    } catch (e) { /* range in another tree */ }
  }
  return null;
}

export function handleHighlightClick(event) {
  if (event.target && event.target.closest && event.target.closest('#aish-hl-host, #ai-ghost-menu')) return;
  const entry = hlEntryAt(event);
  if (!entry) return;
  event.preventDefault(); event.stopPropagation();
  hlShowMenu(event.pageX, event.pageY, entry);
}

// Kept for the content.js listener list; clicks are handled in one place now.
export function handleGhostHighlightClick() {}

function hlRemove(id, opts) {
  const entry = hlLive.get(id);
  if (entry) { hlUnpaint(entry); hlLive.delete(id); }
  hlRemoveFromStorage(id, opts);
  hlRefreshPanel();
}

function hlKeep(id) {
  const entry = hlLive.get(id);
  if (!entry) return;
  hlUnpaint(entry);
  entry.ann = { ...entry.ann, type: 'user' };
  hlPatchAnnotation(id, { type: 'user' });
  hlPaint(entry);
  hlRefreshPanel();
}

function hlShowMenu(x, y, entry) {
  let menu = document.getElementById('ai-ghost-menu');
  if (!menu) {
    menu = document.createElement('div');
    menu.id = 'ai-ghost-menu';
    menu.style.cssText = `
      position:absolute; z-index:2147483647;
      background:#fff; border:1px solid #e2e8f0;
      border-radius:8px; padding:6px;
      box-shadow:0 4px 16px rgba(0,0,0,0.15);
      display:flex; gap:6px; font-size:12px;
    `;
    document.body.appendChild(menu);
  }
  const ghost = entry.ann.type === 'ghost';
  menu.innerHTML = ghost
    ? `<button id="btn-convert-yellow" style="background:#fef08a;border:1px solid #fde047;color:#854d0e;padding:4px 8px;border-radius:4px;cursor:pointer;font-weight:bold;">⭐ Keep</button>
       <button id="btn-dismiss-ghost" style="background:#f1f5f9;border:1px solid #cbd5e1;color:#475569;padding:4px 8px;border-radius:4px;cursor:pointer;">✕ Dismiss</button>`
    : `<button id="btn-dismiss-ghost" style="background:#f1f5f9;border:1px solid #cbd5e1;color:#475569;padding:4px 8px;border-radius:4px;cursor:pointer;">🗑 Remove highlight</button>`;
  menu.style.left = `${x}px`;
  menu.style.top = `${y - 44}px`;
  menu.style.display = 'flex';
  const id = entry.ann.id;
  const keepBtn = document.getElementById('btn-convert-yellow');
  if (keepBtn) keepBtn.onclick = () => { hlKeep(id); menu.style.display = 'none'; };
  document.getElementById('btn-dismiss-ghost').onclick = () => { hlRemove(id, { dismiss: ghost }); menu.style.display = 'none'; };
  setTimeout(() => {
    document.addEventListener('click', function hideMenu() {
      if (menu) menu.style.display = 'none';
      document.removeEventListener('click', hideMenu);
    }, { once: true });
  }, 100);
}

// ── 2. AI highlights ─────────────────────────────────────────────────────────

export function applyGhostHighlights(quotes = []) {
  if (!aiHighlightingEnabled || !quotes || !quotes.length) return;
  const idx = ancBuildIndex(ancScopeRoot());
  getNormalizedAnnotations((annotations) => {
    const url = getPageKey();
    let added = false;
    quotes.forEach(quote => {
      const exact = ancQuoteUsable(idx, quote, 8);            // unique in the article, or long enough to be specific
      if (!exact) return;
      // already known (also when dismissed earlier): never re-create
      if (annotations.some(a => a.url === url && a.type === 'ghost' && a.text === exact)) return;
      const res = ancResolve(idx, { text: exact });
      const range = res && ancToRange(idx, res.start, res.end);
      if (!range) return;
      const q = ancMakeSelector(idx, range);
      const ann = { id: hlNewId(), url, text: exact, type: 'ghost', timestamp: new Date().toISOString(), v: 2,
        quote: { exact: q.exact, prefix: q.prefix, suffix: q.suffix }, pos: q.pos };
      annotations.push(ann); added = true;
      const entry = { ann, range, status: 'ok', marks: [] };
      hlLive.set(ann.id, entry);
      hlPaint(entry);
    });
    if (added) chrome.storage.local.set({ [SK.annotations]: annotations });
    hlRefreshPanel();
  });
}

/** Texts of the user's current highlights (used as high-priority context for the AI). */
export function getUserHighlightTexts() {
  const out = [];
  for (const e of hlLive.values()) {
    if (e.ann.type === 'user' && e.range) out.push(ancNormalize(e.range.toString()));
  }
  document.querySelectorAll('.ai-user-highlight').forEach(el => { const t = ancNormalize(el.textContent); if (t && !out.includes(t)) out.push(t); });
  return out.filter(Boolean);
}

// ── 3. Panel + scrollbar ticks ───────────────────────────────────────────────

let hlPanelTimer = null;
let hlSummarizeHandler = null;
/** content.js registers what the panel's “Summarize” does (the highlighter must not import the summary flow). */
export function setPageSummarizeHandler(fn) { hlSummarizeHandler = fn; }
function hlRefreshPanel() {
  clearTimeout(hlPanelTimer);
  hlPanelTimer = setTimeout(() => {
    const docH = Math.max(document.documentElement.scrollHeight, 1);
    if (isHighlightingSuppressed()) { hlpRender([], {}); return; }
    const seen = new Map();
    for (const e of hlLive.values()) {           // same quote saved several times: show one row (prefer one that is attached)
      const k = e.ann.type + '|' + e.ann.text;
      const cur = seen.get(k);
      if (!cur || (cur.status === 'lost' && e.status !== 'lost')) seen.set(k, e);
    }
    const items = [...seen.values()].map(e => {
      let frac = null;
      if (e.range && e.status !== 'lost') {
        try { const r = e.range.getBoundingClientRect(); frac = Math.min(1, Math.max(0, (r.top + window.scrollY) / docH)); } catch (err) { /* detached */ }
      }
      return { id: e.ann.id, type: e.ann.type, text: e.ann.text, status: e.status, frac };
    });
    // Nothing could be attached on this page (feed that changed, other content under the same URL): stay quiet.
    if (items.length && items.every(i => i.status === 'lost')) { hlpRender([], {}); return; }
    hlpRender(items, {
      hideSite: () => {
        const host = window.location.hostname.replace(/^www\./, '').toLowerCase();
        chrome.storage.sync.get(['highlightExcludedSites'], (r) => {
          const list = Array.isArray(r.highlightExcludedSites) ? r.highlightExcludedSites : [];
          if (!list.includes(host)) list.push(host);
          chrome.storage.sync.set({ highlightExcludedSites: list });
        });
      },
      summarize: () => (hlSummarizeHandler ? hlSummarizeHandler() : undefined),
      jump: hlJump, remove: (id) => hlRemove(id, { dismiss: hlLive.get(id)?.ann.type === 'ghost' }),
      keep: hlKeep, reattach: (id) => { hlReattachId = id; }, pending: () => hlReattachId
    });
  }, 120);
}

function hlJump(id) {
  const entry = hlLive.get(id);
  if (!entry || !entry.range) return;
  const el = entry.range.startContainer.parentElement;
  if (el && el.scrollIntoView) el.scrollIntoView({ block: 'center', behavior: 'smooth' });
  if (HL_NATIVE) {
    CSS.highlights.set('aish-flash', new Highlight(entry.range));
    setTimeout(() => CSS.highlights.delete('aish-flash'), 1400);
  } else if (el) { el.classList.add('aish-hl-flash'); setTimeout(() => el.classList.remove('aish-hl-flash'), 1400); }
}


/** Scroll to a passage of the page (an AI answer's source quote) and select it briefly. Returns true when found. */
export function revealQuote(quote) {
  try {
    const idx = ancBuildIndex(ancScopeRoot());
    const hit = ancResolve(idx, { exact: quote });
    if (!hit) return false;
    const range = ancToRange(idx, hit.start, hit.end);
    if (!range) return false;
    const el = range.startContainer.parentElement;
    if (el && el.scrollIntoView) el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    const sel = window.getSelection();
    sel.removeAllRanges(); sel.addRange(range);
    setTimeout(() => { try { if (sel.rangeCount && sel.getRangeAt(0) === range) sel.removeAllRanges(); } catch (_) { /* gone */ } }, 4000);
    return true;
  } catch (_) { return false; }
}
