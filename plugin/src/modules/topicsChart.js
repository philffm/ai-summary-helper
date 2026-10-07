// topicsChart.js — "Topics over time": stacked columns of the top tags per week / month.
// Rendered inside the analytics report (History) — pure SVG, no dependencies.

import { T } from './feedI18n.js';

const NS = 'http://www.w3.org/2000/svg';
const TOP_OPTIONS = [3, 5, 8];
const DAY = 86400000;

const normTag = (tag) => String(tag).trim()
    .replace(/([a-z])([A-Z])/g, '$1 $2').replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .toLowerCase().replace(/\s+/g, ' ').trim();
const titleCase = (k) => k.replace(/\b\w/g, c => c.toUpperCase());

function buckets(view, now = new Date()) {
    const out = [];
    if (view === 'month') {
        for (let m = 11; m >= 0; m--) {
            const start = new Date(now.getFullYear(), now.getMonth() - m, 1);
            const end = new Date(now.getFullYear(), now.getMonth() - m + 1, 1);
            out.push({ start: start.getTime(), end: end.getTime(), label: start.toLocaleDateString(undefined, { month: 'short' }), full: start.toLocaleDateString(undefined, { month: 'long', year: 'numeric' }) });
        }
    } else {
        const today = new Date(now); today.setHours(0, 0, 0, 0);
        for (let w = 11; w >= 0; w--) {
            const end = today.getTime() - w * 7 * DAY + DAY;       // exclusive end (today inclusive for w = 0)
            const start = end - 7 * DAY;
            const s = new Date(start), e = new Date(end - DAY);
            const f = (d) => d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
            out.push({ start, end, label: f(s), full: `${f(s)} – ${f(e)}` });
        }
    }
    return out;
}

/** @returns {{ rows: Array<{label, full, counts: number[]}>, series: string[] }} (last series is "Other" when present) */
export function topicsData(articles, view, topN = 5) {
    const bs = buckets(view);
    const lo = bs[0].start, hi = bs[bs.length - 1].end;
    const inWin = (articles || []).filter(a => { const t = new Date(a.timestamp).getTime(); return t >= lo && t < hi; });
    const freq = {};
    inWin.forEach(a => new Set((a.tags || []).map(normTag).filter(Boolean)).forEach(k => { freq[k] = (freq[k] || 0) + 1; }));
    const top = Object.entries(freq).sort((a, b) => b[1] - a[1]).slice(0, topN).map(e => e[0]);
    const hasOther = Object.keys(freq).length > top.length;
    const rows = bs.map(b => ({ label: b.label, full: b.full, counts: new Array(top.length + (hasOther ? 1 : 0)).fill(0) }));
    inWin.forEach(a => {
        const t = new Date(a.timestamp).getTime();
        const i = bs.findIndex(b => t >= b.start && t < b.end);
        if (i < 0) return;
        new Set((a.tags || []).map(normTag).filter(Boolean)).forEach(k => {
            const s = top.indexOf(k);
            if (s >= 0) rows[i].counts[s]++;
            else if (hasOther) rows[i].counts[top.length]++;
        });
    });
    // Mood per tag and period: average AI score (−100…+100) of the articles that have one; null = nothing scored.
    const sum = rows.map(() => top.map(() => 0)), cnt = rows.map(() => top.map(() => 0));
    let scored = 0;
    inWin.forEach(a => {
        if (typeof a.moodScore !== 'number') return;
        const t = new Date(a.timestamp).getTime();
        const i = bs.findIndex(b => t >= b.start && t < b.end);
        if (i < 0) return;
        scored++;
        new Set((a.tags || []).map(normTag).filter(Boolean)).forEach(k => {
            const s = top.indexOf(k);
            if (s >= 0) { sum[i][s] += a.moodScore; cnt[i][s]++; }
        });
    });
    rows.forEach((r, i) => { r.mood = top.map((_, s) => cnt[i][s] ? Math.round(sum[i][s] / cnt[i][s] * 100) : null); r.moodN = cnt[i]; });
    return { rows, series: [...top.map(titleCase), ...(hasOther ? [T('Other')] : [])], keys: top, scored };
}

const el = (tag, attrs = {}, text) => {
    const n = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
    if (text != null) n.textContent = text;
    return n;
};

function showTip(wrap, ev, text) {
    const tip = wrap.querySelector('.tp-tip');
    tip.hidden = false; tip.textContent = text;
    const b = wrap.getBoundingClientRect();
    tip.style.left = Math.min(Math.max(ev.clientX - b.left + 10, 0), Math.max(0, b.width - tip.offsetWidth)) + 'px';
    tip.style.top = (ev.clientY - b.top - 34) + 'px';
}
const hideTip = (wrap) => { wrap.querySelector('.tp-tip').hidden = true; };
const fmtMood = (v) => (v > 0 ? '+' : '') + v;

/** Mood over time per category: one line per tag, −100…+100, gaps where nothing is scored. */
function drawMood(wrap, data) {
    const { rows, keys, series } = data;
    const W = Math.max(320, Math.round(wrap.clientWidth || 600)), H = 220, L = 34, B = 22, Tp = 8, R = 6;
    const bw = (W - L - R) / rows.length;
    const y = (v) => Tp + (H - Tp - B) * (1 - (v + 100) / 200);
    const cx = (i) => L + i * bw + bw / 2;
    const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, width: W, height: H, class: 'tp-svg', role: 'img', 'aria-label': T('Mood over time per category') });
    [100, 50, 0, -50, -100].forEach(v => {
        svg.append(el('line', { x1: L, x2: W - R, y1: y(v), y2: y(v), class: v === 0 ? 'tp-grid tp-zero' : 'tp-grid' }));
        svg.append(el('text', { x: L - 6, y: y(v) + 3, 'text-anchor': 'end', class: 'tp-axis' }, fmtMood(v)));
    });
    keys.forEach((_, s) => {
        let seg = [];
        const flush = () => { if (seg.length > 1) svg.append(el('polyline', { points: seg.join(' '), class: `tp-line tp-l${s}`, fill: 'none' })); seg = []; };
        rows.forEach((r, i) => { if (r.mood[s] === null) flush(); else seg.push(`${cx(i)},${y(r.mood[s])}`); });
        flush();
    });
    rows.forEach((r, i) => {
        keys.forEach((_, s) => { if (r.mood[s] !== null) svg.append(el('circle', { cx: cx(i), cy: y(r.mood[s]), r: 3.5, class: `tp-dot tp-s${s}` })); });
        const hit = el('rect', { x: L + i * bw, y: Tp, width: bw, height: H - Tp - B, fill: 'transparent' });
        hit.addEventListener('mousemove', (ev) => {
            const parts = keys.map((_, s) => r.mood[s] === null ? null : `${series[s]}: ${fmtMood(r.mood[s])} (${r.moodN[s]})`).filter(Boolean);
            showTip(wrap, ev, `${r.full} · ` + (parts.length ? parts.join(' · ') : T('not scored')));
        });
        hit.addEventListener('mouseleave', () => hideTip(wrap));
        svg.append(hit);
        if (i % 2 === (rows.length - 1) % 2) svg.append(el('text', { x: cx(i), y: H - 6, 'text-anchor': 'middle', class: 'tp-axis' }, r.label));
    });
    wrap.querySelector('.tp-svg')?.remove();
    wrap.prepend(svg);
}

function drawChart(wrap, data, type = 'bars') {
    if (type === 'mood') return drawMood(wrap, data);
    const { rows, series } = data;
    const W = Math.max(320, Math.round(wrap.clientWidth || 600)), H = 200, L = 28, B = 22, Tp = 8, R = 4;   // 1 unit = 1 px, so text stays crisp at any width
    const lines = type === 'lines';
    const shown = lines ? data.keys.length : series.length;   // lines skip the "Other" bucket
    const totals = rows.map(r => lines ? Math.max(0, ...r.counts.slice(0, shown)) : r.counts.reduce((a, b) => a + b, 0));
    const max = Math.max(1, ...totals);
    const niceMax = max <= 4 ? max : Math.ceil(max / 2) * 2;
    const bw = (W - L - R) / rows.length;
    const y = (v) => Tp + (H - Tp - B) * (1 - v / niceMax);
    const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, width: W, height: H, class: 'tp-svg', role: 'img', 'aria-label': T('Topics over time') });
    [0, niceMax / 2, niceMax].forEach(v => {
        svg.append(el('line', { x1: L, x2: W - R, y1: y(v), y2: y(v), class: 'tp-grid' }));
        svg.append(el('text', { x: L - 6, y: y(v) + 3, 'text-anchor': 'end', class: 'tp-axis' }, String(Math.round(v))));
    });
    const tip = wrap.querySelector('.tp-tip');
    const tipAt = (ev, text) => {
        tip.hidden = false; tip.textContent = text;
        const b = wrap.getBoundingClientRect();
        tip.style.left = Math.min(Math.max(ev.clientX - b.left + 10, 0), Math.max(0, b.width - tip.offsetWidth)) + 'px';
        tip.style.top = (ev.clientY - b.top - 34) + 'px';
    };
    if (lines) {
        const cx = (i) => L + i * bw + bw / 2;
        for (let s = 0; s < shown; s++) {
            const pts = rows.map((r, i) => `${cx(i)},${y(r.counts[s])}`).join(' ');
            svg.append(el('polyline', { points: pts, class: `tp-line tp-l${s}`, fill: 'none' }));
        }
        rows.forEach((r, i) => {
            // one hover column per period: tooltip lists every series for that period
            const hit = el('rect', { x: L + i * bw, y: Tp, width: bw, height: H - Tp - B, fill: 'transparent' });
            hit.addEventListener('mousemove', (ev) => tipAt(ev, `${r.full} · ` + series.slice(0, shown).map((n, s) => `${n}: ${r.counts[s]}`).join(' · ')));
            hit.addEventListener('mouseleave', () => { tip.hidden = true; });
            for (let s = 0; s < shown; s++) svg.append(el('circle', { cx: cx(i), cy: y(r.counts[s]), r: 3.5, class: `tp-dot tp-s${s}` }));
            svg.append(hit);
            if (i % 2 === (rows.length - 1) % 2) svg.append(el('text', { x: cx(i), y: H - 6, 'text-anchor': 'middle', class: 'tp-axis' }, r.label));
        });
        wrap.querySelector('.tp-svg')?.remove();
        wrap.prepend(svg);
        return;
    }
    rows.forEach((r, i) => {
        let acc = 0;
        const x = L + i * bw + bw * 0.18, w = bw * 0.64;
        r.counts.forEach((c, s) => {
            if (!c) return;
            const y0 = y(acc), y1 = y(acc + c);
            const rect = el('rect', { x, y: y1, width: w, height: Math.max(1, y0 - y1), class: `tp-seg tp-s${s === series.length - 1 && series[s] === T('Other') ? 'o' : s}`, rx: 2 });
            const show = (ev) => tipAt(ev, `${r.full} · ${series[s]}: ${c}`);
            rect.addEventListener('mousemove', show);
            rect.addEventListener('mouseleave', () => { tip.hidden = true; });
            svg.append(rect);
            acc += c;
        });
        if (i % 2 === (rows.length - 1) % 2) svg.append(el('text', { x: x + w / 2, y: H - 6, 'text-anchor': 'middle', class: 'tp-axis' }, r.label));
    });
    wrap.querySelector('.tp-svg')?.remove();
    wrap.prepend(svg);
}

function drawLegend(legend, data, container, mood = false) {
    legend.replaceChildren();
    data.series.forEach((name, s) => {
        const isOther = s === data.keys.length;
        if (mood && isOther) return;                       // mood has no "Other" line
        const total = data.rows.reduce((a, r) => a + (mood ? r.moodN[s] : r.counts[s]), 0);   // mood: scored articles
        const b = document.createElement('button');
        b.type = 'button'; b.className = 'tp-leg';
        b.disabled = isOther;
        b.title = isOther ? name : T('Search “{term}”', { term: name });
        const sw = document.createElement('i'); sw.className = `tp-sw tp-s${isOther ? 'o' : s}`;
        b.append(sw, document.createTextNode(`${name} · ${total}`));
        if (!isOther) b.addEventListener('click', () => container.dispatchEvent(new CustomEvent('tag-search', { bubbles: true, detail: { tag: name } })));
        legend.append(b);
    });
}

function drawTable(details, data, view, mood = false) {
    const tbl = document.createElement('table');
    tbl.className = 'tp-table';
    const head = document.createElement('tr');
    [view === 'month' ? T('Month') : T('Week'), ...(mood ? data.series.slice(0, data.keys.length) : data.series)].forEach(h => { const th = document.createElement('th'); th.textContent = h; head.append(th); });
    tbl.append(head);
    data.rows.forEach(r => {
        const tr = document.createElement('tr');
        [r.full, ...(mood ? r.mood.map(v => v === null ? '–' : fmtMood(v)) : r.counts)].forEach(v => { const td = document.createElement('td'); td.textContent = v; tr.append(td); });
        tbl.append(tr);
    });
    details.querySelector('table')?.remove();
    details.append(tbl);
}

/** Builds the "Topics over time" section element. */
export function renderTopicsSection(articles, container) {
    const sec = document.createElement('div');
    sec.className = 'ar-section ar-topics';
    sec.innerHTML = `
      <div class="ar-section-head">
        <h3 class="ar-section-title"></h3>
        <div class="ar-view-toggle" role="tablist">
          <button type="button" class="ar-view-btn active" data-view="week"></button>
          <button type="button" class="ar-view-btn" data-view="month"></button>
        </div>
      </div>
      <div class="tp-controls">
        <div class="ar-view-toggle tp-metric" role="tablist">
          <button type="button" class="ar-view-btn active" data-metric="mood"></button>
          <button type="button" class="ar-view-btn" data-metric="volume"></button>
        </div>
        <div class="ar-view-toggle tp-type" role="tablist">
          <button type="button" class="ar-view-btn active" data-type="bars"></button>
          <button type="button" class="ar-view-btn" data-type="lines"></button>
        </div>
        <label class="tp-topn"><span></span><select class="tp-topn-select"></select></label>
      </div>
      <div class="tp-chart"><div class="tp-tip" hidden></div></div>
      <div class="tp-legend"></div>
      <details class="tp-details"><summary></summary></details>`;
    sec.querySelector('.ar-section-title').textContent = T('📈 Topics over time');
    const [wk, mo] = sec.querySelectorAll('.ar-view-toggle:not(.tp-type) .ar-view-btn');
    const [mMood, mVol] = sec.querySelectorAll('.tp-metric .ar-view-btn');
    const [tBars, tLines] = sec.querySelectorAll('.tp-type .ar-view-btn');
    const typeToggle = sec.querySelector('.tp-type');
    const nSel = sec.querySelector('.tp-topn-select');
    wk.textContent = T('Week'); mo.textContent = T('Month');
    mMood.textContent = T('Mood'); mVol.textContent = T('Volume');
    tBars.textContent = T('Stacked'); tLines.textContent = T('Lines');
    sec.querySelector('.tp-topn span').textContent = T('Top');
    TOP_OPTIONS.forEach(n => { const o = document.createElement('option'); o.value = String(n); o.textContent = String(n); nSel.append(o); });
    nSel.value = '5';
    let curView = 'week', curType = 'bars', curMetric = 'mood';
    sec.querySelector('summary').textContent = T('Table view');

    const chart = sec.querySelector('.tp-chart'), legend = sec.querySelector('.tp-legend'), details = sec.querySelector('.tp-details');
    const apply = (view = curView) => {
        curView = view;
        [wk, mo].forEach(b => b.classList.toggle('active', b.dataset.view === view));
        [tBars, tLines].forEach(b => b.classList.toggle('active', b.dataset.type === curType));
        [mMood, mVol].forEach(b => b.classList.toggle('active', b.dataset.metric === curMetric));
        typeToggle.hidden = curMetric === 'mood';
        const data = topicsData(articles, view, Number(nSel.value));
        if (!data.keys.length) {
            chart.replaceChildren(Object.assign(document.createElement('p'), { className: 'ar-empty', textContent: T('No tags found. Add tags to your summaries!') }));
            legend.replaceChildren(); details.hidden = true; return;
        }
        details.hidden = false;
        if (!chart.querySelector('.tp-tip')) { const t = document.createElement('div'); t.className = 'tp-tip'; t.hidden = true; chart.append(t); }
        if (curMetric === 'mood' && !data.scored) {
            chart.replaceChildren(Object.assign(document.createElement('p'), { className: 'ar-empty', textContent: T('No article has a mood yet — let the AI score them.') }));
            legend.replaceChildren(); details.hidden = true; return;
        }
        drawChart(chart, data, curMetric === 'mood' ? 'mood' : curType); drawLegend(legend, data, container, curMetric === 'mood'); drawTable(details, data, view, curMetric === 'mood');
    };
    mMood.addEventListener('click', () => { curMetric = 'mood'; apply(); });
    mVol.addEventListener('click', () => { curMetric = 'volume'; apply(); });
    wk.addEventListener('click', () => apply('week'));
    mo.addEventListener('click', () => apply('month'));
    tBars.addEventListener('click', () => { curType = 'bars'; apply(); });
    tLines.addEventListener('click', () => { curType = 'lines'; apply(); });
    nSel.addEventListener('change', () => apply());
    apply('week');
    // Draw at the real pixel width once attached, and again when the pane is resized.
    if (typeof ResizeObserver !== 'undefined') {
        let lastW = 0;
        new ResizeObserver(() => {
            const w = Math.round(chart.clientWidth);
            if (w && Math.abs(w - lastW) > 8) { lastW = w; apply(); }
        }).observe(chart);
    }
    return sec;
}
