// feedInsights.js — analytics for the Feeds view (scope = the source you are looking at).
// Reuses the chart renderers + .ar-* styles of the History report so both look alike.
import { articlesByDay, articlesByWeek, renderBarChart, renderWeekChart, chartTips } from './analyticsManager.js';
import { T, TN, locale } from './feedI18n.js';
import { moodSection } from './moodView.js';

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
    const tips = chartTips((n) => TN(n, '{n} item', '{n} items'));
    const draw = (v) => { chart.innerHTML = v === 'week' ? renderWeekChart(articlesByWeek(arts), tips.week) : renderBarChart(articlesByDay(arts), tips.day); [...tg.children].forEach(b => b.classList.toggle('active', b.dataset.view === v)); };
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
