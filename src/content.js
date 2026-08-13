// content.js
(() => {
  // ── Cross-browser shim ────────────────────────────────────────────────
  // Safari/iOS Web Extensions expose ONLY the `browser.*` namespace; the
  // `chrome.*` namespace is undefined there. Firefox exposes both, but
  // `browser.*` is the Promise-based standard. Alias chrome → browser so
  // the rest of this script works unchanged on every platform.
  if (typeof chrome === 'undefined' && typeof browser !== 'undefined') {
    globalThis.chrome = browser;
  }

  // Smart injection guard: Checks if an alive extension context exists.
  // If the extension was reloaded, the old context is "invalidated" and 
  // getManifest() will throw an error. This safely allows the new script to inject!
  if (window.aishPing && window.aishPing()) return;
  window.aishPing = () => {
    try {
      return !!chrome.runtime.getManifest();
    } catch (e) {
      return false;
    }
  };

const API_BASE = 'https://api.byphil.eu';
// const API_BASE = 'http://localhost:3000'; // for local testing

// Define the donation messages
const donationMessages = [
  "Help me brew new ideas with a soothing cup of tea! 🍵",
  "Help me upgrade my workspace with a new plant! 🌿",
  "Help me fund a tiny house to code in peace! 🏡",
  "Get me closer to my goal of relocating into a sailboat! 🚤",
  "Feeling generous? A pizza would definitely boost my brainstorming sessions! 🍕",
  "Help me turn my remote work into a van life adventure! 🚐",
  "Your support can help me build my tiny home! 🏠",
  "Help me get a kayak to paddle through my creative process! 🛶",
  "Get me a smoothie to recharge my problem-solving skills! 🥤"
];

function getRandomDonationMessage() {
  const randomIndex = Math.floor(Math.random() * donationMessages.length);
  return donationMessages[randomIndex];
}

let servicesData = [];
let modelConfig = {};
let annotationObserver = null;
let annotationUrlWatcher = null;
let restoreTimer = null;
let restoreScheduledAt = 0; // first time the pending restore was requested, for max-wait
const RESTORE_MAX_WAIT_MS = 1000;

// Stable per-page key: origin + pathname only. Deliberately ignores the query
// string and hash so that trackers/ads doing history.replaceState with a new
// UTM/session param (very common) don't make us think the user navigated to
// a "different" page and clear/lose their highlights.
function getPageKey() {
  return `${window.location.origin}${window.location.pathname}`;
}
let lastObservedUrl = getPageKey();

// Cache the setting so sync reads don't block event handlers
let userHighlightingEnabled = true;
let aiHighlightingEnabled = true;

function isAnyHighlightingEnabled() {
  return userHighlightingEnabled || aiHighlightingEnabled;
}

chrome.storage.sync.get(['highlightingEnabled', 'userHighlightingEnabled', 'aiHighlightingEnabled'], (data) => {
  const legacy = data.highlightingEnabled !== false;
  userHighlightingEnabled = data.userHighlightingEnabled !== undefined ? data.userHighlightingEnabled !== false : legacy;
  aiHighlightingEnabled = data.aiHighlightingEnabled !== undefined ? data.aiHighlightingEnabled !== false : legacy;

  if (!isAnyHighlightingEnabled()) {
    clearHighlightElements();
  } else {
    scheduleRestoreAnnotations(80);
  }
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'sync') return;

  let shouldRestore = false;

  if ('userHighlightingEnabled' in changes) {
    userHighlightingEnabled = changes.userHighlightingEnabled.newValue !== false;
    if (!userHighlightingEnabled) {
      clearHighlightElementsByType('user');
    } else {
      shouldRestore = true;
    }
  }

  if ('aiHighlightingEnabled' in changes) {
    aiHighlightingEnabled = changes.aiHighlightingEnabled.newValue !== false;
    if (!aiHighlightingEnabled) {
      clearHighlightElementsByType('ghost');
    } else {
      shouldRestore = true;
    }
  }

  if ('highlightingEnabled' in changes && !('userHighlightingEnabled' in changes) && !('aiHighlightingEnabled' in changes)) {
    const legacyEnabled = changes.highlightingEnabled.newValue !== false;
    userHighlightingEnabled = legacyEnabled;
    aiHighlightingEnabled = legacyEnabled;
    if (!legacyEnabled) {
      clearHighlightElements();
    } else {
      shouldRestore = true;
    }
  }

  if (shouldRestore && isAnyHighlightingEnabled()) {
    scheduleRestoreAnnotations(80);
  }
});

// Restore persisted highlights as soon as the DOM is ready
document.addEventListener('mouseup', handleTextSelection);
document.addEventListener('click', handleHighlightClick);

if (document.readyState === 'interactive' || document.readyState === 'complete') {
  scheduleRestoreAnnotations(80);
} else {
  document.addEventListener('DOMContentLoaded', () => scheduleRestoreAnnotations(80));
}

ensureHighlightUiStyles();
startAnnotationWatchers();

function ensureHighlightUiStyles() {
  if (document.getElementById('aish-highlight-ui-styles')) return;
  const style = document.createElement('style');
  style.id = 'aish-highlight-ui-styles';
  style.textContent = `
    .hover-effect {
      outline: 2px dashed #3b82f6 !important;
      outline-offset: 2px !important;
      background-color: rgba(59, 130, 246, 0.12) !important;
    }
  `;
  document.documentElement.appendChild(style);
}

// ─────────────────────────────────────────────────────────────────────────────
// ── Unified Annotations Storage (Pure New Structure) ─────────────────────────
// ─────────────────────────────────────────────────────────────────────────────

function saveAnnotationToStorage(text, type = 'user') {
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

function removeAnnotationFromStorage(text, type = 'user') {
  getNormalizedAnnotations((annotations) => {
    const currentUrl = getPageKey();
    const compactText = (text || '').replace(/\s+/g, ' ').trim();
    if (!compactText) return;
    annotations = annotations.filter(a => !(a.url === currentUrl && a.text === compactText && a.type === type));
    chrome.storage.local.set({ annotations });
  });
}

function restoreAnnotations() {
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


function scheduleRestoreAnnotations(delay = 160) {
  if (!isAnyHighlightingEnabled()) return;

  const now = Date.now();
  if (!restoreTimer) restoreScheduledAt = now;

  // If we've already been waiting for RESTORE_MAX_WAIT_MS, stop pushing the
  // timer back — run on the next tick regardless of new mutations. Without
  // this, a page with continuous DOM churn (ads, lazy loading, live tickers)
  // can reset this debounce forever and restoreAnnotations() never runs.
  const elapsed = now - restoreScheduledAt;
  const effectiveDelay = elapsed >= RESTORE_MAX_WAIT_MS ? 0 : delay;

  if (restoreTimer) clearTimeout(restoreTimer);
  restoreTimer = setTimeout(() => {
    restoreTimer = null;
    restoreScheduledAt = 0;
    restoreAnnotations();
  }, effectiveDelay);
}

function clearHighlightElements() {
  clearHighlightElementsByType('user');
  clearHighlightElementsByType('ghost');
}

function clearHighlightElementsByType(type) {
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

function startAnnotationWatchers() {
  if (!annotationObserver && document.documentElement) {
    annotationObserver = new MutationObserver((mutations) => {
      // Don't let inserting our own <mark> elements (or the tooltip/menu)
      // count as page activity — otherwise applying a highlight retriggers
      // this observer and keeps pushing scheduleRestoreAnnotations back.
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
      // Uses the stable page key (origin + pathname), NOT the full href, so
      // a query-string-only change (tracking/UTM params, ad iframes calling
      // history.replaceState, etc.) is not mistaken for real navigation.
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

// ─────────────────────────────────────────────────────────────────────────────
// ── 1. Yellow User Annotations ───────────────────────────────────────────────
// ─────────────────────────────────────────────────────────────────────────────

function handleTextSelection(event) {
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

function applyHighlightFromRange(range, text) {
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

function highlightTextOnPage(element, text, isGhost) {
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

function handleHighlightClick(event) {
  const target = event.target;
  if (target && target.classList.contains('ai-user-highlight')) {
    const textToRemove = (target.dataset.annotationText || target.textContent || '').replace(/\s+/g, ' ').trim();
    const parent = target.parentNode;
    while (target.firstChild) parent.insertBefore(target.firstChild, target);
    parent.removeChild(target);
    removeAnnotationFromStorage(textToRemove, 'user');
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// ── 2. Light Blue AI Ghost Annotations ───────────────────────────────────────
// ─────────────────────────────────────────────────────────────────────────────

function applyGhostHighlights(quotes = []) {
  if (!aiHighlightingEnabled || !quotes || !quotes.length) return;
  quotes.forEach(quote => {
    const clean = quote.replace(/\s+/g, ' ').trim();
    if (clean.length < 5) return;
    saveAnnotationToStorage(clean, 'ghost');
    highlightTextOnPage(document.body, clean, true);
  });
}

document.addEventListener('click', (event) => {
  const target = event.target;
  if (target && target.classList.contains('ai-ghost-highlight')) {
    event.preventDefault(); event.stopPropagation();
    showGhostActionMenu(event.pageX, event.pageY, target);
  }
});

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

// ─────────────────────────────────────────────────────────────────────────────
// ── Decision Dialog (shown in-page for context menu "Summarize & Close") ─────
// ─────────────────────────────────────────────────────────────────────────────

function showDecisionDialog(onConfirm) {
  document.getElementById('aish-decision-overlay')?.remove();

  const TIMES = [
    { id: 'tomorrow', label: '🌅 Tomorrow' },
    { id: 'weekend',  label: '🏖️ Weekend'  },
    { id: 'week',     label: '📅 This Week' },
    { id: 'research', label: '🔬 Research Session' },
  ];

  const overlay = document.createElement('div');
  overlay.id = 'aish-decision-overlay';
  overlay.style.cssText = `
    position:fixed;top:0;left:0;width:100vw;height:100vh;
    background:rgba(0,0,0,0.72);backdrop-filter:blur(4px);
    z-index:2147483647;display:flex;align-items:center;justify-content:center;
    font-family:system-ui,-apple-system,sans-serif;
  `;

  const card = document.createElement('div');
  card.style.cssText = `
    background:#1e1e2e;color:#e2e8f0;border-radius:16px;
    padding:24px;width:340px;max-width:90vw;
    box-shadow:0 24px 64px rgba(0,0,0,0.6);
    display:flex;flex-direction:column;gap:14px;
  `;
  card.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;">
      <span style="font-size:18px;font-weight:700;">🔖 Save for Later</span>
      <button id="aish-dialog-cancel"
        style="background:none;border:none;color:#94a3b8;font-size:22px;cursor:pointer;line-height:1;padding:0;">✕</button>
    </div>
    <p style="font-size:13px;color:#94a3b8;margin:0;">
      The page will be summarised &amp; closed. Remind me…
    </p>
    <div id="aish-time-chips" style="display:flex;flex-wrap:wrap;gap:8px;">
      ${TIMES.map((t, i) => `
        <button type="button" data-time="${t.id}"
          style="padding:6px 12px;border-radius:99px;font-size:13px;cursor:pointer;transition:all .15s;
                 ${i === 0
                   ? 'background:#2563eb;color:#fff;border:1px solid #2563eb;'
                   : 'background:transparent;color:#94a3b8;border:1px solid #334155;'}">
          ${t.label}
        </button>`).join('')}
    </div>
    <textarea id="aish-decision-reason"
      placeholder="Why keep this? (optional)"
      style="background:#0f172a;color:#e2e8f0;border:1px solid #334155;border-radius:8px;
             padding:10px;font-size:13px;resize:none;height:64px;font-family:inherit;"></textarea>
    <button id="aish-dialog-confirm"
      style="background:#2563eb;color:#fff;border:none;border-radius:10px;
             padding:12px;font-size:15px;font-weight:600;cursor:pointer;">
      ✨ Summarize &amp; Close Tab
    </button>
  `;

  overlay.appendChild(card);
  document.body.appendChild(overlay);

  let selectedTime = 'tomorrow';

  card.querySelector('#aish-time-chips').addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-time]');
    if (!btn) return;
    selectedTime = btn.dataset.time;
    card.querySelectorAll('#aish-time-chips button').forEach(b => {
      const active = b === btn;
      b.style.background = active ? '#2563eb' : 'transparent';
      b.style.color       = active ? '#fff'    : '#94a3b8';
      b.style.border      = active ? '1px solid #2563eb' : '1px solid #334155';
    });
  });

  card.querySelector('#aish-dialog-cancel').addEventListener('click', () => overlay.remove());

  card.querySelector('#aish-dialog-confirm').addEventListener('click', () => {
    const reason = card.querySelector('#aish-decision-reason').value.trim();
    const decision = {
      id: Date.now().toString(),
      url: window.location.href,
      title: document.title,
      favicon: `${window.location.origin}/favicon.ico`,
      reason,
      timeframe: selectedTime,
      savedAt: new Date().toISOString(),
      status: 'pending'
    };
    card.innerHTML = `
      <span style="font-size:40px;text-align:center;">✨</span>
      <p style="font-size:18px;font-weight:600;margin:0;text-align:center;">Summarizing…</p>
      <p style="font-size:13px;color:#94a3b8;margin:0;text-align:center;">Tab closes automatically when done.</p>
    `;
    onConfirm(decision);
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// ── Extension Message Handlers ───────────────────────────────────────────────
// ─────────────────────────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'PING') {
    sendResponse({ status: 'PONG' });
    return true;
  }

  if (request.action === 'contextMenuHighlight') {
    const text = request.text?.trim();
    if (text && userHighlightingEnabled) {
      highlightTextOnPage(document.body, text, false);
      saveAnnotationToStorage(text, 'user');
    }
    sendResponse({ status: 'ok' });
    return true;
  }

  if (request.action === 'contextMenuClearHighlights') {
    clearHighlightElements();
    
    // Clear only for the current URL using the new array structure
    chrome.storage.local.get(['annotations'], (res) => {
      let annotations = res.annotations;
      if (Array.isArray(annotations)) {
        const currentUrl = window.location.href.split('#')[0];
        annotations = annotations.filter(a => a.url !== currentUrl);
        chrome.storage.local.set({ annotations }, () => {
          sendResponse({ status: 'ok' });
        });
      } else {
        sendResponse({ status: 'ok' });
      }
    });
    return true;
  }

  if (request.action === 'toggleHybridSidebar') {
    toggleHybridSidebar();
    sendResponse({ status: 'Sidebar toggled' });
    return true;
  }

  if (request.action === 'fetchSummaryAndClose') {
    sendResponse({ success: true });

    showDecisionDialog((decision) => {
      const streamOverlay = createStreamingOverlay();
      document.body.appendChild(streamOverlay);
      
      const decisionDialog = document.getElementById('aish-decision-overlay');
      if (decisionDialog) decisionDialog.remove();

      chrome.storage.sync.get(['debugEnabled', 'prompt'], async (data) => {
        const promptToUse = data.prompt || 'Summarize the following content:';
        const hiddenTarget = document.createElement('div');
        hiddenTarget.style.cssText = 'position:fixed;left:-9999px;top:0;width:1px;height:1px;overflow:hidden;';
        document.body.appendChild(hiddenTarget);
        try {
          const result = await fetchSummary('', 'en-US', promptToUse, 200, hiddenTarget, data.debugEnabled || false, 'extension');
          const article = result.article;
          
          if (article) {
            article.decisionTimeframe = decision.timeframe;
            article.decisionReason = decision.reason;
            article.decisionSavedAt = decision.savedAt;
            article.isDecision = true;
            
            chrome.storage.local.get({ articles: [] }, (data) => {
              const articles = data.articles || [];
              const idx = articles.findIndex(a => a.timestamp === article.timestamp);
              if (idx >= 0) {
                articles[idx] = article;
                chrome.storage.local.set({ articles }, () => {
                  chrome.runtime.sendMessage({ action: 'scheduleDecisionAlarm', article });
                  waitForSpeedReadingComplete(streamOverlay, () => {
                    chrome.runtime.sendMessage({ action: 'closeTabSelf' });
                  });
                });
              }
            });
          } else {
            updateStreamingOverlay(streamOverlay, 'No summary generated', true);
          }
        } catch (e) {
          updateStreamingOverlay(streamOverlay, `❌ Summary failed: ${e.message || 'Unknown error'}`, true);
        }
      });
    });
    return false;
  }
  
  if (request.action === 'fetchSummary') {
    const { additionalQuestions: popupQuestions, selectedLanguage, prompt: popupPrompt, summaryMode, summaryLength: msgSummaryLength } = request;
    sendResponse({ success: true, message: summaryMode === 'extension' ? 'Fetching summary...' : 'Selection started' });

    (async () => {
      if (summaryMode === 'extension') {
        chrome.storage.sync.get(['debugEnabled', 'prompt'], (data) => {
          const promptToUse = popupPrompt || data.prompt || 'Summarize the following content:';
          const length = msgSummaryLength || 200;
          const hiddenTarget = document.createElement('div');
          hiddenTarget.style.cssText = 'position:fixed;left:-9999px;top:0;width:1px;height:1px;overflow:hidden;';
          document.body.appendChild(hiddenTarget);
          fetchSummary(
            popupQuestions,
            selectedLanguage,
            promptToUse,
            length,
            hiddenTarget,
            data.debugEnabled || false,
            summaryMode
          );
        });
        return;
      }

      const targetElement = await selectTargetElement();
      if (targetElement) {
        chrome.storage.sync.get(['debugEnabled', 'prompt'], (data) => {
          const promptToUse = popupPrompt || data.prompt || 'Summarize the following content:';
          const length = msgSummaryLength || 200;
          fetchSummary(
            popupQuestions, 
            selectedLanguage, 
            promptToUse, 
            length, 
            targetElement, 
            data.debugEnabled || false,
            summaryMode
          );
        });
      }
    })();
    return false;
  } else if (request.action === 'setServices') {
    servicesData = request.services;
  } else if (request.action === 'setModelConfig') {
    modelConfig = request.modelConfig;
  }
});

async function getTopUserTags(limit = 10) {
  return new Promise((resolve) => {
    chrome.storage.local.get({ articles: [] }, (data) => {
      const tagCounts = {};
      const articles = data.articles || [];
      articles.forEach(art => {
        if (Array.isArray(art.tags)) {
          art.tags.forEach(t => {
            const clean = (t || '').toString().trim();
            if (!clean) return;
            const key = clean.toLowerCase();
            tagCounts[key] = {
              original: clean,
              count: (tagCounts[key]?.count || 0) + 1
            };
          });
        }
      });
      const sorted = Object.values(tagCounts).sort((a, b) => b.count - a.count);
      resolve(sorted.slice(0, limit).map(item => item.original));
    });
  });
}

async function fetchSummary(additionalQuestions, selectedLanguage, prompt, summaryLength, targetElement, debugEnabled, summaryMode = 'extension') {
  const tokenLimit = 20000;

  const { html: contentHtml, text: contentText } = getAllTextContent();
  const truncatedContent = truncateToTokenLimit(contentText, tokenLimit);

  // Start image compression immediately and let it run while AI is streaming.
  const imageCompressionPromise = inlineAndCompressImages(contentHtml);

  const donationMessage = getRandomDonationMessage();
  showPlaceholder(targetElement, donationMessage);

  return new Promise((resolve, reject) => {
    chrome.storage.sync.get(['activeService', 'servicesConfig', 'connectionMode', 'preferredCloudModel', 'licenseKey', 'ghostHighlightAmount'], async (data) => {
      // ── Define relay FIRST so it's available to every code path,
      // including validation errors and the missing-API-key branch ──
      const relay = (action, payload = {}) => {
        if (summaryMode === 'extension') {
          chrome.runtime.sendMessage({ action, ...payload }).catch(() => {});
        }
      };

      const localAuth = await chrome.storage.local.get(['pb_token']).catch(() => ({}));
      const sessionToken = localAuth?.pb_token || '';
      const connectionMode = data.connectionMode || 'cloud';
      let activeService = data.activeService || 'openai';
      let cfg = (data.servicesConfig || {})[activeService] || {};
      let apiKey = cfg.apiKey || '';
      
      let apiUrl = cfg.endpoint;
      let modelIdentifier = cfg.activeModelId || (Array.isArray(cfg.customModel) ? cfg.customModel[0] : cfg.customModel) || cfg.model;
      const ghostCfg = getGhostHighlightConfig(data.ghostHighlightAmount);

      if (connectionMode === 'cloud') {
        activeService = 'cloud'; 
        apiUrl = `${API_BASE}/v1/projects/ai_summary_helper/chat`;
        modelIdentifier = data.preferredCloudModel || 'google/gemini-2.5-flash';
        apiKey = sessionToken || data.licenseKey || ''; 
      } else if (cfg) {
        apiUrl = cfg.endpointUrl || apiUrl;
        modelIdentifier = cfg.modelIdentifier || modelIdentifier;
      }

      let apiKeyOptional = false;
      if (connectionMode !== 'cloud') {
        try {
          const servicesUrl = chrome.runtime.getURL('services.json');
          const servicesResp = await fetch(servicesUrl);
          if (servicesResp && servicesResp.ok) {
            const servicesList = await servicesResp.json();
            const svcMeta = servicesList.find(s => (s.id || '').toLowerCase() === (activeService || '').toLowerCase());
            apiKeyOptional = svcMeta?.apiKeyOptional || false;
          }
        } catch (e) {}
      } else {
        apiKeyOptional = true; 
      }

      if (activeService === 'ollama') apiKeyOptional = true;

      if (!apiKey && !apiKeyOptional) {
        alert('Please set your API key in the extension popup.');
        relay('summaryError', { error: 'API key not set' });
        reject(new Error('API key not set'));
        return;
      }

      try {
        if (!modelIdentifier && connectionMode !== 'cloud') {
          try {
            const servicesUrl = chrome.runtime.getURL('services.json');
            const servicesResp = await fetch(servicesUrl);
            if (servicesResp && servicesResp.ok) {
              const servicesList = await servicesResp.json();
              const svcMeta = servicesList.find(s => (s.id || '').toLowerCase() === (activeService || '').toLowerCase());
              modelIdentifier = svcMeta?.defaultModel || '';
            }
          } catch (e) {}
        }

        if (!apiUrl) throw new Error('Model endpoint is not configured.');
        try { new URL(apiUrl); } catch (urlErr) { throw new Error(`Configured endpoint is not a valid URL: ${apiUrl}`); }

        const headers = { 'Content-Type': 'application/json' };
        let requestBody;
        let finalApiUrl = apiUrl;

        // 🔥 IMPORTANT: This tells the AI to return EXACT verbatim quotes so `indexOf()` never fails
        const systemPrompt = `You are a summarizer returning HTML <div> with <h2> and <p> tags. At the end include two HTML comments: one with 3-5 broad topic tags strictly based on the core subject matter of the source article (ignore user style preferences, tone, or your persona when generating tags): <!-- TAGS: tag1, tag2, tag3 --> and one with ${ghostCfg.promptRange} short, EXACT verbatim string snippets representing the most critical key insights, core facts, or main arguments from the source text (avoid conversational quotes or dialogue unless they state a core thesis): <!-- GHOST_HIGHLIGHTS: ["exact key passage 1", "exact key passage 2"] -->.`;

        // ── Route based on API format ──
        if (activeService === 'gemini') {
          finalApiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(modelIdentifier)}:streamGenerateContent?alt=sse`;
          headers['x-goog-api-key'] = apiKey;
          const parts = [
            { text: `Please produce ONLY valid HTML. Return a single <div> containing <h2> and <p> tags. At the end include two HTML comments: one with 3-5 broad topic tags strictly derived from the core subject matter of the source text (ignore user personas or styling prompts): <!-- TAGS: tag1, tag2, tag3 --> and one with ${ghostCfg.promptRange} short, EXACT verbatim string snippets representing the most critical key insights, core facts, or main arguments from the source text (avoid conversational quotes or dialogue unless they state a core thesis): <!-- GHOST_HIGHLIGHTS: ["exact key passage 1", "exact key passage 2"] -->. Output Language: ${selectedLanguage}. Limit: ${summaryLength} words.` },
            { text: `Additional Questions/Instructions: ${additionalQuestions}` },
            { text: truncatedContent }
          ];
          requestBody = JSON.stringify({ contents: [{ role: 'user', parts }] });
        } else {
          // Default OpenAI / Cloud / Custom format
          if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;
          const { installId } = await chrome.storage.local.get('installId');
          if (installId) headers['X-Install-ID'] = installId;

          requestBody = JSON.stringify({
            model: modelIdentifier,
            messages: [
              { role: 'system', content: systemPrompt },
              { role: 'user', content: `Language: ${selectedLanguage}. Limit: ${summaryLength} words. Instruction: ${prompt}. Additional Context/Questions: ${additionalQuestions}. Content: ${truncatedContent}` }
            ],
            stream: true
          });
        }

        if (debugEnabled) {
          updateDebugPanel(`Requesting ${modelIdentifier}...\n\nURL: ${finalApiUrl}\n\nPayload: ${requestBody}`, finalApiUrl);
        }

        let summary = "";
        const streamContainer = targetElement.querySelector('.placeholder');
        const outputArea = document.createElement('div');
        outputArea.style.marginTop = '15px';
        outputArea.style.borderTop = '1px solid #ccc';
        outputArea.style.paddingTop = '10px';
        streamContainer.appendChild(outputArea);

        relay('summaryProgress', { chunk: 'Connected to API, waiting for response…' });

        const streamStart = Date.now();
        const port = chrome.runtime.connect({ name: 'streamFetch' });
        
        port.postMessage({
          action: 'startFetch',
          apiUrl: finalApiUrl,
          headers: headers,
          body: requestBody
        });

        let buffer = '';

        port.onMessage.addListener(async (msg) => {
          if (msg.error) {
            console.error('❌ Error:', msg.error);
            relay('summaryError', { error: msg.error });
            targetElement.querySelector('.placeholder').innerHTML = `<b>Error:</b> ${msg.error}`;
            reject(new Error(msg.error));
            port.disconnect();
            return;
          }

          if (msg.done) {
            streamContainer.remove();
            
            // 🔥 EXTRACT METADATA FROM RAW TEXT BEFORE HTML CONVERSION TO PREVENT BREAKING JSON
            let tags = [];
            const tagMatch = summary.match(/<!--\s*TAGS:\s*([^>]+)\s*-->/i);
            if (tagMatch) {
              const seen = new Set();
              tags = tagMatch[1]
                .split(',')
                .map(t => t.trim().replace(/^#/, ''))
                .filter(Boolean)
                .filter(t => {
                  const key = t.toLowerCase();
                  if (seen.has(key)) return false;
                  seen.add(key);
                  return true;
                });
            }
            tags = await ensureGeneralTag(tags, contentText, document.title);
            let ghostQuotes = [];
            const ghostMatch = summary.match(/<!--\s*GHOST_HIGHLIGHTS:\s*([\s\S]*?)\s*-->/i);
            if (ghostMatch) {
              try { 
                let rawJson = ghostMatch[1].trim();
                // Strip out markdown codeblocks the AI occasionally uses to format the JSON Array
                rawJson = rawJson.replace(/^```json/i, '').replace(/^```/, '').replace(/```$/, '').trim();
                ghostQuotes = JSON.parse(rawJson); 
              } catch (e) { 
                console.warn('[AI Summary Helper] Failed to parse ghost quotes:', e); 
              }
            }
            ghostQuotes = normalizeGhostQuotes(ghostQuotes, ghostCfg.max);
            
            // Strip tags and ghost comments from the raw summary string
            let cleanRawText = summary
              .replace(/<!--\s*GHOST_HIGHLIGHTS:\s*([\s\S]*?)\s*-->/gi, '')
              .replace(/<!--\s*TAGS:\s*[^>]+\s*-->/gi, '')
              .trim();

            // Finally, convert the cleaned text to HTML
            const cleanHtml = markdownToHtml(cleanRawText);

            // Apply ghost highlights to the page now that it's safe to do so
            if (ghostQuotes.length > 0) applyGhostHighlights(ghostQuotes);
            
            // WAIT FOR IMAGE COMPRESSION TO FINISH BEFORE SAVING
            let finalContentHtml = contentHtml;
            try {
              finalContentHtml = await imageCompressionPromise;
            } catch (compressionError) {
              console.warn('[AI Summary Helper] Background image compression failed. Falling back to original HTML.', compressionError);
            }
            
            if (summaryMode === 'inline') {
              const summaryContainer = document.createElement('blockquote');
              summaryContainer.style.cssText = "border-left: 4px solid #007bff; padding: 15px; margin: 20px 0; background: rgba(0,123,255,0.05);";
              summaryContainer.innerHTML = `<div><h2 style="margin-top:0">AI Summary 🧙</h2>${cleanHtml}</div>`;
              insertSummary(targetElement, summaryContainer);
            } else {
              targetElement.remove();
              relay('summaryComplete', {
                summary: cleanHtml,
                title: document.title,
                url: window.location.href,
                timestamp: new Date().toISOString(),
                tags: tags,
                modelId: modelIdentifier,
                content: finalContentHtml
              });
            }
            
            saveToLocalStorage(finalContentHtml, cleanHtml, window.location.href, document.title, '', tags, modelIdentifier, summaryLength)
              .then(savedArticle => resolve({ success: true, article: savedArticle }))
              .catch(err => {
                console.error('Failed to save article:', err);
                resolve({ success: true, article: null });
              });
            
            port.disconnect();
            return;
          }

          if (msg.chunk) {
            relay('summaryProgress', { chunk: 'Receiving data…' });
            buffer += msg.chunk;
            const lines = buffer.split('\n');
            buffer = lines.pop();

            for (let line of lines) {
              line = line.trim();
              if (!line || line === 'data: [DONE]') continue;

              try {
                let contentPiece = '';
                const cleanLine = line.startsWith('data: ') ? line.substring(6) : line;
                const json = JSON.parse(cleanLine);

                if (activeService === 'gemini') {
                  contentPiece = json.candidates?.[0]?.content?.parts?.[0]?.text || '';
                } else {
                  contentPiece = json.choices?.[0]?.delta?.content || json.message?.content || json.response || '';
                }

                if (contentPiece) {
                  summary += contentPiece;
                  
                  outputArea.innerHTML = `<small style="opacity:0.7; color: #666;">Drafting summary...</small><br>${markdownToHtml(summary)}`;
                  if (debugEnabled) updateDebugPanel(summary, finalApiUrl);
                  
                  const streamingOverlay = document.getElementById('aish-streaming-overlay');
                  if (streamingOverlay) {
                    updateStreamingOverlay(streamingOverlay, summary, false);
                  }
                  
                  const wordCount = summary.split(/\s+/).filter(Boolean).length;
                  if (summaryMode === 'extension' && wordCount % 10 < 2) {
                    const elapsed = Math.floor((Date.now() - streamStart) / 1000);
                    relay('summaryProgress', {
                      chunk: `${wordCount} words · ${elapsed}s`,
                      preview: summary
                    });
                  }
                }
              } catch (e) { /* Ignore partial JSON chunks */ }
            }
          }
        });

      } catch (error) {
        console.error('❌ Error:', error);
        relay('summaryError', { error: error.message });
        targetElement.querySelector('.placeholder').innerHTML = `<b>Error:</b> ${error.message}`;
        reject(error);
      }
    });
  });
}

function saveToLocalStorage(content, summary, url, title, description, tags = [], modelId = '', summaryLength = 200) {
  return new Promise((resolve, reject) => {
    const timestamp = new Date().toISOString();
    const articleData = { content, summary, url, title, description, timestamp, tags, modelId, summaryLength };

    chrome.storage.local.get({ articles: [] }, (data) => {
      const articles = data.articles || [];
      articles.push(articleData);
      chrome.storage.local.set({ articles }, () => {
        console.log('Article saved to local storage:', articleData);
        resolve(articleData);
      });
    });
  });
}

function truncateToTokenLimit(text, maxTokens) {
  if (!text) return text;
  const approxTokens = Math.ceil(text.length / 4);
  if (approxTokens <= maxTokens) return text;
  const allowedChars = Math.max(1000, Math.floor(maxTokens * 4));
  return text.slice(0, allowedChars);
}

function chunkText(text, chunkSize) {
  if (!text) return [];
  const chunks = [];
  let start = 0;
  while (start < text.length) {
    chunks.push(text.slice(start, start + chunkSize));
    start += chunkSize;
  }
  return chunks;
}

// ── HTML Tag Stripper ──
function stripHtmlTags(html) {
  if (!html) return '';
  return html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

function getGhostHighlightConfig(setting = 'regular') {
  switch (setting) {
    case 'few':
      return { promptRange: '1-2', max: 2 };
    case 'a_lot':
      return { promptRange: '4-6', max: 6 };
    default:
      return { promptRange: '2-3', max: 3 };
  }
}

function normalizeGhostQuotes(quotes, maxCount = 3) {
  if (!Array.isArray(quotes)) return [];
  const seen = new Set();
  const normalized = [];

  for (const q of quotes) {
    const clean = (q || '').toString().replace(/\s+/g, ' ').trim();
    if (!clean || clean.length < 5) continue;
    const key = clean.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    normalized.push(clean);
    if (normalized.length >= maxCount) break;
  }

  return normalized;
}

async function ensureGeneralTag(tags, contentText = '', pageTitle = '', maxTags = 7) {
  const inputTags = Array.isArray(tags) ? tags : [];
  const normalized = [];
  const seen = new Set();

  for (const raw of inputTags) {
    const clean = (raw || '').toString().trim();
    if (!clean) continue;
    const key = clean.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    normalized.push(clean);
  }

  // Fetch top 10 most used tags from storage library
  const topUserTags = await getTopUserTags(10);
  const corpus = `${pageTitle || ''}\n${contentText || ''}\n${normalized.join(' ')}`.toLowerCase();

  // Check if any of your top historical tags match the current article content
  const matchedHistoricalTags = topUserTags.filter(ut => {
    const term = ut.toLowerCase();
    // Match whole-word occurrences to avoid false positives
    const rx = new RegExp(`\\b${term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
    return rx.test(corpus) && !seen.has(term);
  });

  // Broad fallback catalog if no specific match occurs
  const broadCatalog = [
    { tag: 'Technology', patterns: [/\bai\b/i, /\bartificial intelligence\b/i, /\bsoftware\b/i, /\btech\b/i, /\btechnology\b/i, /\bcyber\b/i, /\bstartup\b/i, /\bsemiconductor\b/i, /\bcloud\b/i] },
    { tag: 'Business', patterns: [/\bfinance\b/i, /\beconomy\b/i, /\beconomic\b/i, /\bcorporate\b/i, /\bmarket\b/i, /\bhiring\b/i, /\bprofit\b/i, /\brevenue\b/i, /\bindustry\b/i] },
    { tag: 'Science', patterns: [/\bscience\b/i, /\bresearch\b/i, /\bstudy\b/i, /\banalysis\b/i, /\bevidence\b/i, /\bexperiment\b/i, /\bjournal\b/i] },
    { tag: 'Health', patterns: [/\bhealth\b/i, /\bmedical\b/i, /\bdisease\b/i, /\bdoctor\b/i, /\bhospital\b/i, /\bphysiology\b/i, /\bnutrition\b/i] },
    { tag: 'Politics', patterns: [/\bgovernment\b/i, /\belection\b/i, /\bgeopolitics?\b/i, /\bregulations?\b/i] },
    { tag: 'Environment', patterns: [/\bclimate\b/i, /\bemissions?\b/i, /\bsustainab(le|ility)\b/i, /\benvironment\b/i, /\brenewable\b/i, /\bbiodiversity\b/i, /\bweather\b/i] },
    { tag: 'Society', patterns: [/\bculture\b/i, /\bcommunity\b/i, /\beducation\b/i, /\bdemographics?\b/i] },
    { tag: 'Lifestyle', patterns: [/\blifestyle\b/i, /\bcreativity\b/i, /\bmindset\b/i, /\bhabits?\b/i, /\bwellbeing\b/i] }
  ];


  let broadTag = normalized.find(tag => broadCatalog.some(b => b.tag.toLowerCase() === tag.toLowerCase())) || '';

  if (!broadTag) {
    for (const broad of broadCatalog) {
      if (broad.patterns.some(rx => rx.test(corpus))) {
        broadTag = broad.tag;
        break;
      }
    }
  }

  if (!broadTag) broadTag = 'General';

  // Combine broad tag, matched historical tags, and AI-generated tags up to maxTags limit
  const combinedSpecific = [...matchedHistoricalTags, ...normalized.filter(tag => tag.toLowerCase() !== broadTag.toLowerCase())];
  const uniqueSpecific = [];
  const specificSeen = new Set();
  for (const t of combinedSpecific) {
    const k = t.toLowerCase();
    if (!specificSeen.has(k)) {
      specificSeen.add(k);
      uniqueSpecific.push(t);
    }
  }

  const cappedSpecific = uniqueSpecific.slice(0, Math.max(0, maxTags - 1));

  // Final dedup: ensure broadTag isn't duplicated in the result
  const finalTags = [broadTag];
  const finalSeen = new Set([broadTag.toLowerCase()]);
  for (const t of cappedSpecific) {
    const k = t.toLowerCase();
    if (!finalSeen.has(k)) {
      finalSeen.add(k);
      finalTags.push(t);
    }
  }
  return finalTags;
}


/**
 * Fetches, resizes, and compresses images into Base64 data URIs.
 * Runs concurrently for all images.
 */
async function inlineAndCompressImages(htmlString, maxWidth = 600, quality = 0.6) {
  if (!htmlString) return '';

  const parser = new DOMParser();
  const doc = parser.parseFromString(htmlString, 'text/html');
  const images = Array.from(doc.querySelectorAll('img'));

  await Promise.all(images.map(async (img) => {
    const originalSrc = img.getAttribute('src');
    if (!originalSrc || originalSrc.startsWith('data:')) return;

    let objectUrl = null;

    try {
      const absoluteUrl = new URL(originalSrc, window.location.href).href;

      const response = await fetch(absoluteUrl);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);

      const blob = await response.blob();
      objectUrl = URL.createObjectURL(blob);

      const imageElement = new Image();
      await new Promise((resolve, reject) => {
        imageElement.onload = resolve;
        imageElement.onerror = reject;
        imageElement.src = objectUrl;
      });

      let width = imageElement.width;
      let height = imageElement.height;

      if (width > maxWidth) {
        height = Math.round((height * maxWidth) / width);
        width = maxWidth;
      }

      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      // Use white background so transparent images remain readable as JPEG.
      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(0, 0, width, height);
      ctx.drawImage(imageElement, 0, 0, width, height);

      const base64Data = canvas.toDataURL('image/jpeg', quality);
      img.setAttribute('src', base64Data);
    } catch (error) {
      console.warn(`[AI Summary Helper] Failed to inline image ${originalSrc}. Leaving original URL.`, error);
    } finally {
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    }
  }));

  return doc.body.innerHTML;
}


// ── Streaming Overlay UI (RSVP Speed-reading display) ──

function createStreamingOverlay() {
  const overlay = document.createElement('div');
  overlay.id = 'aish-streaming-overlay';
  overlay.style.cssText = `
    position:fixed;top:0;left:0;width:100vw;height:100vh;
    background:linear-gradient(135deg, #0f172a 0%, #1a1f3a 100%);
    z-index:2147483647;display:flex;align-items:center;justify-content:center;
    font-family:system-ui,-apple-system,sans-serif;
  `;
  
  const savedSpeed = localStorage.getItem('aish-reading-speed') || 'medium';
  
  overlay.innerHTML = `
    <div style="text-align:center;max-width:90vw;">
      <h2 style="margin:0 0 40px;font-size:16px;color:#94a3b8;font-weight:500;letter-spacing:0.5px;text-transform:uppercase;">Speed Reading</h2>
      <div id="rsvp-word" style="font-size:72px;font-weight:700;color:#e2e8f0;line-height:1.2;min-height:90px;letter-spacing:-1px;">
        <span style="opacity:0.5;">Ready…</span>
      </div>
      <div style="margin-top:48px;display:flex;gap:24px;align-items:center;justify-content:center;flex-wrap:wrap;">
        <div style="display:flex;gap:8px;align-items:center;">
          <span style="font-size:11px;color:#94a3b8;text-transform:uppercase;letter-spacing:0.5px;">Speed</span>
          <select id="speed-control" style="background:#1e1e2e;color:#e2e8f0;border:1px solid #334155;border-radius:6px;padding:6px 10px;font-size:12px;cursor:pointer;">
            <option value="slow">Slow (300ms)</option>
            <option value="medium" selected>Medium (200ms)</option>
            <option value="fast">Fast (120ms)</option>
          </select>
        </div>
        <div style="width:1px;height:20px;background:rgba(148,163,184,0.2);"></div>
        <div style="font-size:12px;color:#94a3b8;">
          <span id="word-count">0</span><span style="opacity:0.5;"> / </span><span id="total-words">0</span>
        </div>
        <div style="width:1px;height:20px;background:rgba(148,163,184,0.2);"></div>
        <div style="font-size:12px;color:#94a3b8;">
          <span id="elapsed-time">0</span><span style="opacity:0.5;">s</span>
        </div>
      </div>
      <button id="close-tab-btn" style="margin-top:48px;padding:10px 20px;background:#3b82f6;color:#fff;border:none;border-radius:8px;font-size:13px;font-weight:600;cursor:pointer;opacity:0;transition:opacity 0.3s;">Close Tab</button>
    </div>
  `;
  
  overlay.wordIndex = 0;
  overlay.words = [];
  overlay.playing = true;
  overlay.totalTime = 0;
  overlay.readingComplete = false;
  overlay.speedConfig = { slow: 300, medium: 200, fast: 120 };
  overlay.currentSpeed = overlay.speedConfig[savedSpeed] || 200;
  
  const speedSelect = overlay.querySelector('#speed-control');
  speedSelect.value = savedSpeed;
  speedSelect.addEventListener('change', (e) => {
    overlay.currentSpeed = overlay.speedConfig[e.target.value];
    localStorage.setItem('aish-reading-speed', e.target.value);
  });
  
  const closeBtn = overlay.querySelector('#close-tab-btn');
  closeBtn.addEventListener('click', () => {
    chrome.runtime.sendMessage({ action: 'closeTabSelf' });
  });
  
  const interval = setInterval(() => {
    if (overlay.playing) {
      overlay.totalTime++;
      const el = overlay.querySelector('#elapsed-time');
      if (el) el.textContent = overlay.totalTime;
    }
    if (!document.body.contains(overlay)) clearInterval(interval);
  }, 1000);
  
  return overlay;
}

function updateStreamingOverlay(overlay, content, isError = false) {
  if (!overlay) return;
  const wordDisplay = overlay.querySelector('#rsvp-word');
  const wordCountSpan = overlay.querySelector('#word-count');
  const totalWordsSpan = overlay.querySelector('#total-words');
  const closeBtn = overlay.querySelector('#close-tab-btn');
  
  if (isError) {
    wordDisplay.innerHTML = `<span style="color:#ef4444;font-size:48px;">${content}</span>`;
    overlay.playing = false;
    if (closeBtn) closeBtn.style.opacity = '1';
    return;
  }
  
  const cleanContent = stripHtmlTags(content);
  const words = cleanContent.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return;
  
  overlay.words = words;
  overlay.totalWords = words.length;
  
  if (totalWordsSpan) totalWordsSpan.textContent = words.length;
  if (words.length > 0 && closeBtn) closeBtn.style.opacity = '1';
  
  if (!overlay.displayInterval) {
    overlay.displayInterval = setInterval(() => {
      if (!overlay.playing) return;
      
      if (overlay.wordIndex >= overlay.words.length) {
        if (overlay.displayInterval) {
          clearInterval(overlay.displayInterval);
          overlay.displayInterval = null;
          overlay.readingComplete = true;
        }
        return;
      }
      
      const word = overlay.words[overlay.wordIndex];
      wordDisplay.textContent = word;
      wordCountSpan.textContent = overlay.wordIndex + 1;
      
      overlay.wordIndex++;
    }, overlay.currentSpeed);
  }
}

function waitForSpeedReadingComplete(overlay, callback) {
  const checkInterval = setInterval(() => {
    if (!document.body.contains(overlay)) {
      clearInterval(checkInterval);
      callback();
      return;
    }
    
    if (overlay.readingComplete) {
      clearInterval(checkInterval);
      setTimeout(callback, 500);
      return;
    }
  }, 100);
}

// ── Hybrid Sidebar (fallback when native sidePanel API is unavailable) ──

function toggleHybridSidebar() {
    const sidebarId = 'ai-summary-hybrid-sidebar';
    let sidebar = document.getElementById(sidebarId);

    if (sidebar) {
        sidebar.style.transform = 'translateX(100%)';
        setTimeout(() => sidebar.remove(), 300);
        return;
    }

    sidebar = document.createElement('iframe');
    sidebar.id = sidebarId;
    sidebar.src = chrome.runtime.getURL('popup.html');
    sidebar.style.cssText = `
        position: fixed;
        top: 12px;
        right: 12px;
        width: 420px;
        height: calc(100vh - 24px);
        border: none;
        border-radius: 16px;
        box-shadow: -8px 0 32px rgba(0,0,0,0.15), 0 0 0 1px rgba(0,0,0,0.05);
        z-index: 2147483647;
        background: #faf8ff;
        transform: translateX(calc(100% + 20px));
        transition: transform 0.3s cubic-bezier(0.16, 1, 0.3, 1);
        color-scheme: light dark;
    `;
    document.body.appendChild(sidebar);
    requestAnimationFrame(() => {
        sidebar.style.transform = 'translateX(0)';
    });
}

// Improved Markdown to HTML helper
function markdownToHtml(text) {
  return text
    .replace(/^```(?:html)?\n?/gi, '').replace(/\n?```$/g, '') // Strip code blocks
    .replace(/^# (.*$)/gim, '<h1>$1</h1>')
    .replace(/^## (.*$)/gim, '<h2>$1</h2>')
    .replace(/^### (.*$)/gim, '<h3>$1</h3>')
    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.*?)\*/g, '<em>$1</em>')
    .replace(/^\* (.*$)/gim, '<ul><li>$1</li></ul>').replace(/<\/ul>\n<ul>/g, '') // Basic lists
    .replace(/\n/g, '<br>'); // Handle line breaks
}

// Function to extract all relevant text content from the page
function getAllTextContent() {
  console.log('Getting all text content');

  // 🔥 Prepend any yellow user highlights as high-priority context for the AI
  const activeHighlights = Array.from(document.querySelectorAll('.ai-user-highlight'))
    .map(el => el.textContent.trim()).filter(Boolean);
  let highlightPrefix = '';
  if (activeHighlights.length > 0) {
    highlightPrefix = `=== USER HIGHLIGHTS & ANNOTATIONS ===\nThe user explicitly marked these sections as high priority:\n- ${activeHighlights.join('\n- ')}\n\n=== MAIN CONTENT ===\n`;
  }

  // Noise selectors — elements to strip before extracting text
  const noiseSelectors = [
    'script', 'style', 'noscript', 'nav', 'header', 'footer', 'aside',
    '[role="navigation"]', '[role="banner"]', '[role="contentinfo"]',
    'iframe', 'embed', 'object', 'canvas', 'svg',
    '.ad', '.ads', '.advertisement', '.ad-wrap', '.ad-config',
    '#comments', '.comments', '.sidebar', '#sidebar',
    '.sr-only', '.visually-hidden', '.screen-reader-text', '.skip-link',
    '[aria-hidden="true"]', '.hidden', '.hide',
    '.tags', '.share-tools', '.recommended-stories', '.story-recommendations',
    '.npr-footer', '.global-stickybar', '#main-sidebar',
    '.audio-module', '.story-meta', '.storytitle', '.bucketwrap',
    '.credit-caption', '.imagewrap', '.branding',
    '#storybyline', '.storybyline-wrap', '.program-block', '.dateblock',
    '#headlineaudio', '#global-modal-mount', '#npr-plus-get-access-modal-mount',
    '#global-stickybar-mount', '#callout-end-of-story-mount',
    '#callout-end-of-story-mount-piano-wrap', '#end-of-story-recommendations-mount',
    '#end-of-story-recommendations-mount-piano', '#newsletter-acquisition-callout-data',
    '.speakable',
    '#comments', '#chat', '#live-chat-iframe', '#donation-shelf',
    '#merch-shelf', '#movie-description', '#secondary',
    '#related', '#playlist', '#header', '#masthead-container',
    'ytd-comments', 'ytd-live-chat-frame', 'ytd-merch-shelf-renderer',
    'ytd-video-secondary-info-renderer', 'ytd-comment-thread-renderer',
    'ytd-item-section-renderer', 'ytd-shelf-renderer',
    '#owner', '#subscribe-button', '#top-level-buttons-computed',
    '#vote-count', '#menu', '#action-buttons', '#actions',
    '#meta-contents', '#description-inline-expander'
  ];

  const articleEl = document.querySelector('#storytext')
    || document.querySelector('article')
    || document.querySelector('[role="main"]')
    || document.querySelector('main')
    || document.querySelector('ytd-text-inline-expander')
    || document.querySelector('ytd-section-list-renderer')
    || document.querySelector('#description')
    || document.querySelector('#content')
    || document.body;

  const clone = articleEl.cloneNode(true);

  for (const selector of noiseSelectors) {
    const nodes = clone.querySelectorAll(selector);
    for (const node of nodes) node.remove();
  }

  const badNodes = clone.querySelectorAll('script, style, button, input, iframe');
  for (const node of badNodes) node.remove();

  const allImages = clone.querySelectorAll('img');
  for (const img of allImages) {
    const src = img.src || img.getAttribute('data-src') || img.getAttribute('data-original');
    if (src && !src.startsWith('data:image')) {
      img.setAttribute('src', src);
    } else {
      img.remove();
      continue;
    }
  }

  const allElements = clone.querySelectorAll('*');
  for (const el of allElements) {
    const attrs = Array.from(el.attributes);
    for (const attr of attrs) {
      if (attr.name !== 'src' && attr.name !== 'href' && attr.name !== 'alt') {
        el.removeAttribute(attr.name);
      }
    }
  }

  let text = clone.textContent || '';
  let cleanText = text.replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();

  const noisePatterns = [
    /^Accessibility links\b/i,
    /^Skip to main content/i,
    /^Keyboard shortcuts for audio player/i,
    /^NPR 24 Hour Program Stream/i,
    /^Open Navigation Menu/i,
    /^Close Navigation Menu/i,
    /^toggle caption$/i,
    /^hide caption$/i,
    /^Sponsor Message/i,
    /^Become an NPR sponsor/i,
  ];
  cleanText = cleanText
    .split('\n')
    .filter(line => {
      const trimmed = line.trim();
      if (!trimmed) return false;
      for (const pattern of noisePatterns) {
        if (pattern.test(trimmed)) return false;
      }
      return true;
    })
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  if (cleanText.length < 500 && articleEl !== document.body) {
    console.log("Extracted content too short, falling back to full body.");
    const bodyClone = document.body.cloneNode(true);
    for (const selector of noiseSelectors) {
      const nodes = bodyClone.querySelectorAll(selector);
      for (const node of nodes) node.remove();
    }
    const bodyBadNodes = bodyClone.querySelectorAll('script, style, button, input, iframe');
    for (const node of bodyBadNodes) node.remove();

    const bodyImages = bodyClone.querySelectorAll('img');
    for (const img of bodyImages) {
      const src = img.src || img.getAttribute('data-src') || img.getAttribute('data-original');
      if (src && !src.startsWith('data:image')) {
        img.setAttribute('src', src);
      } else {
        img.remove();
        continue;
      }
    }

    const bodyAllEls = bodyClone.querySelectorAll('*');
    for (const el of bodyAllEls) {
      const attrs = Array.from(el.attributes);
      for (const attr of attrs) {
        if (attr.name !== 'src' && attr.name !== 'href' && attr.name !== 'alt') {
          el.removeAttribute(attr.name);
        }
      }
    }
    clone.innerHTML = bodyClone.innerHTML;
    text = bodyClone.textContent || '';
    cleanText = text.replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
  }

  console.log('Collected content length:', cleanText.length);
  return { html: clone.innerHTML, text: highlightPrefix + cleanText };
}

function isBackgroundDark() {
  const elementsToCheck = ['html', 'body', 'main', 'article'];
  let backgroundColor = null;

  for (const selector of elementsToCheck) {
    const element = document.querySelector(selector);
    if (element) {
      backgroundColor = window.getComputedStyle(element).backgroundColor;
      break;
    }
  }

  if (!backgroundColor) return false;

  const rgb = backgroundColor.match(/\d+/g);
  if (!rgb) return false;

  const r = parseInt(rgb[0], 10);
  const g = parseInt(rgb[1], 10);
  const b = parseInt(rgb[2], 10);
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance < 0.5;
}

function showPlaceholder(targetElement, donationMessage) {
  console.log('Showing placeholder in the selected element');

  const placeholder = document.createElement('div');
  placeholder.classList.add('placeholder');

  const isDark = isBackgroundDark();
  const textColor = isDark ? '#fff' : '#000';
  const linkColor = isDark ? '#add8e6' : '#007bff';

  placeholder.style.backgroundColor = isDark ? 'rgba(0, 0, 0, 0.7)' : 'rgba(255, 255, 255, 0.7)';
  placeholder.style.color = textColor;
  placeholder.style.border = '2px dashed #007bff';
  placeholder.style.borderRadius = '10px';
  placeholder.style.padding = '32px';

  placeholder.innerHTML = `
    <style>
     @keyframes spin {
        from { transform: rotate(0deg); }
        to { transform: rotate(360deg); }
      }
    </style>
    <div style="font-size: 24px; color: ${textColor} !important;">Fetching summary... <span style="display: inline-block; animation: spin 2s linear infinite;">⏳</span></div>
    <div style="font-size: 16px; margin-top: 10px; font-weight: bold;">
    Questions, bugs or ideas? 💡, feel free to <a href="https://philwornath.com/?ref=aish#contact" target="_blank" style="color: ${linkColor} !important; font-weight: bold;">contact me</a>
      ${donationMessage} <a href="https://link.philwornath.com/?source=aish#donate" style="color: ${linkColor} !important; font-weight: bold;" target="_blank">Support AI Summary Helper</a><br>
    </div>
  `;

  placeholder.animate([
    { backgroundColor: isDark ? 'rgba(0, 0, 0, 0.7)' : 'rgba(255, 255, 255, 0.7)' },
    { backgroundColor: isDark ? 'rgba(0, 0, 0, 1)' : 'rgba(255, 255, 255, 1)' }
  ], {
    duration: 2000,
    iterations: Infinity,
    direction: 'alternate'
  });

  targetElement.appendChild(placeholder);
}

function insertSummary(targetElement, summaryContainer) {
  console.log('Inserting summary into the target element');
  targetElement.style.backgroundColor = '';
  targetElement.style.border = '';
  targetElement.appendChild(summaryContainer);
}

function selectTargetElement() {
  console.log('Prompting user to select the target element');
  return new Promise((resolve) => {
    const messageDiv = document.createElement('div');
    messageDiv.id = 'ai-summary-message';
    messageDiv.textContent = 'Click on the element where you want to insert the summary.';
    document.body.appendChild(messageDiv);

    messageDiv.style.position = 'absolute';
    messageDiv.style.backgroundColor = '#007bff';
    messageDiv.style.color = 'white';
    messageDiv.style.padding = '5px 10px';
    messageDiv.style.borderRadius = '5px';
    messageDiv.style.fontSize = '14px';
    messageDiv.style.zIndex = '10000';
    messageDiv.style.pointerEvents = 'none';

    let lastHovered = null;

    function hoverInHandler(event) {
      const el = event.target;
      if (!el || !(el instanceof Element)) return;
      if (el.id === 'ai-summary-message' || el.closest('#ai-summary-hybrid-sidebar')) return;

      if (lastHovered && lastHovered !== el) lastHovered.classList.remove('hover-effect');
      el.classList.add('hover-effect');
      lastHovered = el;
    }

    function hoverOutHandler(event) {
      const el = event.target;
      if (!el || !(el instanceof Element)) return;
      el.classList.remove('hover-effect');
      if (lastHovered === el) lastHovered = null;
    }

    function clickHandler(event) {
      event.preventDefault();
      event.stopPropagation();

      document.body.style.cursor = 'default';
      document.removeEventListener('click', clickHandler);
      document.removeEventListener('mouseover', hoverInHandler);
      document.removeEventListener('mouseout', hoverOutHandler);
      document.removeEventListener('mousemove', mouseMoveHandler);

      if (lastHovered) {
        lastHovered.classList.remove('hover-effect');
        lastHovered = null;
      }

      messageDiv.remove();

      const targetElement = event.target;
      resolve(targetElement);
    }

    function mouseMoveHandler(event) {
      messageDiv.style.left = event.pageX + 15 + 'px';
      messageDiv.style.top = event.pageY + 15 + 'px';
    }

    document.addEventListener('mouseover', hoverInHandler);
    document.addEventListener('mouseout', hoverOutHandler);
    document.addEventListener('click', clickHandler, { once: true });
    document.addEventListener('mousemove', mouseMoveHandler);
  });
}

function updateDebugPanel(text, apiUrl) {
  let panel = document.getElementById('ai-summary-debug');
  if (!panel) {
    panel = document.createElement('div');
    panel.id = 'ai-summary-debug';
    panel.style.cssText = `position:fixed;right:10px;bottom:10px;width:350px;max-height:40vh;overflow:auto;background:#222;color:#0f0;padding:10px;z-index:10000;font-family:monospace;font-size:11px;border-radius:5px;box-shadow:0 0 10px rgba(0,0,0,0.5);`;
    document.body.appendChild(panel);
  }
  panel.innerHTML = `<strong>Debug (${apiUrl})</strong><hr><pre style="white-space:pre-wrap">${text}</pre>`;
}

})();