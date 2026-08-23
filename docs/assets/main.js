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
