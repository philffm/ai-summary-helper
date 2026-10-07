/* AI Summary Helper — site analytics loader.
 *
 * Self-hosted Matomo, cookieless, no unique identifiers, IP anonymisation on the
 * server. Loaded in <head> of every page. Respects Do Not Track, Global Privacy
 * Control and a local opt-out, and shows a small info notice (no blocking banner
 * is needed because nothing is stored on the visitor's device for tracking).
 *
 * CONSENT_MODE:
 *   'optout' (default) – cookieless audience measurement runs unless the visitor
 *                        opts out (or sends DNT/GPC). Legitimate interest, art. 6(1)(f).
 *   'optin'            – nothing is sent until the visitor clicks "Allow".
 */
(function () {
  'use strict';
  var CONSENT_MODE = 'optout';
  var MATOMO_URL = '//analytics.philwornath.de/';
  var SITE_ID = '1';
  var K_CHOICE = 'aish_analytics';        // 'off' | 'on'
  var K_NOTICE = 'aish_analytics_notice'; // '1' once the notice was dismissed

  function get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function set(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
  function del(k) { try { localStorage.removeItem(k); } catch (e) {} }

  function browserSaysNo() {
    var n = navigator;
    return n.globalPrivacyControl === true ||
      n.doNotTrack === '1' || n.doNotTrack === 'yes' || window.doNotTrack === '1' || n.msDoNotTrack === '1';
  }
  function allowed() {
    if (browserSaysNo()) return false;
    var c = get(K_CHOICE);
    if (c === 'off') return false;
    if (CONSENT_MODE === 'optin') return c === 'on';
    return true;
  }

  var loaded = false;
  function load() {
    if (loaded) return; loaded = true;
    var _paq = window._paq = window._paq || [];
    _paq.push(['disableCookies']);
    _paq.push(['disableBrowserFeatureDetection']);
    _paq.push(['setDoNotTrack', true]);
    _paq.push(['trackPageView']);
    _paq.push(['enableLinkTracking']);
    _paq.push(['setTrackerUrl', MATOMO_URL + 'matomo.php']);
    _paq.push(['setSiteId', SITE_ID]);
    var g = document.createElement('script'), s = document.getElementsByTagName('script')[0];
    g.async = true; g.src = MATOMO_URL + 'matomo.js';
    s.parentNode.insertBefore(g, s);
  }

  // Safe no-op: only forwards events when tracking is active.
  window.aishTrack = function (category, action, name, value) {
    try {
      if (!loaded || !allowed()) return;
      var a = ['trackEvent', category, action];
      if (name !== undefined && name !== null) a.push(String(name).slice(0, 120));
      if (value !== undefined && value !== null && !isNaN(Number(value))) a.push(Number(value));
      window._paq.push(a);
    } catch (e) {}
  };

  window.aishAnalytics = {
    mode: CONSENT_MODE,
    isActive: function () { return loaded && allowed(); },
    isOptedOut: function () { return !allowed(); },
    browserSignal: browserSaysNo,
    optOut: function () { set(K_CHOICE, 'off'); refresh(); },
    optIn: function () { set(K_CHOICE, 'on'); if (allowed()) load(); refresh(); },
    reset: function () { del(K_CHOICE); del(K_NOTICE); refresh(); }
  };

  if (allowed()) load();

  /* ── Info notice + settings dialog (built after DOM is ready) ────── */
  var ui = {};
  function el(tag, attrs, html) {
    var e = document.createElement(tag);
    for (var k in attrs) e.setAttribute(k, attrs[k]);
    if (html) e.innerHTML = html;
    return e;
  }
  function privacyHref() {
    var s = document.querySelector('script[src*="assets/analytics.js"]');
    var src = s ? s.getAttribute('src') : 'assets/analytics.js';
    return src.replace('assets/analytics.js', 'privacy.html') + '#analytics';
  }
  function refresh() {
    if (ui.status) ui.status.textContent = statusText();
    if (ui.toggle) ui.toggle.textContent = allowed() ? 'Turn analytics off' : 'Turn analytics on';
    if (ui.toggle) ui.toggle.disabled = browserSaysNo();
  }
  function statusText() {
    if (browserSaysNo()) return 'Your browser sends a Do Not Track / Global Privacy Control signal, so analytics is off.';
    return allowed() ? 'Analytics is currently ON (anonymous, cookieless).' : 'Analytics is currently OFF.';
  }
  function closeNotice(remember) {
    if (ui.notice) { ui.notice.remove(); ui.notice = null; }
    if (remember) set(K_NOTICE, '1');
  }
  function showNotice() {
    if (get(K_NOTICE) === '1' || ui.notice || browserSaysNo()) return;
    if (CONSENT_MODE === 'optin' && get(K_CHOICE)) return;
    var optin = CONSENT_MODE === 'optin';
    var n = el('div', { 'class': 'an-notice', role: 'region', 'aria-label': 'Analytics notice' },
      '<p><strong>Privacy-friendly analytics.</strong> ' +
      (optin ? 'May we count anonymous visits? ' : 'We count anonymous visits with a self-hosted Matomo. ') +
      'No cookies, no tracking across sites, no personal data. <a href="' + privacyHref() + '">Details</a></p>' +
      '<div class="an-actions">' +
      (optin
        ? '<button type="button" data-a="allow" class="an-btn an-primary">Allow</button><button type="button" data-a="deny" class="an-btn">No thanks</button>'
        : '<button type="button" data-a="ok" class="an-btn an-primary">OK</button><button type="button" data-a="deny" class="an-btn">Opt out</button>') +
      '</div>');
    n.addEventListener('click', function (e) {
      var a = e.target && e.target.getAttribute && e.target.getAttribute('data-a');
      if (!a) return;
      if (a === 'allow') window.aishAnalytics.optIn();
      if (a === 'deny') window.aishAnalytics.optOut();
      closeNotice(true);
    });
    document.body.appendChild(n); ui.notice = n;
  }
  function openDialog() {
    if (ui.dialog) return;
    var prev = document.activeElement;
    var d = el('div', { 'class': 'an-overlay' },
      '<div class="an-dialog" role="dialog" aria-modal="true" aria-labelledby="anTitle">' +
      '<h2 id="anTitle">Analytics settings</h2>' +
      '<p>This site uses a self-hosted Matomo instance to count page views and feature clicks. It sets <strong>no cookies</strong>, ' +
      'stores nothing on your device for tracking, anonymises your IP address and never sees page content, e-mail addresses or API keys.</p>' +
      '<p id="anStatus" aria-live="polite"></p>' +
      '<div class="an-actions"><button type="button" id="anToggle" class="an-btn an-primary"></button>' +
      '<button type="button" id="anClose" class="an-btn">Close</button></div>' +
      '<p class="an-small"><a href="' + privacyHref() + '">Read the privacy policy</a></p></div>');
    document.body.appendChild(d); ui.dialog = d;
    ui.status = d.querySelector('#anStatus'); ui.toggle = d.querySelector('#anToggle');
    refresh();
    function close() { d.remove(); ui.dialog = null; ui.status = ui.toggle = null; document.removeEventListener('keydown', key, true); if (prev && prev.focus) prev.focus(); }
    function key(e) {
      if (e.key === 'Escape') { e.preventDefault(); close(); return; }
      if (e.key !== 'Tab') return;
      var f = d.querySelectorAll('button:not([disabled]),a[href]');
      if (!f.length) return;
      var first = f[0], last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
    document.addEventListener('keydown', key, true);
    d.addEventListener('click', function (e) { if (e.target === d || e.target.id === 'anClose') close(); });
    ui.toggle.addEventListener('click', function () {
      if (allowed()) window.aishAnalytics.optOut(); else window.aishAnalytics.optIn();
      set(K_NOTICE, '1'); closeNotice(false);
    });
    ui.toggle.focus();
  }
  window.aishAnalytics.openSettings = openDialog;

  function ready() {
    // Any element with [data-analytics-settings] opens the dialog (footer link).
    document.addEventListener('click', function (e) {
      var t = e.target.closest && e.target.closest('[data-analytics-settings]');
      if (t) { e.preventDefault(); openDialog(); }
    });
    // Privacy page controls
    var st = document.getElementById('analyticsStatusInline');
    if (st) { st.textContent = statusText(); }
    showNotice();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', ready); else ready();
})();
