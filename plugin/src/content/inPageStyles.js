// content/inPageStyles.js
// Gives a shadow root that AISH draws into a web page the app's design tokens and component CSS (inPage.css), and the host the
// theme and motion settings (data-theme / data-motion), so the page tools look like the popup (Figma AISH-039).
// The sheet is fetched once per page and shared by every root (adoptedStyleSheets); the host stays invisible until it is there,
// so nothing flashes unstyled. Names are prefixed `ips` (the content-script bundle shares one scope).

let ipsSheet = null;   // Promise<CSSStyleSheet|null>
let ipsPrefs = null;   // Promise<{ theme, reduceMotion }>

function ipsUrl() {
  try { return chrome.runtime.getURL('inPage.css'); } catch (_) { return ''; }
}

function ipsLoadSheet() {
  if (!ipsSheet) {
    ipsSheet = (async () => {
      const url = ipsUrl();
      if (!url || typeof CSSStyleSheet !== 'function' || typeof fetch !== 'function') return null;
      const res = await fetch(url);
      if (!res.ok) return null;
      const sheet = new CSSStyleSheet();
      sheet.replaceSync(await res.text());
      return sheet;
    })().catch(() => null);
  }
  return ipsSheet;
}

function ipsLoadPrefs() {
  if (!ipsPrefs) {
    ipsPrefs = (async () => {
      // eslint-disable-next-line no-restricted-syntax -- content script: two read-only display settings, StorageManager is popup-side
      try { return (await chrome.storage.sync.get(['theme', 'reduceMotion'])) || {}; } catch (_) { return {}; }
    })();
  }
  return ipsPrefs;
}

/** Styles `root` (the shadow root of `host`) with inPage.css and sets the theme on `host`. Returns a promise for when it is shown. */
export function ipsAttach(host, root) {
  host.style.visibility = 'hidden';
  return Promise.all([ipsLoadSheet(), ipsLoadPrefs()]).then(([sheet, prefs]) => {
    if (sheet && 'adoptedStyleSheets' in root) root.adoptedStyleSheets = [...root.adoptedStyleSheets, sheet];
    else {
      const url = ipsUrl();
      if (url) { const link = document.createElement('link'); link.rel = 'stylesheet'; link.href = url; root.prepend(link); }
    }
    if (prefs.theme && prefs.theme !== 'system') host.dataset.theme = prefs.theme;
    if (prefs.reduceMotion) host.dataset.motion = 'reduce';
    host.style.visibility = '';
  });
}
