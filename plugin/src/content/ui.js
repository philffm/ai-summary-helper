import { debug } from '../modules/log.js';
import { newSidebarToken, SIDEBAR_HASH_KEY, SIDEBAR_TOKEN_FIELD } from '../modules/sidebarChannel.js';
// content/ui.js
// DOM/UI injection helpers for the content script. These create and manage
// in-page UI (tooltips, menus, overlays, sidebar, placeholder, debug panel).

import { stripHtmlTags, isBackgroundDark } from './extractor.js';
import { escapeHtml } from './markdown.js';

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

// ── Hybrid Sidebar (fallback when native sidePanel API is unavailable) ──

// Token in the sidebar's #hash that the popup requires on every postMessage (modules/sidebarChannel.js).
let sidebarToken = '';

/** Wrap a message for the hybrid sidebar iframe, or null when no sidebar of ours was opened. */
export function sidebarMessage(msg) {
    return sidebarToken ? { ...msg, [SIDEBAR_TOKEN_FIELD]: sidebarToken } : null;
}

/** Open the in-page sidebar if it is not open yet (never closes it). Returns the iframe. */
export function ensureHybridSidebar() {
    if (!document.getElementById('ai-summary-hybrid-sidebar')) toggleHybridSidebar();
    return document.getElementById('ai-summary-hybrid-sidebar');
}

export function toggleHybridSidebar() {
    const sidebarId = 'ai-summary-hybrid-sidebar';
    let sidebar = document.getElementById(sidebarId);

    if (sidebar) {
        sidebar.style.transform = 'translateX(100%)';
        setTimeout(() => sidebar.remove(), 300);
        return;
    }

    sidebarToken = newSidebarToken();
    sidebar = document.createElement('iframe');
    sidebar.id = sidebarId;
    sidebar.src = chrome.runtime.getURL('popup.html') + '#' + SIDEBAR_HASH_KEY + '=' + sidebarToken;
    sidebar.style.cssText = `
        position: fixed;
        top: 12px;
        right: 12px;
        width: min(420px, 100vw - 24px);
        height: calc(100vh - 24px);
        height: calc(100dvh - 24px); /* overrides the line above wherever dvh is supported */
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
  debug('Showing placeholder in the selected element');

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

  // eslint-disable-next-line no-unsanitized/property -- reviewed: message from packaged donationMessages.json, colours are constants
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
  debug('Inserting summary into the target element');
  targetElement.style.backgroundColor = '';
  targetElement.style.border = '';
  targetElement.appendChild(summaryContainer);
}

export function selectTargetElement() {
  debug('Prompting user to select the target element');
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
  panel.innerHTML = `<strong>Debug (${escapeHtml(apiUrl)})</strong><hr><pre style="white-space:pre-wrap">${escapeHtml(text)}</pre>`;
}
