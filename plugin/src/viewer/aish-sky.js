// AI Summary Helper viewer: the Sky. A full-screen, immersive map of your saved articles: every article is a star, articles that share
// tags pull each other into a handful of named clusters, and you fly through them. Plain JavaScript, loaded only when the Sky is opened.
//   2D: pan, zoom, click a cluster label or a star.
// Everything shown comes from library.json and is drawn as canvas pixels or inserted with textContent. Nothing is inserted as HTML.
(function () {
  'use strict';
  var reduced = false; try { reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) { /* old browser */ }

  function rnd(seed) { var h = 2166136261; for (var i = 0; i < seed.length; i++) { h ^= seed.charCodeAt(i); h = Math.imul(h, 16777619); } return function () { h += 0x6D2B79F5; var t = h; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
  function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
  function dateOf(a) { var t = Date.parse(a.savedAt || ''); return isNaN(t) ? 0 : t; }
  function ease(t) { return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; }
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }

  // ── the model ───────────────────────────────────────────────────────────────────────────────────
  // Tags that say nothing about a topic (a language code, a tag on a tenth of everything) neither bind articles nor name clusters.
  function noiseTag(t, count, N) { var core = String(t).replace(/^[^\p{L}\p{N}]+/u, '').trim().toLowerCase(); return core.length <= 3 && /^[a-z]{2,3}$/.test(core) || count > Math.max(40, N * 0.09) || core === 'general' || core === 'untagged'; }

  function model(items) {
    var N = items.length, byTag = {}, W = items.map(function () { return {}; });
    items.forEach(function (a, i) { (a.tags || []).forEach(function (t) { (byTag[t] = byTag[t] || []).push(i); }); });
    var good = {}, idf = {}; Object.keys(byTag).forEach(function (t) { var n = byTag[t].length; good[t] = !noiseTag(t, n, N); idf[t] = Math.log(1 + N / n); });
    Object.keys(byTag).forEach(function (t) {
      var m = byTag[t]; if (!good[t] || m.length < 2) return;
      for (var x = 0; x < m.length; x++) for (var y = x + 1; y < m.length; y++) { W[m[x]][m[y]] = (W[m[x]][m[y]] || 0) + idf[t]; W[m[y]][m[x]] = W[m[x]][m[y]]; }
    });
    var edges = []; W.forEach(function (row, i) { Object.keys(row).forEach(function (j) { j = +j; if (j > i) edges.push([i, j, row[j]]); }); });

    // force layout (seeded): springs along edges, local repulsion on a grid, a little gravity
    var px = new Float32Array(N), py = new Float32Array(N), vx = new Float32Array(N), vy = new Float32Array(N), R0 = 200 + 18 * Math.sqrt(N), i, j, k;
    items.forEach(function (a, n) { var g = rnd(String(a.id)), an = g() * 6.2832, rr = Math.sqrt(g()) * R0; px[n] = Math.cos(an) * rr; py[n] = Math.sin(an) * rr; });
    var iters = N > 1500 ? 80 : N > 600 ? 150 : 240, cell = 70;
    for (var it = 0; it < iters; it++) {
      var alpha = 1 - it / iters, grid = {};
      for (i = 0; i < N; i++) { var key = Math.floor(px[i] / cell) + ',' + Math.floor(py[i] / cell); (grid[key] = grid[key] || []).push(i); }
      for (i = 0; i < N; i++) {
        var cx = Math.floor(px[i] / cell), cy = Math.floor(py[i] / cell);
        for (var gx = -1; gx <= 1; gx++) for (var gy = -1; gy <= 1; gy++) { var cl = grid[(cx + gx) + ',' + (cy + gy)]; if (!cl) continue; for (k = 0; k < cl.length; k++) { j = cl[k]; if (j <= i) continue; var dx = px[i] - px[j], dy = py[i] - py[j], d2 = dx * dx + dy * dy + 0.01; if (d2 > cell * cell * 2.4) continue; var f = 1700 / d2 * alpha, d = Math.sqrt(d2); vx[i] += dx / d * f; vy[i] += dy / d * f; vx[j] -= dx / d * f; vy[j] -= dy / d * f; } }
      }
      for (var e = 0; e < edges.length; e++) { i = edges[e][0]; j = edges[e][1]; var w = Math.min(edges[e][2], 4), ddx = px[j] - px[i], ddy = py[j] - py[i], dd = Math.sqrt(ddx * ddx + ddy * ddy) + 0.01, target = 52 / (1 + w * 0.4), ff = (dd - target) * 0.011 * w * alpha; vx[i] += ddx / dd * ff; vy[i] += ddy / dd * ff; vx[j] -= ddx / dd * ff; vy[j] -= ddy / dd * ff; }
      for (i = 0; i < N; i++) { vx[i] -= px[i] * 0.0012; vy[i] -= py[i] * 0.0012; vx[i] *= 0.6; vy[i] *= 0.6; px[i] += clamp(vx[i], -30, 30); py[i] += clamp(vy[i], -30, 30); }
    }

    // clusters: label propagation, then merge down to a calm handful (small groups join their strongest neighbour)
    var lab = []; for (i = 0; i < N; i++) lab.push(i);
    var order = []; for (i = 0; i < N; i++) order.push(i); var sr = rnd('order' + N); order.sort(function () { return sr() - 0.5; });
    for (var rep = 0; rep < 14; rep++) { var changed = 0; order.forEach(function (n) { var sum = {}, best = lab[n], bw = 0; Object.keys(W[n]).forEach(function (m) { var l = lab[+m]; sum[l] = (sum[l] || 0) + W[n][m]; if (sum[l] > bw || (sum[l] === bw && l < best)) { bw = sum[l]; best = l; } }); if (best !== lab[n]) { lab[n] = best; changed++; } }); if (!changed) break; }
    var groups = {}; lab.forEach(function (l, n) { (groups[l] = groups[l] || []).push(n); });
    var want = clamp(Math.round(Math.sqrt(N) / 2.4), 4, 12), minSize = Math.max(3, Math.round(N * 0.012));
    function cent(g) { var mx = 0, my = 0; g.forEach(function (n) { mx += px[n]; my += py[n]; }); return [mx / g.length, my / g.length]; }
    for (;;) {
      var keys = Object.keys(groups).sort(function (a, b) { return groups[a].length - groups[b].length; });
      if (keys.length <= 1) break;
      var small = keys[0], sg = groups[small];
      if (keys.length <= want && sg.length >= minSize) break;
      var link = {}; sg.forEach(function (n) { Object.keys(W[n]).forEach(function (m) { var l = lab[+m]; if (l != small) link[l] = (link[l] || 0) + W[n][m]; }); });
      var dest = Object.keys(link).sort(function (a, b) { return link[b] - link[a]; })[0];
      if (dest === undefined) { var c0 = cent(sg), bd = 1e18; keys.forEach(function (kk) { if (kk == small) return; var c1 = cent(groups[kk]), dd2 = Math.pow(c0[0] - c1[0], 2) + Math.pow(c0[1] - c1[1], 2); if (dd2 < bd) { bd = dd2; dest = kk; } }); }
      sg.forEach(function (n) { lab[n] = dest; groups[dest].push(n); }); delete groups[small];
    }
    var ids = Object.keys(groups).sort(function (a, b) { return groups[b].length - groups[a].length || a - b; });
    var clusters = ids.map(function (l, ci) {
      var g = groups[l], score = {}; g.forEach(function (n) { (items[n].tags || []).forEach(function (t) { if (good[t]) score[t] = (score[t] || 0) + 1; }); });
      var tags = Object.keys(score).sort(function (a, b) { return score[b] * idf[b] - score[a] * idf[a]; }), c = cent(g);
      var ds = g.map(function (n) { return Math.hypot(px[n] - c[0], py[n] - c[1]); }).sort(function (a, b) { return a - b; });
      var name = tags.length ? tags[0] + (tags[1] && score[tags[1]] >= g.length * 0.45 ? ' · ' + tags[1] : '') : 'Other';
      return { id: ci, name: name.length > 26 ? name.slice(0, 25) + '…' : name, n: g.length, members: g, hue: (ci * 137.508 + 20) % 360, cx: c[0], cy: c[1], radius: Math.max(50, (ds[Math.floor(ds.length * 0.9)] || 0) + 40), z: (rnd('z' + ci)() - 0.5) * 520, tags: tags.slice(0, 5) };
    });
    var clOf = {}; clusters.forEach(function (c) { c.members.forEach(function (n) { clOf[n] = c; }); });
    var times = items.map(dateOf).filter(Boolean), t0 = Math.min.apply(null, times.concat([Date.now()])), t1 = Math.max.apply(null, times.concat([t0 + 1])), sz = clamp(1.25 - N / 1400, 0.55, 1);
    var stars = items.map(function (a, n) {
      var g = rnd('s' + a.id), c = clOf[n], tt = dateOf(a), words = ((a.summary && a.summary.md) || '').split(/\s+/).length, hl = (a.highlights || []).length, lane = clusters.indexOf(c) - (clusters.length - 1) / 2;
      return { a: a, id: a.id, i: n, c: c, hue: c.hue, r: (2.2 + Math.sqrt(hl * 3 + words / 60)) * sz, cx: px[n], cy: py[n], tx: tt ? ((tt - t0) / (t1 - t0)) * 1000 - 500 : 0, ty: lane * 56 + (g() - 0.5) * 36,
        z: c.z + (g() - 0.5) * 160 + (tt ? ((tt - t0) / (t1 - t0)) * 120 - 60 : 0), ph: g() * 6.28, x: px[n], y: py[n] };
    });
    var links = [];
    clusters.forEach(function (c) {
      var inT = {}, first = c.members[0]; if (first === undefined) return; inT[first] = true; var left = c.members.length - 1;
      while (left > 0) { var bi = -1, bj = -1, bw2 = -1; c.members.forEach(function (a2) { if (!inT[a2]) return; Object.keys(W[a2]).forEach(function (b2) { b2 = +b2; if (inT[b2] || clOf[b2] !== c) return; if (W[a2][b2] > bw2) { bw2 = W[a2][b2]; bi = a2; bj = b2; } }); }); if (bj < 0) break; inT[bj] = true; links.push([stars[bi], stars[bj]]); left--; }
    });
    stars.forEach(function (s) { s.nb = Object.keys(W[s.i]).map(function (m) { return [stars[+m], W[s.i][m]]; }).sort(function (a, b) { return b[1] - a[1]; }).slice(0, 5).map(function (p) { return p[0]; }); });
    return { stars: stars, clusters: clusters, links: links, N: N };
  }

  // ── mount: a full-screen overlay. returns { update(items), setVisible(ids|null), destroy() } ──
  function mount(host, ctx) {
    host.textContent = ''; host.appendChild(el('div', 'sky-note', 'The Sky is open. Press Esc to come back.'));
    var root = el('div', 'sky-fs'), canvas = document.createElement('canvas'), labelLayer = el('div', 'sky-labels'), tip = el('div', 'sky-tip'), caption = el('div', 'sky-caption'), cross = el('div', 'sky-cross'), side = el('aside', 'sky-side'), hint = el('div', 'sky-hint'), legend = el('div', 'sky-legend');
    root.setAttribute('role', 'dialog'); root.setAttribute('aria-label', 'The sky: an immersive map of your saved articles'); root.setAttribute('aria-modal', 'true');
    canvas.tabIndex = 0; canvas.setAttribute('role', 'img'); canvas.setAttribute('aria-label', 'Every star is a saved article; clusters are groups that share tags. Arrow keys move, plus and minus zoom, Tab steps through the stars, Escape leaves.');
    var layout = 'constellations', M = { stars: [], clusters: [], links: [], N: 0 }, vis = null, view = { k: 1, x: 0, y: 0 }, anim = null, morph = null, hover = null, selected = null, focusC = null, tour = null, raf = 0, dead = false, dust = [], lastSig = '', prevOverflow = document.documentElement.style.overflow;
    var dg = rnd('dust'); for (var d = 0; d < 140; d++) dust.push([dg(), dg(), dg() * 1.1 + 0.3, dg() * 6.28]);

    // ── the bar ──
    var bar = el('div', 'sky-bar'), search = document.createElement('input'); search.type = 'search'; search.className = 'sky-search'; search.placeholder = 'Search the sky…'; search.setAttribute('aria-label', 'Search the sky'); search.autocomplete = 'off';
    function btn(label, onClick, pressed, title) { var b = el('button', 'sky-b', label); b.type = 'button'; if (title) b.title = title; if (pressed != null) b.setAttribute('aria-pressed', String(!!pressed)); b.addEventListener('click', onClick); return b; }
    var bExit = btn('✕ Exit', exit, null, 'Back to the list (Esc)'), b2d = btn('2D', function () {}, true), bLay = btn('Timeline', function () { setLayout(layout === 'timeline' ? 'constellations' : 'timeline'); }, false, 'Switch between clusters and a timeline'), bTour = btn('Tour', toggleTour, false, 'Fly through the clusters'), bSurp = btn('Surprise me', surprise), bFs = btn('Full screen', fullscreen);
    bar.append(bExit, search, b2d, bLay, bTour, bSurp, bFs);
    var shown = 0; search.addEventListener('input', function () { clearTimeout(shown); shown = setTimeout(function () { vis = ctx.match ? ctx.match(search.value) : null; applyVis(); }, 120); });
    root.append(canvas, labelLayer, cross, tip, caption, legend, hint, side, bar); document.body.appendChild(root); document.documentElement.style.overflow = 'hidden';
    var ctx2 = canvas.getContext('2d'), W = 0, H = 0, dpr = Math.min(2, window.devicePixelRatio || 1);
    function size() { W = root.clientWidth || window.innerWidth; H = root.clientHeight || window.innerHeight; canvas.width = W * dpr; canvas.height = H * dpr; canvas.style.width = W + 'px'; canvas.style.height = H + 'px'; }
    window.addEventListener('resize', size); size();
    function inVis(s) { return !vis || vis.has(s.id); }
    function applyVis() { frame(); }

    function pos(s) { return [s.x, s.y]; }
    function toScreen(p) { return [W / 2 + (p[0] + view.x) * view.k, H / 2 + (p[1] + view.y) * view.k]; }
    function fitTo(pts, pad) { if (!pts.length) return { k: 1, x: 0, y: 0 }; var x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9; pts.forEach(function (p) { x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]); y0 = Math.min(y0, p[1]); y1 = Math.max(y1, p[1]); }); var bw = Math.max(80, x1 - x0) + (pad || 160), bh = Math.max(80, y1 - y0) + (pad || 160); return { k: clamp(Math.min(W / bw, (H - 80) / bh), 0.15, 6), x: -(x0 + x1) / 2, y: -(y0 + y1) / 2 + 20 }; }
    function allPts() { return M.stars.map(pos); }
    function fly(to, ms) { if (reduced || !ms) { view = { k: to.k, x: to.x, y: to.y }; anim = null; frame(); return; } anim = { f: { k: view.k, x: view.x, y: view.y }, t: to, t0: performance.now(), d: ms }; frame(); }
    function flyAll() { focusC = null; select(null); caption.style.opacity = 0; fly(fitTo(allPts()), 1100); }
    function flyCluster(c) { focusC = c; select(null); fly(fitTo(c.members.map(function (n) { return pos(M.stars[n]); }), 200), 1200); caption.textContent = c.name + ' · ' + c.n + ' articles'; caption.style.opacity = 1; frame(); }
    function setLayout(l) {
      if (l === layout) return; layout = l; bLay.setAttribute('aria-pressed', String(l === 'timeline')); bLay.textContent = l === 'timeline' ? 'Clusters' : 'Timeline';
      M.stars.forEach(function (s) { s.fx = s.x; s.fy = s.y; s.gx = l === 'timeline' ? s.tx : s.cx; s.gy = l === 'timeline' ? s.ty : s.cy; });
      morph = { t0: performance.now(), d: reduced ? 1 : 1100 }; focusC = null; fly(fitTo(M.stars.map(function (s) { return l === 'timeline' ? [s.tx, s.ty] : [s.cx, s.cy]; })), 1100);
    }
    function clusterAnchor(c) { if (layout === 'timeline') { var y = c.members.reduce(function (a, n) { return a + M.stars[n].ty; }, 0) / c.n; return [-540, y]; } return [c.cx, c.cy - c.radius * 0.55]; }

    // ── labels: a few, never on top of each other, bigger clusters first ──
    var labelEls = {};
    function placeLabels(project) {
      var cand = M.clusters.map(function (c) { var p = project(c); return p && { c: c, x: p[0], y: p[1], depth: p[2] }; }).filter(Boolean).sort(function (a, b) { return b.c.n - a.c.n; });
      var taken = [], count = 0, seen = {};
      cand.forEach(function (o) {
        var c = o.c, e = labelEls[c.id]; if (!e) { e = el('button', 'sky-label', c.name); e.type = 'button'; e.style.color = 'hsl(' + c.hue + ',85%,78%)'; e.addEventListener('click', function () { stopTour(); flyCluster(c); }); labelEls[c.id] = e; labelLayer.appendChild(e); }
        var fs = clamp(12 + Math.sqrt(c.n) * 1.5, 13, 24), w = c.name.length * fs * 0.58 + 16, h = fs + 10, x0 = o.x - w / 2, y0 = o.y - h / 2, ok = o.x > -20 && o.x < W + 20 && o.y > 50 && o.y < H - 30 && count < 14;
        if (ok) for (var q = 0; q < taken.length; q++) { var t = taken[q]; if (x0 < t[2] + 8 && x0 + w + 8 > t[0] && y0 < t[3] + 4 && y0 + h + 4 > t[1]) { ok = false; break; } }
        var dim = focusC && focusC !== c ? 0.3 : 1;
        if (ok) { taken.push([x0, y0, x0 + w, y0 + h]); count++; seen[c.id] = 1; e.style.display = ''; e.style.transform = 'translate(' + (o.x | 0) + 'px,' + (o.y | 0) + 'px) translate(-50%,-50%)'; e.style.fontSize = fs + 'px'; e.style.opacity = clamp(o.depth, 0.15, 1) * dim; } else e.style.display = 'none';
      });
      Object.keys(labelEls).forEach(function (id) { if (!seen[id]) labelEls[id].style.display = 'none'; });
    }
    function labels2d() { var fade = clamp((3.4 - view.k) / 1.4, 0, 1); placeLabels(function (c) { var p = toScreen(clusterAnchor(c)); return [p[0], p[1], fade < 0.05 ? 0 : fade]; }); }

    // ── 2D drawing ──
    function draw(now) {
      if (anim) { var u = Math.min(1, (now - anim.t0) / anim.d), e = ease(u); view.k = anim.f.k + (anim.t.k - anim.f.k) * e; view.x = anim.f.x + (anim.t.x - anim.f.x) * e; view.y = anim.f.y + (anim.t.y - anim.f.y) * e; if (u >= 1) anim = null; }
      if (morph) { var mu = Math.min(1, (now - morph.t0) / morph.d), me = ease(mu); M.stars.forEach(function (s) { s.x = s.fx + (s.gx - s.fx) * me; s.y = s.fy + (s.gy - s.fy) * me; }); if (mu >= 1) morph = null; }
      ctx2.setTransform(dpr, 0, 0, dpr, 0, 0);
      var bg = ctx2.createRadialGradient(W / 2, H / 2, 20, W / 2, H / 2, Math.max(W, H) * 0.8); bg.addColorStop(0, '#0c1226'); bg.addColorStop(1, '#03050b'); ctx2.fillStyle = bg; ctx2.fillRect(0, 0, W, H);
      dust.forEach(function (p) { var x = ((p[0] * W + view.x * view.k * 0.12) % W + W) % W, y = ((p[1] * H + view.y * view.k * 0.12) % H + H) % H, a = 0.2 + 0.3 * (reduced ? 1 : 0.5 + 0.5 * Math.sin(now / 1300 + p[3])); ctx2.fillStyle = 'rgba(200,215,255,' + a + ')'; ctx2.fillRect(x, y, p[2], p[2]); });
      var calm = 1 / (1 + M.N / 500);   // many stars: every glow gets quieter, so the sum does not blow out
      ctx2.globalCompositeOperation = 'lighter';
      if (layout === 'constellations') M.clusters.forEach(function (c) {
        var pc = toScreen([c.cx, c.cy]), g2 = rnd('n' + c.id), breathe = reduced ? 1 : 1 + 0.03 * Math.sin(now / 2600 + c.id), on = (focusC === c) ? 1.7 : 1;
        for (var b = 0; b < 2; b++) { var ox = (g2() - 0.5) * c.radius * 0.5 * view.k, oy = (g2() - 0.5) * c.radius * 0.5 * view.k, rr = c.radius * (0.9 + g2() * 0.5) * view.k * breathe; if (pc[0] + ox + rr < 0 || pc[0] + ox - rr > W || pc[1] + oy + rr < 0 || pc[1] + oy - rr > H) continue; var g = ctx2.createRadialGradient(pc[0] + ox, pc[1] + oy, 0, pc[0] + ox, pc[1] + oy, rr); g.addColorStop(0, 'hsla(' + c.hue + ',85%,55%,' + 0.16 * calm * on + ')'); g.addColorStop(0.6, 'hsla(' + c.hue + ',80%,50%,' + 0.05 * calm * on + ')'); g.addColorStop(1, 'hsla(' + c.hue + ',80%,50%,0)'); ctx2.fillStyle = g; ctx2.beginPath(); ctx2.arc(pc[0] + ox, pc[1] + oy, rr, 0, 6.283); ctx2.fill(); }
      });
      ctx2.globalCompositeOperation = 'source-over';
      var focus = selected || hover, nbSet = focus ? focus.nb : [];
      if (view.k > 0.7 || focusC) { ctx2.lineWidth = 1; M.links.forEach(function (l) { if (focusC && l[0].c !== focusC) return; var a = toScreen(pos(l[0])), b = toScreen(pos(l[1])); if ((a[0] < 0 && b[0] < 0) || (a[0] > W && b[0] > W) || (a[1] < 0 && b[1] < 0) || (a[1] > H && b[1] > H)) return; ctx2.strokeStyle = 'hsla(' + l[0].hue + ',75%,70%,0.2)'; ctx2.beginPath(); ctx2.moveTo(a[0], a[1]); ctx2.lineTo(b[0], b[1]); ctx2.stroke(); }); }
      if (focus) { var fp = toScreen(pos(focus)); ctx2.lineWidth = 1.5; ctx2.setLineDash([4, 4]); nbSet.forEach(function (n) { var p = toScreen(pos(n)); ctx2.strokeStyle = 'hsla(' + focus.hue + ',90%,80%,0.85)'; ctx2.beginPath(); ctx2.moveTo(fp[0], fp[1]); ctx2.lineTo(p[0], p[1]); ctx2.stroke(); }); ctx2.setLineDash([]); }
      var near = {}; nbSet.forEach(function (n) { near[n.id] = 1; });
      M.stars.forEach(function (s) {
        var p = toScreen(pos(s)); if (p[0] < -30 || p[1] < -30 || p[0] > W + 30 || p[1] > H + 30) return;
        var on = s === hover || s === selected, nb = near[s.id], ok = inVis(s), dim = (ok ? 1 : 0.1) * (focusC && s.c !== focusC && !on ? 0.4 : 1), tw = reduced ? 1 : 0.85 + 0.15 * Math.sin(now / 900 + s.ph);
        var r = Math.max(1.3, s.r * Math.sqrt(view.k)) * (on ? 1.6 : nb ? 1.3 : 1), halo = r * (on ? 5 : 3);
        var g = ctx2.createRadialGradient(p[0], p[1], 0, p[0], p[1], halo); g.addColorStop(0, 'hsla(' + s.hue + ',90%,82%,' + (0.9 * tw * dim) + ')'); g.addColorStop(0.4, 'hsla(' + s.hue + ',90%,64%,' + (0.28 * tw * dim) + ')'); g.addColorStop(1, 'hsla(' + s.hue + ',90%,60%,0)');
        ctx2.fillStyle = g; ctx2.beginPath(); ctx2.arc(p[0], p[1], halo, 0, 6.283); ctx2.fill();
        ctx2.fillStyle = 'rgba(255,255,255,' + dim + ')'; ctx2.beginPath(); ctx2.arc(p[0], p[1], r * (on ? 1.1 : 0.8), 0, 6.283); ctx2.fill();
        if (s === selected) { var pr = reduced ? 1 : (now % 1800) / 1800; ctx2.strokeStyle = 'hsla(' + s.hue + ',90%,80%,' + (1 - pr) * 0.8 + ')'; ctx2.lineWidth = 1.5; ctx2.beginPath(); ctx2.arc(p[0], p[1], r * (2 + pr * 4), 0, 6.283); ctx2.stroke(); }
      });
      if (focus) { ctx2.textBaseline = 'middle'; ctx2.textAlign = 'center'; [focus].concat(nbSet).forEach(function (s, i) { var p = toScreen(pos(s)), t = (s.a.title || '').slice(0, 34) + ((s.a.title || '').length > 34 ? '…' : ''); ctx2.font = (i ? '500 11px' : '700 12px') + ' system-ui, sans-serif'; var w = ctx2.measureText(t).width + 12; ctx2.fillStyle = 'rgba(8,12,24,.82)'; ctx2.fillRect(p[0] - w / 2, p[1] + 10, w, 18); ctx2.fillStyle = '#e8edf5'; ctx2.fillText(t, p[0], p[1] + 19); }); }
      labels2d();
    }
    function loop(now) { if (dead) return; draw(now); raf = (!reduced && !document.hidden) || anim || morph ? requestAnimationFrame(loop) : 0; }
    function frame() { cancelAnimationFrame(raf); raf = requestAnimationFrame(loop); }

    // ── pointer and keyboard (2D) ──
    function pick(mx, my) { var best = null, bd = 22 * 22; M.stars.forEach(function (s) { if (!inVis(s)) return; var p = toScreen(pos(s)), dd = (p[0] - mx) * (p[0] - mx) + (p[1] - my) * (p[1] - my); if (dd < bd) { bd = dd; best = s; } }); return best; }
    var drag = null;
    canvas.addEventListener('pointerdown', function (e) { stopTour(); anim = null; drag = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y, moved: false }; canvas.setPointerCapture(e.pointerId); canvas.style.cursor = 'grabbing'; });
    canvas.addEventListener('pointermove', function (e) {
      var mx = e.clientX, my = e.clientY;
      if (drag) { var dx = e.clientX - drag.x, dy = e.clientY - drag.y; if (Math.abs(dx) + Math.abs(dy) > 4) drag.moved = true; if (drag.moved) { view.x = drag.vx + dx / view.k; view.y = drag.vy + dy / view.k; frame(); return; } }
      hover = pick(mx, my); canvas.style.cursor = hover ? 'pointer' : 'grab';
      if (hover) { tip.textContent = (hover.a.title || hover.a.url) + '  ·  ' + hover.c.name; tip.style.display = 'block'; tip.style.left = Math.min(W - 260, mx + 14) + 'px'; tip.style.top = (my + 14) + 'px'; } else tip.style.display = 'none';
      frame();
    });
    canvas.addEventListener('pointerup', function (e) { var moved = drag && drag.moved; drag = null; canvas.style.cursor = 'grab'; if (moved) return; var s = pick(e.clientX, e.clientY); if (s) select(s, true); else select(null); });
    canvas.addEventListener('dblclick', function () { flyAll(); });
    canvas.addEventListener('pointerleave', function () { hover = null; tip.style.display = 'none'; frame(); });
    canvas.addEventListener('wheel', function (e) { e.preventDefault(); stopTour(); var mx = e.clientX - W / 2, my = e.clientY - H / 2, f = e.deltaY < 0 ? 1.16 : 1 / 1.16, k2 = clamp(view.k * f, 0.12, 9); view.x += mx / k2 - mx / view.k; view.y += my / k2 - my / view.k; view.k = k2; anim = null; frame(); }, { passive: false });
    function onKey(e) {
      if (dead) return;
      if (document.activeElement === search) { if (e.key === 'Escape') { search.value = ''; vis = null; applyVis(); search.blur(); e.stopPropagation(); } return; }
      var k = e.key, step = 60 / view.k, ok = true;
      if (k === 'Escape') { if (selected) select(null); else if (focusC) flyAll(); else exit(); }
      else if (k === '/') { search.focus(); e.preventDefault(); return; }
      else if (k === 'ArrowLeft') view.x += step; else if (k === 'ArrowRight') view.x -= step; else if (k === 'ArrowUp') view.y += step; else if (k === 'ArrowDown') view.y -= step;
      else if (k === '+' || k === '=') view.k = Math.min(9, view.k * 1.2); else if (k === '-') view.k = Math.max(0.12, view.k / 1.2);
      else if (k === 'Tab') { ok = false; var list = M.stars.filter(inVis).sort(function (a, b) { return a.c.id - b.c.id || a.x - b.x; }), i = selected ? list.indexOf(selected) : -1, nx = list[(i + (e.shiftKey ? -1 : 1) + list.length) % list.length]; if (nx) { e.preventDefault(); select(nx, true); } }
      else ok = false;
      if (ok) { e.preventDefault(); anim = null; frame(); }
    }
    document.addEventListener('keydown', onKey, true);

    function select(s, flyTo) {
      selected = s; side.textContent = ''; side.classList.toggle('open', !!s); if (!s) { frame(); return; }
      var close = el('button', 'sky-close', '✕ Close'); close.type = 'button'; close.addEventListener('click', function () { select(null); });
      side.append(close, ctx.card(s.a));
      if (flyTo) fly({ k: Math.max(view.k, 1.9), x: -s.x - 90 / Math.max(view.k, 1.9), y: -s.y }, 900);
      frame();
    }
    function surprise() { stopTour(); var pool = M.stars.filter(inVis); if (!pool.length) return; pool.sort(function (a, b) { return (b.a.highlights || []).length - (a.a.highlights || []).length; }); var s = pool[Math.floor(Math.random() * Math.min(pool.length, 40))]; focusC = null; select(s, true); caption.textContent = 'A star from ' + s.c.name; caption.style.opacity = 1; }
    function toggleTour() { if (tour) return stopTour(); if (!M.clusters.length) return; if (reduced) { hint.textContent = 'The tour moves the camera by itself, so it is off while reduced motion is on. Click the cluster names instead.'; return; } tour = { i: 0, timer: 0 }; bTour.setAttribute('aria-pressed', 'true'); tourStep(); }
    function tourStep() { if (!tour) return; flyCluster(M.clusters[tour.i % M.clusters.length]); tour.i++; tour.timer = setTimeout(tourStep, 4600); }
    function stopTour() { if (!tour) return; clearTimeout(tour.timer); tour = null; bTour.setAttribute('aria-pressed', 'false'); caption.style.opacity = 0; }
    function fullscreen() { try { if (document.fullscreenElement) document.exitFullscreen(); else root.requestFullscreen(); } catch (e) { /* not allowed here */ } }

    function legendFor() { legend.textContent = ''; M.clusters.slice(0, 10).forEach(function (c) { var b = el('button', 'sky-leg'); b.type = 'button'; var dot = el('i'); dot.style.background = 'hsl(' + c.hue + ',85%,62%)'; b.append(dot, document.createTextNode(c.name), el('span', null, String(c.n))); b.addEventListener('click', function () { stopTour(); flyCluster(c); }); legend.appendChild(b); }); }
    function setHint() { hint.textContent = 'Drag to move · scroll to zoom · click a name or a star · / to search'; }
    function update(items) {
      var sig = items.length + ':' + (items[0] && items[0].id) + ':' + (items[items.length - 1] && items[items.length - 1].id);
      if (sig === lastSig && M.stars.length) { applyVis(); return; }
      lastSig = sig; var first = !M.stars.length; M = model(items); legendFor();
      if (selected) selected = M.stars.filter(function (s) { return s.id === selected.id; })[0] || null;
      focusC = null; var fit = fitTo(M.stars.map(function (s) { return layout === 'timeline' ? [s.tx, s.ty] : [s.cx, s.cy]; }));
      M.stars.forEach(function (s) { if (layout === 'timeline') { s.x = s.tx; s.y = s.ty; } });
      if (first && !reduced) { view = { k: fit.k * 0.3, x: fit.x, y: fit.y }; fly(fit, 2400); } else { view = fit; anim = null; }
      setHint(); frame();
    }
    function exit() { destroy(); if (ctx.exit) ctx.exit(); }
    function destroy() { if (dead) return; dead = true; stopTour(); cancelAnimationFrame(raf); window.removeEventListener('resize', size); document.removeEventListener('keydown', onKey, true); try { if (document.fullscreenElement) document.exitFullscreen(); } catch (e) { /* none */ } document.documentElement.style.overflow = prevOverflow; if (root.parentNode) root.parentNode.removeChild(root); host.textContent = ''; }
    update(ctx.all()); if (ctx.match) { vis = null; }
    return { update: update, setVisible: function (ids) { vis = ids; applyVis(); }, destroy: destroy };
  }
  window.AISH_SKY = { mount: mount };
})();
