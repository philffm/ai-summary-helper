// moodView.js — "Mood over time" card shared by Feeds insights and History analytics.
// ctx: { moodStore, feedIds?, subTitle?, unscored?(from,to), onScore?(list), onOpen?, onRecap?, hasRecap? }
import { T, TN, locale } from './feedI18n.js';
import { isoWeek, moodBar } from './feedRollup.js';
import { buildBuckets, movers, pct } from './feedMood.js';

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

// ── Mood over time ─────────────────────────────────────────────────────────
let mScope = 'week', mSel = null;

function periodLabel(scope, ts) {
    if (scope === 'day') return new Date(ts).toLocaleDateString(locale(), { weekday: 'short', day: 'numeric', month: 'short' });
    if (scope === 'week') return T('Week {n}', { n: isoWeek(ts) });
    return new Date(ts).toLocaleDateString(locale(), { month: 'long', year: 'numeric' });
}
function shortLabel(scope, ts) {
    if (scope === 'day') return String(new Date(ts).getDate());
    if (scope === 'week') return T('W{n}', { n: isoWeek(ts) });
    return new Date(ts).toLocaleDateString(locale(), { month: 'short' });
}
const signed = (n) => (n > 0 ? '+' : n < 0 ? '−' : '') + Math.abs(n);

export function moodSection(ctx) {
    const sec = section(T('📈 Mood over time')); sec.classList.add('feed-mt-sec');
    const head = h('div', 'ar-section-head'); head.append(sec.firstChild);
    const tg = h('div', 'ar-view-toggle'); tg.setAttribute('role', 'tablist');
    const body = h('div', 'feed-mt');
    const draw = () => {
        [...tg.children].forEach(b => b.classList.toggle('active', b.dataset.view === mScope));
        body.replaceChildren();
        const bs = buildBuckets(ctx.moodStore || {}, mScope, Date.now(), ctx.feedIds || null);
        if (!bs.some(b => b.rated)) {
            body.append(h('p', 'ar-empty', ctx.emptyHint || T('Nothing rated yet — write a ✨ Recap to rate items.')));
            const todo = (ctx.unscored ? ctx.unscored(0, Date.now() + 864e5) : []).slice(0, ctx.scoreMax || 120);
            if (todo.length && ctx.onScore) { const bt = h('button', 'feed-btn', T('🤖 Score {n} unscored items', { n: todo.length })); bt.type = 'button'; bt.addEventListener('click', () => ctx.onScore(todo)); body.append(bt); }
            return;
        }
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
            card.append(h('div', 'feed-muted', need > 0 ? T('Only {r} of {n} items are rated', { r: cur.rated, n: cur.t }) : T('Only {r} rated items — at least 5 are needed', { r: cur.rated })));
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
        if (ctx.onOpen) acts.append(open, rc);
        if (acts.children.length) card.append(acts);
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
            const head2 = h('div', 'feed-mt-whatmoved', T('What moved') + ' · ' + T('{a} vs {b}', { a: shortLabel(mScope, cur.start), b: shortLabel(mScope, prev.start) }));
            if (mv.cats.length || mv.srcs.length) body.append(head2);
            rows(T('Categories'), mv.cats, (k) => k);
            if (ctx.subTitle) rows(T('Sources'), mv.srcs, (k) => ctx.subTitle(k));
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

