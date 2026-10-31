// AI Summary Helper viewer: the Sky. Every article is a star; articles that share tags pull each other together into clusters
// (nebulae with a name), and you fly through them. Plain JavaScript, loaded only when the Sky view is opened.
//   2D: pan, zoom, click a cluster to fly in, click a star for its neighbours and the article, Tour, Surprise me, arrow keys.
//   3D: the same sky as a cloud (three.js, loaded on demand with an integrity hash): orbit, W A S D, click to fly to a star.
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
  function ease(t) { return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; }
  function isDark() { return css('--bg', '#fff').replace(/\s/g, '').toLowerCase().indexOf('#0') === 0; }

  // ── the model: edges from shared tags, a force layout, clusters, names, colours ──
  function model(items) {
    var N = items.length, byTag = {}, W = items.map(function () { return {}; });
    items.forEach(function (a, i) { (a.tags || []).forEach(function (t) { (byTag[t] = byTag[t] || []).push(i); }); });
    var idf = {}; Object.keys(byTag).forEach(function (t) { idf[t] = Math.log(1 + N / byTag[t].length); });
    Object.keys(byTag).forEach(function (t) {                      // rare tags bind strongly, very common ones not at all
      var m = byTag[t]; if (m.length < 2 || m.length > 90) return;
      for (var x = 0; x < m.length; x++) for (var y = x + 1; y < m.length; y++) { W[m[x]][m[y]] = (W[m[x]][m[y]] || 0) + idf[t]; W[m[y]][m[x]] = W[m[x]][m[y]]; }
    });
    var edges = []; W.forEach(function (row, i) { Object.keys(row).forEach(function (j) { j = +j; if (j > i) edges.push([i, j, row[j]]); }); });

    // force layout (seeded, deterministic): springs along edges, local repulsion on a grid, a little gravity
    var px = new Float32Array(N), py = new Float32Array(N), vx = new Float32Array(N), vy = new Float32Array(N), R0 = 160 + 16 * Math.sqrt(N);
    items.forEach(function (a, i) { var g = rnd(String(a.id)); var an = g() * 6.2832, rr = Math.sqrt(g()) * R0; px[i] = Math.cos(an) * rr; py[i] = Math.sin(an) * rr; });
    var iters = N > 1500 ? 90 : N > 600 ? 160 : 260, cell = 64;
    for (var it = 0; it < iters; it++) {
      var alpha = 1 - it / iters, grid = {}, i, j, k;
      for (i = 0; i < N; i++) { var key = Math.floor(px[i] / cell) + ',' + Math.floor(py[i] / cell); (grid[key] = grid[key] || []).push(i); }
      for (i = 0; i < N; i++) {
        var cx = Math.floor(px[i] / cell), cy = Math.floor(py[i] / cell);
        for (var gx = -1; gx <= 1; gx++) for (var gy = -1; gy <= 1; gy++) { var cl = grid[(cx + gx) + ',' + (cy + gy)]; if (!cl) continue; for (k = 0; k < cl.length; k++) { j = cl[k]; if (j <= i) continue; var dx = px[i] - px[j], dy = py[i] - py[j], d2 = dx * dx + dy * dy + 0.01; if (d2 > cell * cell * 2.25) continue; var f = 1400 / d2 * alpha, d = Math.sqrt(d2); vx[i] += dx / d * f; vy[i] += dy / d * f; vx[j] -= dx / d * f; vy[j] -= dy / d * f; } }
      }
      for (var e = 0; e < edges.length; e++) { i = edges[e][0]; j = edges[e][1]; var w = Math.min(edges[e][2], 4), ddx = px[j] - px[i], ddy = py[j] - py[i], dd = Math.sqrt(ddx * ddx + ddy * ddy) + 0.01, target = 46 / (1 + w * 0.45), ff = (dd - target) * 0.012 * w * alpha; vx[i] += ddx / dd * ff; vy[i] += ddy / dd * ff; vx[j] -= ddx / dd * ff; vy[j] -= ddy / dd * ff; }
      for (i = 0; i < N; i++) { vx[i] -= px[i] * 0.0016; vy[i] -= py[i] * 0.0016; vx[i] *= 0.6; vy[i] *= 0.6; px[i] += Math.max(-30, Math.min(30, vx[i])); py[i] += Math.max(-30, Math.min(30, vy[i])); }
    }

    // clusters by label propagation (weighted), seeded order; tiny groups join their strongest neighbour
    var lab = []; for (var n = 0; n < N; n++) lab.push(n);
    var order = []; for (n = 0; n < N; n++) order.push(n); var sr = rnd('order' + N); order.sort(function () { return sr() - 0.5; });
    for (var rep = 0; rep < 14; rep++) { var changed = 0; order.forEach(function (i2) { var sum = {}, best = lab[i2], bw = 0; Object.keys(W[i2]).forEach(function (j2) { var l = lab[+j2]; sum[l] = (sum[l] || 0) + W[i2][j2]; if (sum[l] > bw || (sum[l] === bw && l < best)) { bw = sum[l]; best = l; } }); if (best !== lab[i2]) { lab[i2] = best; changed++; } }); if (!changed) break; }
    var groups = {}; lab.forEach(function (l, i2) { (groups[l] = groups[l] || []).push(i2); });
    Object.keys(groups).forEach(function (l) { var g = groups[l]; if (g.length >= 3 || N < 12) return; var best = -1, bw = 0; g.forEach(function (i2) { Object.keys(W[i2]).forEach(function (j2) { if (lab[+j2] != l && W[i2][j2] > bw) { bw = W[i2][j2]; best = lab[+j2]; } }); }); if (best >= 0) { g.forEach(function (i2) { lab[i2] = best; groups[best].push(i2); }); delete groups[l]; } });
    var ids = Object.keys(groups).sort(function (a, b) { return groups[b].length - groups[a].length || a - b; });
    var clusters = ids.map(function (l, ci) {
      var g = groups[l], score = {}; g.forEach(function (i2) { (items[i2].tags || []).forEach(function (t) { score[t] = (score[t] || 0) + 1; }); });
      var tags = Object.keys(score).sort(function (a, b) { return score[b] * idf[b] - score[a] * idf[a]; }), mx = 0, my = 0; g.forEach(function (i2) { mx += px[i2]; my += py[i2]; }); mx /= g.length; my /= g.length;
      var ds = g.map(function (i2) { return Math.hypot(px[i2] - mx, py[i2] - my); }).sort(function (a, b) { return a - b; });
      var name = tags.length ? tags[0] + (tags[1] && score[tags[1]] >= g.length * 0.4 ? ' · ' + tags[1] : '') : 'loose threads';
      return { id: ci, name: name, tags: tags.slice(0, 5), n: g.length, members: g, hue: (ci * 137.508 + 20) % 360, cx: mx, cy: my, radius: Math.max(40, (ds[Math.floor(ds.length * 0.9)] || 0) + 40), z: (rnd('z' + ci)() - 0.5) * 420 };
    });
    var clOf = {}; clusters.forEach(function (c) { c.members.forEach(function (i2) { clOf[i2] = c; }); });
    var times = items.map(dateOf).filter(Boolean), t0 = Math.min.apply(null, times.concat([Date.now()])), t1 = Math.max.apply(null, times.concat([t0 + 1]));
    var stars = items.map(function (a, i2) {
      var g = rnd('s' + a.id), c = clOf[i2], tt = dateOf(a), words = ((a.summary && a.summary.md) || '').split(/\s+/).length, hl = (a.highlights || []).length, lane = clusters.indexOf(c) - (clusters.length - 1) / 2;
      return { a: a, id: a.id, i: i2, c: c, hue: c.hue, r: 2.2 + Math.sqrt(hl * 3 + words / 60), cx: px[i2], cy: py[i2], tx: tt ? ((tt - t0) / (t1 - t0)) * 900 - 450 : 0, ty: lane * 52 + (g() - 0.5) * 34,
        z: c.z + (tt ? ((tt - t0) / (t1 - t0)) * 260 - 130 : 0) + (g() - 0.5) * 80, ph: g() * 6.28, x: px[i2], y: py[i2] };
    });
    // links: a maximum spanning tree inside each cluster (the "constellation"), and each star's strongest neighbours
    var links = [];
    clusters.forEach(function (c) {
      var inT = {}, first = c.members[0]; if (first === undefined) return; inT[first] = true; var left = c.members.length - 1;
      while (left > 0) { var bi = -1, bj = -1, bw2 = -1; c.members.forEach(function (a2) { if (!inT[a2]) return; Object.keys(W[a2]).forEach(function (b2) { b2 = +b2; if (inT[b2] || clOf[b2] !== c) return; if (W[a2][b2] > bw2) { bw2 = W[a2][b2]; bi = a2; bj = b2; } }); }); if (bj < 0) break; inT[bj] = true; links.push([stars[bi], stars[bj]]); left--; }
    });
    stars.forEach(function (s) { s.nb = Object.keys(W[s.i]).map(function (j2) { return [stars[+j2], W[s.i][j2]]; }).sort(function (a, b) { return b[1] - a[1]; }).slice(0, 5).map(function (p) { return p[0]; }); });
    return { stars: stars, clusters: clusters, links: links };
  }

  // ── mount: returns { update(items), destroy() } ──
  function mount(host, ctx) {
    host.textContent = '';
    var wrap = el('div', 'sky'), bar = el('div', 'sky-bar'), chips = el('div', 'sky-bar'), stage = el('div', 'sky-stage'), canvas = document.createElement('canvas'), tip = el('div', 'sky-tip'), caption = el('div', 'sky-caption'), cardBox = el('div', 'sky-card'), note = el('div', 'sky-note');
    canvas.tabIndex = 0; canvas.setAttribute('role', 'img'); canvas.setAttribute('aria-label', 'A sky of your saved articles: every star is an article, clusters are groups that share tags. Arrow keys move, plus and minus zoom, Enter opens the selected star. The list below shows the same articles.');
    var layout = 'constellations', mode3d = false, M = { stars: [], clusters: [], links: [] }, view = { k: 1, x: 0, y: 0 }, anim = null, morph = null, hover = null, selected = null, focusC = null, tour = null, raf = 0, dead = false, t3 = null, shoot = null, dust = [];
    var dg = rnd('dust'); for (var d = 0; d < 160; d++) dust.push([dg(), dg(), dg() * 1.1 + 0.3, dg() * 6.28]);
    function btn(label, onClick, pressed) { var b = el('button', 'sky-b', label); b.type = 'button'; if (pressed != null) b.setAttribute('aria-pressed', String(!!pressed)); b.addEventListener('click', onClick); return b; }
    var bLay1 = btn('Constellations', function () { setLayout('constellations'); }, true), bLay2 = btn('Timeline', function () { setLayout('timeline'); }, false), bTour = btn('Tour', toggleTour), bSurp = btn('Surprise me', surprise), b3d = btn('3D', toggle3d, false), bReset = btn('Fly out', function () { flyAll(); });
    bar.append(bLay1, bLay2, bTour, bSurp, b3d, bReset); stage.append(canvas, caption, tip); wrap.append(bar, chips, stage, cardBox, note); host.appendChild(wrap);
    var ctx2 = canvas.getContext('2d'), W = 0, H = 0, dpr = Math.min(2, window.devicePixelRatio || 1);
    function size() { var r = stage.getBoundingClientRect(); W = Math.max(280, r.width); H = Math.max(340, Math.min(680, window.innerHeight * 0.74)); stage.style.height = H + 'px'; canvas.width = W * dpr; canvas.height = H * dpr; canvas.style.width = W + 'px'; canvas.style.height = H + 'px'; if (t3) t3.resize(W, H); }
    var ro = window.ResizeObserver ? new ResizeObserver(function () { size(); }) : null; if (ro) ro.observe(stage); size();

    function pos(s) { return [s.x, s.y]; }
    function toScreen(p) { return [W / 2 + (p[0] + view.x) * view.k, H / 2 + (p[1] + view.y) * view.k]; }
    function fitTo(pts, pad) { if (!pts.length) return { k: 1, x: 0, y: 0 }; var x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9; pts.forEach(function (p) { x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]); y0 = Math.min(y0, p[1]); y1 = Math.max(y1, p[1]); }); var bw = Math.max(80, x1 - x0) + (pad || 120), bh = Math.max(80, y1 - y0) + (pad || 120); return { k: Math.max(0.15, Math.min(6, Math.min(W / bw, H / bh))), x: -(x0 + x1) / 2, y: -(y0 + y1) / 2 }; }
    function allPts() { return M.stars.map(pos); }
    function fly(to, ms) { if (reduced || !ms) { view = { k: to.k, x: to.x, y: to.y }; anim = null; frame(); return; } anim = { f: { k: view.k, x: view.x, y: view.y }, t: to, t0: performance.now(), d: ms }; frame(); }
    function flyAll() { focusC = null; select(null); fly(fitTo(allPts()), 1100); if (t3) t3.reset(); }
    function flyCluster(c) { focusC = c; select(null); fly(fitTo(c.members.map(function (i) { return pos(M.stars[i]); }), 160), 1200); if (t3) t3.flyTo(c.cx, c.cy, c.z, 520); caption.textContent = c.name + ' · ' + c.n + ' articles'; caption.style.opacity = 1; }
    function setLayout(l) {
      if (l === layout) return; layout = l; bLay1.setAttribute('aria-pressed', String(l === 'constellations')); bLay2.setAttribute('aria-pressed', String(l === 'timeline'));
      M.stars.forEach(function (s) { s.fx = s.x; s.fy = s.y; s.gx = l === 'timeline' ? s.tx : s.cx; s.gy = l === 'timeline' ? s.ty : s.cy; });
      morph = { t0: performance.now(), d: reduced ? 1 : 1100 }; focusC = null; fly(l === 'timeline' ? fitTo(M.stars.map(function (s) { return [s.tx, s.ty]; })) : fitTo(M.stars.map(function (s) { return [s.cx, s.cy]; })), 1100); if (t3) t3.rebuild();
    }
    function clusterAt(mx, my) { var best = null, bd = 1e12; M.clusters.forEach(function (c) { var p = toScreen(layout === 'timeline' ? [c.members.reduce(function (a, i) { return a + M.stars[i].x; }, 0) / c.n, c.members.reduce(function (a, i) { return a + M.stars[i].y; }, 0) / c.n] : [c.cx, c.cy]), r = c.radius * view.k * 0.8, d = Math.pow(p[0] - mx, 2) + Math.pow(p[1] - my, 2); if (d < r * r && d < bd) { bd = d; best = c; } }); return best; }

    function draw(now) {
      if (anim) { var u = Math.min(1, (now - anim.t0) / anim.d), e = ease(u); view.k = anim.f.k + (anim.t.k - anim.f.k) * e; view.x = anim.f.x + (anim.t.x - anim.f.x) * e; view.y = anim.f.y + (anim.t.y - anim.f.y) * e; if (u >= 1) anim = null; }
      if (morph) { var mu = Math.min(1, (now - morph.t0) / morph.d), me = ease(mu); M.stars.forEach(function (s) { s.x = s.fx + (s.gx - s.fx) * me; s.y = s.fy + (s.gy - s.fy) * me; }); if (mu >= 1) morph = null; }
      var dark = isDark();
      ctx2.setTransform(dpr, 0, 0, dpr, 0, 0);
      var bgG = ctx2.createRadialGradient(W / 2, H / 2, 20, W / 2, H / 2, Math.max(W, H) * 0.75);
      if (dark) { bgG.addColorStop(0, '#0d1224'); bgG.addColorStop(1, '#04060d'); } else { bgG.addColorStop(0, '#f7f9ff'); bgG.addColorStop(1, '#e8edf8'); }
      ctx2.fillStyle = bgG; ctx2.fillRect(0, 0, W, H);
      // dust: tiny far stars that drift a little with the camera (parallax)
      dust.forEach(function (p) { var x = ((p[0] * W + view.x * view.k * 0.12) % W + W) % W, y = ((p[1] * H + view.y * view.k * 0.12) % H + H) % H, a = (0.25 + 0.35 * (reduced ? 1 : 0.5 + 0.5 * Math.sin(now / 1300 + p[3]))) * (dark ? 1 : 0.5); ctx2.fillStyle = dark ? 'rgba(200,215,255,' + a + ')' : 'rgba(80,100,160,' + a * 0.6 + ')'; ctx2.fillRect(x, y, p[2], p[2]); });
      // nebulae: soft, slowly breathing glows behind each cluster
      ctx2.globalCompositeOperation = dark ? 'lighter' : 'source-over';
      M.clusters.forEach(function (c) {
        var pc = toScreen(layout === 'timeline' ? [0, c.members.length ? M.stars[c.members[0]].y : 0] : [c.cx, c.cy]); if (layout === 'timeline') return;
        var g2 = rnd('n' + c.id), breathe = reduced ? 1 : 1 + 0.04 * Math.sin(now / 2400 + c.id);
        for (var b = 0; b < 3; b++) { var ox = (g2() - 0.5) * c.radius * 0.7 * view.k, oy = (g2() - 0.5) * c.radius * 0.7 * view.k, rr = c.radius * (0.8 + g2() * 0.7) * view.k * breathe; if (pc[0] + ox + rr < 0 || pc[0] + ox - rr > W || pc[1] + oy + rr < 0 || pc[1] + oy - rr > H) continue; var g = ctx2.createRadialGradient(pc[0] + ox, pc[1] + oy, 0, pc[0] + ox, pc[1] + oy, rr); var on = (focusC === c) ? 1.5 : 1; g.addColorStop(0, 'hsla(' + c.hue + ',85%,' + (dark ? 58 : 60) + '%,' + (dark ? 0.2 : 0.14) * on + ')'); g.addColorStop(0.55, 'hsla(' + c.hue + ',80%,' + (dark ? 50 : 62) + '%,' + (dark ? 0.07 : 0.06) * on + ')'); g.addColorStop(1, 'hsla(' + c.hue + ',80%,50%,0)'); ctx2.fillStyle = g; ctx2.beginPath(); ctx2.arc(pc[0] + ox, pc[1] + oy, rr, 0, 6.283); ctx2.fill(); }
      });
      ctx2.globalCompositeOperation = 'source-over';
      // constellation lines
      var nbSet = selected ? selected.nb : (hover ? hover.nb : []), focus = selected || hover;
      ctx2.lineWidth = 1;
      M.links.forEach(function (l) { var a = toScreen(pos(l[0])), b = toScreen(pos(l[1])); if ((a[0] < 0 && b[0] < 0) || (a[0] > W && b[0] > W) || (a[1] < 0 && b[1] < 0) || (a[1] > H && b[1] > H)) return; ctx2.strokeStyle = 'hsla(' + l[0].hue + ',75%,' + (dark ? 70 : 42) + '%,' + (dark ? 0.26 : 0.3) + ')'; ctx2.beginPath(); ctx2.moveTo(a[0], a[1]); ctx2.lineTo(b[0], b[1]); ctx2.stroke(); });
      if (focus) { var fp = toScreen(pos(focus)); ctx2.lineWidth = 1.6; nbSet.forEach(function (n) { var p = toScreen(pos(n)); ctx2.strokeStyle = 'hsla(' + focus.hue + ',90%,' + (dark ? 78 : 40) + '%,0.85)'; ctx2.setLineDash([4, 4]); ctx2.beginPath(); ctx2.moveTo(fp[0], fp[1]); ctx2.lineTo(p[0], p[1]); ctx2.stroke(); }); ctx2.setLineDash([]); }
      // stars
      var near = {}; nbSet.forEach(function (n) { near[n.id] = 1; });
      M.stars.forEach(function (s) {
        var p = toScreen(pos(s)); if (p[0] < -30 || p[1] < -30 || p[0] > W + 30 || p[1] > H + 30) return;
        var tw = reduced ? 1 : 0.8 + 0.2 * Math.sin(now / 900 + s.ph), on = s === hover || s === selected, nb = near[s.id], dim = focusC && s.c !== focusC && !on ? 0.35 : 1;
        var r = Math.max(1.5, s.r * Math.sqrt(view.k)) * (on ? 1.5 : nb ? 1.25 : 1), halo = r * (on ? 6 : 4);
        var g = ctx2.createRadialGradient(p[0], p[1], 0, p[0], p[1], halo);
        g.addColorStop(0, 'hsla(' + s.hue + ',90%,' + (dark ? 84 : 52) + '%,' + (0.95 * tw * dim) + ')'); g.addColorStop(0.35, 'hsla(' + s.hue + ',90%,' + (dark ? 66 : 46) + '%,' + (0.36 * tw * dim) + ')'); g.addColorStop(1, 'hsla(' + s.hue + ',90%,60%,0)');
        ctx2.fillStyle = g; ctx2.beginPath(); ctx2.arc(p[0], p[1], halo, 0, 6.283); ctx2.fill();
        ctx2.fillStyle = dark ? 'rgba(255,255,255,' + dim + ')' : 'hsla(' + s.hue + ',70%,28%,' + dim + ')'; ctx2.beginPath(); ctx2.arc(p[0], p[1], r * (on ? 1.2 : 0.9), 0, 6.283); ctx2.fill();
        if (s === selected) { var pr = reduced ? 1 : (now % 1800) / 1800; ctx2.strokeStyle = 'hsla(' + s.hue + ',90%,' + (dark ? 80 : 40) + '%,' + (1 - pr) * 0.8 + ')'; ctx2.lineWidth = 1.5; ctx2.beginPath(); ctx2.arc(p[0], p[1], r * (2 + pr * 4), 0, 6.283); ctx2.stroke(); }
      });
      // a rare shooting star
      if (!reduced) { if (!shoot && Math.random() < 0.003) shoot = { x: Math.random() * W, y: Math.random() * H * 0.5, vx: 6 + Math.random() * 4, vy: 3 + Math.random() * 2, life: 1 }; if (shoot) { ctx2.strokeStyle = 'rgba(255,255,255,' + shoot.life * (dark ? 0.8 : 0.3) + ')'; ctx2.lineWidth = 1.5; ctx2.beginPath(); ctx2.moveTo(shoot.x, shoot.y); ctx2.lineTo(shoot.x - shoot.vx * 6, shoot.y - shoot.vy * 6); ctx2.stroke(); shoot.x += shoot.vx; shoot.y += shoot.vy; shoot.life -= 0.03; if (shoot.life <= 0) shoot = null; } }
      // labels: cluster names (hide when zoomed far in), names of the focused star and its neighbours
      ctx2.textBaseline = 'middle'; ctx2.textAlign = 'center';
      if (layout === 'constellations') M.clusters.forEach(function (c) { var p = toScreen([c.cx, c.cy - c.radius * 0.55]); if (p[0] < -100 || p[0] > W + 100 || p[1] < -30 || p[1] > H + 30) return; var fs = Math.max(11, Math.min(24, 10 + Math.sqrt(c.n) * 2.4)) * Math.min(1.3, Math.max(0.8, Math.sqrt(view.k))); var fade = Math.max(0, Math.min(1, (3.2 - view.k) / 1.2)) * (focusC && focusC !== c ? 0.4 : 1); if (fade <= 0.02) return; ctx2.font = '600 ' + fs + 'px system-ui, sans-serif'; ctx2.shadowColor = dark ? 'rgba(0,0,0,.8)' : 'rgba(255,255,255,.9)'; ctx2.shadowBlur = 6; ctx2.fillStyle = 'hsla(' + c.hue + ',' + (dark ? '85%,78%' : '70%,32%') + ',' + fade + ')'; ctx2.fillText(c.name, p[0], p[1]); ctx2.shadowBlur = 0; });
      else M.clusters.forEach(function (c) { var s0 = M.stars[c.members[0]]; if (!s0) return; var p = toScreen([-480, c.members.reduce(function (a, i) { return a + M.stars[i].y; }, 0) / c.n]); ctx2.textAlign = 'left'; ctx2.font = '600 13px system-ui, sans-serif'; ctx2.fillStyle = 'hsl(' + c.hue + ',' + (dark ? '80%,75%' : '65%,34%') + ')'; ctx2.fillText(c.name, Math.max(8, p[0]), p[1]); ctx2.textAlign = 'center'; });
      if (focus) { [focus].concat(nbSet).forEach(function (s, i) { var p = toScreen(pos(s)); var t = (s.a.title || '').slice(0, 34) + ((s.a.title || '').length > 34 ? '…' : ''); ctx2.font = (i ? '500 11px' : '700 12px') + ' system-ui, sans-serif'; var w = ctx2.measureText(t).width + 12; ctx2.fillStyle = dark ? 'rgba(10,14,28,.8)' : 'rgba(255,255,255,.88)'; ctx2.fillRect(p[0] - w / 2, p[1] + 10, w, 18); ctx2.fillStyle = dark ? '#e8edf5' : '#0f172a'; ctx2.fillText(t, p[0], p[1] + 19); }); }
    }
    function loop(now) { if (dead || mode3d) return; draw(now); raf = (!reduced && !document.hidden) ? requestAnimationFrame(loop) : (anim || morph ? requestAnimationFrame(loop) : 0); }
    function frame() { cancelAnimationFrame(raf); if (mode3d) return; raf = requestAnimationFrame(loop); }

    // ── pointer and keyboard ──
    function pick(mx, my) { var best = null, bd = 20 * 20; M.stars.forEach(function (s) { var p = toScreen(pos(s)), d = (p[0] - mx) * (p[0] - mx) + (p[1] - my) * (p[1] - my); if (d < bd) { bd = d; best = s; } }); return best; }
    var drag = null;
    canvas.addEventListener('pointerdown', function (e) { stopTour(); anim = null; drag = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y, moved: false }; canvas.setPointerCapture(e.pointerId); canvas.style.cursor = 'grabbing'; });
    canvas.addEventListener('pointermove', function (e) {
      var r = canvas.getBoundingClientRect(), mx = e.clientX - r.left, my = e.clientY - r.top;
      if (drag) { var dx = e.clientX - drag.x, dy = e.clientY - drag.y; if (Math.abs(dx) + Math.abs(dy) > 4) drag.moved = true; if (drag.moved) { view.x = drag.vx + dx / view.k; view.y = drag.vy + dy / view.k; frame(); return; } }
      hover = pick(mx, my); var cl = hover ? null : clusterAt(mx, my); canvas.style.cursor = hover || cl ? 'pointer' : 'grab';
      if (hover) { tip.textContent = (hover.a.title || hover.a.url) + (hover.c ? '  ·  ' + hover.c.name : ''); tip.style.display = 'block'; tip.style.left = Math.min(W - 200, mx + 12) + 'px'; tip.style.top = (my + 12) + 'px'; } else if (cl) { tip.textContent = cl.name + ' · ' + cl.n + ' articles'; tip.style.display = 'block'; tip.style.left = Math.min(W - 200, mx + 12) + 'px'; tip.style.top = (my + 12) + 'px'; } else tip.style.display = 'none';
      frame();
    });
    canvas.addEventListener('pointerup', function (e) {
      var moved = drag && drag.moved; drag = null; canvas.style.cursor = 'grab'; if (moved) return;
      var r = canvas.getBoundingClientRect(), mx = e.clientX - r.left, my = e.clientY - r.top, s = pick(mx, my);
      if (s) { select(s, true); return; }
      var c = clusterAt(mx, my); if (c && c !== focusC) { flyCluster(c); return; }
      select(null); if (focusC) { /* click on empty space inside a focused cluster keeps the focus */ }
    });
    canvas.addEventListener('dblclick', function () { flyAll(); });
    canvas.addEventListener('pointerleave', function () { hover = null; tip.style.display = 'none'; frame(); });
    canvas.addEventListener('wheel', function (e) { e.preventDefault(); stopTour(); var r = canvas.getBoundingClientRect(), mx = e.clientX - r.left - W / 2, my = e.clientY - r.top - H / 2, f = e.deltaY < 0 ? 1.18 : 1 / 1.18, k2 = Math.max(0.12, Math.min(9, view.k * f)); view.x += mx / k2 - mx / view.k; view.y += my / k2 - my / view.k; view.k = k2; anim = null; frame(); }, { passive: false });
    canvas.addEventListener('keydown', function (e) {
      var step = 60 / view.k, ok = true;
      if (e.key === 'ArrowLeft') view.x += step; else if (e.key === 'ArrowRight') view.x -= step; else if (e.key === 'ArrowUp') view.y += step; else if (e.key === 'ArrowDown') view.y -= step;
      else if (e.key === '+' || e.key === '=') view.k = Math.min(9, view.k * 1.2); else if (e.key === '-') view.k = Math.max(0.12, view.k / 1.2);
      else if (e.key === 'Enter' && selected) cardBox.scrollIntoView({ block: 'nearest' });
      else if (e.key === 'Escape') { if (selected) select(null); else flyAll(); }
      else if (e.key === 'Tab') { ok = false; var list = M.stars.slice().sort(function (a, b) { return a.c.id - b.c.id || a.x - b.x; }), i = selected ? list.indexOf(selected) : -1, nx = list[(i + (e.shiftKey ? -1 : 1) + list.length) % list.length]; if (nx) { e.preventDefault(); select(nx, true); } }
      else ok = false;
      if (ok) { e.preventDefault(); anim = null; frame(); }
    });
    function select(s, flyTo) {
      selected = s; cardBox.textContent = ''; if (!s) { frame(); return; }
      if (flyTo) { if (mode3d && t3) t3.flyTo(s.cx, s.cy, s.z, 260); else fly({ k: Math.max(view.k, 1.9), x: -s.x, y: -s.y }, 900); }
      var close = el('button', 'sky-close', 'Close'); close.type = 'button'; close.addEventListener('click', function () { select(null); });
      cardBox.append(close, ctx.card(s.a)); cardBox.scrollIntoView({ block: 'nearest', behavior: reduced ? 'auto' : 'smooth' }); if (t3) t3.highlight(s); frame();
    }
    function surprise() { stopTour(); var pool = M.stars.slice().sort(function (a, b) { return (b.a.highlights || []).length - (a.a.highlights || []).length; }), s = pool[Math.floor(Math.random() * Math.min(pool.length, Math.max(3, pool.length)))]; if (s) { focusC = null; select(s, true); caption.textContent = 'A star from ' + s.c.name; caption.style.opacity = 1; } }
    function toggleTour() { if (tour) return stopTour(); if (!M.clusters.length || reduced) { note.textContent = reduced ? 'The tour moves the camera by itself, so it is off while reduced motion is on. Use the cluster buttons instead.' : ''; return; } tour = { i: 0, timer: 0 }; bTour.setAttribute('aria-pressed', 'true'); tourStep(); }
    function tourStep() { if (!tour) return; var c = M.clusters[tour.i % M.clusters.length]; flyCluster(c); tour.i++; tour.timer = setTimeout(tourStep, 4200); }
    function stopTour() { if (!tour) return; clearTimeout(tour.timer); tour = null; bTour.setAttribute('aria-pressed', 'false'); caption.style.opacity = 0; }

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
      loadThree().then(function (T) { if (dead) return; note.textContent = ''; stopTour(); mode3d = true; b3d.setAttribute('aria-pressed', 'true'); canvas.style.display = 'none'; t3 = build3d(T); }).catch(function (e) { note.textContent = e.message; }).then(function () { b3d.disabled = false; });
    }
    function leave3d() { mode3d = false; b3d.setAttribute('aria-pressed', 'false'); if (t3) { t3.destroy(); t3 = null; } canvas.style.display = ''; hover = null; frame(); }
    function build3d(T) {
      var dark = isDark(), renderer = new T.WebGLRenderer({ antialias: true }), scene = new T.Scene(), cam = new T.PerspectiveCamera(58, W / H, 1, 6000), group = new T.Group(), pts = null, ray = new T.Raycaster(), el3 = renderer.domElement;
      var s3 = { th: 0.5, ph: 1.2, d: 1000, tx: 0, ty: 0, tz: 0, auto: !reduced, idle: 0 }, tw = null, down = null, hl = null, keys = {}, r3 = 0, lastHover = 0;
      renderer.setPixelRatio(dpr); renderer.setSize(W, H); el3.className = 'sky-gl'; el3.tabIndex = 0; stage.insertBefore(el3, caption);
      renderer.setClearColor(dark ? 0x04060d : 0xeef2fa, 1); scene.fog = new T.FogExp2(dark ? 0x04060d : 0xeef2fa, 0.00055); scene.add(group);
      function p3(s) { return layout === 'timeline' ? [s.tx, -s.ty * 2.2, s.z * 0.2] : [s.cx * 1.5, -s.cy * 1.5, s.z]; }
      function c3(c) { if (layout === 'timeline') { var s = M.stars[c.members[0]]; return [-480, -(c.members.reduce(function (a, i) { return a + M.stars[i].ty; }, 0) / c.n) * 2.2, 0]; } return [c.cx * 1.5, -c.cy * 1.5, c.z]; }
      function soft(a) { var c2 = document.createElement('canvas'); c2.width = c2.height = 128; var x = c2.getContext('2d'), g = x.createRadialGradient(64, 64, 0, 64, 64, 64); g.addColorStop(0, 'rgba(255,255,255,' + a + ')'); g.addColorStop(0.4, 'rgba(255,255,255,' + a * 0.35 + ')'); g.addColorStop(1, 'rgba(255,255,255,0)'); x.fillStyle = g; x.fillRect(0, 0, 128, 128); return new T.CanvasTexture(c2); }
      function clearGroup() { while (group.children.length) { var c = group.children.pop(); if (c.geometry) c.geometry.dispose(); if (c.material) { if (c.material.map) c.material.map.dispose(); c.material.dispose(); } } pts = null; hiLines = null; }
      var hiLines = null;
      function rebuild() {
        clearGroup(); var n = M.stars.length, pos3 = new Float32Array(n * 3), col = new Float32Array(n * 3), cc = new T.Color();
        M.stars.forEach(function (s, i) { var p = p3(s); pos3[i * 3] = p[0]; pos3[i * 3 + 1] = p[1]; pos3[i * 3 + 2] = p[2]; cc.setHSL(s.hue / 360, 0.95, dark ? 0.72 : 0.4); col[i * 3] = cc.r; col[i * 3 + 1] = cc.g; col[i * 3 + 2] = cc.b; });
        var g = new T.BufferGeometry(); g.setAttribute('position', new T.BufferAttribute(pos3, 3)); g.setAttribute('color', new T.BufferAttribute(col, 3));
        pts = new T.Points(g, new T.PointsMaterial({ size: dark ? 34 : 46, sizeAttenuation: true, vertexColors: true, map: soft(1), transparent: true, depthWrite: false, blending: dark ? T.AdditiveBlending : T.NormalBlending })); group.add(pts);
        // nebulae: big soft sprites per cluster
        var nebTex = soft(0.55);
        M.clusters.forEach(function (c) { var p = c3(c), g2 = rnd('n3' + c.id); for (var k = 0; k < 4; k++) { var sp = new T.Sprite(new T.SpriteMaterial({ map: nebTex, color: new T.Color().setHSL(c.hue / 360, 0.8, dark ? 0.5 : 0.6), transparent: true, opacity: dark ? 0.2 : 0.14, depthWrite: false, blending: dark ? T.AdditiveBlending : T.NormalBlending })); sp.position.set(p[0] + (g2() - 0.5) * c.radius * 1.6, p[1] + (g2() - 0.5) * c.radius * 1.6, p[2] + (g2() - 0.5) * c.radius * 1.2); var sc = c.radius * (2.6 + g2() * 1.8); sp.scale.set(sc, sc, 1); group.add(sp); } });
        // constellation lines and cluster names
        var lp = [], lc = []; M.links.forEach(function (l) { var a = p3(l[0]), b = p3(l[1]); lp.push(a[0], a[1], a[2], b[0], b[1], b[2]); cc.setHSL(l[0].hue / 360, 0.8, dark ? 0.65 : 0.45); lc.push(cc.r, cc.g, cc.b, cc.r, cc.g, cc.b); });
        var lg = new T.BufferGeometry(); lg.setAttribute('position', new T.Float32BufferAttribute(lp, 3)); lg.setAttribute('color', new T.Float32BufferAttribute(lc, 3)); group.add(new T.LineSegments(lg, new T.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: dark ? 0.32 : 0.4, depthWrite: false })));
        M.clusters.forEach(function (c) { var tc = document.createElement('canvas'); tc.width = 512; tc.height = 96; var q = tc.getContext('2d'); q.font = '600 44px system-ui, sans-serif'; q.textAlign = 'center'; q.textBaseline = 'middle'; q.shadowColor = dark ? 'rgba(0,0,0,.9)' : 'rgba(255,255,255,.9)'; q.shadowBlur = 8; q.fillStyle = 'hsl(' + c.hue + ',' + (dark ? '85%,80%' : '70%,32%') + ')'; q.fillText(c.name.slice(0, 26), 256, 48); var sp = new T.Sprite(new T.SpriteMaterial({ map: new T.CanvasTexture(tc), transparent: true, depthWrite: false })), p = c3(c); sp.position.set(p[0], p[1] + c.radius * 1.5 + 30, p[2]); sp.scale.set(230 + c.n * 3.5, 43 + c.n * 0.65, 1); group.add(sp); });
      }
      function fitDist() { var m = 0; M.stars.forEach(function (s) { var p = p3(s); m = Math.max(m, Math.hypot(p[0], p[1], p[2])); }); return Math.max(450, Math.min(3000, m * 2.3)); }
      function place() { cam.position.set(s3.tx + s3.d * Math.sin(s3.ph) * Math.sin(s3.th), s3.ty + s3.d * Math.cos(s3.ph), s3.tz + s3.d * Math.sin(s3.ph) * Math.cos(s3.th)); cam.lookAt(s3.tx, s3.ty, s3.tz); }
      function flyTo(x, y, z, dist) { var cs = layout === 'timeline' ? null : null; void cs; tw = { f: { x: s3.tx, y: s3.ty, z: s3.tz, d: s3.d }, t: { x: x * (layout === 'timeline' ? 1 : 1.5), y: -y * (layout === 'timeline' ? 1 : 1.5), z: z, d: dist ? Math.max(180, dist * 1.4) : s3.d }, t0: performance.now(), dur: reduced ? 1 : 1100 }; s3.auto = false; }
      function reset() { tw = { f: { x: s3.tx, y: s3.ty, z: s3.tz, d: s3.d }, t: { x: 0, y: 0, z: 0, d: fitDist() }, t0: performance.now(), dur: reduced ? 1 : 1100 }; s3.auto = !reduced; }
      function render(now) {
        if (dead) return;
        if (tw) { var u = Math.min(1, (now - tw.t0) / tw.dur), e = ease(u); s3.tx = tw.f.x + (tw.t.x - tw.f.x) * e; s3.ty = tw.f.y + (tw.t.y - tw.f.y) * e; s3.tz = tw.f.z + (tw.t.z - tw.f.z) * e; s3.d = tw.f.d + (tw.t.d - tw.f.d) * e; if (u >= 1) tw = null; }
        var sp = 14 * (s3.d / 800);
        if (keys.w) s3.d = Math.max(120, s3.d - sp * 3); if (keys.s) s3.d = Math.min(4000, s3.d + sp * 3); if (keys.a) s3.th -= 0.02; if (keys.d) s3.th += 0.02;
        if (keys.ArrowLeft) { s3.tx -= sp * Math.cos(s3.th); s3.tz += sp * Math.sin(s3.th); } if (keys.ArrowRight) { s3.tx += sp * Math.cos(s3.th); s3.tz -= sp * Math.sin(s3.th); } if (keys.ArrowUp) s3.ty += sp; if (keys.ArrowDown) s3.ty -= sp;
        if (!reduced && !down && !tw && now - s3.idle > 5000) s3.auto = true; if (s3.auto) s3.th += 0.0012;
        place(); renderer.render(scene, cam); r3 = requestAnimationFrame(render);
      }
      function ndc(e) { var r = el3.getBoundingClientRect(); return new T.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1); }
      function hit(e) { if (!pts) return null; ray.setFromCamera(ndc(e), cam); ray.params.Points.threshold = 16; var h = ray.intersectObject(pts)[0]; return h ? M.stars[h.index] : null; }
      el3.addEventListener('pointerdown', function (e) { stopTour(); down = { x: e.clientX, y: e.clientY, th: s3.th, ph: s3.ph, moved: false }; s3.auto = false; s3.idle = performance.now(); el3.setPointerCapture(e.pointerId); });
      el3.addEventListener('pointermove', function (e) {
        s3.idle = performance.now();
        if (down) { var dx = e.clientX - down.x, dy = e.clientY - down.y; if (Math.abs(dx) + Math.abs(dy) > 4) down.moved = true; s3.th = down.th - dx * 0.006; s3.ph = Math.max(0.15, Math.min(Math.PI - 0.15, down.ph - dy * 0.006)); return; }
        var t = performance.now(); if (t - lastHover < 60) return; lastHover = t; var s = hit(e), r = stage.getBoundingClientRect(); if (s) { tip.textContent = (s.a.title || s.a.url) + '  ·  ' + s.c.name; tip.style.display = 'block'; tip.style.left = Math.min(W - 200, e.clientX - r.left + 12) + 'px'; tip.style.top = (e.clientY - r.top + 12) + 'px'; el3.style.cursor = 'pointer'; } else { tip.style.display = 'none'; el3.style.cursor = 'grab'; }
      });
      el3.addEventListener('pointerup', function (e) { var moved = down && down.moved; down = null; if (moved) return; var s = hit(e); if (s) select(s, true); else select(null); });
      el3.addEventListener('dblclick', function () { reset(); });
      el3.addEventListener('wheel', function (e) { e.preventDefault(); s3.auto = false; s3.idle = performance.now(); s3.d = Math.max(120, Math.min(4000, s3.d * (e.deltaY < 0 ? 0.9 : 1.1))); }, { passive: false });
      el3.addEventListener('keydown', function (e) { var k = e.key.length === 1 ? e.key.toLowerCase() : e.key; if ('wasd'.indexOf(k) >= 0 || k.indexOf('Arrow') === 0) { keys[k] = true; s3.auto = false; s3.idle = performance.now(); e.preventDefault(); } else if (k === 'Escape') { select(null); reset(); } });
      el3.addEventListener('keyup', function (e) { var k = e.key.length === 1 ? e.key.toLowerCase() : e.key; delete keys[k]; });
      el3.addEventListener('blur', function () { keys = {}; });
      rebuild(); s3.d = fitDist(); r3 = requestAnimationFrame(render);
      return {
        rebuild: rebuild, resize: function (w, h) { renderer.setSize(w, h); cam.aspect = w / h; cam.updateProjectionMatrix(); }, reset: reset, flyTo: function (x, y, z, d) { flyTo(x, y, z, d); },
        highlight: function (s) {
          hl = s; if (hiLines) { group.remove(hiLines); hiLines.geometry.dispose(); hiLines.material.dispose(); hiLines = null; }
          if (!s || !s.nb.length) return; var a = p3(s), lp = []; s.nb.forEach(function (n) { var b = p3(n); lp.push(a[0], a[1], a[2], b[0], b[1], b[2]); });
          var g = new T.BufferGeometry(); g.setAttribute('position', new T.Float32BufferAttribute(lp, 3)); hiLines = new T.LineSegments(g, new T.LineBasicMaterial({ color: new T.Color().setHSL(s.hue / 360, 0.9, dark ? 0.8 : 0.4), transparent: true, opacity: 0.9, depthWrite: false })); group.add(hiLines);
        },
        destroy: function () { cancelAnimationFrame(r3); clearGroup(); renderer.dispose(); try { renderer.forceContextLoss(); } catch (e) { /* already gone */ } if (el3.parentNode) el3.parentNode.removeChild(el3); void hl; }
      };
    }

    function chipsFor(clusters) { chips.textContent = ''; clusters.slice(0, 12).forEach(function (c) { var b = btn(c.name + ' ' + c.n, function () { stopTour(); flyCluster(c); }); b.className = 'sky-b sky-chip'; b.style.borderColor = 'hsl(' + c.hue + ',70%,55%)'; chips.appendChild(b); }); }
    function update(items) {
      var first = !M.stars.length; M = model(items); layout = layout === 'timeline' ? 'timeline' : 'constellations';
      M.stars.forEach(function (s) { if (layout === 'timeline') { s.x = s.tx; s.y = s.ty; } });
      if (selected && !M.stars.some(function (s) { return s.id === selected.id; })) select(null); else if (selected) selected = M.stars.filter(function (s) { return s.id === selected.id; })[0] || null;
      focusC = null; chipsFor(M.clusters); note.textContent = items.length ? '' : 'Nothing to show.';
      var fit = fitTo(M.stars.map(pos)); if (first && !reduced) { view = { k: fit.k * 0.35, x: fit.x, y: fit.y }; fly(fit, 2200); } else { view = fit; anim = null; }
      if (t3) t3.rebuild(); frame();
    }
    function destroy() { dead = true; stopTour(); cancelAnimationFrame(raf); if (ro) ro.disconnect(); if (t3) t3.destroy(); host.textContent = ''; }
    document.addEventListener('visibilitychange', function () { if (!document.hidden && !mode3d && !dead) frame(); });
    update(ctx.items());
    return { update: update, destroy: destroy };
  }
  window.AISH_SKY = { mount: mount };
})();
