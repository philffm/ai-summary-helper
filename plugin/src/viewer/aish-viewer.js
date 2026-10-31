// AI Summary Helper: reading list viewer. Plain JavaScript, no build step. Reads library.json from the same folder.
// Safety: every value from library.json is inserted with textContent or createTextNode, never as HTML. Links are http(s) only.
(function () {
  'use strict';
  var D3_URL = 'https://cdn.jsdelivr.net/npm/d3@7.9.0/dist/d3.min.js';
  var D3_SRI = 'sha384-CjloA8y00+1SDAUkjs099PVfnY2KmDC2BZnws9kh8D/lX1s46w6EPhpXdqMfjK6i';
  var state = { all: [], notes: [], q: '', tags: {}, sort: 'new', view: 'list', month: '' };
  var $ = function (id) { return document.getElementById(id); };

  function h(tag, attrs, kids) {
    var e = document.createElement(tag);
    for (var k in attrs || {}) { if (k === 'text') e.textContent = attrs[k]; else if (k === 'class') e.className = attrs[k]; else e.setAttribute(k, attrs[k]); }
    (kids || []).forEach(function (c) { if (c != null) e.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
    return e;
  }
  function safeUrl(u) { try { var x = new URL(String(u), location.href); return x.protocol === 'http:' || x.protocol === 'https:' ? x.href : ''; } catch (e) { return ''; } }
  function dateOf(a) { var t = Date.parse(a.savedAt || ''); return isNaN(t) ? 0 : t; }
  function fmt(t) { return t ? new Date(t).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : ''; }
  function monthOf(a) { var t = dateOf(a); if (!t) return ''; var d = new Date(t); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0'); }

  // tiny Markdown: paragraphs, "- " lists, #-headings, **bold**, *italic*, [text](http link). Builds nodes, never HTML.
  function inline(text, into) {
    var re = /(\*\*[^*]+\*\*|\*[^*]+\*|\[[^\]]+\]\([^)\s]+\))/g, last = 0, m;
    while ((m = re.exec(text))) {
      if (m.index > last) into.appendChild(document.createTextNode(text.slice(last, m.index)));
      var tok = m[0];
      if (tok.slice(0, 2) === '**') into.appendChild(h('strong', { text: tok.slice(2, -2) }));
      else if (tok[0] === '*') into.appendChild(h('em', { text: tok.slice(1, -1) }));
      else { var mm = /^\[([^\]]+)\]\(([^)\s]+)\)$/.exec(tok), href = safeUrl(mm[2]); into.appendChild(href ? h('a', { href: href, rel: 'noopener noreferrer nofollow', target: '_blank', text: mm[1] }) : document.createTextNode(mm[1])); }
      last = m.index + tok.length;
    }
    if (last < text.length) into.appendChild(document.createTextNode(text.slice(last)));
  }
  function markdown(md) {
    var box = h('div'), blocks = String(md || '').replace(/\r/g, '').split(/\n{2,}/);
    blocks.forEach(function (b) {
      b = b.trim(); if (!b) return;
      var lines = b.split('\n');
      if (lines.every(function (l) { return /^\s*[-*]\s+/.test(l); })) { var ul = h('ul'); lines.forEach(function (l) { var li = h('li'); inline(l.replace(/^\s*[-*]\s+/, ''), li); ul.appendChild(li); }); box.appendChild(ul); }
      else if (/^#{1,6}\s/.test(b)) { var hh = h('h4'); inline(b.replace(/^#{1,6}\s+/, ''), hh); box.appendChild(hh); }
      else { var p = h('p'); inline(lines.join(' '), p); box.appendChild(p); }
    });
    return box;
  }

  function haystack(a) {
    if (a._h) return a._h;
    var parts = [a.title, a.site, a.author, (a.tags || []).join(' '), a.summary && a.summary.md, (a.highlights || []).map(function (x) { return x.text; }).join(' '), (a.qa || []).map(function (x) { return x.q + ' ' + x.a; }).join(' ')];
    a._h = parts.filter(Boolean).join(' ').toLowerCase();
    return a._h;
  }
  function visible() {
    var q = state.q.trim().toLowerCase(), want = Object.keys(state.tags);
    var out = state.all.filter(function (a) {
      if (q && !q.split(/\s+/).every(function (w) { return haystack(a).indexOf(w) >= 0; })) return false;
      if (want.length && !want.every(function (t) { return (a.tags || []).indexOf(t) >= 0; })) return false;
      if (state.month && monthOf(a) !== state.month) return false;
      return true;
    });
    out.sort(function (x, y) { return state.sort === 'old' ? dateOf(x) - dateOf(y) : state.sort === 'title' ? String(x.title).localeCompare(String(y.title)) : dateOf(y) - dateOf(x); });
    return out;
  }

  function card(a) {
    var title = h('h2'), href = safeUrl(a.url);
    title.appendChild(href ? h('a', { href: href, rel: 'noopener noreferrer', target: '_blank', text: a.title || href }) : document.createTextNode(a.title || 'Untitled'));
    var meta = h('div', { class: 'meta' }, [a.site, fmt(dateOf(a)), a.author, a.reminder && ('\u{1F516} ' + a.reminder.timeframe + (a.reminder.reason ? ': ' + a.reminder.reason : ''))].filter(Boolean).map(function (t) { return h('span', { text: t }); }));
    var c = h('article', { class: 'card' }, [title, meta]);
    if (a.summary && a.summary.md) {
      var s = markdown(a.summary.md); s.className = 'sum clamp'; c.appendChild(s);
      var more = h('button', { type: 'button', class: 'more', text: 'Read more', 'aria-expanded': 'false' });
      more.addEventListener('click', function () { var open = s.classList.toggle('clamp'); more.textContent = open ? 'Read more' : 'Show less'; more.setAttribute('aria-expanded', String(!open)); });
      c.appendChild(more);
    }
    if ((a.highlights || []).length) {
      var ul = h('ul', { class: 'hl' });
      a.highlights.forEach(function (x) { var li = h('li', { class: x.type === 'ghost' ? 'ghost' : '', text: x.text }); if (x.comment) li.appendChild(h('div', { class: 'cm', text: '\u{1F4AC} ' + x.comment })); ul.appendChild(li); });
      c.appendChild(ul);
    }
    if (a.hasText) c.appendChild(fullText(a));
    if ((a.tags || []).length) {
      var tg = h('div', { class: 'tags' });
      a.tags.forEach(function (t) { var b = h('button', { type: 'button', class: 'tag', 'aria-pressed': String(!!state.tags[t]), text: t }); b.addEventListener('click', function () { toggleTag(t); }); tg.appendChild(b); });
      c.appendChild(tg);
    }
    return c;
  }

  // full text lives in the article's own file; fetched only when someone asks for it, shown as plain paragraphs
  function fullText(a) {
    var wrap = h('div'), btn = h('button', { type: 'button', class: 'more', text: 'Read the full text', 'aria-expanded': 'false' }), box = h('div', { class: 'sum' }), loaded = false;
    btn.addEventListener('click', function () {
      var open = btn.getAttribute('aria-expanded') !== 'true';
      btn.setAttribute('aria-expanded', String(open)); btn.textContent = open ? 'Hide the full text' : 'Read the full text'; box.hidden = !open;
      if (!open || loaded) return; loaded = true; box.textContent = 'Loading…';
      if (fromDisk) { box.textContent = 'The full text needs this page to be opened from a web server, not from disk.'; loaded = false; return; }
      fetch('articles/' + String(a.id).replace(/[^A-Za-z0-9_.-]/g, '_') + '.json', { cache: 'no-store' }).then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); }).then(function (f) {
        box.textContent = ''; (f.blocks || []).forEach(function (b) { box.appendChild(h(b[0] === 'h2' || b[0] === 'h3' ? 'h4' : 'p', { text: b[1] })); });
      }).catch(function () { box.textContent = 'The full text could not be loaded.'; loaded = false; });
    });
    box.hidden = true; wrap.appendChild(btn); wrap.appendChild(box); return wrap;
  }

  function renderNotes(box) {
    var notes = state.notes.filter(function (n) { var q = state.q.trim().toLowerCase(); return !q || (n.text + ' ' + (n.tags || []).join(' ')).toLowerCase().indexOf(q) >= 0; });
    $('count').textContent = notes.length + ' notes';
    notes.forEach(function (n) {
      var c = h('article', { class: 'card' }, [h('p', { class: 'sum', text: n.text }), h('div', { class: 'meta' }, [fmt(Date.parse(n.created))].filter(Boolean).map(function (t) { return h('span', { text: t }); }))]);
      if (n.quote) c.insertBefore(h('p', { class: 'sum', text: '\u201C' + n.quote + '\u201D' }), c.firstChild);
      box.appendChild(c);
    });
    if (!notes.length) box.appendChild(h('div', { class: 'note', text: 'No notes.' }));
  }

  function tagCounts() {
    var n = {}; state.all.forEach(function (a) { (a.tags || []).forEach(function (t) { n[t] = (n[t] || 0) + 1; }); });
    return Object.keys(n).map(function (t) { return { tag: t, n: n[t] }; }).sort(function (a, b) { return b.n - a.n || a.tag.localeCompare(b.tag); });
  }
  function renderTags() {
    var box = $('tags'); box.textContent = '';
    tagCounts().slice(0, 40).forEach(function (t) {
      var b = h('button', { type: 'button', class: 'tag', 'aria-pressed': String(!!state.tags[t.tag]) }, [t.tag, h('small', { text: String(t.n) })]);
      b.addEventListener('click', function () { toggleTag(t.tag); }); box.appendChild(b);
    });
  }
  function toggleTag(t) { if (state.tags[t]) delete state.tags[t]; else state.tags[t] = true; render(); }

  var d3Promise = null;
  function loadD3() {
    if (window.d3) return Promise.resolve(window.d3);
    if (!d3Promise) d3Promise = new Promise(function (res, rej) {
      var s = document.createElement('script'); s.src = D3_URL; s.integrity = D3_SRI; s.crossOrigin = 'anonymous';
      s.onload = function () { res(window.d3); }; s.onerror = function () { d3Promise = null; rej(new Error('d3 could not be loaded (offline or blocked).')); };
      document.head.appendChild(s);
    });
    return d3Promise;
  }
  function note(text, cls) { var n = h('div', { class: 'note' + (cls ? ' ' + cls : ''), text: text }); $('extra').textContent = ''; $('extra').appendChild(n); }

  // the Sky: every article a star (aish-sky.js, loaded only here). The list below stays, as the accessible version of the same stars.
  var skyPromise = null, sky = null;
  function loadSky() {
    if (window.AISH_SKY) return Promise.resolve(window.AISH_SKY);
    if (!skyPromise) skyPromise = new Promise(function (res, rej) { var s = document.createElement('script'); s.src = 'aish-sky.js'; s.onload = function () { res(window.AISH_SKY); }; s.onerror = function () { skyPromise = null; rej(new Error('aish-sky.js is missing next to this page.')); }; document.head.appendChild(s); });
    return skyPromise;
  }
  function showSky() {
    loadSky().then(function (S) {
      if (state.view !== 'sky') return;
      if (sky) { sky.update(state.all); return; }
      $('extra').textContent = '';
      sky = S.mount($('extra'), {
        all: function () { return state.all; }, card: card,
        match: function (q) { q = q.trim().toLowerCase(); if (!q) return null; var ws = q.split(/\s+/), ids = new Set(); state.all.forEach(function (a) { var hs = haystack(a); if (ws.every(function (w) { return hs.indexOf(w) >= 0; })) ids.add(a.id); }); return ids; },
        exit: function () { sky = null; state.view = 'list'; try { history.replaceState(null, '', '#list'); } catch (e) { /* file:// */ } render(); }
      });
    }).catch(function (e) { note(e.message, 'err'); });
  }
  function leaveSky() { if (sky) { sky.destroy(); sky = null; } }

  function drawTimeline(d3) {
    var counts = {}; state.all.forEach(function (a) { var m = monthOf(a); if (m) counts[m] = (counts[m] || 0) + 1; });
    var months = Object.keys(counts).sort(); if (!months.length) return note('No dates to draw.');
    var W = 900, H = 220, m = { t: 14, r: 10, b: 30, l: 34 };
    var x = d3.scaleBand().domain(months).range([m.l, W - m.r]).padding(.15), y = d3.scaleLinear().domain([0, d3.max(months, function (k) { return counts[k]; })]).nice().range([H - m.b, m.t]);
    var svg = d3.create('svg').attr('viewBox', '0 0 ' + W + ' ' + H).attr('role', 'img').attr('aria-label', 'Articles saved per month');
    svg.append('g').attr('transform', 'translate(0,' + (H - m.b) + ')').call(d3.axisBottom(x).tickValues(months.filter(function (_, i) { return i % Math.ceil(months.length / 12) === 0; }))).selectAll('text').style('fill', 'currentColor');
    svg.append('g').attr('transform', 'translate(' + m.l + ',0)').call(d3.axisLeft(y).ticks(4)).selectAll('text').style('fill', 'currentColor');
    svg.selectAll('rect').data(months).join('rect').attr('x', function (k) { return x(k); }).attr('y', function (k) { return y(counts[k]); }).attr('width', x.bandwidth()).attr('height', function (k) { return y(0) - y(counts[k]); })
      .attr('rx', 3).attr('fill', function (k) { return k === state.month ? '#eab308' : 'var(--accent)'; }).style('cursor', 'pointer')
      .on('click', function (_, k) { state.month = state.month === k ? '' : k; render(); }).append('title').text(function (k) { return k + ': ' + counts[k]; });
    svg.selectAll('.domain, .tick line').attr('stroke', 'currentColor').attr('opacity', .4);
    var box = h('div', { class: 'chart' }); box.style.color = 'var(--muted)'; box.appendChild(svg.node());
    $('extra').textContent = ''; $('extra').appendChild(box);
    $('extra').appendChild(h('div', { class: 'note', text: state.month ? 'Showing ' + state.month + '. Click the bar again to clear.' : 'Click a bar to show that month.' }));
  }

  function drawGraph(d3) {
    var top = tagCounts().slice(0, 60); if (top.length < 2) return note('Not enough tags to draw a graph.');
    var idx = {}; top.forEach(function (t, i) { idx[t.tag] = i; });
    var pair = {};
    state.all.forEach(function (a) { var ts = (a.tags || []).filter(function (t) { return t in idx; }); for (var i = 0; i < ts.length; i++) for (var j = i + 1; j < ts.length; j++) { var k = ts[i] < ts[j] ? ts[i] + '\u0000' + ts[j] : ts[j] + '\u0000' + ts[i]; pair[k] = (pair[k] || 0) + 1; } });
    var nodes = top.map(function (t) { return { id: t.tag, n: t.n }; });
    var links = Object.keys(pair).map(function (k) { var p = k.split('\u0000'); return { source: p[0], target: p[1], w: pair[k] }; });
    var W = 900, H = 520, r = d3.scaleSqrt().domain([1, top[0].n]).range([5, 26]);
    var svg = d3.create('svg').attr('viewBox', '0 0 ' + W + ' ' + H).attr('role', 'img').attr('aria-label', 'Tags that appear together');
    var link = svg.append('g').attr('stroke', 'currentColor').attr('stroke-opacity', .25).selectAll('line').data(links).join('line').attr('stroke-width', function (l) { return Math.min(6, 1 + l.w * .6); });
    var node = svg.append('g').selectAll('g').data(nodes).join('g').style('cursor', 'pointer').on('click', function (_, d) { toggleTag(d.id); });
    node.append('circle').attr('r', function (d) { return r(d.n); }).attr('fill', function (d) { return state.tags[d.id] ? '#eab308' : 'var(--accent)'; }).attr('fill-opacity', .85);
    node.append('text').text(function (d) { return d.id; }).attr('text-anchor', 'middle').attr('dy', function (d) { return r(d.n) + 12; }).attr('font-size', 11).style('fill', 'currentColor');
    node.append('title').text(function (d) { return d.id + ': ' + d.n + ' articles'; });
    var sim = d3.forceSimulation(nodes).force('link', d3.forceLink(links).id(function (d) { return d.id; }).distance(120).strength(.3)).force('charge', d3.forceManyBody().strength(-320)).force('center', d3.forceCenter(W / 2, H / 2)).force('collide', d3.forceCollide(function (d) { return r(d.n) + 8; }));
    node.call(d3.drag().on('start', function (e, d) { if (!e.active) sim.alphaTarget(.3).restart(); d.fx = d.x; d.fy = d.y; }).on('drag', function (e, d) { d.fx = e.x; d.fy = e.y; }).on('end', function (e, d) { if (!e.active) sim.alphaTarget(0); d.fx = null; d.fy = null; }));
    sim.on('tick', function () {
      nodes.forEach(function (d) { d.x = Math.max(30, Math.min(W - 30, d.x)); d.y = Math.max(20, Math.min(H - 30, d.y)); });
      link.attr('x1', function (l) { return l.source.x; }).attr('y1', function (l) { return l.source.y; }).attr('x2', function (l) { return l.target.x; }).attr('y2', function (l) { return l.target.y; });
      node.attr('transform', function (d) { return 'translate(' + d.x + ',' + d.y + ')'; });
    });
    var box = h('div', { class: 'graph' }); box.style.color = 'var(--muted)'; box.appendChild(svg.node());
    $('extra').textContent = ''; $('extra').appendChild(box);
    $('extra').appendChild(h('div', { class: 'note', text: 'Tags that appear on the same articles are linked. Click a tag to filter. Drag to move.' }));
  }

  function render() {
    renderTags();
    var list = visible(), box = $('list'); box.textContent = '';
    var nb = document.querySelector('#views button[data-view="notes"]'); if (nb) nb.hidden = !state.notes.length;
    if (state.view === 'notes') { $('extra').textContent = ''; document.querySelectorAll('#views button').forEach(function (b) { b.setAttribute('aria-pressed', String(b.dataset.view === 'notes')); }); return renderNotes(box); }
    $('count').textContent = list.length === state.all.length ? state.all.length + ' articles' : list.length + ' of ' + state.all.length + ' articles';
    $('sub').textContent = state.generated ? 'Updated ' + fmt(Date.parse(state.generated)) : '';
    list.slice(0, 300).forEach(function (a) { box.appendChild(card(a)); });
    if (list.length > 300) box.appendChild(h('div', { class: 'note', text: 'Showing the first 300. Search or filter to narrow it down.' }));
    if (!list.length) box.appendChild(h('div', { class: 'note', text: 'Nothing matches.' }));
    document.querySelectorAll('#views button').forEach(function (b) { b.setAttribute('aria-pressed', String(b.dataset.view === state.view)); });
    if (state.view !== 'sky') leaveSky();
    if (state.view === 'list') { $('extra').textContent = ''; }
    else if (state.view === 'sky') showSky();
    else loadD3().then(function (d3) { if (state.view === 'timeline') drawTimeline(d3); else drawGraph(d3); }).catch(function (e) { note(e.message, 'err'); });
  }

  function init(lib) {
    if (!lib || !Array.isArray(lib.articles)) throw new Error('library.json has no articles.');
    state.all = lib.articles.filter(function (a) { return a && typeof a === 'object'; }); state.generated = lib.generatedAt; state.notes = Array.isArray(lib.notes) ? lib.notes : [];
    var hv = (location.hash || '').slice(1); if (hv === 'timeline' || hv === 'graph' || hv === 'notes' || hv === 'sky') state.view = hv;   // a link can open a view directly
    $('q').addEventListener('input', function () { state.q = this.value; render(); });
    $('sort').addEventListener('change', function () { state.sort = this.value; render(); });
    $('views').addEventListener('click', function (e) { var b = e.target.closest('button'); if (!b) return; state.view = b.dataset.view; if (state.view === 'list') state.month = ''; try { history.replaceState(null, '', state.view === 'list' ? location.pathname + location.search : '#' + state.view); } catch (_) { /* file or sandbox */ } render(); });
    render();
  }
  // The list comes from library.js (a script: works when this page is opened from disk) or, failing that, library.json (needs a web server).
  var fromDisk = location.protocol === 'file:';
  function loadLibrary() {
    return new Promise(function (resolve, reject) {
      if (window.AISH_LIBRARY) return resolve(window.AISH_LIBRARY);
      var s = document.createElement('script'); s.src = 'library.js?' + Date.now();
      s.onload = function () { window.AISH_LIBRARY ? resolve(window.AISH_LIBRARY) : reject(new Error('library.js is empty.')); };
      s.onerror = function () {
        fetch('library.json', { cache: 'no-store' }).then(function (r) { if (!r.ok) throw new Error('library.json answered ' + r.status + '.'); return r.json(); }).then(resolve)
          .catch(function (e) { reject(new Error(fromDisk ? 'library.js is not next to this page. A page opened from disk can only read the list from library.js; library.json needs a web server.' : e.message)); });
      };
      document.head.appendChild(s);
    });
  }
  loadLibrary().then(init).catch(function (e) { $('sub').textContent = ''; $('list').appendChild(h('div', { class: 'note err', text: 'Could not load the list: ' + e.message })); });
})();
