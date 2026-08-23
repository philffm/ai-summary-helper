// content/ui.js
// DOM/UI injection helpers for the content script. These create and manage
// in-page UI (tooltips, menus, overlays, sidebar, placeholder, debug panel).

import { stripHtmlTags, isBackgroundDark } from './extractor.js';

export function ensureHighlightUiStyles() {
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

// ── Decision Dialog (shown in-page for context menu "Summarize & Close") ─────

export function showDecisionDialog(onConfirm) {
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

// ── Streaming Overlay UI (RSVP Speed-reading display) ──

export function createStreamingOverlay() {
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

export function updateStreamingOverlay(overlay, content, isError = false) {
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

export function waitForSpeedReadingComplete(overlay, callback) {
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

export function toggleHybridSidebar() {
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

// ── Placeholder / Insertion helpers ──

export function showPlaceholder(targetElement, donationMessage) {
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

export function insertSummary(targetElement, summaryContainer) {
  console.log('Inserting summary into the target element');
  targetElement.style.backgroundColor = '';
  targetElement.style.border = '';
  targetElement.appendChild(summaryContainer);
}

export function selectTargetElement() {
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

export function updateDebugPanel(text, apiUrl) {
  let panel = document.getElementById('ai-summary-debug');
  if (!panel) {
    panel = document.createElement('div');
    panel.id = 'ai-summary-debug';
    panel.style.cssText = `position:fixed;right:10px;bottom:10px;width:350px;max-height:40vh;overflow:auto;background:#222;color:#0f0;padding:10px;z-index:10000;font-family:monospace;font-size:11px;border-radius:5px;box-shadow:0 0 10px rgba(0,0,0,0.5);`;
    document.body.appendChild(panel);
  }
  panel.innerHTML = `<strong>Debug (${apiUrl})</strong><hr><pre style="white-space:pre-wrap">${text}</pre>`;
}
