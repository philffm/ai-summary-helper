// Guided tour for the in-site demo: small popover + highlight ring, progress dots, Back / Next / Skip, "Take the tour" to restart.
// Lives on the outer page and reaches into the (same-origin) popup iframe for targets. Real actions advance it; Next always works.
(() => {
  const I = window.AISH_TOUR_I18N || {}, P = new URLSearchParams(location.search);
  const key = P.get('lang') || 'en', S = I[key] || I.en; if (!S) return;
  if (P.get('tour') === '0') return;
  const app = document.getElementById('app'), esc = (s) => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const SEEN = 'aish_demo_tour_seen';
  const seen = () => { try { return localStorage.getItem(SEEN) === '1'; } catch (_) { return false; } };
  const markSeen = () => { try { localStorage.setItem(SEEN, '1'); } catch (_) { /* private mode */ } };
  const isFx = /firefox/i.test(navigator.userAgent);
  const STORE = { chrome: 'https://chromewebstore.google.com/detail/ai-summary-helper-openai/hldbejcjaedipeegjcinmhejdndchkmb', fx: 'https://addons.mozilla.org/en-US/firefox/addon/ai-summary-helper/' };
  const doc = () => { try { return app.contentDocument; } catch (_) { return null; } };
  const q = (sel) => { const d = doc(); if (!d) return null; return [...d.querySelectorAll(sel)].find(e => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; }) || null; };
  const goto = (screen) => { const b = q('.nav-item[data-screen=' + screen + ']'); if (b) b.click(); };
  // target: the element to ring; enter: put the popup in the right state; auto: which real action moves on.
  const STEPS = [
    { sel: '#fetchSummary', enter: () => goto('main'), auto: '#fetchSummary' },
    { outer: '.panel' },
    { sel: '.chat-suggest-chip', alt: '#additionalQuestions', auto: '.chat-suggest-chip,.ask-btn' },
    { outer: '#art mark', alt: '#art' },
    { sel: '.chip[data-panel=language]' },
    { sel: '.nav-item[data-screen=history]' },
    { final: true }
  ];
  let i = -1, pop, ring, btn, timer, advancing = false;
  const dots = () => STEPS.map((_, k) => '<i class="' + (k === i ? 'on' : k < i ? 'done' : '') + '"></i>').join('');
  const css = document.createElement('style');
  css.textContent = `
.tour-ring{position:fixed;z-index:9998;pointer-events:none;border-radius:12px;box-shadow:0 0 0 3px #4c8dff,0 0 0 9999px rgba(10,12,20,.0);transition:all .25s ease;animation:tourPulse 1.8s ease-in-out infinite}
@keyframes tourPulse{50%{box-shadow:0 0 0 6px rgba(76,141,255,.45),0 0 0 9999px rgba(10,12,20,0)}}
.tour-pop{position:fixed;z-index:9999;width:min(320px,calc(100vw - 24px));background:var(--card);color:var(--ink);border:1px solid var(--line);border-radius:14px;padding:14px 16px 12px;box-shadow:0 14px 40px rgba(0,0,0,.22);font:14px/1.5 system-ui,-apple-system,Segoe UI,sans-serif}
.tour-pop .n{font-size:11.5px;color:var(--dim);letter-spacing:.02em}.tour-pop h3{margin:2px 0 4px;font-size:16px;line-height:1.3}.tour-pop p{margin:0 0 10px;color:var(--dim)}
.tour-pop .row{display:flex;align-items:center;gap:8px}.tour-pop .dots{display:flex;gap:5px;flex:1}.tour-pop .dots i{width:7px;height:7px;border-radius:50%;background:var(--line)}.tour-pop .dots i.on{background:#4c8dff;width:18px;border-radius:99px}.tour-pop .dots i.done{background:#8bb4ff}
.tour-pop button,.tour-pop a.b{font:inherit;font-size:13px;border-radius:8px;padding:6px 12px;border:1px solid var(--line);background:transparent;color:var(--ink);cursor:pointer;text-decoration:none;display:inline-block}
.tour-pop .pri{background:#4c8dff;border-color:#4c8dff;color:#fff;font-weight:600}.tour-pop .skip{border:0;color:var(--dim);padding:6px 4px;font-size:12.5px;text-decoration:underline;background:none}
.tour-pop .cta{display:flex;flex-wrap:wrap;gap:8px;margin:2px 0 10px}
.tour-restart{position:fixed;left:14px;bottom:14px;z-index:9990;font:13px system-ui,sans-serif;background:var(--card);color:var(--ink);border:1px solid var(--line);border-radius:99px;padding:6px 14px;cursor:pointer;box-shadow:0 4px 14px rgba(0,0,0,.12)}
@media(max-width:820px){.tour-pop{left:12px !important;right:12px !important;top:auto !important;bottom:12px;width:auto}}`;
  document.head.appendChild(css);
  const rectOf = (st) => {
    if (st.outer) { const e = document.querySelector(st.outer) || (st.alt && document.querySelector(st.alt)); return e ? e.getBoundingClientRect() : null; }
    if (!st.sel) return null;
    const e = q(st.sel) || (st.alt && q(st.alt)); if (!e) return null;
    const r = e.getBoundingClientRect(), f = app.getBoundingClientRect();
    return { left: f.left + r.left, top: f.top + r.top, width: r.width, height: r.height, right: f.left + r.right, bottom: f.top + r.bottom };
  };
  const place = () => {
    if (i < 0 || !pop) return;
    const st = STEPS[i], vw = innerWidth, vh = innerHeight, r = st.final ? null : rectOf(st);
    if (!r) { ring.style.display = 'none'; pop.style.left = Math.max(12, (vw - pop.offsetWidth) / 2) + 'px'; pop.style.top = Math.max(12, (vh - pop.offsetHeight) / 2) + 'px'; return; }
    const pad = 5; ring.style.display = 'block';
    Object.assign(ring.style, { left: r.left - pad + 'px', top: r.top - pad + 'px', width: r.width + pad * 2 + 'px', height: r.height + pad * 2 + 'px' });
    const w = pop.offsetWidth, h = pop.offsetHeight; let x, y;
    if (r.left > vw * 0.45 && r.left - w - 16 > 8) { x = r.left - w - 16; y = r.top + r.height / 2 - h / 2; }       // target on the right → pop to its left
    else if (r.bottom + h + 14 < vh) { x = r.left + r.width / 2 - w / 2; y = r.bottom + 14; }
    else { x = r.left + r.width / 2 - w / 2; y = r.top - h - 14; }
    pop.style.left = Math.min(Math.max(12, x), vw - w - 12) + 'px'; pop.style.top = Math.min(Math.max(12, y), vh - h - 12) + 'px';
  };
  const render = () => {
    const st = STEPS[i], T = S.steps[i], U = S.ui, last = i === STEPS.length - 1;
    pop.dir = document.documentElement.dir || getComputedStyle(document.documentElement).direction;
    pop.innerHTML = '<div class="n">' + esc(U.step.replace('{n}', i + 1).replace('{total}', STEPS.length)) + '</div><h3>' + esc(T.t) + '</h3><p>' + esc(T.s) + '</p>' +
      (last ? '<div class="cta"><a class="b pri" target="_blank" rel="noopener" href="' + (isFx ? STORE.fx : STORE.chrome) + '">' + (isFx ? 'Firefox' : 'Chrome') + ' ↗</a><a class="b" target="_blank" rel="noopener" href="' + (isFx ? STORE.chrome : STORE.fx) + '">' + (isFx ? 'Chrome' : 'Firefox') + ' ↗</a></div>' : '') +
      '<div class="row"><div class="dots">' + dots() + '</div>' +
      (i > 0 ? '<button data-a="back">' + esc(U.back) + '</button>' : (last ? '' : '<button class="skip" data-a="skip">' + esc(U.skip) + '</button>')) +
      '<button class="pri" data-a="' + (last ? 'done' : 'next') + '">' + esc(last ? U.explore : U.next) + '</button></div>' +
      (i > 0 && !last ? '<div style="text-align:end;margin-top:6px"><button class="skip" data-a="skip">' + esc(U.skip) + '</button></div>' : '');
    place();
  };
  const go = (n) => {
    if (n < 0) return;
    if (n >= STEPS.length) return end();
    i = n; advancing = false; const st = STEPS[i]; if (st.enter) st.enter();
    render(); setTimeout(place, 350);
  };
  const next = () => {
    // Pressing Next on "Press Summarize" does it for the visitor, so the next steps have something to show.
    if (i === 0 && !q('.chat-suggest-chip')) { const b = q('#fetchSummary'); if (b) { advancing = true; b.click(); setTimeout(() => go(1), 600); return; } }
    go(i + 1);
  };
  const end = () => { markSeen(); i = -1; if (pop) pop.remove(), pop = null; if (ring) ring.remove(), ring = null; clearInterval(timer); if (btn) btn.hidden = false; };
  const start = () => {
    if (i >= 0) return; if (btn) btn.hidden = true;
    pop = document.createElement('div'); pop.className = 'tour-pop'; pop.setAttribute('role', 'dialog'); document.body.appendChild(pop);
    ring = document.createElement('div'); ring.className = 'tour-ring'; document.body.appendChild(ring);
    pop.addEventListener('click', (e) => { const a = e.target.closest('[data-a]'); if (!a) return; const k = a.dataset.a; if (k === 'next') next(); else if (k === 'back') go(i - 1); else end(); });
    addEventListener('keydown', onKey);
    clearInterval(timer); timer = setInterval(place, 300);
    go(0);
  };
  const onKey = (e) => { if (i < 0) return; if (e.key === 'Escape') end(); };
  addEventListener('resize', place);
  // Real actions inside the popup move the tour on.
  const hook = () => {
    const d = doc(); if (!d || !d.body || d.__tourHooked) return; d.__tourHooked = true;
    d.addEventListener('click', (e) => {
      if (i < 0 || advancing) return; const st = STEPS[i];
      if (st.auto && e.target.closest && e.target.closest(st.auto)) { advancing = true; setTimeout(() => go(i + 1), i === 0 ? 2200 : 1500); }
    }, true);
  };
  setInterval(hook, 500);
  btn = document.createElement('button'); btn.className = 'tour-restart'; btn.textContent = '✨ ' + S.ui.restart; btn.hidden = true; btn.addEventListener('click', start); document.body.appendChild(btn);
  const ready = () => { const d = doc(); return d && d.readyState === 'complete' && q('#fetchSummary'); };
  const boot = setInterval(() => { if (!ready()) return; clearInterval(boot); btn.hidden = false; if (P.get('tour') === '1' || !seen()) setTimeout(start, 900); }, 400);
  window.AISH_TOUR = { start, end };
})();
