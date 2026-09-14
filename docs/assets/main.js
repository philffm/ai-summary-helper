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

/* ── Bookmarklet generator (BYOK + byPhil Cloud) ────────────────── */
(function () {
  var card = document.getElementById('bookmarkletCard');
  if (!card) return;

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
    localSendIp: document.getElementById('bmLocalSendIp')
  };

  var mode = 'byok';
  var otpId = null;

  function setMode(next) {
    mode = next;
    els.modeByok.classList.toggle('active', next === 'byok');
    els.modeCloud.classList.toggle('active', next === 'cloud');
    els.byokPanel.hidden = next !== 'byok';
    els.cloudPanel.hidden = next !== 'cloud';
    els.output.hidden = true;
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
    } else {
      els.cloudAuth.hidden = false;
      els.cloudConnected.hidden = true;
    }
  }

  // ── Mode toggle ─────────────────────────────────────────────────
  els.modeByok.addEventListener('click', function () { setMode('byok'); });
  els.modeCloud.addEventListener('click', function () { setMode('cloud'); });

  // ── Provider hint ───────────────────────────────────────────────
  els.provider.addEventListener('change', updateProviderHint);
  updateProviderHint();

  // ── Persist BYOK key + provider locally ─────────────────────────
  els.apiKey.addEventListener('input', function () {
    try { localStorage.setItem('aish_bm_api_key', els.apiKey.value.trim()); } catch (e) {}
  });
  els.provider.addEventListener('change', function () {
    try { localStorage.setItem('aish_bm_provider', els.provider.value); } catch (e) {}
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
  });
  els.shareKindle.addEventListener('change', function () {
    try { localStorage.setItem('aish_bm_share_kindle', els.shareKindle.checked ? '1' : '0'); } catch (e) {}
  });
  els.shareLocalSend.addEventListener('change', function () {
    try { localStorage.setItem('aish_bm_share_localsend', els.shareLocalSend.checked ? '1' : '0'); } catch (e) {}
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
      modelIdentifier = els.cloudModel.value || 'google/gemini-2.5-flash';
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
      'var shareNative=' + (shareNative ? 'true' : 'false') + ';',
      'var shareKindle=' + (shareKindle ? 'true' : 'false') + ';',
      'var shareLocalSend=' + (shareLocalSend ? 'true' : 'false') + ';',
      'var kindleEmail=' + JSON.stringify(kindleEmail) + ';',
      'var localSendIp=' + JSON.stringify(localSendIp) + ';',
      'var content=document.body.innerText;',
      'var style=document.createElement("style");',
      'style.innerHTML="#ai-summary-message{position:fixed;top:0;left:0;width:100%;background:#007bff;color:#fff;text-align:center;padding:10px 0;z-index:10000;font-size:18px;font-weight:bold;}#ai-summary-box{position:fixed;top:60px;right:20px;max-width:420px;max-height:70vh;overflow:auto;background:#fff;border:1px solid #007bff;border-radius:10px;padding:16px;box-shadow:0 4px 20px rgba(0,0,0,0.3);z-index:10000;}";',
      'document.head.appendChild(style);',
      'var msg=document.createElement("div");msg.id="ai-summary-message";msg.textContent="Summarizing…";document.body.prepend(msg);',
      '// Optional update check (best-effort, never blocks summarization).',
      'try{fetch(BM_VERSION_URL).then(function(r){return r.json();}).then(function(v){if(v&&v.version&&v.version!==BM_VERSION){msg.textContent="⚠️ Bookmarklet outdated (v"+BM_VERSION+", latest v"+v.version+"). Regenerate it at ai-summary-helper.byphil.eu/#bookmarklet";setTimeout(function(){msg.textContent="Summarizing…";},4000);}}).catch(function(){});}catch(e){}',
      'var headers={"Content-Type":"application/json"};',
      'if(apiKey)headers["Authorization"]="Bearer "+apiKey;',
      'var body;',
      'var req;',
      'if(isGemini){',
      '  var url="https://generativelanguage.googleapis.com/v1beta/models/"+encodeURIComponent(model)+":generateContent?alt=sse";',
      '  headers["x-goog-api-key"]=apiKey;',
      '  body=JSON.stringify({contents:[{role:"user",parts:[{text:"Produce ONLY valid HTML. Return a single <div> containing <h2> and <p> tags. "+prompt+"\\n\\nContent:\\n"+content}]}]});',
      '  req=fetch(url,{method:"POST",headers:headers,body:body});',
      '}else{',
      '  body=JSON.stringify({model:model,messages:[{role:"system",content:"You summarize content from websites in a tailored and meaningful manner."},{role:"user",content:"Summarize in valid HTML format with sections:"+prompt},{role:"user",content:content}],stream:true});',
      '  req=fetch(apiUrl,{method:"POST",headers:headers,body:body});',
      '}',
      'req',
      '.then(function(r){if(!r.ok)throw new Error("HTTP "+r.status);return r.text();})',
      '.then(function(text){var out="";var lines=text.split("\\n");for(var i=0;i<lines.length;i++){var line=lines[i].trim();if(!line||line.indexOf("data:")!==0)continue;var json=line.substring(5).trim();if(json==="[DONE]")continue;try{var j=JSON.parse(json);var piece=isGemini?(j.candidates&&j.candidates[0]&&j.candidates[0].content&&j.candidates[0].content.parts&&j.candidates[0].content.parts[0]?j.candidates[0].content.parts[0].text:""):(j.choices&&j.choices[0]&&(j.choices[0].delta&&j.choices[0].delta.content||j.choices[0].message&&j.choices[0].message.content)||j.message&&j.message.content||j.response||"");if(piece)out+=piece;}catch(e){}}return out;})',
      '.then(function(summary){msg.remove();if(!summary)throw new Error("No summary returned");',
      '  var title=document.title||"AI Summary";',
      '  var url=location.href;',
      '  var docHtml="<!DOCTYPE html><html><head><meta charset=\\"utf-8\\"><title>"+title+"</title><style>body{font-family:sans-serif;line-height:1.6;padding:20px;max-width:800px;margin:auto;}h1{border-bottom:2px solid #333;padding-bottom:5px;}.meta{color:#555;font-style:italic;}.summary{background:#f8f9fa;padding:15px;border-left:4px solid #0284c7;margin:20px 0;}</style></head><body><h1>"+title+"</h1><div class=\\"meta\\">Captured via AI Summary Helper &middot; <a href=\\""+url+"\\">Source</a></div><div class=\\"summary\\"><h2>🧙 AI Summary</h2>"+summary+"</div><h2>📄 Content</h2><div>"+content.replace(/</g,"&lt;").replace(/>/g,"&gt;")+"</div></body></html>";',
      '  // Always insert the summary on the page.',
      '  var box=document.createElement("div");box.id="ai-summary-box";box.innerHTML="<h2 style=\\"margin-top:0\\">AI Summary 🧙</h2>"+summary;document.body.appendChild(box);var close=document.createElement("button");close.textContent="✕";close.style.cssText="position:absolute;top:6px;right:8px;border:none;background:none;font-size:16px;cursor:pointer;";box.prepend(close);close.addEventListener("click",function(){box.remove();});',
      '  // Optional: system share sheet.',
      '  if(shareNative&&navigator.share){try{navigator.share({title:title,text:summary,url:url});}catch(e){}}',
      '  // Optional: send to Kindle via byPhil Cloud proxy.',
      '  if(shareKindle){',
      '    fetch("https://api.byphil.eu/v1/projects/ai_summary_helper/kindle",{method:"POST",headers:{"Content-Type":"application/json","Authorization":"Bearer "+apiKey},body:JSON.stringify({kindle_email:kindleEmail,title:title,content:content,summary:summary,url:url})}).then(function(r){return r.json();}).then(function(d){if(d&&d.success){alert("Sent to Kindle! 📚");}else{alert("Kindle delivery failed: "+(d&&d.error||"unknown"));}}).catch(function(e){alert("Kindle error: "+e.message);});',
      '  }',
      '  // Optional: send to LocalSend via direct P2P.',
      '  if(shareLocalSend){',
      '    var fileName=title.replace(/[^a-z0-9_-]/gi,"_")+".html";',
      '    var enc=new TextEncoder();var bytes=enc.encode(docHtml);var fileId="file_"+Date.now();',
      '    var prepare={info:{alias:"AI Summary Helper",version:"2.0",deviceModel:"Bookmarklet",deviceType:"browser"},files:{}};prepare.files[fileId]={id:fileId,fileName:fileName,size:bytes.length,fileType:"text/html",sha256:null,preview:null};',
      '    var base="http://"+localSendIp+":53317/api/localsend/v1";',
      '    fetch(base+"/prepare-upload",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(prepare)}).then(function(r){if(!r.ok)throw new Error("Handshake HTTP "+r.status);return r.json();}).then(function(d){var sid=d.sessionId||d.session_id;var files=d.files||{};var tok=files[fileId]||(d.tokens&&d.tokens[fileId]);var up=base+"/upload?sessionId="+encodeURIComponent(sid)+"&fileId="+encodeURIComponent(fileId);if(tok)up+="&token="+encodeURIComponent(tok);return fetch(up,{method:"POST",headers:{"Content-Type":"application/octet-stream"},body:bytes});}).then(function(r){if(!r.ok)throw new Error("Upload HTTP "+r.status);alert("Sent to LocalSend! 📖");}).catch(function(e){alert("LocalSend error: "+e.message);});',
      '  }',
      '})',
      '.catch(function(err){msg.remove();alert("Error: "+err.message);});',
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
  });
})();
