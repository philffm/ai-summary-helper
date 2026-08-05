// content.js
// Mark that content script is loaded
window.contentScriptLoaded = true;

const API_BASE = 'https://api.byphil.eu';
// const API_BASE = 'http://localhost:3000'; // for local testing - comment out for production

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

// Function to get a random donation message
function getRandomDonationMessage() {
  const randomIndex = Math.floor(Math.random() * donationMessages.length);
  return donationMessages[randomIndex];
}

let servicesData = [];
let modelConfig = {};

// ─────────────────────────────────────────────────────────────────────────────
// ── Annotation Storage Keys (per page) ───────────────────────────────────────
// ─────────────────────────────────────────────────────────────────────────────

const USER_ANNOTATION_KEY = `annotations_${window.location.origin}${window.location.pathname}`;
const GHOST_ANNOTATION_KEY = `ghost_annotations_${window.location.origin}${window.location.pathname}`;

// Cache the setting so sync reads don't block event handlers
let highlightingEnabled = true;
chrome.storage.sync.get('highlightingEnabled', (data) => {
  highlightingEnabled = data.highlightingEnabled !== false; // default on
});
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'sync' && 'highlightingEnabled' in changes) {
    highlightingEnabled = changes.highlightingEnabled.newValue !== false;
  }
});

// Restore persisted highlights as soon as the DOM is ready
document.addEventListener('mouseup', handleTextSelection);
document.addEventListener('click', handleHighlightClick);

if (document.readyState === 'interactive' || document.readyState === 'complete') {
  restoreHighlights();
  restoreGhostHighlights();
} else {
  document.addEventListener('DOMContentLoaded', () => {
    restoreHighlights();
    restoreGhostHighlights();
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// ── 1. Yellow User Annotations ───────────────────────────────────────────────
// ─────────────────────────────────────────────────────────────────────────────

function handleTextSelection(event) {
  if (!highlightingEnabled) return;
  const selection = window.getSelection();
  const selectedText = selection ? selection.toString().trim() : '';
  if (!selectedText || selectedText.length < 3) return;

  const anchorNode = selection.anchorNode;
  if (anchorNode && anchorNode.parentElement &&
     (anchorNode.parentElement.closest('#ai-summary-hybrid-sidebar') ||
      ['INPUT', 'TEXTAREA'].includes(anchorNode.parentElement.tagName))) return;

  showHighlightTooltip(event.pageX, event.pageY, () => {
    applyHighlight(selection);
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

function applyHighlight(selection) {
  if (!selection.rangeCount) return;
  const range = selection.getRangeAt(0);
  const text  = selection.toString().trim();
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
  saveHighlightToStorage(text);
}

function saveHighlightToStorage(text) {
  chrome.storage.local.get([USER_ANNOTATION_KEY], (res) => {
    const list = res[USER_ANNOTATION_KEY] || [];
    if (!list.includes(text)) {
      list.push(text);
      chrome.storage.local.set({ [USER_ANNOTATION_KEY]: list });
    }
  });
}

function restoreHighlights() {
  if (!highlightingEnabled) return;
  chrome.storage.local.get([USER_ANNOTATION_KEY], (res) => {
    (res[USER_ANNOTATION_KEY] || []).forEach(text => highlightTextOnPage(document.body, text, false));
  });
}

function highlightTextOnPage(element, text, isGhost) {
  if (!element || !text) return;
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT, null, false);
  let node;
  while ((node = walker.nextNode())) {
    const idx = node.nodeValue.indexOf(text);
    if (idx !== -1 && node.parentElement &&
        !node.parentElement.classList.contains('ai-user-highlight') &&
        !node.parentElement.classList.contains('ai-ghost-highlight')) {
      const range = document.createRange();
      range.setStart(node, idx);
      range.setEnd(node, idx + text.length);
      const mark = document.createElement('mark');
      if (isGhost) {
        mark.className = 'ai-ghost-highlight';
        mark.dataset.ghostText = text;
        mark.title = 'AI Ghost Highlight — click to keep or dismiss';
        mark.style.cssText = 'background-color:rgba(186,230,253,0.65);color:#0369a1;border-bottom:2px dashed #0284c7;border-radius:2px;padding:0 2px;cursor:pointer;';
      } else {
        mark.className = 'ai-user-highlight';
        mark.title = 'Click to remove highlight';
        mark.style.cssText = 'background-color:#fef08a;color:#1f2937;border-radius:2px;padding:0 2px;cursor:pointer;';
      }
      try { range.surroundContents(mark); } catch (e) { /* cross-node range — skip */ }
      break;
    }
  }
}

function handleHighlightClick(event) {
  const target = event.target;
  if (target && target.classList.contains('ai-user-highlight')) {
    const textToRemove = target.textContent.trim();
    const parent = target.parentNode;
    while (target.firstChild) parent.insertBefore(target.firstChild, target);
    parent.removeChild(target);
    chrome.storage.local.get([USER_ANNOTATION_KEY], (res) => {
      const list = (res[USER_ANNOTATION_KEY] || []).filter(i => i !== textToRemove);
      chrome.storage.local.set({ [USER_ANNOTATION_KEY]: list });
    });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// ── 2. Light Blue AI Ghost Annotations ───────────────────────────────────────
// ─────────────────────────────────────────────────────────────────────────────

function applyGhostHighlights(quotes = []) {
  if (!highlightingEnabled || !quotes || !quotes.length) return;
  chrome.storage.local.get([GHOST_ANNOTATION_KEY], (res) => {
    let saved = res[GHOST_ANNOTATION_KEY] || [];
    quotes.forEach(quote => {
      const clean = quote.trim();
      if (clean.length < 5) return;
      if (!saved.includes(clean)) saved.push(clean);
      highlightTextOnPage(document.body, clean, true);
    });
    chrome.storage.local.set({ [GHOST_ANNOTATION_KEY]: saved });
  });
}

function restoreGhostHighlights() {
  if (!highlightingEnabled) return;
  chrome.storage.local.get([GHOST_ANNOTATION_KEY], (res) => {
    (res[GHOST_ANNOTATION_KEY] || []).forEach(text => highlightTextOnPage(document.body, text, true));
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

  const text = markElement.dataset.ghostText || markElement.textContent.trim();

  document.getElementById('btn-convert-yellow').onclick = () => {
    removeGhostFromStorage(text);
    markElement.className = 'ai-user-highlight';
    markElement.title = 'Click to remove highlight';
    markElement.style.cssText = 'background-color:#fef08a;color:#1f2937;border-radius:2px;padding:0 2px;cursor:pointer;';
    delete markElement.dataset.ghostText;
    saveHighlightToStorage(text);
    menu.style.display = 'none';
  };
  document.getElementById('btn-dismiss-ghost').onclick = () => {
    removeGhostFromStorage(text);
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

function removeGhostFromStorage(text) {
  chrome.storage.local.get([GHOST_ANNOTATION_KEY], (res) => {
    const list = (res[GHOST_ANNOTATION_KEY] || []).filter(i => i !== text);
    chrome.storage.local.set({ [GHOST_ANNOTATION_KEY]: list });
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// ── Decision Dialog (shown in-page for context menu "Summarize & Close") ─────
// ─────────────────────────────────────────────────────────────────────────────

function showDecisionDialog(onConfirm) {
  // Remove any stale overlay
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

  // Chip selection
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
    // Transition overlay to "summarizing" state
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
    // The background passes info.selectionText — find and highlight it on the page
    const text = request.text?.trim();
    if (text && highlightingEnabled) {
      highlightTextOnPage(document.body, text, false);
      saveHighlightToStorage(text);
    }
    sendResponse({ status: 'ok' });
    return true;
  }

  if (request.action === 'contextMenuClearHighlights') {
    // Remove all yellow + ghost highlights from DOM and storage
    document.querySelectorAll('.ai-user-highlight, .ai-ghost-highlight').forEach(el => {
      const parent = el.parentNode;
      while (el.firstChild) parent.insertBefore(el.firstChild, el);
      parent.removeChild(el);
    });
    chrome.storage.local.remove([USER_ANNOTATION_KEY, GHOST_ANNOTATION_KEY]);
    sendResponse({ status: 'ok' });
    return true;
  }

  if (request.action === 'toggleHybridSidebar') {
    toggleHybridSidebar();
    sendResponse({ status: 'Sidebar toggled' });
    return true;
  }

  if (request.action === 'fetchSummaryAndClose') {
    sendResponse({ success: true });

    // Show an inline decision dialog — no popup required
    showDecisionDialog((decision) => {
      // Create beautiful streaming overlay
      const streamOverlay = createStreamingOverlay();
      document.body.appendChild(streamOverlay);
      
      // Remove decision dialog
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
            // Embed decision metadata into the article
            article.decisionTimeframe = decision.timeframe;
            article.decisionReason = decision.reason;
            article.decisionSavedAt = decision.savedAt;
            article.isDecision = true;
            
            // Update the article in storage
            chrome.storage.local.get({ articles: [] }, (data) => {
              const articles = data.articles || [];
              // Find and update the article by timestamp
              const idx = articles.findIndex(a => a.timestamp === article.timestamp);
              if (idx >= 0) {
                articles[idx] = article;
                chrome.storage.local.set({ articles }, () => {
                  // Schedule alarm based on article metadata
                  chrome.runtime.sendMessage({ action: 'scheduleDecisionAlarm', article });
                  // Wait for speed reading to complete before closing
                  waitForSpeedReadingComplete(streamOverlay, () => {
                    chrome.runtime.sendMessage({ action: 'closeTabSelf' });
                  });
                });
              }
            });
          } else {
            // If no article, show error and allow manual close
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
    // 1. Acknowledge immediately to prevent port errors in the popup
    sendResponse({ success: true, message: summaryMode === 'extension' ? 'Fetching summary...' : 'Selection started' });

    // 2. Run the logic independently
    (async () => {

      // Extension mode: skip element selection, use a temp off-screen container
      if (summaryMode === 'extension') {
        chrome.storage.sync.get(['debugEnabled', 'prompt'], (data) => {
          const promptToUse = popupPrompt || data.prompt || 'Summarize the following content:';
          // Use message-passed summaryLength first, fall back to 200
          const length = msgSummaryLength || 200;
          // Create a hidden placeholder so fetchSummary has a target to stream into
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

      // Inline mode: ask user to pick an insertion point
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
    
    return false; // Port closes after sendResponse
  } else if (request.action === 'setServices') {
    servicesData = request.services;
    console.log('Services data received:', servicesData);
  } else if (request.action === 'setModelConfig') {
    modelConfig = request.modelConfig;
    console.log('Model configuration received:', modelConfig);
  }
});

async function fetchSummary(additionalQuestions, selectedLanguage, prompt, summaryLength, targetElement, debugEnabled, summaryMode = 'extension') {
  // Increase tokenLimit for Gemini-style providers. This is an approximate
  // token limit (measured in tokens) used to decide how much of the page to
  // include. We use character-based truncation below (chars ≈ tokens * 4).
  const tokenLimit = 20000; // generous default for larger inputs

  const { html: contentHtml, text: contentText } = getAllTextContent();
  const truncatedContent = truncateToTokenLimit(contentText, tokenLimit);

  // Show placeholder after fetching content
  const donationMessage = getRandomDonationMessage();
  showPlaceholder(targetElement, donationMessage);

  return new Promise((resolve, reject) => {
    chrome.storage.sync.get(['activeService', 'servicesConfig', 'connectionMode', 'preferredCloudModel', 'licenseKey', 'pb_token'], async (data) => {
      const localAuth = await chrome.storage.local.get(['pb_token']).catch(() => ({}));
      const sessionToken = localAuth?.pb_token || data.pb_token || '';
      const connectionMode = data.connectionMode || 'cloud';
      let activeService = data.activeService || 'openai';
      let cfg = (data.servicesConfig || {})[activeService] || {};
      let apiKey = cfg.apiKey || '';
      
      // Fixed: The modelConfig from 'setModelConfig' was overriding the Cloud Mode selection
      // because it was being prioritized at the top level. We now apply it only if
      // we are NOT in cloud mode.
      let apiUrl = cfg.endpoint;
      let modelIdentifier = cfg.activeModelId || (Array.isArray(cfg.customModel) ? cfg.customModel[0] : cfg.customModel) || cfg.model;

      // ── Cloud Mode Override ──────────────────────────────────────────
      if (connectionMode === 'cloud') {
        activeService = 'cloud'; // Internal flag for the proxy
        apiUrl = `${API_BASE}/v1/projects/ai_summary_helper/chat`;
        modelIdentifier = data.preferredCloudModel || 'google/gemini-2.5-flash';
        
        // Use PB Token if available, else fallback to legacy licenseKey
        apiKey = sessionToken || data.licenseKey || ''; 
      } else if (modelConfig) {
        // Only apply contextual overrides (from individual service chips) 
        // if we are in local/developer mode.
        apiUrl = modelConfig.endpointUrl || apiUrl;
        modelIdentifier = modelConfig.modelIdentifier || modelIdentifier;
      }

      // Check if API key is optional for this service
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
        } catch (e) {
          console.warn('Could not load services.json for apiKeyOptional check', e);
        }
      } else {
        // Cloud mode handles its own auth (license or installId)
        apiKeyOptional = true; 
      }

      // Hard fallback for Ollama just in case fetch fails
      if (activeService === 'ollama') apiKeyOptional = true;

      if (!apiKey && !apiKeyOptional) {
        alert('Please set your API key in the extension popup.');
        reject(new Error('API key not set'));
        return;
      }

      try {
        // Defensive fallback: if modelIdentifier is missing (migration not run),
        // attempt to read the default model from the bundled services.json so
        // we always send a `model` parameter to APIs like OpenAI.
        if (!modelIdentifier && connectionMode !== 'cloud') {
          try {
            const servicesUrl = chrome.runtime.getURL('services.json');
            const servicesResp = await fetch(servicesUrl);
            if (servicesResp && servicesResp.ok) {
              const servicesList = await servicesResp.json();
              const svcMeta = servicesList.find(s => (s.id || '').toLowerCase() === (activeService || '').toLowerCase());
              modelIdentifier = svcMeta?.defaultModel || '';
            }
          } catch (e) {
            console.warn('Could not load services.json for fallback modelIdentifier', e);
          }
        }

        if (!apiUrl) {
          const msg = 'Model endpoint is not configured. Open the extension settings and set a valid endpoint.';
          const placeholderEl = targetElement.querySelector('.placeholder');
          if (placeholderEl) placeholderEl.innerHTML = msg;
          throw new Error(msg);
        }

        try {
          new URL(apiUrl);
        } catch (urlErr) {
          const msg = `Configured endpoint is not a valid URL: ${apiUrl}`;
          const placeholderEl = targetElement.querySelector('.placeholder');
          if (placeholderEl) placeholderEl.innerHTML = msg;
          throw new Error(msg);
        }

        // Prepare request and headers. Gemini requires a different shape and
        // uses the `x-goog-api-key` header instead of Bearer tokens.
        const headers = { 'Content-Type': 'application/json' };
        let requestBody;
        let finalApiUrl = apiUrl;

        if (connectionMode === 'cloud') {
          // Cloud Proxy uses a unified OpenAI-compatible streaming interface
          if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;
          
          // Pull installId for anonymous tier tracking
          const { installId } = await chrome.storage.local.get('installId');
          if (installId) headers['X-Install-ID'] = installId;

          requestBody = JSON.stringify({
            model: modelIdentifier,
            messages: [
              { role: 'system', content: 'You are a summarizer returning HTML <div> with <h2> and <p> tags. At the end include two HTML comments: one with 3-5 broad topic tags: <!-- TAGS: tag1, tag2, tag3 --> and one with 2-5 short key quotes verbatim from the source text: <!-- GHOST_HIGHLIGHTS: ["quote 1", "quote 2"] -->.' },
              { role: 'user', content: `Language: ${selectedLanguage}. Limit: ${summaryLength} words. Instruction: ${prompt}. Additional Context/Questions: ${additionalQuestions}. Content: ${truncatedContent}` }
            ],
            stream: true
          });
        } else if (activeService === 'gemini') {
          // Switch to streaming endpoint for Gemini
          finalApiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(modelIdentifier)}:streamGenerateContent?alt=sse`;
          headers['x-goog-api-key'] = apiKey;
          
          const parts = [
            { text: `Please produce ONLY valid HTML. Return a single <div> containing <h2> and <p> tags. At the end include two HTML comments: one with 3-5 broad topic tags: <!-- TAGS: tag1, tag2, tag3 --> and one with 2-5 short key quotes verbatim from the source text: <!-- GHOST_HIGHLIGHTS: ["quote 1", "quote 2"] -->. Output Language: ${selectedLanguage}. Limit: ${summaryLength} words.` },
            { text: `Prompt Context: ${prompt}` },
            { text: `Additional Questions/Instructions: ${additionalQuestions}` },
            { text: truncatedContent }
          ];

          requestBody = JSON.stringify({ contents: [{ role: 'user', parts }] });
        } else {
          // OpenAI / Ollama streaming
          headers['Authorization'] = `Bearer ${apiKey}`;
          requestBody = JSON.stringify({
            model: modelIdentifier,
            messages: [
              { role: 'system', content: 'You are a summarizer returning HTML <div> with <h2> and <p> tags. At the end include two HTML comments: one with 3-5 broad topic tags: <!-- TAGS: tag1, tag2, tag3 --> and one with 2-5 short key quotes verbatim from the source text: <!-- GHOST_HIGHLIGHTS: ["quote 1", "quote 2"] -->.' },
              { role: 'user', content: `Language: ${selectedLanguage}. Limit: ${summaryLength} words. Instruction: ${prompt}. Additional Context/Questions: ${additionalQuestions}. Content: ${truncatedContent}` }
            ],
            stream: true
          });
        }

        // Generic Debug Panel Trigger
        if (debugEnabled) {
          updateDebugPanel(`Requesting ${modelIdentifier}...\n\nURL: ${finalApiUrl}\n\nPayload: ${requestBody}`, finalApiUrl);
        }

        // Helper: relay progress back to the popup
        const relay = (action, payload = {}) => {
          if (summaryMode === 'extension') {
            chrome.runtime.sendMessage({ action, ...payload }).catch(() => {});
          }
        };

        // STREAMING LOGIC
        let summary = "";
        const streamContainer = targetElement.querySelector('.placeholder');
        const outputArea = document.createElement('div');
        outputArea.style.marginTop = '15px';
        outputArea.style.borderTop = '1px solid #ccc';
        outputArea.style.paddingTop = '10px';
        streamContainer.appendChild(outputArea);

        relay('summaryProgress', { chunk: 'Connected to API, waiting for response…' });

        // Track start time for elapsed reporting
        const streamStart = Date.now();

        const port = chrome.runtime.connect({ name: 'streamFetch' });
        
        port.postMessage({
          action: 'startFetch',
          apiUrl: finalApiUrl,
          headers: headers,
          body: requestBody
        });

        let buffer = '';

        port.onMessage.addListener((msg) => {
          if (msg.error) {
            console.error('❌ Error:', msg.error);
            relay('summaryError', { error: msg.error });
            targetElement.querySelector('.placeholder').innerHTML = `<b>Error:</b> ${msg.error}`;
            reject(new Error(msg.error));
            port.disconnect();
            return;
          }

          if (msg.done) {
            // Finalize UI
            streamContainer.remove();
            
            const finalHtml = markdownToHtml(summary);
            
            // Extract tags
            let tags = [];
            const tagMatch = finalHtml.match(/<!--\s*TAGS:\s*([^>]+)\s*-->/i);
            if (tagMatch) {
              tags = tagMatch[1].split(',').map(t => t.trim().replace(/^#/, '')).filter(Boolean);
            }
            // Also scrape #hashtags from the summary text itself
            const hashTags = summary.match(/#(\w+)/g) || [];
            for (const ht of hashTags) {
              const clean = ht.replace('#', '');
              if (!tags.includes(clean)) tags.push(clean);
            }

            // Extract and apply ghost highlights
            let ghostQuotes = [];
            const ghostMatch = finalHtml.match(/<!--\s*GHOST_HIGHLIGHTS:\s*(\[[\s\S]*?\])\s*-->/i);
            if (ghostMatch) {
              try { ghostQuotes = JSON.parse(ghostMatch[1]); } catch (e) { /* malformed JSON — skip */ }
            }
            if (ghostQuotes.length > 0) applyGhostHighlights(ghostQuotes);

            // Strip both comments from the rendered HTML
            const cleanHtml = finalHtml
              .replace(/<!--\s*GHOST_HIGHLIGHTS:\s*\[[\s\S]*?\]\s*-->/gi, '')
              .replace(/<!--\s*TAGS:\s*[^>]+\s*-->/gi, '')
              .trim();
            
            if (summaryMode === 'inline') {
              const summaryContainer = document.createElement('blockquote');
              summaryContainer.style.cssText = "border-left: 4px solid #007bff; padding: 15px; margin: 20px 0; background: rgba(0,123,255,0.05);";
              summaryContainer.innerHTML = `<div><h2 style="margin-top:0">AI Summary 🧙</h2>${cleanHtml}</div>`;
              insertSummary(targetElement, summaryContainer);
            } else {
              // Extension mode: clean up the hidden placeholder, summary is saved to storage
              targetElement.remove();
              relay('summaryComplete', {
                summary: cleanHtml,
                title: document.title,
                url: window.location.href,
                timestamp: new Date().toISOString(),
                tags: tags,
                modelId: modelIdentifier,
                content: contentHtml
              });
            }
            
            saveToLocalStorage(contentHtml, cleanHtml, window.location.href, document.title, '', tags, modelIdentifier, summaryLength)
              .then(savedArticle => {
                resolve({ success: true, article: savedArticle });
              })
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
                  
                  // Live update the UI
                  outputArea.innerHTML = `<small style="opacity:0.7; color: #666;">Drafting summary...</small><br>${markdownToHtml(summary)}`;
                  if (debugEnabled) updateDebugPanel(summary, finalApiUrl);
                  
                  // Update streaming overlay if active (for fetchSummaryAndClose flow)
                  const streamingOverlay = document.getElementById('aish-streaming-overlay');
                  if (streamingOverlay) {
                    updateStreamingOverlay(streamingOverlay, summary, false);
                  }
                  
                  // Throttled progress to popup (every ~10 words)
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

// Function to save content, summary, URL, title, and description to local storage
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

// Function to truncate text content to fit within a token limit.
// Previous implementation sliced by UTF-8 bytes which is too aggressive for
// Gemini (and causes early truncation). Use a rough tokens -> chars
// approximation (chars ≈ tokens * 4) and slice by characters instead.
function truncateToTokenLimit(text, maxTokens) {
  if (!text) return text;
  // rough approx: 1 token ≈ 4 characters (varies by language)
  const approxTokens = Math.ceil(text.length / 4);
  if (approxTokens <= maxTokens) return text;
  const allowedChars = Math.max(1000, Math.floor(maxTokens * 4));
  return text.slice(0, allowedChars);
}

// Split a long text into chunks of up to `chunkSize` characters.
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
  
  // Get saved speed preference or default to 'medium'
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
  
  // State
  overlay.wordIndex = 0;
  overlay.words = [];
  overlay.playing = true;
  overlay.totalTime = 0;
  overlay.readingComplete = false;
  overlay.speedConfig = { slow: 300, medium: 200, fast: 120 };
  overlay.currentSpeed = overlay.speedConfig[savedSpeed] || 200;
  
  // Speed control listener
  const speedSelect = overlay.querySelector('#speed-control');
  speedSelect.value = savedSpeed;
  speedSelect.addEventListener('change', (e) => {
    overlay.currentSpeed = overlay.speedConfig[e.target.value];
    localStorage.setItem('aish-reading-speed', e.target.value);
  });
  
  // Close button listener
  const closeBtn = overlay.querySelector('#close-tab-btn');
  closeBtn.addEventListener('click', () => {
    chrome.runtime.sendMessage({ action: 'closeTabSelf' });
  });
  
  // Start elapsed time counter
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
  
  // Strip HTML tags from content
  const cleanContent = stripHtmlTags(content);
  
  // Split content into words
  const words = cleanContent.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return;
  
  overlay.words = words;
  overlay.totalWords = words.length;
  
  if (totalWordsSpan) totalWordsSpan.textContent = words.length;
  
  // Show close button once we have content
  if (words.length > 0 && closeBtn) {
    closeBtn.style.opacity = '1';
  }
  
  // Don't start auto-play here, let the streaming continue until done
  // Just update the display with the latest content
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
    }, overlay.currentSpeed); // Use dynamic speed from localStorage
  }
}

// ── Wait for Speed Reading to Complete ──
function waitForSpeedReadingComplete(overlay, callback) {
  const checkInterval = setInterval(() => {
    if (!document.body.contains(overlay)) {
      clearInterval(checkInterval);
      callback();
      return;
    }
    
    if (overlay.readingComplete) {
      clearInterval(checkInterval);
      // Give a tiny delay so the last word displays before closing
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

  // Prepend any yellow user highlights as high-priority context for the AI
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
    // visually hidden / screen-reader-only text
    '.sr-only', '.visually-hidden', '.screen-reader-text', '.skip-link',
    '[aria-hidden="true"]', '.hidden', '.hide',
    // NPR-specific junk
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
    // YouTube-specific junk
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

  // Find the best content container
  const articleEl = document.querySelector('#storytext')     // NPR
    || document.querySelector('article')                      // generic
    || document.querySelector('[role="main"]')                // fallback
    || document.querySelector('main')                         // last resort
    || document.querySelector('ytd-text-inline-expander')     // YouTube description
    || document.querySelector('ytd-section-list-renderer')    // YouTube comments/sections
    || document.querySelector('#description')                 // YouTube fallback
    || document.querySelector('#content')                     // YouTube fallback
    || document.body;

  // Clone just the content container
  const clone = articleEl.cloneNode(true);

  // Strip noise from the clone
  for (const selector of noiseSelectors) {
    const nodes = clone.querySelectorAll(selector);
    for (const node of nodes) node.remove();
  }

  // ── Sanitization Block: Remove all HTML bloat but keep clean semantic tags ──
  // 1. Remove interactive or dead nodes
  const badNodes = clone.querySelectorAll('script, style, button, input, iframe');
  for (const node of badNodes) node.remove();

  // 2. Clean up images: resolve src for lazy-loaded images, then strip all tracking attributes
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

  // 3. Strip every single attribute except src, href, alt from all elements
  const allElements = clone.querySelectorAll('*');
  for (const el of allElements) {
    const attrs = Array.from(el.attributes);
    for (const attr of attrs) {
      if (attr.name !== 'src' && attr.name !== 'href' && attr.name !== 'alt') {
        el.removeAttribute(attr.name);
      }
    }
  }
  // ── End Sanitization Block ─────────────────────────────────────────────────

  // Use textContent on the cleaned clone (reliable, works detached)
  let text = clone.textContent || '';

  // Clean up whitespace
  let cleanText = text
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  // Post-process: strip common noise lines
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
      if (!trimmed) return false; // skip empty lines
      for (const pattern of noisePatterns) {
        if (pattern.test(trimmed)) return false;
      }
      return true;
    })
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  // If too short, fall back to full body
  if (cleanText.length < 500 && articleEl !== document.body) {
    console.log("Extracted content too short, falling back to full body.");
    const bodyClone = document.body.cloneNode(true);
    for (const selector of noiseSelectors) {
      const nodes = bodyClone.querySelectorAll(selector);
      for (const node of nodes) node.remove();
    }
    // Apply sanitization on the body clone too
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
    // Use the body clone for both HTML and text
    clone.innerHTML = bodyClone.innerHTML;
    text = bodyClone.textContent || '';
    cleanText = text
      .replace(/[ \t]+/g, ' ')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  console.log('Collected content length:', cleanText.length);
  // Return both the cleaned HTML (for storage) and the plain text (for AI prompt)
  return { html: clone.innerHTML, text: highlightPrefix + cleanText };
}

// Simplified function to determine if the background is light or dark
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

  if (!backgroundColor) return false; // Default to light if unable to determine

  const rgb = backgroundColor.match(/\d+/g);
  if (!rgb) return false; // Default to light if unable to determine

  // Calculate luminance
  const r = parseInt(rgb[0], 10);
  const g = parseInt(rgb[1], 10);
  const b = parseInt(rgb[2], 10);
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance < 0.5; // Dark if luminance is less than 0.5
}

// Function to show "Fetching" placeholder without removing the original content
function showPlaceholder(targetElement, donationMessage) {
  console.log('Showing placeholder in the selected element');

  const placeholder = document.createElement('div');
  placeholder.classList.add('placeholder');

  const isDark = isBackgroundDark();
  const textColor = isDark ? '#fff' : '#000';
  const linkColor = isDark ? '#add8e6' : '#007bff'; // Light blue for dark backgrounds, blue for light backgrounds

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

  // Add subtle animation to the placeholder
  placeholder.animate([
    { backgroundColor: isDark ? 'rgba(0, 0, 0, 0.7)' : 'rgba(255, 255, 255, 0.7)' },
    { backgroundColor: isDark ? 'rgba(0, 0, 0, 1)' : 'rgba(255, 255, 255, 1)' }
  ], {
    duration: 2000,
    iterations: Infinity,
    direction: 'alternate'
  });

  targetElement.appendChild(placeholder); // Append the placeholder without removing existing content
}
// Automatically insert the summary
function insertSummary(targetElement, summaryContainer) {

  console.log('Inserting summary into the target element');
  targetElement.style.backgroundColor = ''; // Remove highlight
  targetElement.style.border = ''; // Remove dashed border
  targetElement.appendChild(summaryContainer); // Append the summary to the target element
}

// Function to let the user select a target element
function selectTargetElement() {
  console.log('Prompting user to select the target element');
  return new Promise((resolve) => {
    // Create the message div
    const messageDiv = document.createElement('div');
    messageDiv.id = 'ai-summary-message';
    messageDiv.textContent = 'Click on the element where you want to insert the summary.';
    document.body.appendChild(messageDiv);

    // Style the message div to appear near the cursor
    messageDiv.style.position = 'absolute';
    messageDiv.style.backgroundColor = '#007bff';
    messageDiv.style.color = 'white';
    messageDiv.style.padding = '5px 10px';
    messageDiv.style.borderRadius = '5px';
    messageDiv.style.fontSize = '14px';
    messageDiv.style.zIndex = '10000';
    messageDiv.style.pointerEvents = 'none'; // Make sure the div does not interfere with clicks

    // Move the message div with the cursor
    document.addEventListener('mousemove', (event) => {
      messageDiv.style.left = event.pageX + 15 + 'px'; // Slight offset to the right of the cursor
      messageDiv.style.top = event.pageY + 15 + 'px';  // Slight offset below the cursor
    });

    // Function to toggle hover effect
    function hoverHandler(event) {
      event.target.classList.toggle('hover-effect');
    }

    // Function to handle click and resolve the target element
    function clickHandler(event) {
      event.preventDefault();
      event.stopPropagation();

      // Remove event listeners
      document.body.style.cursor = 'default';
      document.removeEventListener('click', clickHandler);
      document.removeEventListener('mouseover', hoverHandler);
      document.removeEventListener('mouseout', hoverHandler);
      document.removeEventListener('mousemove', mouseMoveHandler);

      // Remove the message
      messageDiv.remove();

      // Resolve the target element
      const targetElement = event.target;
      resolve(targetElement);
    }

    // Mouse move event handler to move the message
    function mouseMoveHandler(event) {
      messageDiv.style.left = event.pageX + 15 + 'px';
      messageDiv.style.top = event.pageY + 15 + 'px';
    }

    // Add the necessary event listeners
    document.addEventListener('mouseover', hoverHandler);
    document.addEventListener('mouseout', hoverHandler);
    document.addEventListener('click', clickHandler, { once: true });
    document.addEventListener('mousemove', mouseMoveHandler);
  });
}

/**
 * Universal Debug Panel - Now handles all models
 */
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

