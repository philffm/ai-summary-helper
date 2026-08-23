// content/extractor.js
// Pure page-content extraction & parsing helpers. No DOM event wiring here —
// these are called by the content.js orchestrator.

/**
 * Extract the main article text + HTML from the page, stripping noise.
 * @returns {{ html: string, text: string }}
 */
export function getAllTextContent() {
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

/**
 * Truncate text to an approximate token limit.
 */
export function truncateToTokenLimit(text, maxTokens) {
  if (!text) return text;
  const approxTokens = Math.ceil(text.length / 4);
  if (approxTokens <= maxTokens) return text;
  const allowedChars = Math.max(1000, Math.floor(maxTokens * 4));
  return text.slice(0, allowedChars);
}

/**
 * Split text into chunks of a given size.
 */
export function chunkText(text, chunkSize) {
  if (!text) return [];
  const chunks = [];
  let start = 0;
  while (start < text.length) {
    chunks.push(text.slice(start, start + chunkSize));
    start += chunkSize;
  }
  return chunks;
}

/**
 * Strip all HTML tags from a string.
 */
export function stripHtmlTags(html) {
  if (!html) return '';
  return html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

/**
 * Fetches, resizes, and compresses images into Base64 data URIs.
 * Runs concurrently for all images.
 */
export async function inlineAndCompressImages(htmlString, maxWidth = 600, quality = 0.6) {
  if (!htmlString) return '';

  const parser = new DOMParser();
  const doc = parser.parseFromString(htmlString, 'text/html');
  const images = Array.from(doc.querySelectorAll('img'));

  await Promise.all(images.map(async (img) => {
    const originalSrc = img.getAttribute('src');
    if (!originalSrc || originalSrc.startsWith('data:')) return;

    try {
      const absoluteUrl = new URL(originalSrc, window.location.href).href;

      // Fetching third-party image bytes must go through the background
      // script here — not a direct content-script fetch(). Chrome extends
      // the extension's host_permissions to content-script fetch() calls,
      // but Safari does NOT: a content script's fetch is still subject to
      // the *page's* CORS/mixed-content rules (e.g. an http:// image on an
      // https:// page gets blocked with "access control checks" errors),
      // even though the extension itself has <all_urls> access. The
      // background page is a genuine privileged extension context and can
      // fetch cross-origin freely.
      const dataUrl = await new Promise((resolve, reject) => {
        chrome.runtime.sendMessage({ action: 'fetchImageAsDataUrl', url: absoluteUrl }, (res) => {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
          } else if (!res?.success) {
            reject(new Error(res?.error || 'Image fetch failed'));
          } else {
            resolve(res.dataUrl);
          }
        });
      });

      const imageElement = new Image();
      await new Promise((resolve, reject) => {
        imageElement.onload = resolve;
        imageElement.onerror = reject;
        imageElement.src = dataUrl;
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
    }
  }));

  return doc.body.innerHTML;
}

/**
 * Detect whether the page background is dark (for placeholder contrast).
 */
export function isBackgroundDark() {
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

/**
 * Convert simple markdown to HTML.
 */
export function markdownToHtml(text) {
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
