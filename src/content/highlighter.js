// content/highlighter.js
// Text highlighting & annotation persistence for the content script.

// ── Shared state (module scope, inlined into the content IIFE by the bundler) ──
let annotationObserver = null;
let annotationUrlWatcher = null;
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
  return userHighlightingEnabled || aiHighlightingEnabled;
}

// Stable per-page key: origin + pathname only.
function getPageKey() {
  return `${window.location.origin}${window.location.pathname}`;
}
let lastObservedUrl = getPageKey();

// ── Unified Annotations Storage ─────────────────────────────────────────────

export function saveAnnotationToStorage(text, type = 'user') {
  getNormalizedAnnotations((annotations) => {
    const currentUrl = getPageKey();
    const compactText = (text || '').replace(/\s+/g, ' ').trim();
    if (!compactText) return;

    // Prevent exact duplicates
    const exists = annotations.some(a => a.url === currentUrl && a.text === compactText && a.type === type);
    if (!exists) {
      annotations.push({
        url: currentUrl,
        text: compactText,
        type: type,
        timestamp: new Date().toISOString()
      });
      chrome.storage.local.set({ annotations });
    }
  });
}

export function removeAnnotationFromStorage(text, type = 'user') {
  getNormalizedAnnotations((annotations) => {
    const currentUrl = getPageKey();
    const compactText = (text || '').replace(/\s+/g, ' ').trim();
    if (!compactText) return;
    annotations = annotations.filter(a => !(a.url === currentUrl && a.text === compactText && a.type === type));
    chrome.storage.local.set({ annotations });
  });
}

export function restoreAnnotations() {
  if (!isAnyHighlightingEnabled()) return;
  getNormalizedAnnotations((annotations) => {
    const currentUrl = getPageKey();
    const pageAnnotations = annotations.filter(a => {
      if (a.url !== currentUrl) return false;
      if (a.type === 'ghost') return aiHighlightingEnabled;
      return userHighlightingEnabled;
    });

    pageAnnotations.forEach(ann => {
      highlightTextOnPage(document.body, ann.text, ann.type === 'ghost');
    });
  });
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

export function clearHighlightElements() {
  clearHighlightElementsByType('user');
  clearHighlightElementsByType('ghost');
}

export function clearHighlightElementsByType(type) {
  const selector = type === 'ghost' ? '.ai-ghost-highlight' : '.ai-user-highlight';
  document.querySelectorAll(selector).forEach(el => {
    const parent = el.parentNode;
    if (!parent) return;
    while (el.firstChild) parent.insertBefore(el.firstChild, el);
    parent.removeChild(el);
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
        return { url, text, type, timestamp };
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

function getNormalizedAnnotations(callback) {
  chrome.storage.local.get(['annotations'], (res) => {
    const normalized = normalizeAnnotationEntries(res.annotations);
    const existing = Array.isArray(res.annotations) ? res.annotations : [];
    const shouldWriteBack = !Array.isArray(res.annotations)
      || JSON.stringify(existing) !== JSON.stringify(normalized);

    if (shouldWriteBack) {
      chrome.storage.local.set({ annotations: normalized }, () => callback(normalized));
      return;
    }

    callback(normalized);
  });
}

function isOwnHighlightMutation(mutations) {
  return mutations.every(m => {
    const nodes = [...m.addedNodes, ...m.removedNodes];
    if (m.type === 'characterData') return false; // text edits are never ours
    return nodes.every(n =>
      n.nodeType === Node.ELEMENT_NODE &&
      (n.classList?.contains('ai-user-highlight') || n.classList?.contains('ai-ghost-highlight') ||
       n.id === 'ai-highlight-tooltip' || n.id === 'ai-ghost-menu')
    );
  });
}

export function startAnnotationWatchers() {
  if (!annotationObserver && document.documentElement) {
    annotationObserver = new MutationObserver((mutations) => {
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
      const currentUrl = getPageKey();
      if (currentUrl !== lastObservedUrl) {
        lastObservedUrl = currentUrl;
        clearHighlightElements();
        scheduleRestoreAnnotations(120);
      }
    }, 700);
  }

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && 'annotations' in changes && isAnyHighlightingEnabled()) {
      scheduleRestoreAnnotations(80);
    }
  });
}

// ── 1. Yellow User Annotations ───────────────────────────────────────────────

export function handleTextSelection(event) {
  if (!userHighlightingEnabled) return;
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) return;

  const selectedRange = selection.getRangeAt(0).cloneRange();
  const selectedText = selectedRange.toString().trim();
  if (!selectedText || selectedText.length < 3) return;

  const anchorNode = selection.anchorNode;
  if (anchorNode && anchorNode.parentElement &&
     (anchorNode.parentElement.closest('#ai-summary-hybrid-sidebar') ||
      ['INPUT', 'TEXTAREA'].includes(anchorNode.parentElement.tagName))) return;

  showHighlightTooltip(event.pageX, event.pageY, () => {
    applyHighlightFromRange(selectedRange, selectedText);
    selection.removeAllRanges();
  });
}

function showHighlightTooltip(x, y, onClick) {
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

export function applyHighlightFromRange(range, text) {
  if (!range || range.collapsed) return;
  const highlightText = text || range.toString().trim();
  if (!highlightText) return;

  const mark  = document.createElement('mark');
  mark.className = 'ai-user-highlight';
  mark.title = 'Click to remove highlight';
  mark.style.cssText = 'background-color:#fef08a;color:#1f2937;border-radius:2px;padding:0 2px;cursor:pointer;';
  try {
    range.surroundContents(mark);
  } catch (e) {
    const wrapper = document.createElement('span');
    wrapper.appendChild(range.extractContents());
    mark.appendChild(wrapper);
    range.insertNode(mark);
  }
  saveAnnotationToStorage(highlightText, 'user');
}

export function highlightTextOnPage(element, text, isGhost) {
  if (!element || !text) return;
  const compactText = text.replace(/\s+/g, ' ').trim();
  if (!compactText) return;

  const existingSelector = isGhost ? '.ai-ghost-highlight' : '.ai-user-highlight';
  const alreadyExists = Array.from(document.querySelectorAll(existingSelector)).some(el => {
    const existingText = (el.dataset.annotationText || el.textContent || '').replace(/\s+/g, ' ').trim();
    return existingText === compactText;
  });
  if (alreadyExists) return;

  let range = findTextRangeAcrossNodes(element, text);
  if (!range) range = findTextRangeAcrossNodes(element, compactText);
  if (!range) return;

  const mark = document.createElement('mark');
  mark.dataset.annotationText = compactText;
  if (isGhost) {
    mark.className = 'ai-ghost-highlight';
    mark.dataset.ghostText = compactText;
    mark.title = 'AI Ghost Highlight — click to keep or dismiss';
    mark.style.cssText = 'background-color:rgba(186,230,253,0.65);color:#0369a1;border-bottom:2px dashed #0284c7;border-radius:2px;padding:0 2px;cursor:pointer;';
  } else {
    mark.className = 'ai-user-highlight';
    mark.title = 'Click to remove highlight';
    mark.style.cssText = 'background-color:#fef08a;color:#1f2937;border-radius:2px;padding:0 2px;cursor:pointer;';
  }

  try {
    range.surroundContents(mark);
  } catch (e) {
    const wrapper = document.createElement('span');
    wrapper.appendChild(range.extractContents());
    mark.appendChild(wrapper);
    range.insertNode(mark);
  }
}

function findTextRangeAcrossNodes(root, text) {
  if (!root || !text) return null;

  const query = text.replace(/\s+/g, ' ').trim();
  if (!query) return null;

  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      if (!node || !node.nodeValue || !node.nodeValue.trim()) return NodeFilter.FILTER_REJECT;
      const parent = node.parentElement;
      if (!parent) return NodeFilter.FILTER_REJECT;
      if (parent.closest('script, style, noscript')) return NodeFilter.FILTER_REJECT;
      if (parent.closest('.ai-user-highlight, .ai-ghost-highlight')) return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    }
  });

  const textNodes = [];
  const spans = [];
  let fullText = '';
  let cursor = 0;
  let current;

  while ((current = walker.nextNode())) {
    const value = current.nodeValue || '';
    textNodes.push(current);
    spans.push({
      node: current,
      start: cursor,
      end: cursor + value.length
    });
    fullText += value;
    cursor += value.length;
  }

  if (!fullText) return null;

  let idx = fullText.indexOf(text);
  if (idx === -1) {
    idx = fullText.indexOf(query);
    if (idx === -1) return null;
  }

  const match = idx === fullText.indexOf(text) && fullText.indexOf(text) !== -1 ? text : query;
  const startIndex = idx;
  const endIndexExclusive = idx + match.length;

  const startPos = resolveGlobalOffset(spans, startIndex);
  const endPos = resolveGlobalOffset(spans, endIndexExclusive);
  if (!startPos || !endPos) return null;

  const range = document.createRange();
  range.setStart(startPos.node, startPos.offset);
  range.setEnd(endPos.node, endPos.offset);

  const container = range.commonAncestorContainer.nodeType === Node.ELEMENT_NODE
    ? range.commonAncestorContainer
    : range.commonAncestorContainer.parentElement;
  if (container && container.closest && container.closest('.ai-user-highlight, .ai-ghost-highlight')) {
    return null;
  }

  return range;
}

function resolveGlobalOffset(spans, globalOffset) {
  if (!spans.length) return null;

  for (let i = 0; i < spans.length; i++) {
    const span = spans[i];
    if (globalOffset < span.end) {
      return {
        node: span.node,
        offset: Math.max(0, globalOffset - span.start)
      };
    }

    if (globalOffset === span.end) {
      return {
        node: span.node,
        offset: span.node.nodeValue.length
      };
    }
  }

  const last = spans[spans.length - 1];
  return {
    node: last.node,
    offset: last.node.nodeValue.length
  };
}

export function handleHighlightClick(event) {
  const target = event.target;
  if (target && target.classList.contains('ai-user-highlight')) {
    const textToRemove = (target.dataset.annotationText || target.textContent || '').replace(/\s+/g, ' ').trim();
    const parent = target.parentNode;
    while (target.firstChild) parent.insertBefore(target.firstChild, target);
    parent.removeChild(target);
    removeAnnotationFromStorage(textToRemove, 'user');
  }
}

// ── 2. Light Blue AI Ghost Annotations ───────────────────────────────────────

export function applyGhostHighlights(quotes = []) {
  if (!aiHighlightingEnabled || !quotes || !quotes.length) return;
  quotes.forEach(quote => {
    const clean = quote.replace(/\s+/g, ' ').trim();
    if (clean.length < 5) return;
    saveAnnotationToStorage(clean, 'ghost');
    highlightTextOnPage(document.body, clean, true);
  });
}

export function handleGhostHighlightClick(event) {
  const target = event.target;
  if (target && target.classList.contains('ai-ghost-highlight')) {
    event.preventDefault(); event.stopPropagation();
    showGhostActionMenu(event.pageX, event.pageY, target);
  }
}

function showGhostActionMenu(x, y, markElement) {
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
  menu.innerHTML = `
    <button id="btn-convert-yellow" style="background:#fef08a;border:1px solid #fde047;color:#854d0e;padding:4px 8px;border-radius:4px;cursor:pointer;font-weight:bold;">⭐ Keep</button>
    <button id="btn-dismiss-ghost" style="background:#f1f5f9;border:1px solid #cbd5e1;color:#475569;padding:4px 8px;border-radius:4px;cursor:pointer;">✕ Dismiss</button>
  `;
  menu.style.left = `${x}px`;
  menu.style.top  = `${y - 44}px`;
  menu.style.display = 'flex';

  const text = (markElement.dataset.ghostText || markElement.dataset.annotationText || markElement.textContent || '').replace(/\s+/g, ' ').trim();

  document.getElementById('btn-convert-yellow').onclick = () => {
    removeAnnotationFromStorage(text, 'ghost');
    markElement.className = 'ai-user-highlight';
    markElement.title = 'Click to remove highlight';
    markElement.style.cssText = 'background-color:#fef08a;color:#1f2937;border-radius:2px;padding:0 2px;cursor:pointer;';
    delete markElement.dataset.ghostText;
    saveAnnotationToStorage(text, 'user');
    menu.style.display = 'none';
  };

  document.getElementById('btn-dismiss-ghost').onclick = () => {
    removeAnnotationFromStorage(text, 'ghost');
    const parent = markElement.parentNode;
    while (markElement.firstChild) parent.insertBefore(markElement.firstChild, markElement);
    parent.removeChild(markElement);
    menu.style.display = 'none';
  };

  setTimeout(() => {
    document.addEventListener('click', function hideMenu() {
      if (menu) menu.style.display = 'none';
      document.removeEventListener('click', hideMenu);
    }, { once: true });
  }, 100);
}
