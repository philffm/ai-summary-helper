// feedInsights.js — analytics for the Feeds view (scope = the source you are looking at).
// Reuses the chart renderers + .ar-* styles of the History report so both look alike.
import { articlesByDay, articlesByWeek, renderBarChart, renderWeekChart } from './analyticsManager.js';
import { T, TN, locale } from './feedI18n.js';
import { isoWeek, moodBar } from './feedRollup.js';
import { buildBuckets, movers, pct } from './feedMood.js';

const DAY = 86400000;
// Short stop-word list for the mixed-language (en/de) term cloud.
const STOP = new Set(('the and for with that this from have has had are was were will would about into over after before their there which when what your you our not but all can more than also been just says said new one two ' +
    'der die das und ist nicht mit für von den dem des ein eine einen einer eines auf aus bei nach über auch sich wie wird sind war hat haben dass oder noch nur aber wenn zum zur als bis ' +
    'les des une pour dans que qui est sur avec par pas plus el la los las una por con para que del').split(' '));

function terms(items, n = 40) {
    const f = new Map();
    for (const i of items) {
        const text = `${i.title || ''} ${i.snippet || ''}`.replace(/<[^>]+>/g, ' ').toLowerCase();
        for (const w of text.match(/[\p{L}\p{N}][\p{L}\p{N}'’-]{3,}/gu) || []) {
            if (STOP.has(w) || /^\d+$/.test(w)) continue;
            f.set(w, (f.get(w) || 0) + 1);
        }
    }
    return [...f].filter(([, c]) => c > 1).sort((a, b) => b[1] - a[1]).slice(0, n);
}

const fmtDur = (sec) => { const m = Math.round(sec / 60); return m < 60 ? `${m}m` : `${Math.floor(m / 60)}h ${m % 60 ? (m % 60) + 'm' : ''}`.trim(); };

function h(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
}
function section(title) {
    const s = h('div', 'ar-section');
    s.append(h('h3', 'ar-section-title', title));
    return s;
}
function statCard(value, label) {
    const c = h('div', 'ar-stat-card');
    c.append(h('span', 'ar-stat-value', String(value)), h('span', 'ar-stat-label', label));
    return c;
}
function barRows(rows, onClick, title) {
    const list = h('div', 'ar-cat-list');
    const max = rows.length ? rows[0][1] : 1;
    rows.forEach(([label, count, payload]) => {
        const r = h('div', 'ar-cat-row');
        r.dataset.tag = label; r.style.cursor = 'pointer'; r.title = title(label);
        const track = h('div', 'ar-cat-bar-track'); const bar = h('div', 'ar-cat-bar'); bar.style.width = Math.round(count / max * 100) + '%'; track.append(bar);
        r.append(h('span', 'ar-cat-label', label), track, h('span', 'ar-cat-count', String(count)));
        r.addEventListener('click', () => onClick(payload != null ? payload : label));
        list.append(r);
    });
    return list;
}


// ── Mood over time ─────────────────────────────────────────────────────────
let mScope = 'week', mSel = null;

function periodLabel(scope, ts) {
    if (scope === 'day') return new Date(ts).toLocaleDateString(locale(), { weekday: 'short', day: 'numeric', month: 'short' });
    if (scope === 'week') return T('Week {n}', { n: isoWeek(ts) });
    return new Date(ts).toLocaleDateString(locale(), { month: 'long', year: 'numeric' });
}
function shortLabel(scope, ts) {
    if (scope === 'day') return String(new Date(ts).getDate());
    if (scope === 'week') return 'W' + isoWeek(ts);
    return new Date(ts).toLocaleDateString(locale(), { month: 'short' });
}
const signed = (n) => (n > 0 ? '+' : n < 0 ? '−' : '') + Math.abs(n);

function moodSection(ctx) {
    const sec = section(T('📈 Mood over time')); sec.classList.add('feed-mt-sec');
    const head = h('div', 'ar-section-head'); head.append(sec.firstChild);
    const tg = h('div', 'ar-view-toggle'); tg.setAttribute('role', 'tablist');
    const body = h('div', 'feed-mt');
    const draw = () => {
        [...tg.children].forEach(b => b.classList.toggle('active', b.dataset.view === mScope));
        body.replaceChildren();
        const bs = buildBuckets(ctx.moodStore || {}, mScope, Date.now(), ctx.feedIds || null);
        if (!bs.some(b => b.rated)) { body.append(h('p', 'ar-empty', T('Nothing rated yet — write a ✨ Recap to rate items.'))); return; }
        const sel = mSel != null && bs[mSel] ? mSel : bs.length - 1;
        const cur = bs[sel], prev = bs[sel - 1] || null;

        // hero: index + change vs previous period
        const hero = h('div', 'feed-mt-hero');
        const idx = h('div', 'feed-mt-idx');
        idx.append(h('span', 'feed-mt-big', cur.index == null ? T('n/a') : signed(cur.index)), h('span', 'feed-muted', T('Mood index') + ' · ' + periodLabel(mScope, cur.start)));
        hero.append(idx);
        if (prev && cur.index != null && prev.index != null) {
            const d = cur.index - prev.index;
            const pill = h('span', 'feed-mt-delta ' + (d > 0 ? 'up' : d < 0 ? 'down' : 'flat'), `${d > 0 ? '▲' : d < 0 ? '▼' : '='} ${T('{n} pts', { n: Math.abs(d) })}`);
            pill.title = T('vs {label}', { label: periodLabel(mScope, prev.start) });
            hero.append(pill);
        }
        body.append(hero);

        // trend: 100% stacked columns
        const chart = h('div', 'feed-mt-chart'); chart.setAttribute('role', 'listbox');
        bs.forEach((b, k) => {
            const col = h('button', 'feed-mt-col' + (k === sel ? ' sel' : '') + (k === bs.length - 1 ? ' now' : '') + (b.index == null ? ' na' : ''));
            col.type = 'button'; col.dataset.i = String(k); col.setAttribute('role', 'option'); col.setAttribute('aria-selected', String(k === sel));
            const stack = h('div', 'feed-mt-stack'); const p = pct(b);
            if (b.index != null) [['neg', p.neg], ['neu', p.neu], ['pos', p.pos]].forEach(([c, v]) => { if (v) { const sg = h('i', 'feed-mood-seg ' + c); sg.style.flex = String(v); stack.append(sg); } });
            col.append(stack, h('span', 'feed-mt-x', shortLabel(mScope, b.start)));
            col.title = `${periodLabel(mScope, b.start)} · ${b.index == null ? T('n/a') : signed(b.index)}`;
            col.addEventListener('click', () => { mSel = k; draw(); });
            chart.append(col);
        });
        body.append(chart);

        // selected period
        const card = h('div', 'feed-mt-card');
        card.append(h('div', 'feed-mt-card-title', periodLabel(mScope, cur.start) + ' · ' + TN(cur.t, '{n} item', '{n} items')));
        if (cur.index != null) {
            card.append(moodBar(h, pct(cur)));
        } else {
            const need = cur.t - cur.rated;
            card.append(h('div', 'feed-muted', T('Only {r} of {n} items are rated', { r: cur.rated, n: cur.t })));
            const prog = h('div', 'feed-mt-prog'); const fill = h('i'); fill.style.width = (cur.t ? Math.round(cur.rated * 100 / cur.t) : 0) + '%'; prog.append(fill); card.append(prog);
            const todo = ctx.unscored ? ctx.unscored(cur.start, cur.end) : [];
            if (todo.length) { const bt = h('button', 'feed-btn', T('🤖 Score {n} unscored items', { n: todo.length })); bt.type = 'button'; bt.addEventListener('click', () => ctx.onScore(todo)); card.append(bt); }
            else if (need > 0) card.append(h('p', 'feed-muted', T('These items are no longer stored, so they cannot be scored.')));
        }
        const acts = h('div', 'feed-mt-acts');
        const open = h('button', 'feed-btn', mScope === 'day' ? T('Open day ›') : mScope === 'week' ? T('Open week ›') : T('Open month ›')); open.type = 'button';
        open.addEventListener('click', () => ctx.onOpen(mScope, cur.start));
        const rc = h('button', 'feed-btn', T('✨ Recap') + (ctx.hasRecap && ctx.hasRecap(mScope, cur.start) ? ' ✓' : '')); rc.type = 'button';
        rc.addEventListener('click', () => ctx.onRecap(mScope, cur.start));
        acts.append(open, rc); card.append(acts);
        body.append(card);

        // what moved
        if (prev && cur.index != null && prev.index != null) {
            const mv = movers(cur, prev);
            const rows = (title, list, label) => {
                if (!list.length) return;
                const box = h('div', 'feed-mt-mv'); box.append(h('div', 'feed-mt-mv-title', title));
                const max = Math.max(...list.map(x => Math.abs(x[1])), 1);
                list.forEach(([k, d]) => {
                    const r = h('div', 'feed-mt-mv-row');
                    const track = h('div', 'feed-mt-mv-track'); const bar = h('i', d > 0 ? 'up' : 'down'); bar.style.width = Math.round(Math.abs(d) / max * 50) + '%'; track.append(bar);
                    r.append(h('span', 'feed-mt-mv-label', label(k)), track, h('span', 'feed-mt-mv-val ' + (d > 0 ? 'up' : 'down'), signed(d)));
                    box.append(r);
                });
                body.append(box);
            };
            const head2 = h('div', 'feed-mt-whatmoved', T('What moved') + ' · ' + shortLabel(mScope, cur.start) + ' vs ' + shortLabel(mScope, prev.start));
            if (mv.cats.length || mv.srcs.length) body.append(head2);
            rows(T('Categories'), mv.cats, (k) => k);
            rows(T('Sources'), mv.srcs, (k) => ctx.subTitle(k));
        }
        const all = bs.reduce((a, b) => ({ t: a.t + b.t, r: a.r + b.rated }), { t: 0, r: 0 });
        body.append(h('p', 'feed-muted feed-mt-foot', T('{r} of {n} items rated · mood comes from AI scoring only', { r: all.r, n: all.t })),
            h('p', 'feed-muted feed-mt-foot', T('Mood history is kept for 13 months, even after items are removed.')));
    };
    [['day', T('Day')], ['week', T('Week')], ['month', T('Month')]].forEach(([v, l]) => {
        const b = h('button', 'ar-view-btn', l); b.type = 'button'; b.dataset.view = v;
        b.addEventListener('click', () => { mScope = v; mSel = null; draw(); }); tg.append(b);
    });
    head.append(tg); sec.prepend(head); sec.append(body);
    draw();
    return sec;
}

export function renderInsights(container, ctx) {
    const { items, scopeLabel, subTitle, isSummarized, onSource, onSearch } = ctx;
    container.replaceChildren();
    const root = h('div', 'ar-report feed-ins');
    container.append(root);
    root.append(h('p', 'feed-muted feed-ins-scope', scopeLabel));
    if (!items.length) { root.append(h('p', 'ar-empty', T('No items in this source yet.'))); return; }

    const unread = items.filter(i => !i.read).length;
    const rated = items.filter(i => i.ai);
    const stats = h('div', 'ar-stats-row');
    stats.append(statCard(items.length, T('Items')), statCard(Math.round(unread / items.length * 100) + '%', T('Unread')),
        statCard(items.filter(isSummarized).length, T('Summarized')), statCard(rated.length, T('AI-rated')));
    root.append(stats);

    // Volume
    const vol = section(T('📅 Volume'));
    const head = h('div', 'ar-section-head'); head.append(vol.firstChild);
    const tg = h('div', 'ar-view-toggle'); tg.setAttribute('role', 'tablist');
    const arts = items.map(i => ({ timestamp: i.published }));
    const chart = h('div', 'ar-chart-wrap');
    const draw = (v) => { chart.innerHTML = v === 'week' ? renderWeekChart(articlesByWeek(arts)) : renderBarChart(articlesByDay(arts)); [...tg.children].forEach(b => b.classList.toggle('active', b.dataset.view === v)); };
    [['day', T('Day')], ['week', T('Week')]].forEach(([v, l]) => { const b = h('button', 'ar-view-btn', l); b.type = 'button'; b.dataset.view = v; b.addEventListener('click', () => draw(v)); tg.append(b); });
    head.append(tg); vol.prepend(head); vol.append(chart); root.append(vol);
    const span = (Date.now() - Math.min(...items.map(i => i.published))) / DAY;
    draw(span >= 21 ? 'week' : 'day');

    // Top sources
    const bySub = new Map();
    items.forEach(i => bySub.set(i.feedId, (bySub.get(i.feedId) || 0) + 1));
    if (bySub.size > 1) {
        const s = section(T('📰 Top sources'));
        const rows = [...bySub].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([id, n]) => [subTitle(id), n, id]);
        s.append(barRows(rows, onSource, (l) => T('Show only {name}', { name: l })));
        root.append(s);
    }

    // Mood over time (daily store, outlives item retention)
    root.append(moodSection(ctx));

    // Categories (AI-labelled items)
    const cats = new Map();
    items.forEach(i => { if (i.cat) cats.set(i.cat, (cats.get(i.cat) || 0) + 1); });
    if (cats.size) {
        const m = section(T('🏷️ Categories'));
        m.append(barRows([...cats].sort((a, b) => b[1] - a[1]).slice(0, 8), onSearch, (l) => T('Search “{term}”', { term: l })));
        root.append(m);
    }

    // Top terms
    const w = section(T('☁️ Top terms'));
    const words = terms(items);
    if (!words.length) w.append(h('p', 'ar-empty', T('Not enough text data yet.')));
    else {
        const cloud = h('div', 'ar-wordcloud'); const max = words[0][1];
        words.forEach(([word, c]) => {
            const s = h('span', 'ar-word', word); s.style.fontSize = (11 + Math.round(c / max * 18)) + 'px'; s.style.opacity = String(0.5 + c / max * 0.5);
            s.style.cursor = 'pointer'; s.title = T('Search “{term}”', { term: word }); s.addEventListener('click', () => onSearch(word)); cloud.append(s);
        });
        w.append(cloud);
    }
    root.append(w);

    // Podcasts
    const eps = items.filter(i => i.audio);
    if (eps.length) {
        const p = section(T('🎧 Podcasts'));
        const left = eps.filter(i => !i.read);
        const secs = left.reduce((s, i) => s + (i.dur || 0), 0);
        const row = h('div', 'ar-stats-row feed-ins-pod');
        row.append(statCard(eps.length, T('Episodes')), statCard(left.length, T('Unplayed')), statCard(secs ? fmtDur(secs) : '–', T('To listen')));
        p.append(row);
        root.append(p);
    }
}
