/* AI Summary Helper — shared site JS. Vanilla, no build step. */

/* Analytics loader + window.aishTrack live in analytics.js */

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
    window.aishTrack && window.aishTrack('Theme', 'toggle', current === 'light' ? 'dark' : 'light');
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
    if (by) { by.classList.add('active'); by.setAttribute('aria-pressed', 'true'); }
    if (bm) { bm.classList.remove('active'); bm.setAttribute('aria-pressed', 'false'); }
  } else {
    grid.classList.remove('yearly');
    if (bm) { bm.classList.add('active'); bm.setAttribute('aria-pressed', 'true'); }
    if (by) { by.classList.remove('active'); by.setAttribute('aria-pressed', 'false'); }
  }
}

/* ── Locale suggestion banner ────────────────────────────────────── */
(function () {
  // Suggests the page in the browser's preferred language (written in that language). Never redirects on its own,
  // so every locale URL stays independently reachable and indexable. Works from English and from any /xx/ page.
  var LOCALES = {
    en: ['English', 'This page is also available in {l}.'], de: ['Deutsch', 'Diese Seite gibt es auch auf {l}.'],
    fr: ['Français', 'Cette page existe aussi en {l}.'], es: ['Español', 'Esta página también está disponible en {l}.'],
    pt: ['Português', 'Esta página também está disponível em {l}.'], zh: ['简体中文', '本页面也提供{l}版本。'],
    'zh-tw': ['繁體中文', '本頁面也提供{l}版本。'], ja: ['日本語', 'このページは{l}でもご覧いただけます。'],
    ko: ['한국어', '이 페이지는 {l}로도 제공됩니다.'], hi: ['हिन्दी', 'यह पेज {l} में भी उपलब्ध है।'],
    vi: ['Tiếng Việt', 'Trang này cũng có bản {l}.'],
    nl: ['Nederlands', 'Deze pagina is ook beschikbaar in het {l}.'], it: ['Italiano', 'Questa pagina è disponibile anche in {l}.'],
    ru: ['Русский', 'Эта страница доступна и на языке: {l}.'], uk: ['Українська', 'Ця сторінка доступна також українською: {l}.'],
    tr: ['Türkçe', 'Bu sayfa {l} dilinde de mevcut.'], id: ['Bahasa Indonesia', 'Halaman ini juga tersedia dalam {l}.'],
    pl: ['Polski', 'Ta strona jest dostępna także po polsku: {l}.'], th: ['ไทย', 'หน้านี้มีให้บริการเป็นภาษา{l}ด้วย'],
    sv: ['Svenska', 'Den här sidan finns även på {l}.'], da: ['Dansk', 'Denne side findes også på {l}.'],
    no: ['Norsk', 'Denne siden er også tilgjengelig på {l}.'], fi: ['Suomi', 'Tämä sivu on saatavilla myös kielellä {l}.'],
    ar: ['العربية', 'هذه الصفحة متاحة أيضًا بـ{l}.']
  };
  var DISMISS_KEY = 'aish_lang_banner_dismissed';
  function map(code) {
    code = (code || '').toLowerCase();
    if (code.indexOf('zh') === 0) return /hant|-tw|-hk|-mo/.test(code) ? 'zh-tw' : 'zh';
    var base = code.split('-')[0];
    if (base === 'nb' || base === 'nn') base = 'no';
    return LOCALES[base] ? base : null;
  }
  // Current locale = first path segment when it is a shipped locale folder, otherwise English.
  var seg = window.location.pathname.replace(/^\/+/, '').split('/')[0].toLowerCase();
  var current = LOCALES[seg] && seg !== 'en' ? seg : 'en';
  var rest = window.location.pathname.replace(/^\/+/, '');
  if (current !== 'en') rest = rest.split('/').slice(1).join('/');
  if (!rest) rest = 'index.html';

  var langs = [];
  try { langs = navigator.languages || []; } catch (e) {}
  if (!langs.length && navigator.language) langs = [navigator.language];
  var target = null;
  for (var i = 0; i < langs.length; i++) { var m = map(langs[i]); if (m) { target = m; break; } }
  if (!target || target === current) return;

  var dismissed = false;
  try { dismissed = localStorage.getItem(DISMISS_KEY) === '1'; } catch (e) {}
  if (dismissed) return;

  var href = '/' + (target === 'en' ? '' : target + '/') + rest;
  var info = LOCALES[target];
  var banner = document.createElement('div');
  banner.className = 'lang-banner';
  banner.setAttribute('role', 'region');
  banner.setAttribute('aria-label', 'Language suggestion');
  banner.setAttribute('lang', target === 'zh-tw' ? 'zh-TW' : target);
  if (target === 'ar') banner.setAttribute('dir', 'rtl');
  banner.innerHTML =
    '<div class="lang-banner-inner">' +
      '<svg class="lang-banner-globe" viewBox="0 0 24 24" fill="none" width="18" height="18" aria-hidden="true"><circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="1.6"/><path d="M3 12h18M12 3c2.6 2.7 3.9 5.7 3.9 9s-1.3 6.3-3.9 9c-2.6-2.7-3.9-5.7-3.9-9S9.4 5.7 12 3Z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>' +
      '<span class="lang-banner-text">' + info[1].replace('{l}', '<a class="lang-banner-link" href="' + href + '">' + info[0] + '</a>') + '</span>' +
      '<button type="button" class="lang-banner-close" aria-label="Dismiss language suggestion">' +
        '<svg viewBox="0 0 24 24" fill="none" width="14" height="14"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>' +
      '</button>' +
    '</div>';
  banner.querySelector('.lang-banner-close').addEventListener('click', function () {
    banner.classList.remove('is-in');
    setTimeout(function () { banner.remove(); }, 250);
    try { localStorage.setItem(DISMISS_KEY, '1'); } catch (e) {}
  });
  document.body.prepend(banner);
  requestAnimationFrame(function () { setTimeout(function () { banner.classList.add('is-in'); }, 400); });
})();

/* ── Bookmarklet generator (BYOK + byPhil Cloud) ────────────────── */
(function () {
  var card = document.getElementById('bookmarkletCard');
  if (!card) return;

  // ── Browser detection: recommend the extension on desktop browsers ──
  // The bookmarklet is mainly for iOS / browsers where the extension can't
  // run. On desktop Chrome/Firefox/Edge/Opera, nudge users toward the full
  // extension instead (richer features, no bookmarklet quirks).
  var browserNote = document.getElementById('bmBrowserNote');
  if (browserNote) {
    var ua = navigator.userAgent || '';
    var isMobile = /Mobi|Android|iPhone|iPad|iPod/i.test(ua);
    var isIOS = /iPhone|iPad|iPod/i.test(ua);
    var isAndroid = /Android/i.test(ua);
    var isChrome = /Chrome\//i.test(ua) && !/Edg\//i.test(ua) && !/OPR\//i.test(ua);
    var isFirefox = /Firefox\//i.test(ua);
    var isEdge = /Edg\//i.test(ua);
    var isOpera = /OPR\//i.test(ua);
    var isSafari = /Safari\//i.test(ua) && !/Chrome\//i.test(ua);

    var extUrl = 'https://chromewebstore.google.com/detail/ai-summary-helper-openai/hldbejcjaedipeegjcinmhejdndchkmb';
    var note = null;

    if (isIOS) {
      note = '📱 You\u2019re on iOS — the extension can\u2019t run here, so the bookmarklet is the right choice.';
    } else if (isAndroid) {
      note = '📱 You\u2019re on Android — the bookmarklet works here.';
    } else if (isChrome) {
      note = '💻 You\u2019re on Chrome — the full <a href="' + extUrl + '" target="_blank" rel="noopener">extension</a> gives you history, search, highlighting, and more. The bookmarklet below still works if you prefer it.';
    } else if (isFirefox) {
      note = '💻 You\u2019re on Firefox — the <a href="https://addons.mozilla.org/firefox/" target="_blank" rel="noopener">extension</a> is the fuller experience. The bookmarklet below still works if you prefer it.';
    } else if (isEdge) {
      note = '💻 You\u2019re on Edge — the <a href="' + extUrl + '" target="_blank" rel="noopener">extension</a> is the fuller experience. The bookmarklet below still works if you prefer it.';
    } else if (isOpera) {
      note = '💻 You\u2019re on Opera — the <a href="' + extUrl + '" target="_blank" rel="noopener">extension</a> is the fuller experience. The bookmarklet below still works if you prefer it.';
    } else if (isSafari) {
      note = '💻 You\u2019re on Safari — the bookmarklet is a good fit here.';
    } else if (!isMobile) {
      note = '💻 The <a href="' + extUrl + '" target="_blank" rel="noopener">extension</a> is the fuller experience on desktop. The bookmarklet below still works if you prefer it.';
    }

    if (note) {
      browserNote.innerHTML = note;
      browserNote.hidden = false;
    }
  }

  var API_BASE = 'https://api.byphil.eu';
  var TOKEN_KEY = 'aish_bm_pb_token';
  var EMAIL_KEY = 'aish_bm_email';

  var PROVIDERS = {
    openai: { name: 'OpenAI', endpoint: 'https://api.openai.com/v1/chat/completions', model: 'gpt-5-mini', keyUrl: 'https://platform.openai.com/api-keys' },
    deepseek: { name: 'DeepSeek', endpoint: 'https://api.deepseek.com/chat/completions', model: 'deepseek-v4-flash', keyUrl: 'https://platform.deepseek.com/api_keys' },
    mistral: { name: 'Mistral', endpoint: 'https://api.mistral.ai/v1/chat/completions', model: 'mistral-large-latest', keyUrl: 'https://console.mistral.ai/api-keys/' },
    gemini: { name: 'Gemini', endpoint: 'https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent', model: 'gemini-3.5-flash', keyUrl: 'https://aistudio.google.com/apikey' },
    ollama: { name: 'Ollama (Local)', endpoint: 'http://localhost:11434/v1/chat/completions', model: 'llama3.2', keyUrl: null, noKey: true }
  };

  var els = {
    modeByok: document.getElementById('bmModeByok'),
    modeCloud: document.getElementById('bmModeCloud'),
    byokPanel: document.getElementById('bmByokPanel'),
    cloudPanel: document.getElementById('bmCloudPanel'),
    provider: document.getElementById('bmProvider'),
    providerHint: document.getElementById('bmProviderHint'),
    apiKey: document.getElementById('bmApiKey'),
    prompt: document.getElementById('bmPrompt'),
    generate: document.getElementById('bmGenerate'),
    output: document.getElementById('bmOutput'),
    link: document.getElementById('bmBookmarkletLink'),
    cloudAuth: document.getElementById('bmCloudAuth'),
    cloudConnected: document.getElementById('bmCloudConnected'),
    cloudEmail: document.getElementById('bmCloudEmail'),
    cloudSendCode: document.getElementById('bmCloudSendCode'),
    cloudOtp: document.getElementById('bmCloudOtp'),
    cloudCode: document.getElementById('bmCloudCode'),
    cloudVerify: document.getElementById('bmCloudVerify'),
    cloudStatus: document.getElementById('bmCloudStatus'),
    cloudEmailLabel: document.getElementById('bmCloudEmailLabel'),
    cloudModel: document.getElementById('bmCloudModel'),
    cloudLogout: document.getElementById('bmCloudLogout'),
    shareNative: document.getElementById('bmShareNative'),
    shareKindle: document.getElementById('bmShareKindle'),
    kindleConfig: document.getElementById('bmKindleConfig'),
    kindleEmail: document.getElementById('bmKindleEmail'),
    shareLocalSend: document.getElementById('bmShareLocalSend'),
    localSendConfig: document.getElementById('bmLocalSendConfig'),
    localSendIp: document.getElementById('bmLocalSendIp'),
    insertion: document.getElementById('bmInsertion'),
    speedRead: document.getElementById('bmSpeedRead'),
    ghostHighlights: document.getElementById('bmGhostHighlights'),
    config: document.getElementById('bmConfig')
  };

  var mode = 'cloud';
  var otpId = null;

  function setMode(next) {
    mode = next;
    els.modeByok.classList.toggle('active', next === 'byok');
    els.modeCloud.classList.toggle('active', next === 'cloud');
    els.byokPanel.hidden = next !== 'byok';
    els.cloudPanel.hidden = next !== 'cloud';
    els.output.hidden = true;
    // The generation form (prompt, share options, generate) shows
    // immediately in BYOK mode, but only after the user connects via
    // byPhil Cloud.
    els.config.hidden = next === 'cloud' && !getToken();
  }

  function updateProviderHint() {
    var p = PROVIDERS[els.provider.value];
    if (!p) { els.providerHint.textContent = ''; return; }
    if (p.noKey) {
      els.providerHint.textContent = 'Runs fully local via Ollama — no API key needed.';
    } else {
      els.providerHint.innerHTML = 'Get your <a href="' + p.keyUrl + '" target="_blank" rel="noopener">' + p.name + ' API key</a>.';
    }
  }

  function getToken() {
    try { return localStorage.getItem(TOKEN_KEY) || ''; } catch (e) { return ''; }
  }
  function setToken(t) {
    try { if (t) localStorage.setItem(TOKEN_KEY, t); else localStorage.removeItem(TOKEN_KEY); } catch (e) {}
  }
  function getEmail() {
    try { return localStorage.getItem(EMAIL_KEY) || ''; } catch (e) { return ''; }
  }
  function setEmail(e) {
    try { if (e) localStorage.setItem(EMAIL_KEY, e); else localStorage.removeItem(EMAIL_KEY); } catch (e) {}
  }

  function setCloudStatus(msg, isError) {
    els.cloudStatus.textContent = msg || '';
    els.cloudStatus.style.color = isError ? 'var(--danger, #e74c3c)' : '';
  }

  // Fetch the available byPhil Cloud models and populate the dropdown.
  // Mirrors the extension's settingsManager: GET /v1/projects/ai_summary_helper/models
  // returns { success, models: [{ id, name, context }] }.
  function loadCloudModels() {
    fetch(API_BASE + '/v1/projects/ai_summary_helper/models')
      .then(function (res) { return res.json(); })
      .then(function (data) {
        if (data && data.success && data.models && data.models.length > 0) {
          var current = els.cloudModel.value;
          els.cloudModel.innerHTML = '';
          data.models.forEach(function (model) {
            var opt = document.createElement('option');
            opt.value = model.id;
            var label = model.name;
            if (model.context) label += ' (Context: ' + Math.round(model.context / 1000) + 'k)';
            opt.textContent = label;
            els.cloudModel.appendChild(opt);
          });
          // Restore the user's previous selection if it's still available.
          if (current && Array.from(els.cloudModel.options).some(function (o) { return o.value === current; })) {
            els.cloudModel.value = current;
          }
        }
      })
      .catch(function () {
        // Keep the fallback option on failure.
      });
  }

  function refreshCloudAuth() {
    var token = getToken();
    var email = getEmail();
    if (token && email) {
      els.cloudAuth.hidden = true;
      els.cloudConnected.hidden = false;
      els.cloudEmailLabel.textContent = email;
      loadCloudModels();
      // Reveal the generation form once connected via byPhil Cloud.
      if (mode === 'cloud') els.config.hidden = false;
    } else {
      els.cloudAuth.hidden = false;
      els.cloudConnected.hidden = true;
      if (mode === 'cloud') els.config.hidden = true;
    }
  }

  // ── Mode toggle ─────────────────────────────────────────────────
  els.modeByok.addEventListener('click', function () { setMode('byok'); window.aishTrack && window.aishTrack('Bookmarklet', 'mode', 'byok'); });
  els.modeCloud.addEventListener('click', function () { setMode('cloud'); window.aishTrack && window.aishTrack('Bookmarklet', 'mode', 'cloud'); });

  // ── Provider hint ───────────────────────────────────────────────
  els.provider.addEventListener('change', updateProviderHint);
  updateProviderHint();

  // ── Persist BYOK key + provider locally ─────────────────────────
  els.apiKey.addEventListener('input', function () {
    try { localStorage.setItem('aish_bm_api_key', els.apiKey.value.trim()); } catch (e) {}
  });
  els.provider.addEventListener('change', function () {
    try { localStorage.setItem('aish_bm_provider', els.provider.value); } catch (e) {}
    window.aishTrack && window.aishTrack('Bookmarklet', 'provider', els.provider.value);
  });
  (function () {
    try {
      var savedKey = localStorage.getItem('aish_bm_api_key');
      var savedProvider = localStorage.getItem('aish_bm_provider');
      if (savedKey) els.apiKey.value = savedKey;
      if (savedProvider && PROVIDERS[savedProvider]) els.provider.value = savedProvider;
    } catch (e) {}
  })();

  // ── byPhil Cloud OTP flow ───────────────────────────────────────
  els.cloudSendCode.addEventListener('click', async function () {
    var email = els.cloudEmail.value.trim();
    if (!email) { setCloudStatus('Enter your email first.', true); return; }
    setCloudStatus('Sending magic code…');
    els.cloudSendCode.disabled = true;
    try {
      var res = await fetch(API_BASE + '/v1/auth/request-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email })
      });
      var data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to send code');
      otpId = data.otpId;
      els.cloudOtp.hidden = false;
      els.cloudCode.focus();
      setCloudStatus('Magic code sent! Check your inbox.');
      window.aishTrack && window.aishTrack('Bookmarklet', 'cloud_send_code');
    } catch (err) {
      setCloudStatus('Error: ' + err.message, true);
    } finally {
      els.cloudSendCode.disabled = false;
    }
  });

  els.cloudVerify.addEventListener('click', async function () {
    var code = els.cloudCode.value.replace(/\s+/g, '').trim();
    if (!code) { setCloudStatus('Enter the verification code.', true); return; }
    if (!otpId) { setCloudStatus('Session lost. Request a new code.', true); return; }
    setCloudStatus('Verifying…');
    els.cloudVerify.disabled = true;
    try {
      var res = await fetch(API_BASE + '/v1/auth/verify-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ otpId: otpId, code: code })
      });
      var data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Invalid code');
      setToken(data.token);
      setEmail(els.cloudEmail.value.trim());
      otpId = null;
      els.cloudCode.value = '';
      els.cloudOtp.hidden = true;
      setCloudStatus('');
      refreshCloudAuth();
      window.aishTrack && window.aishTrack('Bookmarklet', 'cloud_connected');
    } catch (err) {
      setCloudStatus('Error: ' + err.message, true);
    } finally {
      els.cloudVerify.disabled = false;
    }
  });

  els.cloudLogout.addEventListener('click', function () {
    setToken(null);
    setEmail(null);
    refreshCloudAuth();
  });

  // Persist the selected cloud model locally.
  els.cloudModel.addEventListener('change', function () {
    try { localStorage.setItem('aish_bm_cloud_model', els.cloudModel.value); } catch (e) {}
  });
  (function () {
    try {
      var savedModel = localStorage.getItem('aish_bm_cloud_model');
      if (savedModel) els.cloudModel.value = savedModel;
    } catch (e) {}
  })();

  // ── Share options toggle ────────────────────────────────────────
  function updateShareConfig() {
    els.kindleConfig.hidden = !els.shareKindle.checked;
    els.localSendConfig.hidden = !els.shareLocalSend.checked;
  }
  els.shareKindle.addEventListener('change', updateShareConfig);
  els.shareLocalSend.addEventListener('change', updateShareConfig);
  els.shareNative.addEventListener('change', function () {
    try { localStorage.setItem('aish_bm_share_native', els.shareNative.checked ? '1' : '0'); } catch (e) {}
    window.aishTrack && window.aishTrack('Bookmarklet', 'share_native', els.shareNative.checked ? 'on' : 'off');
  });
  els.shareKindle.addEventListener('change', function () {
    try { localStorage.setItem('aish_bm_share_kindle', els.shareKindle.checked ? '1' : '0'); } catch (e) {}
    window.aishTrack && window.aishTrack('Bookmarklet', 'share_kindle', els.shareKindle.checked ? 'on' : 'off');
  });
  els.shareLocalSend.addEventListener('change', function () {
    try { localStorage.setItem('aish_bm_share_localsend', els.shareLocalSend.checked ? '1' : '0'); } catch (e) {}
    window.aishTrack && window.aishTrack('Bookmarklet', 'share_localsend', els.shareLocalSend.checked ? 'on' : 'off');
  });
  els.kindleEmail.addEventListener('input', function () {
    try { localStorage.setItem('aish_bm_kindle_email', els.kindleEmail.value.trim()); } catch (e) {}
  });
  els.localSendIp.addEventListener('input', function () {
    try { localStorage.setItem('aish_bm_localsend_ip', els.localSendIp.value.trim()); } catch (e) {}
  });
  (function () {
    try {
      if (localStorage.getItem('aish_bm_share_native') === '1') els.shareNative.checked = true;
      if (localStorage.getItem('aish_bm_share_kindle') === '1') els.shareKindle.checked = true;
      if (localStorage.getItem('aish_bm_share_localsend') === '1') els.shareLocalSend.checked = true;
      var savedKindle = localStorage.getItem('aish_bm_kindle_email');
      var savedLocalSend = localStorage.getItem('aish_bm_localsend_ip');
      if (savedKindle) els.kindleEmail.value = savedKindle;
      if (savedLocalSend) els.localSendIp.value = savedLocalSend;
    } catch (e) {}
  })();
  updateShareConfig();

  // ── Insertion option persistence ───────────────────────────────
  els.insertion.addEventListener('change', function () {
    try { localStorage.setItem('aish_bm_insertion', els.insertion.value); } catch (e) {}
  });
  (function () {
    try {
      var savedInsertion = localStorage.getItem('aish_bm_insertion');
      if (savedInsertion && ['floating', 'inline'].indexOf(savedInsertion) !== -1) els.insertion.value = savedInsertion;
    } catch (e) {}
  })();

  // ── Speed-read option persistence ──────────────────────────────
  els.speedRead.addEventListener('change', function () {
    try { localStorage.setItem('aish_bm_speedread', els.speedRead.checked ? '1' : '0'); } catch (e) {}
  });
  (function () {
    try {
      if (localStorage.getItem('aish_bm_speedread') === '1') els.speedRead.checked = true;
    } catch (e) {}
  })();

  // ── Ghost highlights option persistence ────────────────────────
  els.ghostHighlights.addEventListener('change', function () {
    try { localStorage.setItem('aish_bm_ghost', els.ghostHighlights.checked ? '1' : '0'); } catch (e) {}
  });
  (function () {
    try {
      if (localStorage.getItem('aish_bm_ghost') === '1') els.ghostHighlights.checked = true;
    } catch (e) {}
  })();

  // Initialize the default mode (byPhil Cloud) and its panel visibility.
  setMode('cloud');

  refreshCloudAuth();

  // ── Bookmarklet generation ──────────────────────────────────────
  // Version of the generated bookmarklet. Bump this whenever the bookmarklet
  // template changes so saved bookmarklets can detect they're outdated.
  var BM_VERSION = '1.0.0';
  // Where the bookmarklet checks for a newer version (served from this site).
  var BM_VERSION_URL = 'https://ai-summary-helper.byphil.eu/bookmarklet-version.json';

  function buildBookmarklet() {
    var prompt = els.prompt.value.trim();
    if (!prompt) { alert('Please enter a prompt.'); return null; }

    var apiUrl, modelIdentifier, apiKey, isGemini, isCloud;

    if (mode === 'cloud') {
      var token = getToken();
      if (!token) { alert('Connect your byPhil account first.'); return null; }
      isCloud = true;
      apiUrl = API_BASE + '/v1/projects/ai_summary_helper/chat';
      modelIdentifier = els.cloudModel.value || 'google/gemini-3.8-flash';
      apiKey = token;
    } else {
      var p = PROVIDERS[els.provider.value];
      if (!p) { alert('Select a provider.'); return null; }
      apiUrl = p.endpoint;
      modelIdentifier = p.model;
      apiKey = els.apiKey.value.trim();
      isGemini = els.provider.value === 'gemini';
      if (!p.noKey && !apiKey) { alert('Enter your API key.'); return null; }
    }

    // Insertion mode: floating box (default) or inline (click to place).
    var insertion = els.insertion.value || 'floating';
    // Speed-read the summary via an RSVP overlay.
    var speedRead = els.speedRead.checked;
    // Ghost-highlight key verbatim passages on the page.
    var ghostHighlights = els.ghostHighlights.checked;

    // Share options (the summary is always inserted on the page; these are
    // optional additional shares configured at generate time).
    var shareNative = els.shareNative.checked;
    var shareKindle = els.shareKindle.checked;
    var shareLocalSend = els.shareLocalSend.checked;
    var kindleEmail = els.kindleEmail.value.trim();
    var localSendIp = els.localSendIp.value.trim();
    if (shareKindle) {
      if (!isCloud) { alert('Send to Kindle requires a byPhil Cloud connection.'); return null; }
      if (!kindleEmail) { alert('Enter your Kindle email.'); return null; }
    }
    if (shareLocalSend && !localSendIp) { alert('Enter your LocalSend IP.'); return null; }

    // The bookmarklet body. It runs in the context of whatever page the user
    // is on, so it must be fully self-contained (no external deps). It:
    //   1. Checks the site's version manifest and warns if this bookmarklet
    //      is outdated (the user should regenerate it).
    //   2. Sends the page content to the chosen provider.
    //   3. Parses the SSE stream from response.text() (works in any browser,
    //      unlike WebExtension-only TextDecoder/getReader()).
    //   4. Always inserts the summary on the page, then optionally shares it
    //      via the system share sheet, Kindle (byPhil Cloud proxy), or
    //      LocalSend (direct P2P).
    var code = [
      '(function(){',
      'var BM_VERSION=' + JSON.stringify(BM_VERSION) + ';',
      'var BM_VERSION_URL=' + JSON.stringify(BM_VERSION_URL) + ';',
      'var apiUrl=' + JSON.stringify(apiUrl) + ';',
      'var model=' + JSON.stringify(modelIdentifier) + ';',
      'var apiKey=' + JSON.stringify(apiKey) + ';',
      'var isGemini=' + (isGemini ? 'true' : 'false') + ';',
      'var isCloud=' + (isCloud ? 'true' : 'false') + ';',
      'var prompt=' + JSON.stringify(prompt) + ';',
      'var insertion=' + JSON.stringify(insertion) + ';',
      'var speedRead=' + (speedRead ? 'true' : 'false') + ';',
      'var ghostHighlights=' + (ghostHighlights ? 'true' : 'false') + ';',
      'var shareNative=' + (shareNative ? 'true' : 'false') + ';',
      'var shareKindle=' + (shareKindle ? 'true' : 'false') + ';',
      'var shareLocalSend=' + (shareLocalSend ? 'true' : 'false') + ';',
      'var kindleEmail=' + JSON.stringify(kindleEmail) + ';',
      'var localSendIp=' + JSON.stringify(localSendIp) + ';',
      '// Extract the main article content, stripping page noise (mirrors the extension extractor).',
      'var NOISE=["script","style","noscript","nav","header","footer","aside","iframe","embed","object","canvas","svg","form","button","input","select","textarea","[role=\\"navigation\\"]","[role=\\"banner\\"]","[role=\\"contentinfo\\"]",".ad",".ads",".advertisement",".sidebar","#sidebar","#comments",".comments",".tags",".share-tools",".recommended-stories",".sr-only",".visually-hidden",".hidden",".hide","[aria-hidden=\\"true\\"]"];',
      'var stripNoise=function(root){var nodes=root.querySelectorAll(NOISE.join(","));for(var i=0;i<nodes.length;i++){nodes[i].remove();}};',
      'var cleanAttrs=function(root){var els=root.querySelectorAll("*");for(var i=0;i<els.length;i++){var el=els[i];var attrs=Array.from(el.attributes);for(var j=0;j<attrs.length;j++){var n=attrs[j].name;if(n!=="src"&&n!=="href"&&n!=="alt")el.removeAttribute(n);}}};',
      'var extractContent=function(){var article=document.querySelector("article")||document.querySelector("[role=\\"main\\"]")||document.querySelector("main")||document.querySelector("#content")||document.querySelector("#storytext")||document.body;var clone=article.cloneNode(true);stripNoise(clone);cleanAttrs(clone);var text=clone.textContent||"";text=text.replace(/[ \\t]+/g," ").replace(/\\n{3,}/g,"\\n\\n").trim();if(text.length<500&&article!==document.body){var bc=document.body.cloneNode(true);stripNoise(bc);cleanAttrs(bc);text=(bc.textContent||"").replace(/[ \\t]+/g," ").replace(/\\n{3,}/g,"\\n\\n").trim();}return text;};',
      'var content=extractContent();',
      'var style=document.createElement("style");',
      'style.innerHTML="#ai-summary-message{position:fixed;top:0;left:0;width:100%;background:#007bff;color:#fff;text-align:center;padding:10px 0;z-index:10000;font-size:18px;font-weight:bold;}#ai-summary-box{position:fixed;top:60px;right:20px;max-width:420px;max-height:70vh;overflow:auto;background:#fff;color:#111;padding:12px;border-left:4px solid #007bff;border-radius:10px;box-shadow:0 4px 20px rgba(0,0,0,0.3);z-index:10000;}#ai-summary-box .asb-body{padding:8px;}#ai-summary-box .asb-actions{position:sticky;bottom:0;background:#fff;border-top:1px solid #007bff;display:flex;gap:6px;flex-wrap:wrap;margin-top:10px;padding:6px;}#ai-summary-box .asb-btn{font-size:12px;padding:4px 8px;border:1px solid #007bff;border-radius:6px;background:transparent;cursor:pointer;color:#007bff;}#ai-summary-box .asb-btn:hover{background:rgba(0,123,255,0.1);}#ai-speedread{position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.85);z-index:10001;display:flex;flex-direction:column;align-items:center;justify-content:center;}#ai-speedread .sr-word{font-size:clamp(28px,6vw,72px);color:#fff;font-weight:bold;}#ai-speedread .sr-controls{margin-top:20px;display:flex;gap:10px;}#ai-speedread .sr-wpm{margin-top:8px;color:#aaa;font-size:14px;}#ai-speedread button{font-size:16px;padding:8px 16px;border:none;border-radius:8px;background:#007bff;color:#fff;cursor:pointer;}";',
      'document.head.appendChild(style);',
      'var msg=document.createElement("div");msg.id="ai-summary-message";msg.textContent="Summarizing…";document.body.prepend(msg);',
      '// Optional update check (best-effort, never blocks summarization).',
      'try{fetch(BM_VERSION_URL).then(function(r){return r.json();}).then(function(v){if(v&&v.version&&v.version!==BM_VERSION){msg.textContent="⚠️ Bookmarklet outdated (v"+BM_VERSION+", latest v"+v.version+"). Regenerate it at ai-summary-helper.byphil.eu/#bookmarklet";setTimeout(function(){msg.textContent="Summarizing…";},4000);}}).catch(function(){});}catch(e){}',
      'var startFetch=function(){',
      '// Create the summary container up front so we can stream into it as text arrives.',
      'var title=document.title||"AI Summary";',
      'var url=location.href;',
      'var box=null,body=null,sc=null;',
      'if(insertion==="inline"&&targetEl){',
      '  sc=document.createElement("blockquote");sc.id="ai-summary-inline";sc.style.cssText="border-left:4px solid #007bff;padding:15px;margin:20px 0;background:rgba(0,123,255,0.05);";sc.innerHTML="<div><h2 style=\\"margin-top:0\\">AI Summary 🧙</h2><div class=\\"asb-body\\"></div></div>";body=sc.querySelector(".asb-body");targetEl.insertAdjacentElement("beforebegin",sc);',
      '}else{',
      '  box=document.createElement("div");box.id="ai-summary-box";box.innerHTML="<strong style=\\"display:block;margin-bottom:8px;\\">🧙 AI Summary</strong><div class=\\"asb-body\\"></div>";body=box.querySelector(".asb-body");document.body.appendChild(box);',
      '}',
      'var headers={"Content-Type":"application/json"};',
      'if(apiKey)headers["Authorization"]="Bearer "+apiKey;',
      'var reqBody;',
      'var req;',
      'if(isGemini){',
      '  var url="https://generativelanguage.googleapis.com/v1beta/models/"+encodeURIComponent(model)+":generateContent?alt=sse";',
      '  headers["x-goog-api-key"]=apiKey;',
      '  reqBody=JSON.stringify({contents:[{role:"user",parts:[{text:"Produce ONLY valid HTML. Return a single <div> containing <h2> and <p> tags. At the end include an HTML comment with 3-5 short, EXACT verbatim string snippets from the source text representing the most critical key insights: <!-- GHOST_HIGHLIGHTS: [\\"exact key passage 1\\", \\"exact key passage 2\\"] -->. "+prompt+"\\n\\nContent:\\n"+content}]}]});',
      '  req=fetch(url,{method:"POST",headers:headers,body:reqBody});',
      '}else{',
      '  reqBody=JSON.stringify({model:model,messages:[{role:"system",content:"You are a summarizer returning HTML <div> with <h2> and <p> tags. At the end include an HTML comment with 3-5 short, EXACT verbatim string snippets from the source text representing the most critical key insights, core facts, or main arguments (avoid conversational quotes or dialogue unless they state a core thesis): <!-- GHOST_HIGHLIGHTS: [\\"exact key passage 1\\", \\"exact key passage 2\\"] -->."},{role:"user",content:"Summarize in valid HTML format with sections:"+prompt},{role:"user",content:content}],stream:true});',
      '  req=fetch(apiUrl,{method:"POST",headers:headers,body:reqBody});',
      '}',
      'req',
      '.then(function(r){if(!r.ok)throw new Error("HTTP "+r.status);return r;})',
      '.then(function(r){',
      '  msg.remove();',
      '  var out="";var buf="";var dec=new TextDecoder();',
      '  var reader=r.body.getReader();',
      '  var done=false;',
      '  var pump=function(){',
      '    reader.read().then(function(chunk){',
      '      if(chunk.done){finalize();return;}',
      '      buf+=dec.decode(chunk.value,{stream:true});',
      '      var nl;while((nl=buf.indexOf("\\n"))!==-1){var line=buf.substring(0,nl).trim();buf=buf.substring(nl+1);if(!line||line.indexOf("data:")!==0)continue;var json=line.substring(5).trim();if(json==="[DONE]")continue;try{var j=JSON.parse(json);var piece=isGemini?(j.candidates&&j.candidates[0]&&j.candidates[0].content&&j.candidates[0].content.parts&&j.candidates[0].content.parts[0]?j.candidates[0].content.parts[0].text:""):(j.choices&&j.choices[0]&&(j.choices[0].delta&&j.choices[0].delta.content||j.choices[0].message&&j.choices[0].message.content)||j.message&&j.message.content||j.response||"");if(piece){out+=piece;body.innerHTML=out;}}catch(e){}}',
      '      pump();',
      '    });',
      '  };',
      '  var finalize=function(){',
      '    if(done)return;done=true;',
      '    buf+=dec.decode();',
      '    if(!out)throw new Error("No summary returned");',
      '    var summary=out;',
      '  // Parse ghost highlights from the summary and strip the comment.',
      '  var ghostQuotes=[];',
      '  var gm=summary.match(/<!--\\s*GHOST_HIGHLIGHTS:\\s*([\\s\\S]*?)\\s*-->/i);',
      '  if(gm){try{var raw=gm[1].trim().replace(/^```json/i,"").replace(/^```/,"").replace(/```$/,"").trim();ghostQuotes=JSON.parse(raw);}catch(e){}}',
      '  summary=summary.replace(/<!--\\s*GHOST_HIGHLIGHTS:\\s*([\\s\\S]*?)\\s*-->/gi,"").trim();',
      '  body.innerHTML=summary;',
      '  // Highlight matching verbatim passages on the page (light blue, like the extension).',
      '  var highlightGhosts=function(){',
      '    if(!ghostQuotes||!ghostQuotes.length)return;',
      '    var style2=document.createElement("style");style2.innerHTML="mark.ai-ghost-highlight{background-color:rgba(186,230,253,0.65);color:#0369a1;border-bottom:2px dashed #0284c7;border-radius:2px;padding:0 2px;}";document.head.appendChild(style2);',
      '    var findRange=function(root,text){var query=text.replace(/\\s+/g," ").trim();if(!query)return null;var walker=document.createTreeWalker(root,NodeFilter.SHOW_TEXT,{acceptNode:function(node){if(!node||!node.nodeValue||!node.nodeValue.trim())return NodeFilter.FILTER_REJECT;var p=node.parentElement;if(!p)return NodeFilter.FILTER_REJECT;if(p.closest("script,style,noscript,mark.ai-ghost-highlight"))return NodeFilter.FILTER_REJECT;return NodeFilter.FILTER_ACCEPT;}});var spans=[];var full="";var cur=0;var n;while((n=walker.nextNode())){var v=n.nodeValue||"";spans.push({node:n,start:cur,end:cur+v.length});full+=v;cur+=v.length;}if(!full)return null;var idx=full.indexOf(text);if(idx===-1)idx=full.indexOf(query);if(idx===-1)return null;var match=idx===full.indexOf(text)&&full.indexOf(text)!==-1?text:query;var si=idx;var ei=idx+match.length;var sp=null,ep=null;for(var i=0;i<spans.length;i++){if(si<spans[i].end){sp={node:spans[i].node,offset:Math.max(0,si-spans[i].start)};break;}}for(var j=0;j<spans.length;j++){if(ei<=spans[j].end){ep={node:spans[j].node,offset:ei-spans[j].start};break;}}if(!sp||!ep)return null;var r=document.createRange();r.setStart(sp.node,sp.offset);r.setEnd(ep.node,ep.offset);return r;};',
      '    ghostQuotes.forEach(function(q){var clean=(q||"").replace(/\\s+/g," ").trim();if(clean.length<5)return;var range=findRange(document.body,clean);if(!range)return;var mark=document.createElement("mark");mark.className="ai-ghost-highlight";mark.dataset.annotationText=clean;try{range.surroundContents(mark);}catch(e){var w=document.createElement("span");w.appendChild(range.extractContents());mark.appendChild(w);range.insertNode(mark);}});',
      '  };',
      '  if(ghostHighlights)highlightGhosts();',
      '  var highlightsHtml="";',
      '  if(ghostQuotes&&ghostQuotes.length){highlightsHtml="<h2>🔦 Key Highlights</h2><ul>"+ghostQuotes.map(function(q){return "<li>"+(q||"").replace(/</g,"&lt;").replace(/>/g,"&gt;")+"</li>";}).join("")+"</ul>";}',
      '  var docHtml="<!DOCTYPE html><html><head><meta charset=\\"utf-8\\"><title>"+title+"</title><style>body{font-family:sans-serif;line-height:1.6;padding:20px;max-width:800px;margin:auto;}h1{border-bottom:2px solid #333;padding-bottom:5px;}.meta{color:#555;font-style:italic;}.summary{background:#f8f9fa;padding:15px;border-left:4px solid #0284c7;margin:20px 0;}mark.ai-ghost-highlight{background-color:rgba(186,230,253,0.65);color:#0369a1;border-bottom:2px dashed #0284c7;border-radius:2px;padding:0 2px;}</style></head><body><h1>"+title+"</h1><div class=\\"meta\\">Captured via AI Summary Helper &middot; <a href=\\""+url+"\\">Source</a></div><div class=\\"summary\\"><h2>🧙 AI Summary</h2>"+summary+"</div>"+highlightsHtml+"<h2>📄 Content</h2><div>"+content.replace(/</g,"&lt;").replace(/>/g,"&gt;")+"</div></body></html>";',
      '  // Build the share buttons (shared by the floating box and inline summary).',
      '  var buildActions=function(){',
      '    var actions=document.createElement("div");actions.className="asb-actions";',
      '    var mkBtn=function(label,fn){var b=document.createElement("button");b.className="asb-btn";b.textContent=label;b.addEventListener("click",fn);actions.appendChild(b);return b;};',
      '    var hlPlain="";if(ghostQuotes&&ghostQuotes.length){hlPlain="\\n\\n🔦 Key Highlights:\\n"+ghostQuotes.map(function(q){return "• "+(q||"").replace(/<[^>]*>/g,"").trim();}).join("\\n");}',
      '    if(shareNative&&navigator.share)mkBtn("Share",function(){try{navigator.share({title:title,text:summary.replace(/<[^>]*>/g,"").trim()+hlPlain,url:url});}catch(e){}});',
      '    mkBtn("Copy",function(){try{navigator.clipboard.writeText(summary.replace(/<[^>]*>/g,"").trim()+hlPlain);}catch(e){}});',
      '    mkBtn(".MD 💾",function(){var plain=summary.replace(/<[^>]*>/g,"").replace(/&amp;/g,"&").replace(/&lt;/g,"<").replace(/&gt;/g,">").replace(/&quot;/g,"\\"").replace(/&#39;/g,"\'").trim();var hl="";if(ghostQuotes&&ghostQuotes.length){hl="\\n\\n## 🔦 Key Highlights\\n\\n"+ghostQuotes.map(function(q){return "- "+(q||"").replace(/<[^>]*>/g,"").trim();}).join("\\n");}var md="# "+title+"\\n\\n> Source: "+url+"\\n\\n## 🧙 AI Summary\\n\\n"+plain+hl+"\\n\\n---\\n\\n## 📄 Content\\n\\n"+content+"\\n";var blob=new Blob([md],{type:"text/markdown;charset=utf-8"});var a=document.createElement("a");a.href=URL.createObjectURL(blob);a.download=title.replace(/[^a-z0-9_-]/gi,"_").toLowerCase()+"_summary.md";document.body.appendChild(a);a.click();document.body.removeChild(a);});',
      '    if(shareKindle)mkBtn("Kindle 📚",function(){var kSummary=summary;if(ghostQuotes&&ghostQuotes.length){kSummary+="<h2>🔦 Key Highlights</h2><ul>"+ghostQuotes.map(function(q){return "<li>"+(q||"").replace(/</g,"&lt;").replace(/>/g,"&gt;")+"</li>";}).join("")+"</ul>";}fetch("https://api.byphil.eu/v1/projects/ai_summary_helper/kindle",{method:"POST",headers:{"Content-Type":"application/json","Authorization":"Bearer "+apiKey},body:JSON.stringify({kindle_email:kindleEmail,title:title,content:content,summary:kSummary,url:url})}).then(function(r){return r.json();}).then(function(d){alert(d&&d.success?"Sent to Kindle! 📚":"Kindle delivery failed: "+(d&&d.error||"unknown"));}).catch(function(e){alert("Kindle error: "+e.message);});});',
      '    if(shareLocalSend)mkBtn("LocalSend 📱",function(){var fileName=title.replace(/[^a-z0-9_-]/gi,"_")+".html";var enc=new TextEncoder();var bytes=enc.encode(docHtml);var fileId="file_"+Date.now();var prepare={info:{alias:"AI Summary Helper",version:"2.0",deviceModel:"Bookmarklet",deviceType:"browser"},files:{}};prepare.files[fileId]={id:fileId,fileName:fileName,size:bytes.length,fileType:"text/html",sha256:null,preview:null};var base="http://"+localSendIp+":53317/api/localsend/v1";fetch(base+"/prepare-upload",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(prepare)}).then(function(r){if(!r.ok)throw new Error("Handshake HTTP "+r.status);return r.json();}).then(function(d){var sid=d.sessionId||d.session_id;var files=d.files||{};var tok=files[fileId]||(d.tokens&&d.tokens[fileId]);var up=base+"/upload?sessionId="+encodeURIComponent(sid)+"&fileId="+encodeURIComponent(fileId);if(tok)up+="&token="+encodeURIComponent(tok);return fetch(up,{method:"POST",headers:{"Content-Type":"application/octet-stream"},body:bytes});}).then(function(r){if(!r.ok)throw new Error("Upload HTTP "+r.status);alert("Sent to LocalSend! 📖");}).catch(function(e){var m=(e&&e.message)||"unknown";if(/CSP|Content Security|mixed content|Refused to connect/i.test(m)){alert("LocalSend blocked by this page security policy (CSP or mixed content). This happens on HTTPS pages talking to a plain-HTTP LAN device. Try the extension instead, or open this page over http://.");}else{alert("LocalSend error: "+m);}});});',
'    if(speedRead)mkBtn("Speed-read ⚡",function(){var words=summary.replace(/<[^>]*>/g," ").split(/\\s+/).filter(function(w){return w.length>0;});var sr=document.createElement("div");sr.id="ai-speedread";sr.innerHTML="<div class=\\"sr-word\\"></div><div class=\\"sr-controls\\"><button id=\\"srSlower\\">−</button><button id=\\"srPause\\">⏸</button><button id=\\"srFaster\\">+</button><button id=\\"srClose\\">✕ Close</button></div><div class=\\"sr-wpm\\" id=\\"srWpm\\"></div>";var wordEl=sr.querySelector(".sr-word");var idx=0;var playing=true;var wpm=300;var timer=null;var wpmEl=sr.querySelector("#srWpm");var updateWpm=function(){wpmEl.textContent=wpm+" wpm";};var tick=function(){if(idx>=words.length){clearInterval(timer);return;}wordEl.textContent=words[idx++];};var restart=function(){clearInterval(timer);timer=setInterval(function(){if(playing)tick();},Math.round(60000/wpm));};tick();updateWpm();restart();sr.querySelector("#srPause").addEventListener("click",function(){playing=!playing;this.textContent=playing?"⏸":"▶";});sr.querySelector("#srSlower").addEventListener("click",function(){wpm=Math.max(60,wpm-50);updateWpm();restart();});sr.querySelector("#srFaster").addEventListener("click",function(){wpm=Math.min(1000,wpm+50);updateWpm();restart();});sr.querySelector("#srClose").addEventListener("click",function(){clearInterval(timer);sr.remove();});document.body.appendChild(sr);});',
      '    return actions;',
      '  };',
      '  var actions=buildActions();',
      '  if(box){box.appendChild(actions);var close=document.createElement("button");close.textContent="✕";close.style.cssText="position:absolute;top:6px;right:8px;border:none;background:none;font-size:16px;cursor:pointer;";box.prepend(close);close.addEventListener("click",function(){box.remove();});}',
      '  if(sc){sc.appendChild(actions);}',      '  };',
      '  pump();',      '})',
      '.catch(function(err){msg.remove();alert("Error: "+err.message);});',
      '};',
      '// For inline mode, ask the user where to insert BEFORE summarizing.',
      'var targetEl=null;',
      'if(insertion==="inline"){',
      '  msg.textContent="Click the spot where you want the summary inserted.";',
      '  document.body.style.cursor="crosshair";',
      '  var hover=function(e){e.target.style.outline="2px dashed #007bff";};',
      '  var unhover=function(e){e.target.style.outline="";};',
      '  document.addEventListener("mouseover",hover);document.addEventListener("mouseout",unhover);',
      '  document.addEventListener("click",function handler(e){e.preventDefault();e.stopPropagation();document.body.style.cursor="default";document.removeEventListener("click",handler);document.removeEventListener("mouseover",hover);document.removeEventListener("mouseout",unhover);targetEl=e.target;msg.textContent="Summarizing…";startFetch();},{once:true});',
      '}else{',
      '  startFetch();',
      '}',
      '})();'
    ].join('\n');

    return 'javascript:' + encodeURIComponent(code);
  }

  els.generate.addEventListener('click', function () {
    var href = buildBookmarklet();
    if (!href) return;
    els.link.href = href;
    els.link.textContent = '🪄 AI Summary (' + (mode === 'cloud' ? 'byPhil Cloud' : els.provider.value) + ')';
    els.output.hidden = false;
    window.aishTrack && window.aishTrack('Bookmarklet', 'generate', mode === 'cloud' ? 'cloud' : els.provider.value);
  });
})();



/* ── Old #bookmarklet deep links (the hero no longer offers the bookmarklet; the generator has its own page) ── */
(function () {
  // The generator moved to its own page; keep old index.html#bookmarklet links working.
  if (location.hash === '#bookmarklet') {
    location.replace(location.pathname.replace(/[^/]*$/, '') + 'bookmarklet.html');
    return;
  }
  var tabs = Array.prototype.slice.call(document.querySelectorAll('.hero-switch-btn'));
  if (!tabs.length) return;
  function select(name, focus) {
    tabs.forEach(function (t) {
      var on = t.dataset.hero === name;
      t.classList.toggle('active', on);
      t.setAttribute('aria-selected', on ? 'true' : 'false');
      t.tabIndex = on ? 0 : -1;
      var pane = document.getElementById(t.getAttribute('aria-controls'));
      if (pane) pane.hidden = !on;
      document.querySelectorAll('[data-stage-pane]').forEach(function (p) { p.hidden = p.getAttribute('data-stage-pane') !== name; });
      window.dispatchEvent(new Event('hs-refresh'));
      if (on && focus) t.focus();
    });
    if (window.aishTrack) window.aishTrack('hero', 'switch', name);
  }
  tabs.forEach(function (t, i) {
    t.addEventListener('click', function () { select(t.dataset.hero); });
    t.addEventListener('keydown', function (e) {
      var k = e.key, n = null;
      if (k === 'ArrowRight' || k === 'ArrowDown') n = tabs[(i + 1) % tabs.length];
      else if (k === 'ArrowLeft' || k === 'ArrowUp') n = tabs[(i - 1 + tabs.length) % tabs.length];
      else if (k === 'Home') n = tabs[0]; else if (k === 'End') n = tabs[tabs.length - 1];
      if (n) { e.preventDefault(); select(n.dataset.hero, true); }
    });
  });
  // iOS can't run the extension: start on the bookmarklet there.
  var ua = navigator.userAgent || '';
  if (/iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)) select('bookmarklet');
})();

/* ── Event tracking (Matomo via window.aishTrack; no-op when opted out) ── */
(function () {
  var T = function () { if (window.aishTrack) window.aishTrack.apply(null, arguments); };
  var page = (location.pathname.replace(/\/index\.html$/, '/').split('/').filter(Boolean).pop() || 'home').replace(/\.html$/, '');
  var htmlLang = document.documentElement.getAttribute('lang') || 'en';

  function sectionOf(node) {
    var s = node.closest && node.closest('section[id], header, footer, nav, .mobile-menu');
    if (!s) return page;
    if (s.id) return s.id;
    return s.tagName.toLowerCase() === 'header' ? 'hero' : s.tagName.toLowerCase();
  }

  /* Clicks: CTAs, nav, footer, blog cards (delegated) */
  document.addEventListener('click', function (e) {
    var a = e.target.closest && e.target.closest('a[href]');
    if (!a) return;
    var href = a.getAttribute('href') || '';
    var where = sectionOf(a);
    if (/chromewebstore\.google\.com/.test(href)) return T('CTA', 'add_to_chrome', where);
    if (/github\.com\/philffm/.test(href)) return T('Outbound', 'github', where);
    if (/bookmarklet\.html/.test(href)) return T('CTA', 'open_bookmarklet_page', where);
    if (/byphil\.eu\/(account|login|pricing|support)|\/account/.test(href)) return T('CTA', 'byphil_account', where);
    if (/byphil\.eu\/terms/.test(href)) return T('Outbound', 'legal', href.split('#')[1] || 'terms');
    if (/byphil\.eu|philwornath\.com/.test(href)) return T('Outbound', 'byphil_site', where);
    if (/ec\.europa\.eu/.test(href)) return T('Outbound', 'eu_odr');
    if (a.classList.contains('blog-card')) return T('Blog', 'open_post', href.replace(/\.html$/, ''));
    if (/privacy\.html/.test(href)) return T('Nav', 'privacy', where);
    if (/^#/.test(href)) return T('Nav', 'anchor', href.slice(1));
    if (a.closest('nav, .mobile-menu')) return T('Nav', 'click', href.replace(/^.*\//, '') || 'home');
    if (a.closest('.tier-card')) return T('Pricing', 'tier_cta', (a.closest('.tier-card').querySelector('.tier-name') || {}).textContent);
    if (a.closest('footer')) return T('Footer', 'click', href.replace(/^.*\//, '') || 'home');
  }, true);

  /* Mobile menu, pricing toggle, personas, FAQ, language banner */
  document.addEventListener('click', function (e) {
    var t = e.target.closest ? e.target : null; if (!t) return;
    var b;
    if ((b = t.closest('#navToggle'))) return T('Nav', 'mobile_menu', b.getAttribute('aria-expanded') === 'true' ? 'close' : 'open');
    if ((b = t.closest('#btnMonthly'))) return T('Pricing', 'billing_toggle', 'monthly');
    if ((b = t.closest('#btnYearly'))) return T('Pricing', 'billing_toggle', 'yearly');
    if ((b = t.closest('.lang-banner-link'))) return T('Language', 'banner_switch', b.textContent);
    if ((b = t.closest('.lang-banner-close'))) return T('Language', 'banner_dismiss');
    if ((b = t.closest('[data-analytics-settings]'))) return T('Privacy', 'open_settings');
  }, true);

  document.addEventListener('toggle', function (e) {
    var d = e.target;
    if (d && d.tagName === 'DETAILS' && d.open && d.closest('.faq')) {
      var q = d.querySelector('summary');
      T('FAQ', 'open', q ? q.textContent.trim().slice(0, 80) : '');
    }
  }, true);

  /* Section views (once each) */
  if ('IntersectionObserver' in window) {
    var seen = {};
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (!en.isIntersecting) return;
        var id = en.target.id;
        if (seen[id]) return; seen[id] = 1; io.unobserve(en.target);
        T('Section', 'view', id);
      });
    }, { threshold: 0.35 });
    document.querySelectorAll('section[id]').forEach(function (s) { io.observe(s); });
  }

  /* Scroll depth 25/50/75/100 */
  var marks = { 25: 0, 50: 0, 75: 0, 100: 0 }, ticking = false;
  function depth() {
    ticking = false;
    var h = document.documentElement, max = h.scrollHeight - h.clientHeight;
    if (max < 200) return;
    var p = Math.round((window.pageYOffset || h.scrollTop) / max * 100);
    Object.keys(marks).forEach(function (m) { if (!marks[m] && p >= +m - (m == 100 ? 2 : 0)) { marks[m] = 1; T('Scroll', 'depth', page, +m); } });
  }
  window.addEventListener('scroll', function () { if (!ticking) { ticking = true; requestAnimationFrame(depth); } }, { passive: true });

  /* Page meta once: viewing language + page type */
  T('Page', 'lang', htmlLang);
})();

/* ── Peek carousel (landing page "See it") ───────────────────────── */
(function () {
  var root = document.querySelector('[data-carousel]');
  if (!root) return;
  var track = root.querySelector('.cx-track');
  var slides = [].slice.call(track.children);
  var dots = [].slice.call(root.querySelectorAll('.cx-dot'));
  var prev = root.querySelector('.cx-prev'), next = root.querySelector('.cx-next');
  var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var active = 0, raf = 0;
  function nearest() {
    var mid = track.scrollLeft + track.clientWidth / 2, best = 0, bd = Infinity;
    slides.forEach(function (el, i) {
      var d = Math.abs(el.offsetLeft + el.offsetWidth / 2 - mid);
      if (d < bd) { bd = d; best = i; }
    });
    return best;
  }
  function sync(i) {
    active = i;
    slides.forEach(function (el, k) { el.classList.toggle('is-active', k === i); el.setAttribute('aria-current', k === i ? 'true' : 'false'); });
    dots.forEach(function (d, k) { d.classList.toggle('is-active', k === i); if (k === i) d.setAttribute('aria-current', 'true'); else d.removeAttribute('aria-current'); });
    if (prev) prev.disabled = i === 0;
    if (next) next.disabled = i === slides.length - 1;
  }
  function go(i) {
    i = Math.max(0, Math.min(slides.length - 1, i));
    var el = slides[i];
    track.scrollTo({ left: el.offsetLeft + el.offsetWidth / 2 - track.clientWidth / 2, behavior: reduce ? 'auto' : 'smooth' });
  }
  track.addEventListener('scroll', function () {
    if (raf) return;
    raf = requestAnimationFrame(function () { raf = 0; var i = nearest(); if (i !== active) sync(i); });
  }, { passive: true });
  if (prev) prev.addEventListener('click', function () { go(active - 1); });
  if (next) next.addEventListener('click', function () { go(active + 1); });
  dots.forEach(function (d, i) { d.addEventListener('click', function () { go(i); }); });
  slides.forEach(function (el, i) { el.addEventListener('click', function () { if (String(window.getSelection && window.getSelection()).length) return; if (i !== active) go(i); }); });
  track.addEventListener('keydown', function (e) {
    if (e.key === 'ArrowRight') { e.preventDefault(); go(active + 1); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); go(active - 1); }
  });
  window.addEventListener('resize', function () { go(active); });
  go(0); sync(0);
})();

// Live demo: the iframe is created on click, so the page stays light until someone wants it.
// It follows the page: language folder (/de/ -> de) and light/dark theme travel as query parameters.
(function () {
  function siteTheme() { return document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark'; }
  function siteLang() { var seg = location.pathname.split('/').filter(Boolean)[0] || ''; return /^[a-z]{2}(-[a-z]{2})?$/.test(seg) ? seg : 'en'; }
  function demoUrl(u) { return u.split('?')[0] + '?lang=' + siteLang() + '&theme=' + siteTheme(); }
  document.querySelectorAll('.demo-open').forEach(function (a) { a.addEventListener('click', function () { a.href = demoUrl(a.getAttribute('href')); }); });
  document.querySelectorAll('[data-demo]').forEach(function (box) {
    var btn = box.querySelector('.demo-start');
    if (!btn) return;
    function poster() { box.style.backgroundImage = 'url(' + box.getAttribute('data-src').replace('demo/index.html', 'assets/demo-poster/' + (/^(en|de|fr|es|pt|zh|zh-tw|ja|ko|hi|vi|nl|it|ru|uk|tr|id|pl|th|ar|sv|da|no|fi)$/.test(siteLang()) ? siteLang() : 'en') + '-' + siteTheme() + '.webp') + ')'; }
    poster();
    new MutationObserver(function () { if (!box.classList.contains('is-live')) poster(); }).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    btn.addEventListener('click', function () {
      var f = document.createElement('iframe');
      f.src = demoUrl(box.getAttribute('data-src')); f.title = 'AI Summary Helper live demo'; f.loading = 'lazy';
      box.appendChild(f); box.classList.add('is-live');
      // Follow the site's light/dark switch while the demo is open.
      new MutationObserver(function () { try { f.contentWindow.postMessage({ aishDemo: true, type: 'theme', theme: siteTheme() }, '*'); } catch (e) { /* not ready */ } })
        .observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    });
  });
})();

/* ── Hero walkthrough (landing page): a looping, presenter-style demo with a cursor ──
   Time-driven and deterministic: render(t) draws any moment, so steps can be jumped to. Pauses when off-screen or on request. */
(function () {
  var root = document.querySelector('[data-hscene]');
  if (!root) return;
  var reduce = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  var vis = root.querySelector('.hs-vis'), view = root.querySelector('.hscene-view'), canvas = root.querySelector('.hscene-canvas');
  var steps = [].slice.call(root.querySelectorAll('.hs-steps li')), dots = [].slice.call(root.querySelectorAll('.hs-dot')), pp = root.querySelector('.hs-pp');
  var mcap = root.querySelector('.hscene-mcap'), ctrlEl = root.querySelector('.hs-ctrl'); if (mcap && ctrlEl) ctrlEl.parentNode.insertBefore(mcap, ctrlEl);
  var mt = root.querySelector('[data-mcap-t]'), ms = root.querySelector('[data-mcap-s]');
  var sum = root.querySelector('.hs-sum'), st = root.querySelector('.hs-st'), sb = root.querySelector('.hs-sb'), sp = root.querySelector('.hs-sp');
  var D0 = null, pills = [].slice.call(root.querySelectorAll('.hs-langs b[data-lang]')), code = root.querySelector('[data-lang-code]');
  var extbtn = root.querySelector('.hs-extbtn'), tabs = root.querySelector('.hs-tabs i.on'), sugg = root.querySelector('.hs-sugg'), inart = root.querySelector('.hs-a em'), tagLang = root.querySelector('.hs-tags i:last-child');
  // Localized mock content (translated pages only): a local story, local UI strings, and the language the summary switches to.
  var pg = location.pathname.split('/').filter(Boolean)[0] || '', L = /^[a-z]{2}(-[a-z]{2})?$/.test(pg) && window.AISH_HERO_I18N && window.AISH_HERO_I18N[pg];
  var codeA = 'en', codeB = 'de';
  function q1(sel, el) { return (el || root).querySelector(sel); }
  function setT(sel, v, html) { var e = q1(sel); if (e && v != null) e[html ? 'innerHTML' : 'textContent'] = v; }
  if (L) {
    codeA = L.codeA; codeB = L.codeB; root.querySelector('[data-lang-code]').textContent = codeA;
    q1('.hs-langs').innerHTML = L.pills.map(function (n, i) { return '<b' + (i === 0 ? ' data-lang="a" class="is-on"' : i === 1 ? ' data-lang="b"' : '') + '>' + n + '</b>'; }).join('');
    pills = [].slice.call(root.querySelectorAll('.hs-langs b[data-lang]'));
    setT('.hs-badge', ' ' + L.badge); var bi = document.createElement('i'); q1('.hs-badge').insertBefore(bi, q1('.hs-badge').firstChild);
    setT('.hs-bar > span', '🔒 ' + L.url); setT('.hs-mast', L.mast); setT('.hs-kick', L.kick); setT('.hs-art h4', L.h); setT('.hs-dek', L.dek);
    var ap = [].slice.call(root.querySelectorAll('.hs-art > p:not(.hs-dek)')); ap[0].textContent = L.p1; ap[1].textContent = L.hl; ap[2].textContent = L.p3;
    var tg = [].slice.call(root.querySelectorAll('.hs-tags i')); tg[0].textContent = L.tags[0]; tg[1].textContent = L.tags[1];
    setT('.hs-sum small', L.sumLabel); setT('.hs-ph2', L.ph2); setT('.hs-sugg', '💬 ' + L.A.q); setT('.hs-q span', L.A.q);
    var a = q1('.hs-a'); a.firstChild.nodeValue = L.A.a; setT('.hs-a em', L.inart);
    [].slice.call(root.querySelectorAll('.hs-tabs i')).forEach(function (e, i) { e.textContent = L.tabs[i]; });
    setT('.hs-graph small', L.graphT); setT('.hs-graph > div', L.graphL, true);
    var bp = [].slice.call(root.querySelectorAll('.bm-page p')); if (bp.length > 2) { bp[0].textContent = L.p1; bp[1].textContent = L.hl; bp[2].textContent = L.p3; }
    setT('.bm-tb span', '🔒 ' + L.url); setT('.bm-mast', L.mast); setT('.bm-page h4', L.h); setT('.bm-card small', L.sumLabel); setT('.bm-card b', L.A.t); setT('.bm-card > span', L.A.b, true);
    steps.forEach(function (c, i) { if (L.steps[i]) { c.querySelector('b').textContent = L.steps[i][0]; c.querySelector('span').textContent = L.steps[i][1]; } });
    D0 = { a: { t: L.A.t, b: L.A.b, p: L.A.p }, b: { t: L.B.t, b: L.B.b, p: L.B.p } };
  }
  var D = D0 || { a: { t: st.getAttribute('data-t-en'), b: sb.getAttribute('data-b-en'), p: sp.getAttribute('data-p-en') }, b: { t: st.getAttribute('data-t-de'), b: sb.getAttribute('data-b-de'), p: sp.getAttribute('data-p-de') } };
  var cur = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  cur.setAttribute('viewBox', '0 0 24 24'); cur.setAttribute('class', 'hs-cursor');
  cur.innerHTML = '<path d="M4 2l15 9-6.5 1.5L9 19z" fill="#14161f" stroke="#fff" stroke-width="1.4" stroke-linejoin="round"/>';
  var rip = document.createElement('div'); rip.className = 'hs-ripple';
  var tip = document.createElement('div'); tip.className = 'hs-tip';
  canvas.appendChild(rip); canvas.appendChild(cur); canvas.appendChild(tip);
  function cl(x) { return x < 0 ? 0 : x > 1 ? 1 : x; }
  function seg(t, a, b) { return cl((t - a) / (b - a)); }
  function ease(x) { return x < .5 ? 2 * x * x : 1 - Math.pow(-2 * x + 2, 2) / 2; }
  function slice(html, n) {
    var out = '', i = 0, vis2 = 0, open = [];
    while (i < html.length && vis2 < n) {
      if (html[i] === '<') { var j = html.indexOf('>', i), tag = html.slice(i, j + 1); out += tag; if (tag[1] === '/') open.pop(); else open.push(tag.replace(/[<>\/]/g, '').split(' ')[0]); i = j + 1; }
      else if (html[i] === '&') { var k = html.indexOf(';', i); out += html.slice(i, k + 1); i = k + 1; vis2++; }
      else { out += html[i++]; vis2++; }
    }
    while (open.length) out += '</' + open.pop() + '>';
    return out;
  }
  function len(html) { return html.replace(/<[^>]+>/g, '').length; }
  // Position of an element's centre in canvas coordinates (offset chain: unaffected by the panel's slide-in transform).
  function pos(el, dx, dy) {
    if (!el || !el.offsetParent) return null;
    var x = el.offsetWidth / 2 + (dx || 0), y = el.offsetHeight / 2 + (dy || 0), n = el;
    while (n && n !== canvas) { x += n.offsetLeft; y += n.offsetTop; n = n.offsetParent; }
    return n === canvas ? { x: x, y: y } : null;
  }
  var T = 22.5, STAGES = [0, 2.2, 9, 15], CLICKS = [2.4, 4.3, 10, 13.4, 15.8];
  var wp = [];
  function buildPath() {
    var lang = pos(pills[1], 0, 0) || pos(tagLang), ext = pos(extbtn), tab = pos(tabs), sg = pos(sugg), ia = pos(inart);
    var cw = parseFloat(getComputedStyle(root).getPropertyValue('--cw')) || 760;
    var rest = { x: cw * .5, y: 470 };
    wp = [ { t: 0, x: rest.x + 60, y: rest.y + 80 }, ext && { t: 1.7, x: ext.x, y: ext.y }, ext && { t: 2.6, x: ext.x, y: ext.y },
      tab && { t: 3.6, x: tab.x, y: tab.y }, tab && { t: 4.6, x: tab.x, y: tab.y },
      sg && { t: 9.8, x: sg.x, y: sg.y }, sg && { t: 10.3, x: sg.x, y: sg.y },
      ia && { t: 12.6, x: ia.x, y: ia.y }, ia && { t: 13.7, x: ia.x, y: ia.y },
      lang && { t: 15.6, x: lang.x, y: lang.y }, lang && { t: 16.2, x: lang.x, y: lang.y },
      { t: 17.6, x: rest.x + 40, y: rest.y + 40 }, { t: T, x: rest.x + 40, y: rest.y + 40 } ].filter(Boolean);
  }
  var lang = 'a', stage = -1, stepTitle = '';
  function setLang(l) { if (l === lang) return; lang = l; code.textContent = l === 'a' ? codeA : codeB; pills.forEach(function (b) { b.classList.toggle('is-on', b.getAttribute('data-lang') === l); }); }
  function css(n, v) { root.style.setProperty(n, v); }
  function render(t) {
    var s = t < STAGES[1] ? 0 : t < STAGES[2] ? 1 : t < STAGES[3] ? 2 : 3;
    if (s !== stage) {
      stage = s;
      steps.forEach(function (c, i) { c.classList.toggle('is-on', i === s); });
      dots.forEach(function (c, i) { c.classList.toggle('is-on', i === s); });
      stepTitle = steps[s] ? steps[s].querySelector('b').textContent : '';
      if (mt && steps[s]) { mt.textContent = steps[s].querySelector('b').textContent; ms.textContent = steps[s].querySelector('span').textContent; }
    }
    setLang(t >= 15.8 ? 'b' : 'a');
    var d = D[lang], ty = lang === 'b' ? 1 : seg(t, 4.4, 8.4);
    css('--p-panel', seg(t, 2.3, 2.9).toFixed(3));
    css('--p-sugg', (seg(t, 8.2, 8.8) * (1 - seg(t, 10, 10.25))).toFixed(3));
    css('--p-qa', seg(t, 10.1, 10.5).toFixed(3));
    css('--p-a', seg(t, 11, 11.5).toFixed(3));
    css('--p-hl', seg(t, 13.4, 14).toFixed(3));
    css('--p-graph', seg(t, 17.6, 18.3).toFixed(3));
    extbtn.classList.toggle('on', t >= 2.4 && t < 21.4);
    tabs.classList.toggle('press', Math.abs(t - 4.3) < .12);
    var all = len(d.t) + len(d.b) + len(d.p), n = Math.round(all * ty);
    sum.classList.toggle('has-text', n > 0);
    st.textContent = d.t; sb.innerHTML = slice(d.b, Math.max(0, n)); sp.textContent = n > len(d.b) ? '• ' + d.p.slice(0, Math.max(0, n - len(d.b))) : '';
    if (ty >= 1) { sb.innerHTML = d.b; sp.textContent = '• ' + d.p; }
    // cursor
    if (wp.length) {
      var a = wp[0], b = wp[wp.length - 1];
      for (var i = 0; i < wp.length - 1; i++) if (t >= wp[i].t && t <= wp[i + 1].t) { a = wp[i]; b = wp[i + 1]; break; }
      var k = b.t === a.t ? 1 : ease(cl((t - a.t) / (b.t - a.t)));
      var x = a.x + (b.x - a.x) * k, y = a.y + (b.y - a.y) * k;
      cur.style.transform = 'translate(' + (x - 4) + 'px,' + (y - 2) + 'px)';
      var cwid = parseFloat(getComputedStyle(root).getPropertyValue('--cw')) || 760, flip = x > cwid - 260;
      if (tip.textContent !== stepTitle) tip.textContent = stepTitle;
      tip.classList.toggle('flip', flip);
      tip.style.transform = 'translate(' + (flip ? x - 14 : x + 24) + 'px,' + (y + 14) + 'px)' + (flip ? ' translateX(-100%)' : '');
      var rc = null; CLICKS.forEach(function (c) { if (t >= c && t < c + .5) rc = c; });
      if (rc !== null) { var q = (t - rc) / .5; rip.style.opacity = (1 - q).toFixed(2); rip.style.transform = 'translate(' + x + 'px,' + y + 'px) scale(' + (.4 + q * 1.1).toFixed(2) + ')'; } else rip.style.opacity = 0;
    }
    canvas.style.opacity = Math.min(seg(t, 0, .35), 1 - seg(t, 21.7, 22.4)).toFixed(2);
  }
  function fit() {
    var mobile = innerWidth <= 900, cw = mobile ? 460 : 760, ch = mobile ? 600 : 720;
    var w = view.parentNode.clientWidth || cw;
    var s = mobile ? w / cw : Math.min(w / cw, (innerHeight - 72 - 150) / ch);
    css('--cw', cw); css('--ch', ch); css('--s', s.toFixed(4));
    buildPath();
  }
  var t = 0, last = 0, playing = !reduce, visible = true, raf = 0, userPaused = false;
  function setPaused(p) { userPaused = p; pp.classList.toggle('is-paused', p); pp.setAttribute('aria-label', p ? 'Play walkthrough' : 'Pause walkthrough'); loop(); }
  function loop() { if (raf || userPaused || !playing || !visible || document.hidden) return; last = 0; raf = requestAnimationFrame(frame); }
  function frame(ts) { raf = 0; if (userPaused || !playing || !visible || document.hidden) return; if (last) t += (ts - last) / 1000; last = ts; if (t >= T) t -= T; render(t); raf = requestAnimationFrame(frame); }
  function jump(i) { t = STAGES[i] + (i === 0 ? 0 : .15); if (reduce) t = [0.5, 4.3 + 4.1, 14.6, 19][i]; render(t); if (!reduce) { last = 0; } }
  steps.forEach(function (c, i) { c.addEventListener('click', function () { jump(i); }); c.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); jump(i); } }); });
  dots.forEach(function (c, i) { c.addEventListener('click', function () { jump(i); }); });
  pp.addEventListener('click', function () { setPaused(!userPaused); });
  if (reduce) { root.classList.add('is-static'); pp.hidden = true; }
  root.classList.add('is-live');
  fit(); render(reduce ? 19 : 0); if (reduce) t = 19;
  window.addEventListener('resize', function () { fit(); render(t); });
  window.addEventListener('hs-refresh', function () { fit(); render(t); loop(); });
  if (window.ResizeObserver) new ResizeObserver(function () { fit(); render(t); }).observe(view.parentNode);
  if ('IntersectionObserver' in window) new IntersectionObserver(function (e) { visible = e[0].isIntersecting; loop(); }, { threshold: .15 }).observe(vis);
  document.addEventListener('visibilitychange', loop);
  root.hsSeek = function (x) { playing = false; t = x; render(x); };
  loop();
})();

// Browser-aware store links: Firefox visitors get the add-on page (and "Chrome" in the label becomes "Firefox"); the other store stays as a secondary link.
(function () {
  if (!/Firefox\//.test(navigator.userAgent) || /Seamonkey/.test(navigator.userAgent)) return;
  var CH = 'chromewebstore.google.com', FF = 'https://addons.mozilla.org/en-US/firefox/addon/ai-summary-helper/', CHURL = 'https://chromewebstore.google.com/detail/ai-summary-helper-openai/hldbejcjaedipeegjcinmhejdndchkmb';
  document.querySelectorAll('a[href*="' + CH + '"]').forEach(function (a) {
    a.href = FF;
    a.childNodes.forEach(function (n) { if (n.nodeType === 3) n.nodeValue = n.nodeValue.replace(/Chrome/g, 'Firefox'); });
    if (!a.children.length) a.textContent = a.textContent.replace(/Chrome/g, 'Firefox');
  });
  document.querySelectorAll('a[data-store="alt"]').forEach(function (a) { a.href = CHURL; a.textContent = 'Chrome'; });
})();

/* ── Floating pill nav: compact on scroll, mega menu, more menu, language picker, active section, scroll lock ── */
(function () {
  var nav = document.getElementById('siteNav');
  if (!nav || !nav.classList.contains('nav--pill')) return;
  var mm = document.getElementById('mobileMenu'), tg = document.getElementById('navToggle');


  // Popovers: [trigger, panel]
  var pops = [];
  function pop(btn, panel, hover) {
    if (!btn || !panel) return;
    var t;
    function open() { clearTimeout(t); pops.forEach(function (p) { if (p.panel !== panel) p.close(); }); panel.hidden = false; btn.setAttribute('aria-expanded', 'true'); }
    function close() { panel.hidden = true; btn.setAttribute('aria-expanded', 'false'); }
    pops.push({ panel: panel, close: close });
    btn.addEventListener('click', function (e) {
      if (btn.tagName === 'A' && hover && window.matchMedia('(hover:hover)').matches && panel.hidden === false) return; // second click follows link
      if (btn.tagName === 'A') { if (panel.hidden) { e.preventDefault(); open(); } return; }
      panel.hidden ? open() : close();
    });
    if (hover) {
      var wrap = btn.parentNode;
      wrap.addEventListener('mouseenter', function () { if (window.matchMedia('(hover:hover)').matches) open(); });
      wrap.addEventListener('mouseleave', function () { t = setTimeout(close, 180); });
      wrap.addEventListener('focusout', function (e) { if (!wrap.contains(e.relatedTarget)) close(); });
    }
  }
  pop(document.getElementById('langBtn'), document.getElementById('langMenu'), false);
  document.addEventListener('click', function (e) { if (!nav.contains(e.target)) pops.forEach(function (p) { p.close(); }); });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') pops.forEach(function (p) { p.close(); }); });

  // Current-locale highlight in language lists
  var m = location.pathname.match(/^\/([a-z]{2}(?:-[a-z]{2})?)\//i), cur = m ? m[1].toLowerCase() : 'en';
  var known = [].map.call(nav.querySelectorAll('[data-loc]'), function (a) { return a.getAttribute('data-loc'); });
  if (known.indexOf(cur) < 0) cur = 'en';
  var rest = location.pathname.replace(/^\/(?:[a-z]{2}(?:-[a-z]{2})?)\//i, '/');
  if (known.indexOf(m && m[1].toLowerCase()) < 0) rest = location.pathname;
  [].forEach.call(nav.querySelectorAll('[data-loc]'), function (a) {
    var l = a.getAttribute('data-loc');
    a.href = (l === 'en' ? '' : '/' + l) + (rest.indexOf('/') === 0 ? rest : '/' + rest);
    if (l === cur) a.setAttribute('aria-current', 'true');
  });

  // Active section highlight
  if ('IntersectionObserver' in window) {
    var links = {};
    [].forEach.call(nav.querySelectorAll('.pill a[data-sec]'), function (a) { links[a.getAttribute('data-sec')] = a; });
    var io = new IntersectionObserver(function (es) {
      es.forEach(function (en) {
        if (!en.isIntersecting) return;
        Object.keys(links).forEach(function (k) { links[k].classList.toggle('is-active', k === en.target.id); });
      });
    }, { rootMargin: '-40% 0px -55% 0px' });
    Object.keys(links).forEach(function (k) { var s = document.getElementById(k); if (s) io.observe(s); });
  }


  // Language search (full-screen menu)
  var ls = document.getElementById('langSearch'), lg = document.getElementById('langGroups');
  if (ls && lg) {
    var pills = [].slice.call(lg.querySelectorAll('.lang-pill')), empty = lg.querySelector('.lang-empty');
    var curPill = lg.querySelector('[aria-current]');
    if (curPill) { ls.placeholder = curPill.textContent; var cc = document.querySelector('.lang-card-cur'); if (cc) cc.textContent = curPill.textContent; }
    var lc = document.getElementById('langCard');
    if (lc && mm) lc.addEventListener('click', function () { mm.setAttribute('data-mode', 'lang'); ls.focus(); });
    function filter() {
      var q = ls.value.trim().toLowerCase(), n = 0;
      pills.forEach(function (a) { var ok = !q || a.getAttribute('data-q').indexOf(q) > -1; a.hidden = !ok; if (ok) n++; });
      [].forEach.call(lg.querySelectorAll('.lang-group'), function (g) { g.hidden = !g.querySelector('.lang-pill:not([hidden])'); });
      if (empty) empty.hidden = n > 0;
    }
    ls.addEventListener('input', filter);
    ls.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { var f = pills.filter(function (a) { return !a.hidden; })[0]; if (f) location.href = f.href; }
    });
    if (mm) new MutationObserver(function () {
      if (!mm.hidden && window.matchMedia('(min-width:861px)').matches) setTimeout(function () { if (mm.getAttribute('data-mode') === 'lang') ls.focus(); }, 60);
      if (mm.hidden) { ls.value = ''; filter(); }
    }).observe(mm, { attributes: true, attributeFilter: ['hidden'] });
  }

  if (mm && tg) tg.addEventListener('click', function () { mm.setAttribute('data-mode', 'menu'); });

  // Globe button: open the full-screen menu and jump to the language search
  var gb = document.getElementById('langBtn');
  if (gb && mm && tg) gb.addEventListener('click', function (ev) {
    ev.stopPropagation();
    if (mm.hidden) tg.click();
    mm.setAttribute('data-mode', 'lang');
    var box = mm.querySelector('.mm-lang');
    setTimeout(function () { if (box) box.scrollIntoView({ block: 'center' }); var s = document.getElementById('langSearch'); if (s) s.focus({ preventScroll: true }); }, 80);
  });

  // Scroll lock while full-screen menu is open
  if (mm && tg) new MutationObserver(function () { document.body.classList.toggle('nav-locked', !mm.hidden); }).observe(mm, { attributes: true, attributeFilter: ['hidden'] });
})();

/* ── Landing videos: groups of clips (the #videos stack, the feature cards) that open a full-screen player you swipe ──
   A group is [data-vstack] or [data-vgroup]; its clips are its <figure data-blog-video> elements, so a translated page
   plays the videos the translation pipeline localized for it. Title and text in the player come from the figure's
   <figcaption>, or (feature cards) from the card's own h3 and p. Labels come from the hidden .vfeed-labels. */
(function () {
  var groups = Array.prototype.slice.call(document.querySelectorAll('[data-vstack], [data-vgroup]'));
  if (!groups.length) return;
  var labels = {}, phoneHref = null;
  Array.prototype.forEach.call(document.querySelectorAll('.vfeed-labels [data-l]'), function (el) {
    labels[el.getAttribute('data-l')] = el.textContent;
    if (el.tagName === 'A') phoneHref = el.getAttribute('href');
  });
  var canHover = window.matchMedia && window.matchMedia('(hover: hover)').matches;
  var feed, track, slides, dots, muteBtn, io, toast, muted = false, blocked = false, bigTimer = 0, lastFocus = null, hinted = false;
  var T = function () { if (window.aishTrack) window.aishTrack.apply(null, arguments); };

  /* The install button under every clip, for the browser it is watched in: Firefox (desktop and Android) gets the add-on,
     desktop Chromium browsers the Chrome Web Store (Edge, Brave and Opera install from there too), Safari and other
     phones the bookmarklet page. Older translated pages without the labels fall back to English. */
  var install = (function () {
    var ua = navigator.userAgent || '';
    var CWS = 'https://chromewebstore.google.com/detail/ai-summary-helper-openai/hldbejcjaedipeegjcinmhejdndchkmb';
    var mobile = /Mobi|Android|iPhone|iPad|iPod/i.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
    if (/Firefox\//.test(ua)) return { href: 'https://addons.mozilla.org/en-US/firefox/addon/ai-summary-helper/', text: labels.add_firefox || 'Add to Firefox — it’s free', store: 'firefox' };
    if (mobile || !/Chrome\//.test(ua)) return { href: phoneHref || 'bookmarklet.html', text: labels['try'] || 'Try it in your browser — it’s free', store: 'bookmarklet' };
    if (/Edg\/|OPR\//.test(ua) || navigator.brave) return { href: CWS, text: labels.add_browser || 'Add to your browser — it’s free', store: 'chrome' };
    return { href: CWS, text: labels.add_chrome || 'Add to Chrome — it’s free', store: 'chrome' };
  })();

  // Campaign tags on the install link under a clip (store, add-on or bookmarklet page): the store dashboard and Matomo can then
  // tell which clip, in which language, brought the install. Pages of this site get them too (Matomo reads utm_*).
  function campaignUrl(href, clip) {
    try {
      var u = new URL(href, location.href), lang = (document.documentElement.getAttribute('lang') || 'en').toLowerCase();
      u.searchParams.set('utm_source', 'aish-site'); u.searchParams.set('utm_medium', 'video'); u.searchParams.set('utm_campaign', 'video-' + clip + '-' + lang);
      return /^https?:/.test(href) ? u.toString() : u.pathname.split('/').pop() + u.search + u.hash;
    } catch (e) { return href; }
  }
  // Shareable link to one clip: this page with #v=<clip>; opening it starts the player at that clip.
  function clipUrl(id) { return location.origin + location.pathname + '#v=' + encodeURIComponent(id); }
  function setHash(id) { try { history.replaceState(null, '', id ? '#v=' + encodeURIComponent(id) : location.pathname + location.search); } catch (e) {} }
  function flash(text) {
    if (!toast) { toast = document.createElement('div'); toast.className = 'vfeed-toast'; toast.setAttribute('role', 'status'); feed.appendChild(toast); }
    toast.textContent = text; toast.classList.remove('on'); void toast.offsetWidth; toast.classList.add('on');
  }
  function share(fig) {
    var id = fig.getAttribute('data-blog-video'), url = clipUrl(id);
    var tmp = document.createElement('div'); tmp.innerHTML = captionHtml(fig);
    var title = (tmp.querySelector('strong') || tmp).textContent.trim();
    T('Video', 'share', id);
    if (navigator.share) {
      navigator.share({ title: title, text: title, url: url }).catch(function () {});   // cancelled: nothing to do
      return;
    }
    var done = function () { flash(labels.copied || 'Link copied'); };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(url).then(done, function () { window.prompt('', url); });
    else window.prompt('', url);
  }

  function captionHtml(fig) {
    var cap = fig.querySelector('figcaption');
    if (cap) return cap.innerHTML;
    var card = fig.closest('.feature-card');
    if (!card) return '';
    var h = card.querySelector('h3'), p = card.querySelector('p');
    var out = document.createElement('div');
    if (h) { var st = document.createElement('strong'); st.textContent = h.textContent; out.appendChild(st); }
    if (p) { var sp = document.createElement('span'); sp.textContent = p.textContent; out.appendChild(sp); }
    return out.innerHTML;
  }

  groups.forEach(function (group) {
    var figs = Array.prototype.slice.call(group.querySelectorAll('figure[data-blog-video]'));
    var fan = group.hasAttribute('data-vstack') ? focusFan(group, figs) : null;
    figs.forEach(function (fig, i) {
      var v = fig.querySelector('video');
      var hoverEl = fig.closest('.feature-card') || fig;   // a feature card previews its clip while the pointer is anywhere on it
      if (canHover) {
        hoverEl.addEventListener('mouseenter', function () { v.muted = true; v.play().catch(function () {}); });
        hoverEl.addEventListener('mouseleave', function () { v.pause(); });
      }
      var openBtn = fig.querySelector('.vstack-open, .fvideo-open');
      if (openBtn) openBtn.addEventListener('click', function () {
        if (fan && fan.on()) {
          if (fan.justSwiped()) return;                       // a swipe across the fan is not a tap
          if (fan.index() !== i) { fan.set(i); return; }      // a clip at the side comes to the front first
        }
        open(figs, i);
      });
      var card = fig.closest('.feature-card');
      var cta = card && card.querySelector('.fvideo-cta');    // "Watch the clip" under the card text opens the same clip
      if (cta) cta.addEventListener('click', function () { open(figs, i); });
    });
  });

  /* Hero "Watch the video": opens the player on the named clip of the #videos stack (the localized komplett clip), no scrolling. */
  Array.prototype.forEach.call(document.querySelectorAll('[data-open-video]'), function (btn) {
    btn.addEventListener('click', function (e) {
      var name = btn.getAttribute('data-open-video');
      for (var g = 0; g < groups.length; g++) {
        var figs = Array.prototype.slice.call(groups[g].querySelectorAll('figure[data-blog-video]'));
        for (var k = 0; k < figs.length; k++) {
          if (figs[k].getAttribute('data-blog-video') === name) { e.preventDefault(); open(figs, k); return; }
        }
      }                                                         // no such clip on this page: the link's own jump to #videos stands
    });
  });

  /* The hero button sits on the exact centre of the demo window. The demo is scaled to fit, so the CSS percentages are only the fallback. */
  (function () {
    var btn = document.querySelector('.hs-watch'), win = document.querySelector('.hs-win'), wrap = btn && btn.parentNode;
    if (!btn || !win || !wrap) return;
    function place() {
      var w = win.getBoundingClientRect(), r = wrap.getBoundingClientRect();
      if (!w.width || !r.width) return;
      btn.style.left = Math.round(w.left - r.left + w.width / 2) + 'px';
      btn.style.top = Math.round(w.top - r.top + w.height / 2) + 'px';
    }
    place();
    window.addEventListener('resize', place);
    window.addEventListener('load', place);
    window.addEventListener('hs-refresh', function () { setTimeout(place, 50); });
    if (window.ResizeObserver) new ResizeObserver(place).observe(wrap);
    [300, 900, 2000].forEach(function (ms) { setTimeout(place, ms); });   // the scene scales in with a transition
  })();

  /* Focus fan for the #videos stack (desktop only, wide enough for 7 visible clips): one clip in front with its caption
     below the fan, three neighbours on each side, the rest hidden; it wraps around. Arrows, dots, ←/→, swipe or a tap
     on a side clip move the focus. Narrow screens (and no JS) keep the scroll-snap row from styles.css. */
  function focusFan(group, figs) {
    var wrap = group.parentNode;
    var capEl = wrap.querySelector('.vstack-caption'), nav = wrap.querySelector('.vstack-nav');
    var dotsEl = nav && nav.querySelector('.vstack-dots');
    var n = figs.length, active = 0, isOn = false, swiped = false, x0 = null;
    if (!capEl || !nav || !dotsEl || n < 3) return null;   // older translated pages without the fan markup keep the plain stack
    var mq = window.matchMedia('(min-width: 761px)');
    figs.forEach(function (f, i) {
      var d = document.createElement('button');
      d.type = 'button'; d.className = 'vstack-dot'; d.tabIndex = -1;
      d.addEventListener('click', function () { set(i); });
      dotsEl.appendChild(d);
    });
    Array.prototype.forEach.call(nav.querySelectorAll('.vstack-arrow'), function (b) {
      var dir = Number(b.getAttribute('data-dir'));
      var l = labels[dir < 0 ? 'prev' : 'next']; if (l) b.setAttribute('aria-label', l);
      b.addEventListener('click', function () { set(active + dir); });
    });
    function rel(i) { var d = i - active; if (d > n / 2) d -= n; if (d < -n / 2) d += n; return d; }
    function paint() {
      figs.forEach(function (f, i) {
        var d = rel(i);
        f.setAttribute('data-pos', Math.abs(d) <= 3 ? String(d) : 'far');
        var b = f.querySelector('.vstack-open'); if (b) b.tabIndex = d === 0 ? 0 : -1;
        var v = f.querySelector('video'); if (d !== 0 && v && !v.paused) v.pause();
      });
      Array.prototype.forEach.call(dotsEl.children, function (d, i) { d.classList.toggle('on', i === active); });
      var cap = figs[active].querySelector('figcaption');
      capEl.innerHTML = cap ? cap.innerHTML : '';
    }
    function set(i) { active = ((i % n) + n) % n; paint(); }
    function apply() {
      isOn = mq.matches;
      group.classList.toggle('is-fan', isOn);
      nav.hidden = !isOn; capEl.hidden = !isOn;
      if (isOn) paint();
      else figs.forEach(function (f) { f.removeAttribute('data-pos'); var b = f.querySelector('.vstack-open'); if (b) b.tabIndex = 0; });
    }
    group.addEventListener('keydown', function (e) {
      if (!isOn || (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight')) return;
      e.preventDefault();
      set(active + (e.key === 'ArrowRight' ? 1 : -1));
      var b = figs[active].querySelector('.vstack-open'); if (b) b.focus({ preventScroll: true });
    });
    group.addEventListener('pointerdown', function (e) { if (isOn) { x0 = e.clientX; swiped = false; } });
    group.addEventListener('pointerup', function (e) {
      if (!isOn || x0 === null) return;
      var dx = e.clientX - x0; x0 = null;
      if (Math.abs(dx) > 40) { swiped = true; set(active + (dx < 0 ? 1 : -1)); setTimeout(function () { swiped = false; }, 0); }
    });
    if (mq.addEventListener) mq.addEventListener('change', apply); else if (mq.addListener) mq.addListener(apply);
    apply();
    return { on: function () { return isOn; }, index: function () { return active; }, set: set, justSwiped: function () { return swiped; } };
  }

  function btn(cls, text, label, onClick) {
    var b = document.createElement('button');
    b.type = 'button'; b.className = 'vfeed-btn ' + cls; b.textContent = text; b.setAttribute('aria-label', label);
    b.addEventListener('click', onClick);
    return b;
  }
  /* muted = the visitor turned sound off; blocked = the browser refused sound because no tap started the clip (a shared
     link, a swipe to the next clip in Safari). Blocked clips play silently with a "Sound on" pill until the next tap. */
  function paintMute() {
    var off = muted || blocked, big = muteBtn.classList.contains('is-big');
    muteBtn.textContent = big ? '🔇 ' + (labels.sound || 'Sound on') : off ? '🔇' : '🔊';
    muteBtn.setAttribute('aria-label', off ? (labels.sound || 'Sound on') : (labels.mute || 'Sound off'));
    Array.prototype.forEach.call(slides, function (s) { s.querySelector('video').muted = off; });
    placeMute();
  }
  // Sound refused: a large "Sound on" pill on the lower part of the picture for 3 s, then the small button in its corner.
  function showBlocked() {
    if (blocked) return;
    blocked = true;
    muteBtn.classList.add('is-big');
    clearTimeout(bigTimer);
    bigTimer = setTimeout(function () { muteBtn.classList.remove('is-big'); paintMute(); }, 3000);
    paintMute();
  }
  /* The sound button sits on the picture itself, top right (the bottom carries the clip's subtitles; the large pill: centred
     a little below the middle). The video is
     letterboxed (object-fit: contain), so the picture's box is worked out from the clip's aspect ratio. */
  function placeMute() {
    if (!slides || !slides.length || feed.hidden) return;
    var v = slides[current()].querySelector('video'), r = v.getBoundingClientRect();
    var pt = parseFloat(getComputedStyle(v).paddingTop) || 0, cw = r.width, ch = r.height - pt;
    var k = Math.min(cw / (v.videoWidth || 360), ch / (v.videoHeight || 520));
    var pw = (v.videoWidth || 360) * k, ph = (v.videoHeight || 520) * k;
    var left = r.left + (cw - pw) / 2, top = r.top + pt + (ch - ph) / 2;
    if (muteBtn.classList.contains('is-big')) {
      muteBtn.style.left = (left + pw / 2) + 'px'; muteBtn.style.top = (top + ph * 0.62) + 'px';
    } else {
      var x = left + pw - 12 - 44, y = top + 12, c = feed.querySelector('.vfeed-close').getBoundingClientRect();
      if (x < c.right && x + 44 > c.left && y < c.bottom + 8) y = c.bottom + 8;   // full-width picture (phones): below the ×
      muteBtn.style.left = x + 'px'; muteBtn.style.top = y + 'px';
    }
  }
  // Inside a tap: start every clip once and stop it again. Safari (iOS above all) then lets each of them play with sound
  // later, when a swipe brings it on screen; otherwise only the tapped clip would get sound.
  function unlock() {
    Array.prototype.forEach.call(slides, function (s) {
      var v = s.querySelector('video');
      if (!v.paused) return;
      v.muted = false;
      var p = v.play(); v.pause();
      if (p && p.catch) p.catch(function () {});
    });
  }
  function soundOn() {
    muted = false; blocked = false;
    clearTimeout(bigTimer); muteBtn.classList.remove('is-big');
    unlock(); paintMute();
    var v = slides[current()].querySelector('video'); v.play().catch(function () {});
  }
  function current() {
    var h = track.clientHeight || 1;
    return Math.max(0, Math.min(slides.length - 1, Math.round(track.scrollTop / h)));
  }
  function go(i) { if (slides[i]) slides[i].scrollIntoView({ behavior: 'smooth', block: 'start' }); }

  function shell() {
    feed = document.createElement('div');
    feed.className = 'vfeed'; feed.hidden = true;
    feed.setAttribute('role', 'dialog'); feed.setAttribute('aria-modal', 'true');
    var h2 = document.querySelector('#videos h2'); if (h2) feed.setAttribute('aria-label', h2.textContent);
    track = document.createElement('div'); track.className = 'vfeed-track';
    dots = document.createElement('div'); dots.className = 'vfeed-dots'; dots.setAttribute('aria-hidden', 'true');
    muteBtn = btn('vfeed-mute', '🔊', labels.mute || 'Sound off', function () { if (muted || blocked) soundOn(); else { muted = true; paintMute(); } });
    feed.appendChild(track);
    feed.appendChild(btn('vfeed-close', '×', labels.close || 'Close', close));
    feed.appendChild(muteBtn);
    feed.appendChild(dots);
    document.body.appendChild(feed);
    window.addEventListener('resize', placeMute);
    // the slide that fills the screen plays (from the start), every other one is paused
    io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        var v = e.target.querySelector('video');
        if (e.isIntersecting && e.intersectionRatio >= 0.6) {
          v.muted = muted || blocked; v.currentTime = 0;
          v.play().catch(function () { showBlocked(); v.play().catch(function () {}); });   // autoplay with sound refused
          if (!v.videoWidth) v.addEventListener('loadedmetadata', placeMute, { once: true });   // real aspect ratio known now
          placeMute();
          var k = Array.prototype.indexOf.call(slides, e.target);
          Array.prototype.forEach.call(dots.children, function (d, j) { d.classList.toggle('on', j === k); });
          if (!feed.hidden) setHash(e.target.getAttribute('data-clip'));   // the address bar always points at the clip on screen
        } else if (!v.paused) v.pause();
      });
    }, { root: track, threshold: [0, 0.6] });
    feed.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') { e.preventDefault(); close(); }
      else if (e.key === 'ArrowDown' || e.key === 'PageDown' || e.key === 'j') { e.preventDefault(); go(current() + 1); }
      else if (e.key === 'ArrowUp' || e.key === 'PageUp' || e.key === 'k') { e.preventDefault(); go(current() - 1); }
      else if (e.key === ' ') { e.preventDefault(); var v = slides[current()].querySelector('video'); if (v.paused) v.play().catch(function () {}); else v.pause(); }
    });
  }

  // (re)fill the player with the clips of the group that was tapped
  function fill(figs) {
    io.disconnect();
    track.textContent = ''; dots.textContent = '';
    figs.forEach(function (fig) {
      var slide = document.createElement('section'); slide.className = 'vfeed-slide';
      var v = document.createElement('video');
      v.setAttribute('playsinline', ''); v.preload = 'none'; v.loop = true;
      v.poster = fig.querySelector('video').getAttribute('poster');
      v.src = fig.querySelector('source').getAttribute('src');
      v.addEventListener('click', function () { if (blocked) soundOn(); else if (v.paused) v.play().catch(function () {}); else v.pause(); });
      var cap = document.createElement('div'); cap.className = 'vfeed-cap';
      cap.innerHTML = captionHtml(fig);
      // below the caption: install button for this browser + share, in one row (nothing is laid over the video)
      var row = document.createElement('div'); row.className = 'vfeed-actions';
      if (install) {
        var a = document.createElement('a');
        a.className = 'vfeed-install'; a.href = campaignUrl(install.href, fig.getAttribute('data-blog-video')); a.textContent = install.text;
        if (/^https?:/.test(install.href)) { a.target = '_blank'; a.rel = 'noopener'; }
        a.addEventListener('click', function () { T('CTA', 'video_install_' + install.store, fig.getAttribute('data-blog-video')); });
        row.appendChild(a);
      }
      var sh = btn('vfeed-share', '', labels.share || 'Share', function () { share(fig); });
      sh.innerHTML = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 12v7a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-7"/><path d="M16 6l-4-4-4 4"/><path d="M12 2v13"/></svg>';
      row.appendChild(sh); cap.appendChild(row);
      slide.setAttribute('data-clip', fig.getAttribute('data-blog-video'));
      slide.appendChild(v); slide.appendChild(cap); track.appendChild(slide);
      dots.appendChild(document.createElement('i'));
    });
    slides = track.children;
    Array.prototype.forEach.call(slides, function (s) { io.observe(s); });
  }

  function open(figs, i) {
    // cards hidden by the audience filter drop out of the swipe list
    var current = figs[i]; figs = figs.filter(function (f) { return !f.closest('[hidden]'); }); i = Math.max(0, figs.indexOf(current));
    if (!feed) shell();
    fill(figs);
    lastFocus = document.activeElement;
    figs.forEach(function (f) { f.querySelector('video').pause(); });
    feed.hidden = false;
    document.documentElement.classList.add('vfeed-open');
    track.scrollTop = i * track.clientHeight;   // straight to the tapped clip, no scroll animation
    var tapped = navigator.userActivation ? navigator.userActivation.isActive : true;   // false for a shared link opened on load
    if (tapped && !muted) {   // opened by a tap: sound is allowed now, so start the clip here and not later in the observer
      blocked = false; clearTimeout(bigTimer); muteBtn.classList.remove('is-big'); unlock(); paintMute();
      slides[i].querySelector('video').play().catch(function () {});
    }
    feed.querySelector('.vfeed-close').focus();
    if (!hinted && labels.hint) {   // once per visit: how to get to the next clip
      hinted = true;
      var h = document.createElement('div'); h.className = 'vfeed-hint'; h.textContent = labels.hint;
      feed.appendChild(h); setTimeout(function () { h.remove(); }, 2800);
    }
  }
  function close() {
    Array.prototype.forEach.call(slides, function (s) { s.querySelector('video').pause(); });
    feed.hidden = true;
    document.documentElement.classList.remove('vfeed-open');
    setHash(null);
    if (lastFocus) lastFocus.focus();
  }

  // A shared link (#v=<clip>) opens the player at that clip, with the group it belongs to.
  var m = /^#v=([\w-]+)$/.exec(location.hash);
  if (m) groups.some(function (group) {
    var figs = Array.prototype.slice.call(group.querySelectorAll('figure[data-blog-video]'));
    var i = figs.map(function (f) { return f.getAttribute('data-blog-video'); }).indexOf(m[1]);
    if (i < 0) return false;
    T('Video', 'open_shared', m[1]);
    open(figs, i);
    return true;
  });
})();

/* ── Video plays (Matomo): play, 25 / 50 / 75 % and "complete" per clip, language and place ──
   Event: category Video, action play | progress_25 | progress_50 | progress_75 | complete, name "<clip>-<lang>|<place>" where place is
   player (full-screen player), videos (the page of all videos), post (a blog post), card or stack (only when played with sound).
   A silent hover preview on a feature card or in the stack is not a play. */
(function () {
  var T = function () { if (window.aishTrack) window.aishTrack.apply(null, arguments); };
  var seen = typeof WeakMap === 'function' ? new WeakMap() : null;
  if (!seen) return;
  function keyOf(v) {
    var src = v.currentSrc || ((v.querySelector('source') || {}).src || '');
    var m = src.match(/\/([^\/]+)\.mp4(?:[?#].*)?$/);
    return m ? m[1] : null;
  }
  function placeOf(v) {
    if (v.closest('.vfeed')) return 'player';
    if (v.closest('.video-card')) return 'videos';
    if (v.closest('.post-figure--video')) return 'post';
    if (v.closest('.feature-card')) return 'card';
    if (v.closest('.vstack')) return 'stack';
    return 'page';
  }
  function stateOf(v) {
    var k = keyOf(v), s = seen.get(v);
    if (!s || s.key !== k) { s = { key: k, played: false, marks: {} }; seen.set(v, s); }   // another clip in the same element: a new play
    return s;
  }
  document.addEventListener('play', function (e) {
    var v = e.target;
    if (!v || v.tagName !== 'VIDEO') return;
    var s = stateOf(v);
    if (!s.key || s.played) return;
    var place = placeOf(v);
    if ((place === 'card' || place === 'stack') && v.muted) return;
    s.played = true;
    T('Video', 'play', s.key + '|' + place);
  }, true);
  document.addEventListener('timeupdate', function (e) {
    var v = e.target;
    if (!v || v.tagName !== 'VIDEO' || !v.duration) return;
    var s = stateOf(v);
    if (!s.played) return;
    var p = v.currentTime / v.duration;
    [[0.25, 'progress_25'], [0.5, 'progress_50'], [0.75, 'progress_75'], [0.9, 'complete']].forEach(function (m) {
      if (p >= m[0] && !s.marks[m[1]]) { s.marks[m[1]] = true; T('Video', m[1], s.key + '|' + placeOf(v)); }
    });
  }, true);
})();
