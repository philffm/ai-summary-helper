// AI Summary Helper viewer: the Sky. Every article is a star; tags are constellations. Plain JavaScript, loaded only when the Sky view is opened.
//   2D: a canvas you can pan and zoom (constellations, or a timeline), hover for a title, click for the article.
//   3D: the same stars as a cloud you can turn (three.js, loaded on demand with an integrity hash).
// Everything shown comes from library.json and is drawn as canvas text or inserted with textContent. Nothing is inserted as HTML.
(function () {
  'use strict';
  var THREE_URL = 'https://cdn.jsdelivr.net/npm/three@0.160.1/build/three.min.js';
  var THREE_SRI = 'sha384-qOkzR5Ke/XkQxuGVJ9hpFEpDlcoLtWwVYhnJf06cLIZa2vaIptSqaubivErzmD5O';
  var reduced = false; try { reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) { /* old browser */ }

  function rnd(seed) { var h = 2166136261; for (var i = 0; i < seed.length; i++) { h ^= seed.charCodeAt(i); h = Math.imul(h, 16777619); } return function () { h += 0x6D2B79F5; var t = h; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
  function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
  function css(name, fallback) { var v = getComputedStyle(document.documentElement).getPropertyValue(name).trim(); return v || fallback; }
  function dateOf(a) { var t = Date.parse(a.savedAt || ''); return isNaN(t) ? 0 : t; }

  // ── the model: themes (the main tag of each article), colours, positions ──
  function model(items) {
    var count = {}; items.forEach(function (a) { (a.tags || []).forEach(function (t) { count[t] = (count[t] || 0) + 1; }); });
    var themeOf = function (a) { var best = '', n = 0; (a.tags || []).forEach(function (t) { if (count[t] > n) { n = count[t]; best = t; } }); return best || 'untagged'; };
    var by = {}; items.forEach(function (a) { var t = themeOf(a); (by[t] = by[t] || []).push(a); });
    var themes = Object.keys(by).sort(function (x, y) { return by[y].length - by[x].length || x.localeCompare(y); });
    var golden = Math.PI * (3 - Math.sqrt(5)), stars = [], info = {};
    var times = items.map(dateOf).filter(Boolean), t0 = Math.min.apply(null, times.concat([Date.now()])), t1 = Math.max.apply(null, times.concat([t0 + 1]));
    themes.forEach(function (th, i) {
      var hue = (i * 137.508) % 360, r = 380 * Math.sqrt((i + 0.5) / themes.length), ang = i * golden;
      var cx = Math.cos(ang) * r, cy = Math.sin(ang) * r, spread = 34 + Math.sqrt(by[th].length) * 22;
      info[th] = { name: th, hue: hue, cx: cx, cy: cy, n: by[th].length, lane: i };
      by[th].forEach(function (a) {
        var g = rnd(String(a.id)), rr = Math.sqrt(g()) * spread, an = g() * Math.PI * 2, tt = dateOf(a);
        var words = ((a.summary && a.summary.md) || '').split(/\s+/).length, hl = (a.highlights || []).length;
        stars.push({ a: a, theme: th, hue: hue, r: 2.2 + Math.sqrt(hl * 3 + words / 60), x: cx + Math.cos(an) * rr, y: cy + Math.sin(an) * rr,
          tx: tt ? ((tt - t0) / (t1 - t0)) * 900 - 450 : 0, ty: (info[th].lane - (themes.length - 1) / 2) * 46 + (g() - 0.5) * 28, z: tt ? ((tt - t0) / (t1 - t0)) * 320 - 160 : 0, ph: g() * 6.28, id: a.id });
      });
    });
    // constellation lines: each star to its two nearest neighbours of the same theme
    var lines = [];
    themes.forEach(function (th) { var g = stars.filter(function (s) { return s.theme === th; }); g.forEach(function (s) { g.map(function (o) { return [o, (o.x - s.x) * (o.x - s.x) + (o.y - s.y) * (o.y - s.y)]; }).filter(function (p) { return p[0] !== s; }).sort(function (p, q) { return p[1] - q[1]; }).slice(0, 2).forEach(function (p) { if (s.id < p[0].id) lines.push([s, p[0]]); }); }); });
    return { stars: stars, themes: themes.map(function (t) { return info[t]; }), lines: lines };
  }

  // ── mount: returns { update(items), destroy() } ──
  function mount(host, ctx) {
    host.textContent = '';
    var wrap = el('div', 'sky'), bar = el('div', 'sky-bar'), stage = el('div', 'sky-stage'), canvas = document.createElement('canvas'), tip = el('div', 'sky-tip'), cardBox = el('div', 'sky-card'), note = el('div', 'sky-note');
    canvas.setAttribute('role', 'img'); canvas.setAttribute('aria-label', 'A map of your saved articles: each star is an article, grouped by tag. The list below shows the same articles.');
    var layout = 'constellations', mode3d = false, M = { stars: [], themes: [], lines: [] }, view = { k: 1, x: 0, y: 0 }, hover = null, selected = null, raf = 0, dead = false, three = null, t3 = null;
    function btn(label, onClick, pressed) { var b = el('button', 'sky-b', label); b.type = 'button'; b.setAttribute('aria-pressed', String(!!pressed)); b.addEventListener('click', onClick); return b; }
    var bLay1 = btn('Constellations', function () { setLayout('constellations'); }, true), bLay2 = btn('Timeline', function () { setLayout('timeline'); }, false), b3d = btn('3D', toggle3d, false), bReset = btn('Reset view', function () { view = { k: 1, x: 0, y: 0 }; if (t3) t3.reset(); }, false);
    bar.append(bLay1, bLay2, b3d, bReset);
    stage.append(canvas, tip); wrap.append(bar, stage, cardBox, note); host.appendChild(wrap);
    var ctx2 = canvas.getContext('2d'), W = 0, H = 0, dpr = Math.min(2, window.devicePixelRatio || 1);
    function size() { var r = stage.getBoundingClientRect(); W = Math.max(280, r.width); H = Math.max(320, Math.min(640, window.innerHeight * 0.7)); stage.style.height = H + 'px'; canvas.width = W * dpr; canvas.height = H * dpr; canvas.style.width = W + 'px'; canvas.style.height = H + 'px'; if (t3) t3.resize(W, H); }
    var ro = window.ResizeObserver ? new ResizeObserver(function () { size(); }) : null; if (ro) ro.observe(stage); size();

    function pos(s) { return layout === 'timeline' ? [s.tx, s.ty] : [s.x, s.y]; }
    function toScreen(p) { return [W / 2 + (p[0] + view.x) * view.k, H / 2 + (p[1] + view.y) * view.k]; }
    function setLayout(l) { layout = l; bLay1.setAttribute('aria-pressed', String(l === 'constellations')); bLay2.setAttribute('aria-pressed', String(l === 'timeline')); view = { k: l === 'timeline' ? Math.min(1.1, W / 1000) : Math.min(1, W / 900), x: 0, y: 0 }; if (t3) t3.rebuild(); }
    view.k = Math.min(1, W / 900) || 1;

    function draw(now) {
      var bg = css('--card', '#fff'), ink = css('--text', '#0f172a'), dark = css('--bg', '#fff').replace(/\s/g, '').toLowerCase().indexOf('#0') === 0;
      ctx2.setTransform(dpr, 0, 0, dpr, 0, 0); ctx2.fillStyle = dark ? '#070a12' : bg; ctx2.fillRect(0, 0, W, H);
      ctx2.lineWidth = 1;
      M.lines.forEach(function (l) { var a = toScreen(pos(l[0])), b = toScreen(pos(l[1])); ctx2.strokeStyle = 'hsla(' + l[0].hue + ',70%,' + (dark ? 65 : 40) + '%,0.22)'; ctx2.beginPath(); ctx2.moveTo(a[0], a[1]); ctx2.lineTo(b[0], b[1]); ctx2.stroke(); });
      M.stars.forEach(function (s) {
        var p = toScreen(pos(s)); if (p[0] < -20 || p[1] < -20 || p[0] > W + 20 || p[1] > H + 20) return;
        var tw = reduced ? 1 : 0.8 + 0.2 * Math.sin(now / 900 + s.ph), r = Math.max(1.4, s.r * Math.sqrt(view.k)), on = s === hover || s === selected;
        var g = ctx2.createRadialGradient(p[0], p[1], 0, p[0], p[1], r * (on ? 6 : 4));
        g.addColorStop(0, 'hsla(' + s.hue + ',90%,' + (dark ? 82 : 52) + '%,' + (0.95 * tw) + ')'); g.addColorStop(0.35, 'hsla(' + s.hue + ',90%,' + (dark ? 65 : 45) + '%,' + (0.35 * tw) + ')'); g.addColorStop(1, 'hsla(' + s.hue + ',90%,60%,0)');
        ctx2.fillStyle = g; ctx2.beginPath(); ctx2.arc(p[0], p[1], r * (on ? 6 : 4), 0, 6.283); ctx2.fill();
        ctx2.fillStyle = dark ? '#fff' : 'hsl(' + s.hue + ',70%,30%)'; ctx2.beginPath(); ctx2.arc(p[0], p[1], r * (on ? 1.5 : 1), 0, 6.283); ctx2.fill();
      });
      ctx2.font = '600 13px system-ui, sans-serif'; ctx2.textAlign = 'center'; ctx2.textBaseline = 'middle';
      M.themes.forEach(function (t) { var p = toScreen(layout === 'timeline' ? [-470, (t.lane - (M.themes.length - 1) / 2) * 46] : [t.cx, t.cy - 30 - Math.sqrt(t.n) * 16]); ctx2.fillStyle = 'hsl(' + t.hue + ',' + (dark ? '80%,75%' : '65%,35%') + ')'; ctx2.globalAlpha = layout === 'timeline' ? 0.9 : 0.85; ctx2.textAlign = layout === 'timeline' ? 'left' : 'center'; ctx2.fillText(t.name, layout === 'timeline' ? Math.max(6, p[0]) : p[0], p[1]); ctx2.globalAlpha = 1; });
      void ink;
    }
    function loop(now) { if (dead || mode3d) return; draw(now); raf = (reduced || !document.hidden) ? requestAnimationFrame(loop) : 0; }
    function frame() { cancelAnimationFrame(raf); if (reduced) draw(0); else raf = requestAnimationFrame(loop); }

    // ── pointer: hover, click, drag to pan, wheel to zoom ──
    function pick(mx, my) { var best = null, bd = 18 * 18; M.stars.forEach(function (s) { var p = toScreen(pos(s)), d = (p[0] - mx) * (p[0] - mx) + (p[1] - my) * (p[1] - my); if (d < bd) { bd = d; best = s; } }); return best; }
    var drag = null;
    canvas.addEventListener('pointerdown', function (e) { drag = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y, moved: false }; canvas.setPointerCapture(e.pointerId); });
    canvas.addEventListener('pointermove', function (e) {
      var r = canvas.getBoundingClientRect(), mx = e.clientX - r.left, my = e.clientY - r.top;
      if (drag) { var dx = e.clientX - drag.x, dy = e.clientY - drag.y; if (Math.abs(dx) + Math.abs(dy) > 4) drag.moved = true; if (drag.moved) { view.x = drag.vx + dx / view.k; view.y = drag.vy + dy / view.k; if (reduced) draw(0); return; } }
      hover = pick(mx, my); canvas.style.cursor = hover ? 'pointer' : 'grab';
      if (hover) { tip.textContent = hover.a.title || hover.a.url; tip.style.display = 'block'; tip.style.left = Math.min(W - 160, mx + 12) + 'px'; tip.style.top = (my + 12) + 'px'; } else tip.style.display = 'none';
      if (reduced) draw(0);
    });
    canvas.addEventListener('pointerup', function (e) { var moved = drag && drag.moved; drag = null; if (moved) return; var r = canvas.getBoundingClientRect(), s = pick(e.clientX - r.left, e.clientY - r.top); select(s); });
    canvas.addEventListener('pointerleave', function () { hover = null; tip.style.display = 'none'; });
    canvas.addEventListener('wheel', function (e) { e.preventDefault(); var f = e.deltaY < 0 ? 1.15 : 1 / 1.15; view.k = Math.max(0.25, Math.min(6, view.k * f)); if (reduced) draw(0); }, { passive: false });
    function select(s) {
      selected = s; cardBox.textContent = '';
      if (!s) return;
      var close = el('button', 'sky-close', 'Close'); close.type = 'button'; close.addEventListener('click', function () { select(null); });
      cardBox.append(close, ctx.card(s.a)); cardBox.scrollIntoView({ block: 'nearest', behavior: reduced ? 'auto' : 'smooth' });
      if (t3) t3.highlight(s);
    }

    // ── 3D ──
    function loadThree() {
      if (window.THREE) return Promise.resolve(window.THREE);
      return new Promise(function (res, rej) { var s = document.createElement('script'); s.src = THREE_URL; s.integrity = THREE_SRI; s.crossOrigin = 'anonymous'; s.onload = function () { res(window.THREE); }; s.onerror = function () { rej(new Error('three.js could not be loaded (offline or blocked).')); }; document.head.appendChild(s); });
    }
    function webgl() { try { var c = document.createElement('canvas'); return !!(window.WebGLRenderingContext && (c.getContext('webgl') || c.getContext('experimental-webgl'))); } catch (e) { return false; } }
    function toggle3d() {
      if (mode3d) return leave3d();
      if (!webgl()) { note.textContent = '3D needs WebGL, which this browser does not offer.'; return; }
      note.textContent = 'Loading 3D…'; b3d.disabled = true;
      loadThree().then(function (T) { if (dead) return; note.textContent = ''; mode3d = true; b3d.setAttribute('aria-pressed', 'true'); canvas.style.display = 'none'; t3 = build3d(T); }).catch(function (e) { note.textContent = e.message; }).then(function () { b3d.disabled = false; });
    }
    function leave3d() { mode3d = false; b3d.setAttribute('aria-pressed', 'false'); if (t3) { t3.destroy(); t3 = null; } canvas.style.display = ''; hover = null; frame(); }
    function build3d(T) {
      var renderer = new T.WebGLRenderer({ antialias: true, alpha: false }), scene = new T.Scene(), cam = new T.PerspectiveCamera(55, W / H, 1, 5000), group = new T.Group(), pts = null, ray = new T.Raycaster(), s3 = { th: 0.6, ph: 1.25, d: 900, auto: !reduced }, down = null, hi = null;
      renderer.setPixelRatio(dpr); renderer.setSize(W, H); renderer.domElement.className = 'sky-gl'; stage.insertBefore(renderer.domElement, tip);
      var dark = css('--bg', '#fff').replace(/\s/g, '').toLowerCase().indexOf('#0') === 0; renderer.setClearColor(dark ? 0x070a12 : 0xf4f6fb, 1); scene.add(group);
      function layoutPos(s) { return layout === 'timeline' ? [s.tx, s.ty * 2.2, s.z * 0.2] : [s.x * 1.4, s.y * 1.4, s.z]; }
      function clearGroup() { while (group.children.length) { var c = group.children.pop(); if (c.geometry) c.geometry.dispose(); if (c.material) { if (c.material.map) c.material.map.dispose(); c.material.dispose(); } } pts = null; }
      function rebuild() {
        clearGroup();
        var pos3 = new Float32Array(M.stars.length * 3), col = new Float32Array(M.stars.length * 3), siz = new Float32Array(M.stars.length), cc = new T.Color();
        M.stars.forEach(function (s, i) { var p = layoutPos(s); pos3[i * 3] = p[0]; pos3[i * 3 + 1] = -p[1]; pos3[i * 3 + 2] = p[2]; cc.setHSL(s.hue / 360, 0.9, dark ? 0.7 : 0.5); col[i * 3] = cc.r; col[i * 3 + 1] = cc.g; col[i * 3 + 2] = cc.b; siz[i] = s.r; });
        var g = new T.BufferGeometry(); g.setAttribute('position', new T.BufferAttribute(pos3, 3)); g.setAttribute('color', new T.BufferAttribute(col, 3));
        var c2 = document.createElement('canvas'); c2.width = c2.height = 64; var x = c2.getContext('2d'), gr = x.createRadialGradient(32, 32, 0, 32, 32, 32); gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.3, 'rgba(255,255,255,.55)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); x.fillStyle = gr; x.fillRect(0, 0, 64, 64);
        pts = new T.Points(g, new T.PointsMaterial({ size: 26, sizeAttenuation: true, vertexColors: true, map: new T.CanvasTexture(c2), transparent: true, depthWrite: false, blending: dark ? T.AdditiveBlending : T.NormalBlending })); group.add(pts);
        M.themes.forEach(function (t) { var tc = document.createElement('canvas'); tc.width = 256; tc.height = 64; var q = tc.getContext('2d'); q.font = '600 30px system-ui, sans-serif'; q.textAlign = 'center'; q.textBaseline = 'middle'; q.fillStyle = 'hsl(' + t.hue + ',' + (dark ? '80%,78%' : '65%,35%') + ')'; q.fillText(t.name.slice(0, 22), 128, 32); var sp = new T.Sprite(new T.SpriteMaterial({ map: new T.CanvasTexture(tc), transparent: true, depthWrite: false })); var p = layout === 'timeline' ? [-480, (t.lane - (M.themes.length - 1) / 2) * 46 * 2.2, 0] : [t.cx * 1.4, t.cy * 1.4, 0]; sp.position.set(p[0], -p[1] + 40, p[2]); sp.scale.set(190, 48, 1); group.add(sp); });
      }
      function place() { cam.position.set(s3.d * Math.sin(s3.ph) * Math.sin(s3.th), s3.d * Math.cos(s3.ph), s3.d * Math.sin(s3.ph) * Math.cos(s3.th)); cam.lookAt(0, 0, 0); }
      function render() { if (dead) return; if (s3.auto) s3.th += 0.0016; place(); renderer.render(scene, cam); r3 = requestAnimationFrame(render); }
      var r3 = 0, el3 = renderer.domElement;
      el3.addEventListener('pointerdown', function (e) { down = { x: e.clientX, y: e.clientY, th: s3.th, ph: s3.ph, moved: false }; s3.auto = false; el3.setPointerCapture(e.pointerId); });
      el3.addEventListener('pointermove', function (e) { if (!down) return; var dx = e.clientX - down.x, dy = e.clientY - down.y; if (Math.abs(dx) + Math.abs(dy) > 4) down.moved = true; s3.th = down.th - dx * 0.006; s3.ph = Math.max(0.15, Math.min(Math.PI - 0.15, down.ph - dy * 0.006)); });
      el3.addEventListener('pointerup', function (e) {
        var moved = down && down.moved; down = null; if (moved || !pts) return;
        var r = el3.getBoundingClientRect(), v = new T.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1); ray.setFromCamera(v, cam); ray.params.Points.threshold = 18;
        var hit = ray.intersectObject(pts)[0]; select(hit ? M.stars[hit.index] : null);
      });
      el3.addEventListener('wheel', function (e) { e.preventDefault(); s3.auto = false; s3.d = Math.max(200, Math.min(2400, s3.d * (e.deltaY < 0 ? 0.9 : 1.1))); }, { passive: false });
      rebuild(); render();
      return {
        rebuild: rebuild, resize: function (w, h) { renderer.setSize(w, h); cam.aspect = w / h; cam.updateProjectionMatrix(); }, reset: function () { s3.th = 0.6; s3.ph = 1.25; s3.d = 900; s3.auto = !reduced; }, highlight: function (s) { hi = s; },
        destroy: function () { cancelAnimationFrame(r3); clearGroup(); renderer.dispose(); try { renderer.forceContextLoss(); } catch (e) { /* already gone */ } if (el3.parentNode) el3.parentNode.removeChild(el3); void hi; }
      };
    }
    function update(items) { M = model(items); if (selected && !M.stars.some(function (s) { return s.id === selected.id; })) select(null); setLayout(layout); if (t3) t3.rebuild(); note.textContent = items.length ? '' : 'Nothing to show.'; if (!mode3d) frame(); }
    function destroy() { dead = true; cancelAnimationFrame(raf); if (ro) ro.disconnect(); if (t3) t3.destroy(); host.textContent = ''; }
    document.addEventListener('visibilitychange', function () { if (!document.hidden && !mode3d && !dead) frame(); });
    update(ctx.items());
    return { update: update, destroy: destroy };
  }
  window.AISH_SKY = { mount: mount };
})();
