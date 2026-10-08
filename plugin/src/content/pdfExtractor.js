// content/pdfExtractor.js
// PDF detection + text extraction via pdf.js. Loaded lazily — see loadPdfJs()
// — so pages that never touch a PDF pay zero cost for this module.
//
// IMPORTANT: this runs as part of a content script (isolated world — shares
// the page's DOM but NOT its JS global scope). A <script src="..."> tag (the
// pattern used for D3 in modules/archiveGraph.js) would execute in the
// PAGE's main world; any global it defines is invisible here. That pattern
// only works in archiveGraph.js because that file runs inside popup.html —
// the extension's own page, a single JS realm. A dynamic import() does not
// have this problem — it evaluates in the calling context's own realm.

let pdfJsModulePromise = null;

/**
 * True if the current top-level document is a PDF, OR if the page embeds
 * one via <embed>/<iframe> (e.g. Sci-Hub-style reader wrappers, where the
 * top-level document is text/html but the actual paper is a separately-
 * loaded PDF resource).
 *
 * @returns {boolean}
 */
export function isPdfPage() {
  return document.contentType === 'application/pdf' || !!findEmbeddedPdfUrl();
}

/**
 * Look for a PDF loaded via <embed> or <iframe> in an otherwise-HTML page.
 * Checks the explicit MIME type first, then falls back to a `.pdf` src
 * suffix for embeds that don't set type="application/pdf" correctly.
 *
 * @returns {string|null}
 */
function findEmbeddedPdfUrl() {
  const typedEmbed = document.querySelector('embed[type="application/pdf"]');
  if (typedEmbed?.src) return typedEmbed.src;

  const suffixEmbed = document.querySelector('embed[src$=".pdf" i]');
  if (suffixEmbed?.src) return suffixEmbed.src;

  const iframe = document.querySelector('iframe[src$=".pdf" i]');
  if (iframe?.src) return iframe.src;

  return null;
}

/**
 * Lazy-load pdf.js via dynamic import(). Requires lib/pdf.mjs +
 * lib/pdf.worker.mjs (the ESM build, not the classic/UMD build) listed in
 * manifest.json's web_accessible_resources. Subsequent calls return the
 * same cached module promise.
 *
 * @returns {Promise<object>} the pdfjsLib module namespace
 */
function loadPdfJs() {
  if (pdfJsModulePromise) return pdfJsModulePromise;
  pdfJsModulePromise = import(chrome.runtime.getURL('lib/pdf.mjs')).then((mod) => {
    mod.GlobalWorkerOptions.workerSrc = chrome.runtime.getURL('lib/pdf.worker.mjs');
    return mod;
  });
  return pdfJsModulePromise;
}

/**
 * Extract all text from the PDF at `url` (defaults to the current page's
 * URL, or the embedded PDF's src if this is an HTML wrapper page). Returns
 * { html, text } to match getAllTextContent()'s return shape so callers
 * don't need to branch on the result.
 *
 * @param {string} [url] - The PDF URL to fetch.
 * @returns {Promise<{ html: string, text: string }>}
 */
export async function extractPdfText(url) {
  const targetUrl = url
    || (document.contentType === 'application/pdf' ? window.location.href : findEmbeddedPdfUrl());
  if (!targetUrl) throw new Error('Could not locate a PDF on this page.');

  const pdfjsLib = await loadPdfJs(); // local variable now, not a global

  const bytes = await fetchPdfBytes(targetUrl);

  // Bound full-page canvas renders on figure-heavy papers (mirrors the
  // NODE_CAP pattern in modules/archiveGraph.js). 8 is a starting guess.
  const MAX_RASTERIZED_PAGES = 8;
  const pageHtmls = [];
  const pageTexts = [];
  let rasterizedCount = 0;

  // The PDFDocumentProxy is a heavyweight object: it owns the worker
  // transport, font caches, and (once we render) canvas bitmaps. If we
  // never tear it down, every inspected PDF permanently leaks typed arrays
  // (Uint8Array), font data, and detached canvases in the tab's renderer.
  // We therefore:
  //   1. call page.cleanup() after each page to release per-page caches,
  //   2. call pdf.cleanup() after the loop to drop the document's font
  //      cache, and
  //   3. call pdf.destroy() in a finally block to terminate the worker
  //      transport and free the whole document graph.
  // The worker itself is shared/refcounted by pdf.js, so destroy() only
  // tears it down once no other loading task references it.
  let pdf = null;
  try {
    try {
      pdf = await pdfjsLib.getDocument({ data: bytes }).promise;
    } catch (e) {
      if (e && (e.name === 'PasswordException' || e.code === 1 || e.code === 2)) throw pdfError('PASSWORD', 'Password protected');
      throw e;
    }

    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      try {
        const content = await page.getTextContent();
        const { html: textHtml, text } = reconstructPageLayout(content.items);

        let pageHtml = textHtml;
        if (rasterizedCount < MAX_RASTERIZED_PAGES) {
          const imageDataUrl = await extractPageImage(page, pdfjsLib);
          if (imageDataUrl) {
            pageHtml += `\n<img src="${imageDataUrl}" alt="Figure from page ${i}" style="max-width:100%;margin:12px 0;">`;
            rasterizedCount++;
          }
        }

        pageHtmls.push(pageHtml);
        pageTexts.push(text);
      } finally {
        // Release this page's render caches (fonts, images, canvas) as soon
        // as we're done with it, instead of holding every page's buffers
        // until the whole document is processed.
        try { page.cleanup(); } catch (e) { /* best-effort */ }
      }
    }

    // Drop the document-level font cache before returning.
    try { pdf.cleanup(); } catch (e) { /* best-effort */ }
  } finally {
    // Always tear down the document + worker transport, even on error.
    if (pdf) {
      try { await pdf.destroy(); } catch (e) { /* best-effort */ }
    }
  }

  const fullText = pageTexts.join('\n\n');
  if (fullText.replace(/\s+/g, '').length < 50) throw pdfError('EMPTY', 'No text');
  return {
    html: pageHtmls.join('\n'),
    text: fullText,
  };
}

/**
 * Reconstruct line/paragraph/heading structure from a page's raw text
 * items using their position and font-size data, instead of flattening
 * everything into one joined string. Heuristic, not a layout engine — see
 * the "known limitation" note re: multi-column pages.
 *
 * @param {Array} items - content.items from page.getTextContent()
 * @returns {{ html: string, text: string }}
 */
function reconstructPageLayout(items) {
  if (!items.length) return { html: '', text: '' };

  const Y_TOLERANCE = 2;

  // Baseline sort: PDF y-axis grows upward, so descending Y is top-to-bottom
  // reading order. Reasonable approximation for single-column pages.
  const sorted = [...items].sort((a, b) => {
    const yDiff = b.transform[5] - a.transform[5];
    if (Math.abs(yDiff) > Y_TOLERANCE) return yDiff;
    return a.transform[4] - b.transform[4];
  });

  // Group into lines by Y position.
  const lines = [];
  let currentLine = null;
  for (const item of sorted) {
    const y = item.transform[5];
    const fontSize = Math.abs(item.transform[3]) || Math.abs(item.transform[0]) || 0;
    if (!currentLine || Math.abs(currentLine.y - y) > Y_TOLERANCE) {
      currentLine = { y, parts: [], fontSize: 0 };
      lines.push(currentLine);
    }
    currentLine.parts.push(item.str);
    currentLine.fontSize = Math.max(currentLine.fontSize, fontSize);
  }

  // Body font size = the mode (most common) line font size on the page.
  const sizeCounts = {};
  lines.forEach(l => {
    const r = Math.round(l.fontSize);
    sizeCounts[r] = (sizeCounts[r] || 0) + 1;
  });
  const bodySize = Number(
    Object.entries(sizeCounts).sort((a, b) => b[1] - a[1])[0]?.[0]
  ) || 0;

  // Group lines into blocks (paragraphs/headings).
  const blocks = [];
  let current = null;
  let prevY = null;
  for (const line of lines) {
    const text = line.parts.join(' ').trim();
    if (!text) continue;
    const isHeading = bodySize > 0 && line.fontSize > bodySize * 1.15;
    const gap = prevY !== null ? Math.abs(prevY - line.y) : 0;
    const startsNewBlock =
      !current || isHeading || current.isHeading !== isHeading || gap > line.fontSize * 1.8;

    if (startsNewBlock) {
      current = { isHeading, text };
      blocks.push(current);
    } else {
      current.text += ' ' + text;
    }
    prevY = line.y;
  }

  const html = blocks
    .map(b => `<${b.isHeading ? 'h3' : 'p'}>${escapeHtml(b.text)}</${b.isHeading ? 'h3' : 'p'}>`)
    .join('\n');
  const text = blocks.map(b => b.text).join('\n\n');

  return { html, text };
}

/**
 * Rasterize `page` to a compressed data URL, but only if it actually
 * contains image-paint operations — skip pure-text pages entirely so a
 * long text-only paper doesn't pay for full-page canvas rendering on
 * every page for nothing.
 *
 * @param {object} page - a pdf.js PDFPageProxy
 * @param {object} pdfjsLib - the loaded pdf.js module namespace (for OPS)
 * @param {number} [maxWidth=600] - matches inlineAndCompressImages()'s default
 * @param {number} [quality=0.6] - matches inlineAndCompressImages()'s default
 * @returns {Promise<string|null>} a data URL, or null if the page has no images
 */
async function extractPageImage(page, pdfjsLib, maxWidth = 600, quality = 0.6) {
  const opList = await page.getOperatorList();
  const hasImage = opList.fnArray.some(fn =>
    fn === pdfjsLib.OPS.paintImageXObject ||
    fn === pdfjsLib.OPS.paintJpegXObject ||
    fn === pdfjsLib.OPS.paintImageMaskXObject
  );
  if (!hasImage) return null;

  const viewport = page.getViewport({ scale: 1.5 });
  const canvas = document.createElement('canvas');
  canvas.width = viewport.width;
  canvas.height = viewport.height;
  await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;

  // Downscale to maxWidth before compressing, same as inlineAndCompressImages().
  let out = canvas;
  if (canvas.width > maxWidth) {
    const scale = maxWidth / canvas.width;
    const resized = document.createElement('canvas');
    resized.width = maxWidth;
    resized.height = Math.round(canvas.height * scale);
    resized.getContext('2d').drawImage(canvas, 0, 0, resized.width, resized.height);
    out = resized;
  }
  return out.toDataURL('image/jpeg', quality);
}

/**
 * Fetch `url`'s bytes as an ArrayBuffer. Local file:// URLs are read
 * directly via XHR in this content script (the only context with any
 * chance of file:// access — see the file:// notes in Correction 3).
 * Everything else (http/https, likely cross-origin, e.g. a PDF embedded
 * from a different host) is routed through background.js, which bypasses
 * page-level CORS restrictions that would otherwise block the content
 * script's own fetch — same precedent as inlineAndCompressImages().
 *
 * @param {string} url
 * @returns {Promise<ArrayBuffer>}
 */
function fetchPdfBytes(url) {
  if (url.startsWith('file:')) {
    return fetchArrayBufferViaXhr(url).then(checkPdfBytes);
  }
  // 1) Same-origin first, with the user's cookies: this is what a PDF opened in the browser's own viewer needs
  //    (paywalled / logged-in PDFs). The service worker has no access to the page's session.
  // 2) Anything else (cross-origin embed, or the first attempt failed): the background worker, also with credentials.
  return fetchViaPage(url).then(checkPdfBytes).catch((first) => viaBackground(url).then(checkPdfBytes).catch((second) => {
    throw (first && first.code && first.code !== 'NETWORK') ? first : second;
  }));
}

function pdfError(code, message) { const e = new Error(message); e.code = code; return e; }

/** Message shown to the user for a failed PDF read (keeps the error codes in one place). */
export function pdfErrorMessage(err) {
  switch (err && err.code) {
    case 'LOGIN': return 'This PDF needs a login or is behind a paywall, so the extension cannot download it. Open it while signed in, or select its text and summarize the selection.';
    case 'NOT_PDF': return 'The address did not return a PDF (probably a login or error page).';
    case 'PASSWORD': return 'This PDF is password protected.';
    case 'EMPTY': return 'This PDF has no selectable text (probably a scan). Text recognition is not supported yet.';
    case 'FILE': return 'Chrome blocks access to local PDFs. Enable "Allow access to file URLs" for this extension in chrome://extensions, then try again.';
    default: return 'Cannot read this PDF directly. If it is a local file, enable "Allow access to file URLs" for the extension; otherwise try opening the paper from its original web URL.';
  }
}

function checkPdfBytes(buf) {
  const u = new Uint8Array(buf);
  // "%PDF" may follow a few bytes of junk, but not a whole HTML page.
  const head = String.fromCharCode.apply(null, u.subarray(0, 1024));
  if (head.indexOf('%PDF') === -1) throw pdfError('NOT_PDF', 'Not a PDF');
  return buf;
}

async function fetchViaPage(url) {
  let r;
  try { r = await fetch(url, { credentials: 'include' }); } catch (_) { throw pdfError('NETWORK', 'Failed to fetch PDF'); }
  if (r.status === 401 || r.status === 402 || r.status === 403) throw pdfError('LOGIN', 'Login required');
  if (!r.ok) throw pdfError('NETWORK', 'Failed to fetch PDF (' + r.status + ')');
  return r.arrayBuffer();
}

function viaBackground(url) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage({ action: 'fetchPdfBytes', url }, (res) => {
      if (chrome.runtime.lastError) { reject(pdfError('NETWORK', chrome.runtime.lastError.message)); return; }
      if (!res || !res.success) { reject(pdfError(res && res.code ? res.code : 'NETWORK', (res && res.error) || 'Failed to fetch PDF')); return; }
      if (typeof res.base64 === 'string') {
        const bin = atob(res.base64);
        const out = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
        resolve(out.buffer);
      } else if (res.bytes) {
        resolve(new Uint8Array(res.bytes).buffer);
      } else reject(pdfError('NETWORK', 'Failed to fetch PDF'));
    });
  });
}

/**
 * Fetch `url` as an ArrayBuffer via XMLHttpRequest. fetch() does not
 * support the file: scheme (a Fetch API limitation, not a permissions
 * issue), so this is required for local PDFs.
 *
 * @param {string} url
 * @returns {Promise<ArrayBuffer>}
 */
function fetchArrayBufferViaXhr(url) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('GET', url, true);
    xhr.responseType = 'arraybuffer';
    xhr.onload = () => {
      // file:// URLs report status 0 on success (there's no real HTTP
      // status for a local file) — only onerror fires for genuine failures,
      // so treat 0 and the 200-299 range both as success here.
      if (xhr.status === 0 || (xhr.status >= 200 && xhr.status < 300)) {
        resolve(xhr.response);
      } else {
        reject(new Error(`Failed to fetch PDF (${xhr.status})`));
      }
    };
    xhr.onerror = () => reject(pdfError('FILE', 'Failed to fetch PDF (network error)'));
    xhr.send();
  });
}

/**
 * Escape the three HTML-significant characters so extracted PDF text can be
 * safely embedded inside <p> tags without breaking the saved HTML.
 *
 * @param {string} str
 * @returns {string}
 */
function escapeHtml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}