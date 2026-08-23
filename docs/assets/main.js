/* AI Summary Helper — shared site JS. Vanilla, no build step. */

/* ── Theme toggle (light / dark) ─────────────────────────────────── */
(function () {
  var root = document.documentElement;
  var themeColorMeta = document.querySelector('meta[name="theme-color"]');
  var btnDesktop = document.getElementById('themeToggle');
  var btnMobile = document.getElementById('themeToggleMobile');
  var mobileLabel = document.getElementById('themeToggleMobileLabel');

  function applyThemeChrome(theme) {
    if (themeColorMeta) themeColorMeta.setAttribute('content', theme === 'light' ? '#F6F5F1' : '#08090C');
    var nextLabel = theme === 'light' ? 'Switch to dark mode' : 'Switch to light mode';
    if (btnDesktop) btnDesktop.setAttribute('aria-label', nextLabel);
    if (mobileLabel) mobileLabel.textContent = nextLabel;
  }

  function setTheme(theme) {
    root.setAttribute('data-theme', theme);
    try { localStorage.setItem('aish_theme', theme); } catch (e) {}
    applyThemeChrome(theme);
  }

  function toggleTheme() {
    var current = root.getAttribute('data-theme') === 'light' ? 'light' : 'dark';
    setTheme(current === 'light' ? 'dark' : 'light');
  }

  applyThemeChrome(root.getAttribute('data-theme') === 'light' ? 'light' : 'dark');
  if (btnDesktop) btnDesktop.addEventListener('click', toggleTheme);
  if (btnMobile) btnMobile.addEventListener('click', toggleTheme);

  if (window.matchMedia) {
    window.matchMedia('(prefers-color-scheme: light)').addEventListener('change', function (e) {
      var saved = null;
      try { saved = localStorage.getItem('aish_theme'); } catch (err) {}
      if (!saved) setTheme(e.matches ? 'light' : 'dark');
    });
  }
})();

/* ── Mobile nav toggle ────────────────────────────────────────────── */
(function () {
  var navToggle = document.getElementById('navToggle');
  var mobileMenu = document.getElementById('mobileMenu');
  if (!navToggle || !mobileMenu) return;

  function closeMobileMenu() {
    mobileMenu.hidden = true;
    navToggle.setAttribute('aria-expanded', 'false');
    navToggle.setAttribute('aria-label', 'Open menu');
  }
  function openMobileMenu() {
    mobileMenu.hidden = false;
    navToggle.setAttribute('aria-expanded', 'true');
    navToggle.setAttribute('aria-label', 'Close menu');
  }
  navToggle.addEventListener('click', function () {
    if (mobileMenu.hidden) openMobileMenu(); else closeMobileMenu();
  });
  mobileMenu.querySelectorAll('a').forEach(function (a) { a.addEventListener('click', closeMobileMenu); });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && !mobileMenu.hidden) closeMobileMenu();
  });
  document.addEventListener('click', function (e) {
    if (!mobileMenu.hidden && !mobileMenu.contains(e.target) && !navToggle.contains(e.target)) {
      closeMobileMenu();
    }
  });
})();

/* ── Scroll-reveal for .reveal elements ──────────────────────────── */
(function () {
  var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var reveals = document.querySelectorAll('.reveal');
  if (!reveals.length) return;

  if ('IntersectionObserver' in window && !reduceMotion) {
    var observer = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          entry.target.classList.add('is-visible');
          observer.unobserve(entry.target);
        }
      });
    }, { threshold: 0.15, rootMargin: '0px 0px -40px 0px' });
    reveals.forEach(function (el) { observer.observe(el); });
  } else {
    reveals.forEach(function (el) { el.classList.add('is-visible'); });
  }
})();

/* ── Pricing: monthly / yearly toggle ────────────────────────────── */
function setBilling(period) {
  var grid = document.getElementById('tiersGrid');
  var bm = document.getElementById('btnMonthly');
  var by = document.getElementById('btnYearly');
  if (!grid) return;
  if (period === 'yearly') {
    grid.classList.add('yearly');
    if (by) by.classList.add('active');
    if (bm) bm.classList.remove('active');
  } else {
    grid.classList.remove('yearly');
    if (bm) bm.classList.add('active');
    if (by) by.classList.remove('active');
  }
}

/* ── Locale suggestion banner (English pages only) ───────────────── */
(function () {
  // Only offer a locale switch on English pages. Anyone already on a
  // /lang/xx/ page is left alone — no redirect, so every locale URL
  // stays independently reachable and indexable.
  var htmlLang = (document.documentElement.getAttribute('lang') || '').toLowerCase();
  if (htmlLang && htmlLang !== 'en' && htmlLang.indexOf('en-') !== 0) return;

  var LOCALES = {
    de: 'Deutsch', es: 'Español', fr: 'Français', hi: 'हिन्दी',
    ja: '日本語', ko: '한국어', pt: 'Português', zh: '中文'
  };
  var DISMISS_KEY = 'aish_lang_banner_dismissed';

  // Best match: walk navigator.languages (falling back to navigator.language)
  // and pick the first that maps to a shipped locale.
  function preferredLocale() {
    var langs = [];
    try { langs = navigator.languages || []; } catch (e) {}
    if (!langs.length && navigator.language) langs = [navigator.language];
    for (var i = 0; i < langs.length; i++) {
      var code = (langs[i] || '').toLowerCase();
      var base = code.split('-')[0];
      if (LOCALES[base]) return base;
    }
    return null;
  }

  var target = preferredLocale();
  if (!target) return;

  var dismissed = false;
  try { dismissed = localStorage.getItem(DISMISS_KEY) === '1'; } catch (e) {}

  // Same-page mapping: /index.html -> /lang/xx/index.html, and
  // /blog/foo.html -> /lang/xx/blog/foo.html. Never just the homepage.
  var rel = window.location.pathname.replace(/^\/+/, '');
  if (!rel) rel = 'index.html';
  var href = '/lang/' + target + '/' + rel;

  var banner = document.createElement('div');
  banner.className = 'lang-banner';
  banner.setAttribute('role', 'region');
  banner.setAttribute('aria-label', 'Language suggestion');
  banner.innerHTML =
    '<div class="lang-banner-inner">' +
      '<span class="lang-banner-text">This page is also available in ' +
        '<a class="lang-banner-link" href="' + href + '">' + (LOCALES[target] || target) + '</a>.' +
      '</span>' +
      '<button type="button" class="lang-banner-close" aria-label="Dismiss language suggestion">' +
        '<svg viewBox="0 0 24 24" fill="none" width="14" height="14"><path d="M6 6l12 12M18 6l6 12" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>' +
      '</button>' +
    '</div>';

  function dismiss() {
    banner.remove();
    try { localStorage.setItem(DISMISS_KEY, '1'); } catch (e) {}
  }
  banner.querySelector('.lang-banner-close').addEventListener('click', dismiss);

  if (!dismissed) document.body.prepend(banner);
})();
