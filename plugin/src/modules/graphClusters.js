// graphClusters.js — what you can DO with a topic in the graph: tap a tag node → the cluster page
// (mini map, one-tap briefing, never-opened list, docked question box; briefing and questions use only the saved summaries)
// and a Markdown export of just that cluster. Everything shown is set as text; AI output goes through the safe renderer.
import { T, TN } from './feedI18n.js';
import { el } from './dom.js';
import { setIconLabel } from './icons.js';

const title = (a) => a.title || (a.content && String(a.content).split('\n')[0]) || T('Untitled');
const isOpened = (a) => !!a.lastOpened;
const hasText = (a) => !!(a && !a.feedStub && String(a.summary || a.snippet || '').trim());

/** { total, unopened, withSummary, exportable } for the cluster card (pure: easy to test). */
export function clusterStats(articles) {
    const list = articles || [];
    return {
        total: list.length,
        unopened: list.filter(a => !isOpened(a)).length,
        withSummary: list.filter(hasText).length,
        exportable: list.filter(a => a.id && !a.feedStub && a.summary).length
    };
}

const CITE = /\[(\d{1,2}(?:\s*[,;]\s*\d{1,2})*)\]/g;
const clip = (str, n) => (str.length > n ? str.slice(0, n - 1) + '…' : str);

/**
 * Turns the [n] / [1, 2] references in a rendered answer into pills that name the article and open it.
 * `articles[n-1]` is item n; numbers outside that range stay plain text. Works on text nodes only (no innerHTML).
 */
export function linkCitations(root, articles, onOpen) {
    const walker = document.createTreeWalker(root, 4 /* SHOW_TEXT */);
    const nodes = [];
    for (let n = walker.nextNode(); n; n = walker.nextNode()) if (CITE.test(n.nodeValue)) nodes.push(n);
    CITE.lastIndex = 0;
    nodes.forEach((node) => {
        const text = node.nodeValue, frag = document.createDocumentFragment();
        let last = 0, changed = false;
        text.replace(CITE, (m, nums, at) => {
            const refs = nums.split(/[,;]/).map(x => Number(x.trim())).filter(k => k >= 1 && k <= articles.length);
            if (!refs.length) return m;
            if (at > last) frag.append(document.createTextNode(text.slice(last, at)));
            refs.forEach((k, i) => {
                if (i) frag.append(document.createTextNode(' '));
                const a = articles[k - 1];
                const b = el('button', 'chat-src graph-cite', k + ' · ' + clip(title(a), 26));
                b.type = 'button'; b.title = title(a);
                b.addEventListener('click', (e) => { e.stopPropagation(); onOpen(a); });
                frag.append(b);
            });
            last = at + m.length; changed = true;
            return m;
        });
        if (!changed) return;
        if (last < text.length) frag.append(document.createTextNode(text.slice(last)));
        node.replaceWith(frag);
    });
}

const hostOf = (u) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch (_) { return ''; } };
/** "3 weeks ago" for a timestamp (locale-aware, no dependency). */
export function ageLabel(ts, now = Date.now()) {
    const t = new Date(ts).getTime();
    if (!Number.isFinite(t)) return '';
    const days = Math.round((now - t) / 86400000);
    let rtf; try { rtf = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' }); } catch (_) { return ''; }
    if (days < 1) return rtf.format(0, 'day');
    if (days < 14) return rtf.format(-days, 'day');
    if (days < 60) return rtf.format(-Math.round(days / 7), 'week');
    if (days < 540) return rtf.format(-Math.round(days / 30), 'month');
    return rtf.format(-Math.round(days / 365), 'year');
}
const metaOf = (a) => [hostOf(a.url || a.link), ageLabel(a.timestamp || a.date || a.published)].filter(Boolean).join(' · ');

const SVGNS = 'http://www.w3.org/2000/svg';
const svg = (name, attrs = {}) => { const n = document.createElementNS(SVGNS, name); Object.entries(attrs).forEach(([k, v]) => n.setAttribute(k, String(v))); return n; };
/** Tiny static map of the topic: the tag in the middle, one dot per article (accent = never opened). */
function miniMap(label, list) {
    const W = 360, H = 76, cx = W / 2, cy = 30;
    const s = svg('svg', { class: 'graph-cluster-map', viewBox: `0 0 ${W} ${H}`, 'aria-hidden': 'true', focusable: 'false' });
    const shown = list.slice(0, 12);
    shown.forEach((a, i) => {
        const ang = (i / Math.max(1, shown.length)) * Math.PI * 2 - Math.PI / 2;
        const x = cx + Math.cos(ang) * (100 + (i % 2) * 30), y = cy + Math.sin(ang) * (17 + (i % 2) * 5);
        s.append(svg('line', { x1: cx, y1: cy, x2: x, y2: y, class: 'gcm-link' }));
        s.append(svg('circle', { cx: x, cy: y, r: 4.5, class: 'gcm-dot' + (isOpened(a) ? '' : ' is-new') }));
    });
    s.append(svg('circle', { cx, cy, r: 12, class: 'gcm-tag' }));
    const t = svg('text', { x: cx, y: H - 6, 'text-anchor': 'middle', class: 'gcm-label' }); t.textContent = clip(label, 28);
    s.append(t);
    return s;
}

/** Tapping a topic node opens the cluster page directly (brief button, never-opened list, ask box). */
export function showClusterCard(container, opts) { return openClusterPage(container, opts); }

/** The cluster page. */
export function openClusterPage(container, { label, articles }) {
    container.querySelectorAll('.graph-preview-card, .graph-cluster-page').forEach(c => c.remove());
    const list = (articles || []).slice().sort((a, b) => new Date(a.lastOpened || a.timestamp) - new Date(b.lastOpened || b.timestamp));
    const st = clusterStats(list);
    const unopened = list.filter(a => !isOpened(a));
    const opened = list.filter(isOpened);
    const focus = unopened.length ? unopened : list;   // the briefing covers what was never opened, else the whole topic
    const openArticle = (a) => container.dispatchEvent(new CustomEvent('open-article', { detail: a, bubbles: true, composed: true }));

    const page = el('div', 'graph-cluster-page'); page.setAttribute('role', 'region'); page.setAttribute('aria-label', label);
    const bar = el('div', 'graph-cluster-bar');
    const back = el('button', 'graph-cluster-back', '←'); back.type = 'button'; back.setAttribute('aria-label', T('Back'));
    back.addEventListener('click', (e) => { e.stopPropagation(); if (ctl) ctl.abort(); page.remove(); });
    const ttl = el('div', 'graph-cluster-ttl');
    ttl.append(el('strong', 'graph-cluster-title', label), el('div', 'graph-preview-date', TN(st.total, '{n} article', '{n} articles') + ' · ' + T('{n} never opened', { n: st.unopened })));
    bar.append(back, ttl);

    const scroll = el('div', 'graph-cluster-scroll');
    scroll.append(miniMap(label, list));

    const out = el('div', 'graph-cluster-answer'); out.setAttribute('aria-live', 'polite');
    let ctl = null;
    const run = async (question, trigger) => {
        if (ctl) ctl.abort();
        ctl = new AbortController();
        const mine = ctl;
        out.className = 'graph-cluster-answer is-busy';
        out.textContent = T('Reading {n} summaries…', { n: Math.min((question ? list : focus).filter(hasText).length, 15) });
        if (trigger) trigger.disabled = true;
        try {
            const { askCluster } = await import('./feedAi.js');
            const { renderAnswer } = await import('./qaView.js');
            const r = await askCluster(question ? list : focus, { topic: label, question }, { signal: mine.signal });
            if (!page.isConnected || mine !== ctl) return;
            out.className = 'graph-cluster-answer md-body';
            out.textContent = '';
            const body = el('div', 'graph-cluster-answer-body'); out.append(body);
            renderAnswer(body, r.text);
            linkCitations(body, r.articles, openArticle);
            out.append(el('div', 'graph-preview-date', T('From {n} summaries — nothing else was sent', { n: r.used })));
            if (r.articles && r.articles.length) {
                out.append(el('div', 'graph-cluster-h', T('Sources used')));
                const ol = el('ol', 'graph-cluster-sources');
                r.articles.forEach((a, i) => {
                    const li = el('li'); const b = el('button', 'graph-cluster-src'); b.type = 'button'; b.title = title(a);
                    b.append(el('span', 'graph-cluster-num', String(i + 1)), el('span', 'graph-cluster-src-t', title(a)));
                    b.addEventListener('click', (e) => { e.stopPropagation(); openArticle(a); });
                    li.append(b); ol.append(li);
                });
                out.append(ol);
            }
            out.scrollIntoView && out.scrollIntoView({ block: 'nearest' });
        } catch (e) {
            if (!page.isConnected || mine !== ctl || (e && e.cancelled)) return;
            out.className = 'graph-cluster-answer is-error';
            out.textContent = (e && e.message) || T('AI request failed');
        } finally { if (trigger) trigger.disabled = false; }
    };

    if (st.withSummary) {
        const brief = el('button', 'graph-preview-open graph-cluster-brief');
        setIconLabel(brief, 'sparkles', unopened.length ? T('✨ Brief me on the {n} unopened', { n: unopened.length }) : T('✨ Brief me on this topic'));
        brief.type = 'button';
        brief.addEventListener('click', (e) => { e.stopPropagation(); run('', brief); });
        scroll.append(brief);
    }
    const actions = el('div', 'graph-cluster-actions');
    const show = el('button', 'button-secondary graph-cluster-show', T('Show list')); show.type = 'button';
    show.addEventListener('click', (e) => {
        e.stopPropagation(); if (ctl) ctl.abort(); page.remove();
        container.dispatchEvent(new CustomEvent('filter-by-tag', { detail: { tag: label }, bubbles: true, composed: true }));
    });
    actions.append(show);
    if (st.exportable) {
        const exp = el('button', 'button-secondary graph-cluster-md'); setIconLabel(exp, 'download', T('⬇ Markdown'));
        exp.type = 'button'; exp.title = T('Export these articles as a .zip of Markdown files');
        exp.addEventListener('click', async (e) => {
            e.stopPropagation(); exp.disabled = true;
            try {
                const m = await import('./markdownArchive.js');
                await m.exportHistoryMarkdown({ ids: list.filter(a => a.id && !a.feedStub).map(a => a.id), name: label });
            } finally { exp.disabled = false; }
        });
        actions.append(exp);
    }
    scroll.append(actions, out);

    const row = (a, dim) => {
        const li = el('li');
        const b = el('button', 'graph-cluster-open' + (dim ? ' is-opened' : '')); b.type = 'button';
        b.append(el('span', 'graph-cluster-open-t', title(a)));
        const meta = metaOf(a); if (meta) b.append(el('span', 'graph-cluster-open-m', meta));
        b.addEventListener('click', (e) => { e.stopPropagation(); openArticle(a); });
        li.append(b); return li;
    };
    if (unopened.length) {
        scroll.append(el('div', 'graph-cluster-h', T('Never opened')));
        const ul = el('ul', 'graph-cluster-list');
        unopened.slice(0, 5).forEach(a => ul.append(row(a, false)));
        scroll.append(ul);
        if (unopened.length > 5) scroll.append(el('div', 'graph-preview-date', T('and {n} more', { n: unopened.length - 5 })));
    }
    if (opened.length) {
        const det = el('details', 'graph-cluster-opened');
        det.append(el('summary', null, T('Opened ({n})', { n: opened.length })));
        const ul = el('ul', 'graph-cluster-list'); opened.slice(0, 20).forEach(a => ul.append(row(a, true))); det.append(ul);
        scroll.append(det);
    }

    const ask = el('form', 'graph-cluster-ask');
    const input = el('input'); input.type = 'text'; input.maxLength = 300;
    input.placeholder = T('Ask about these articles…'); input.setAttribute('aria-label', input.placeholder);
    const go = el('button', 'button-secondary', T('Ask')); go.type = 'submit';
    ask.append(input, go);
    ask.addEventListener('submit', (e) => { e.preventDefault(); const q = input.value.trim(); if (q) { run(q, go); input.value = ''; } });

    page.append(bar, scroll);
    if (st.withSummary) page.append(ask);
    container.appendChild(page);
    return page;
}
