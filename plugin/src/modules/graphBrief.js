// graphBrief.js — briefings above one topic: select several topics on the graph (long-press or ⇧/Ctrl/⌘-tap) and/or set the Time window,
// and a floating bar offers "Brief" for exactly that scope. Same engine as the cluster page: stored summaries only, duplicates removed,
// groups of 15 merged in steps. The result toggles between "By topic" and "By time".
import { T, TN } from './feedI18n.js';
import { el } from './dom.js';
import { setIconLabel } from './icons.js';
import { dedupeArticles } from './textUtils.js';
import { fillAnswer, mountGraphPage } from './graphClusters.js';

export const BRIEF_CAP = 60;     // = CLUSTER_MAX * CLUSTER_RUNS in feedAi.js
export const BRIEF_CHUNK = 15;

const title = (a) => a.title || (a.content && String(a.content).split('\n')[0]) || T('Untitled');
const monthLabel = (i) => new Date(Math.floor(i / 12), i % 12, 1).toLocaleDateString(undefined, { month: 'short', year: 'numeric' });

/** Requests needed for n articles: one per group of 15, plus one merge when there is more than one group. Pure. */
export function briefSteps(n) {
    const used = Math.min(n, BRIEF_CAP);
    return used <= BRIEF_CHUNK ? 1 : Math.ceil(used / BRIEF_CHUNK) + 1;
}

/**
 * The articles a bar-brief covers. `selected` empty = every topic. `range` = { from, to, full } (month indexes) or null.
 * Returns { articles (newest first, duplicates removed), topics: [{ id, label, n }] (only topics with something in scope), duplicates }. Pure.
 */
export function scopeArticles({ topics, membersOf, selected, range, monthIndex, includeOpened = true }) {
    const chosen = (selected && selected.size ? topics.filter(t => selected.has(t.id)) : topics);
    const inRange = (a) => {
        if (!range || range.full) return true;
        const t = new Date(a.timestamp).getTime();
        if (!Number.isFinite(t)) return true;
        const m = monthIndex(t);
        return m >= range.from && m <= range.to;
    };
    const byId = new Map();
    const perTopic = [];
    chosen.forEach((t) => {
        const mem = (membersOf(t.id) || []).filter(a => inRange(a) && (includeOpened || !a.lastOpened));
        if (!mem.length) return;
        perTopic.push({ id: t.id, label: t.label, n: mem.length });
        mem.forEach(a => { if (!byId.has(a.id || a)) byId.set(a.id || a, a); });
    });
    const union = [...byId.values()];
    const articles = dedupeArticles(union).sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    return { articles, topics: perTopic, duplicates: union.length - articles.length };
}

/** The result page: "By topic | By time" toggle, answer with citation pills, docked question box. */
export function openBriefPage(container, { heading, subtitle, articles, layout = 'time' }) {
    container.querySelectorAll('.graph-preview-card').forEach(c => c.remove());
    const openArticle = (a) => container.dispatchEvent(new CustomEvent('open-article', { detail: a, bubbles: true, composed: true }));
    let close = () => {};
    const page = el('div', 'graph-cluster-page graph-brief-page');
    let ctl = null;
    const bar = el('div', 'graph-cluster-bar');
    const back = el('button', 'graph-cluster-back', '←'); back.type = 'button'; back.setAttribute('aria-label', T('Back'));
    back.addEventListener('click', (e) => { e.stopPropagation(); close(); });
    const ttl = el('div', 'graph-cluster-ttl');
    ttl.append(el('strong', 'graph-cluster-title', heading), el('div', 'graph-preview-date', subtitle));
    bar.append(back, ttl);
    const scroll = el('div', 'graph-cluster-scroll');
    const seg = el('div', 'graph-brief-seg'); seg.setAttribute('role', 'group'); seg.setAttribute('aria-label', T('Briefing layout'));
    const out = el('div', 'graph-cluster-answer'); out.setAttribute('aria-live', 'polite');
    const cache = {};
    let current = layout;
    const run = async (lay, question) => {
        if (ctl) ctl.abort();
        ctl = new AbortController(); const mine = ctl;
        if (!question && cache[lay]) { await fillAnswer(out, cache[lay], openArticle); return; }
        out.className = 'graph-cluster-answer is-busy';
        const readN = Math.min(articles.length, BRIEF_CAP);
        out.textContent = T('Reading {n} summaries…', { n: readN });
        try {
            const { askCluster } = await import('./feedAi.js');
            const r = await askCluster(articles, { topic: heading, question, layout: question ? '' : lay }, { signal: mine.signal, onPart: ({ done, total }) => { if (mine === ctl && out.classList.contains('is-busy')) out.textContent = T('Reading {n} summaries · step {a} of {b}…', { n: readN, a: Math.min(done + 1, total), b: total }); } });
            if (!page.isConnected || mine !== ctl) return;
            r.question = question || '';
            if (!question) cache[lay] = r;
            await fillAnswer(out, r, openArticle);
        } catch (e) {
            if (!page.isConnected || mine !== ctl || (e && e.cancelled)) return;
            out.className = 'graph-cluster-answer is-error';
            out.textContent = (e && e.message) || T('AI request failed');
        }
    };
    const btns = {};
    [['topic', T('By topic')], ['time', T('By time')]].forEach(([id, label]) => {
        const b = el('button', null, label); b.type = 'button'; btns[id] = b;
        b.addEventListener('click', () => { current = id; paint(); run(id); });
        seg.append(b);
    });
    const paint = () => Object.entries(btns).forEach(([id, b]) => { b.setAttribute('aria-pressed', String(id === current)); b.classList.toggle('on', id === current); });
    paint();
    const exp = el('button', 'button-secondary graph-cluster-md'); setIconLabel(exp, 'download', T('⬇ Markdown'));
    exp.type = 'button'; exp.title = T('Export these articles (and the briefing, if you made one) as a .zip of Markdown files');
    exp.addEventListener('click', async () => {
        exp.disabled = true;
        try {
            const m = await import('./markdownArchive.js');
            await m.exportHistoryMarkdown({ ids: articles.filter(a => a.id && !a.feedStub).map(a => a.id), name: heading, briefing: { title: heading, results: out.__results || [] } });
        } finally { exp.disabled = false; }
    });
    const actions = el('div', 'graph-cluster-actions'); actions.append(exp);
    scroll.append(seg, actions, out);
    const ask = el('form', 'graph-cluster-ask');
    const input = el('input'); input.type = 'text'; input.maxLength = 300;
    input.placeholder = T('Ask about this briefing…'); input.setAttribute('aria-label', input.placeholder);
    const go = el('button', 'button-secondary', T('Ask')); go.type = 'submit';
    ask.append(input, go);
    ask.addEventListener('submit', (e) => { e.preventDefault(); const q = input.value.trim(); if (q) { run(current, q); input.value = ''; } });
    page.append(bar, scroll, ask);
    close = mountGraphPage(container, page, heading, () => { if (ctl) ctl.abort(); });
    run(current);
    return page;
}

/**
 * The floating action bar. ctx: { topics:[{id,label}], membersOf(id), monthIndex, onSelection(Set) }.
 * Shown while topics are selected or a time window is active. Returns { toggle(id), has(id), clear(), setRange(r), size, destroy() }.
 */
export function createGraphBrief(container, ctx) {
    const sel = new Set();
    let range = null, includeOpened = true, expanded = false;
    const bar = el('div', 'graph-brief-bar'); bar.hidden = true;
    bar.setAttribute('role', 'region'); bar.setAttribute('aria-label', T('Briefing scope'));
    // Polite announcement of what the scope is (the bar itself is rebuilt on every change, so it cannot be the live region).
    const live = el('div', 'sr-only'); live.setAttribute('role', 'status'); live.setAttribute('aria-live', 'polite');
    container.append(bar, live);
    // Escape: close the options first, then clear the topic selection.
    bar.addEventListener('keydown', (e) => {
        if (e.key !== 'Escape' || e.defaultPrevented) return;
        if (expanded) { e.preventDefault(); e.stopPropagation(); expanded = false; render(); const h = bar.querySelector('.graph-brief-head'); if (h) h.focus(); }
        else if (sel.size) { e.preventDefault(); e.stopPropagation(); api.clear(); }
    });
    const windowLabel = () => (range && !range.full ? monthLabel(range.from) + ' – ' + monthLabel(range.to) : '');
    const scope = () => scopeArticles({ topics: ctx.topics, membersOf: ctx.membersOf, selected: sel, range, monthIndex: ctx.monthIndex, includeOpened });
    const active = () => sel.size > 0 || !!(range && !range.full);

    const go = () => {
        const sc = scope();
        if (!sc.articles.length) return;
        const win = windowLabel();
        const heading = sel.size ? sc.topics.map(t => t.label).slice(0, 3).join(' + ') + (sc.topics.length > 3 ? ' +' + (sc.topics.length - 3) : '') : T('All topics') + (win ? ' · ' + win : '');
        openBriefPage(container, {
            heading,
            subtitle: T('Briefing') + (win && sel.size ? ' · ' + win : '') + ' · ' + TN(sc.articles.length, '{n} summary', '{n} summaries'),
            articles: sc.articles,
            layout: sel.size ? 'topic' : 'time'
        });
    };

    const chip = (t, on) => {
        const b = el('button', 'graph-brief-chip' + (on ? ' on' : ''), (on ? '✓ ' : '') + t.label + ' · ' + t.n);
        b.type = 'button'; b.setAttribute('aria-pressed', String(on));
        b.addEventListener('click', (e) => {
            e.stopPropagation();
            const eff = new Set((sel.size ? sel : new Set(scopeArticles({ topics: ctx.topics, membersOf: ctx.membersOf, selected: new Set(), range, monthIndex: ctx.monthIndex, includeOpened }).topics.map(x => x.id))));
            if (eff.has(t.id)) eff.delete(t.id); else eff.add(t.id);
            sel.clear(); eff.forEach(id => sel.add(id)); ctx.onSelection && ctx.onSelection(sel); render();
        });
        return b;
    };
    const segBtns = (name, items, cur, onPick) => {
        const w = el('div', 'graph-brief-seg graph-brief-seg-sm'); w.setAttribute('role', 'group'); w.setAttribute('aria-label', name);
        items.forEach(([id, label]) => {
            const b = el('button', cur === id ? 'on' : null, label); b.type = 'button'; b.setAttribute('aria-pressed', String(cur === id));
            b.addEventListener('click', (e) => { e.stopPropagation(); onPick(id); }); w.append(b);
        });
        return w;
    };

    function render() {
        bar.hidden = !active();
        if (bar.hidden) { bar.replaceChildren(); expanded = false; return; }
        const sc = scope();
        const n = sc.articles.length;
        const win = windowLabel();
        const head = el('button', 'graph-brief-head'); head.type = 'button'; head.setAttribute('aria-expanded', String(expanded));
        const strong = el('strong', null, sel.size ? TN(sc.topics.length, '{n} topic', '{n} topics') + ' · ' + TN(n, '{n} article', '{n} articles') : T('All topics') + ' · ' + T('{n} shown', { n: sc.topics.length }));
        const sub = el('span', 'graph-preview-date', [win, sel.size ? '' : TN(n, '{n} article', '{n} articles'), sc.duplicates ? T('{n} duplicates skipped', { n: sc.duplicates }) : ''].filter(Boolean).join(' · '));
        head.append(strong, sub);
        head.addEventListener('click', () => { expanded = !expanded; render(); });
        const briefBtn = el('button', 'graph-preview-open graph-brief-go'); briefBtn.type = 'button';
        setIconLabel(briefBtn, 'sparkles', T('✨ Brief'));
        briefBtn.disabled = !n;
        briefBtn.addEventListener('click', (e) => { e.stopPropagation(); go(); });
        const row = el('div', 'graph-brief-row'); row.append(head, briefBtn);
        if (sel.size) {
            const x = el('button', 'graph-preview-card-close', '✕'); x.type = 'button'; x.setAttribute('aria-label', T('Clear selection'));
            x.addEventListener('click', (e) => { e.stopPropagation(); api.clear(); });
            row.append(x);
        }
        const kids = [row];
        if (expanded) {
            const panel = el('div', 'graph-brief-panel');
            const all = scopeArticles({ topics: ctx.topics, membersOf: ctx.membersOf, selected: new Set(), range, monthIndex: ctx.monthIndex, includeOpened });
            const chips = el('div', 'graph-brief-chips');
            all.topics.forEach(t => chips.append(chip(t, !sel.size || sel.has(t.id))));
            panel.append(chips);
            panel.append(segBtns(T('Which articles'), [['all', T('Opened too')], ['new', T('Unopened')]], includeOpened ? 'all' : 'new', (id) => { includeOpened = id === 'all'; render(); }));
            const steps = briefSteps(n);
            const info = el('div', 'graph-brief-info');
            info.append(el('div', null, TN(n, '{n} article', '{n} articles') + (sc.duplicates ? ' · ' + T('{n} duplicates skipped', { n: sc.duplicates }) : '') + (steps > 1 ? ' · ' + T('{n} steps, then merged', { n: steps }) : '')));
            if (n > BRIEF_CAP) info.append(el('div', 'graph-preview-date', T('Over {n} articles only the {n} newest are used; narrow topics or period for full coverage.', { n: BRIEF_CAP })));
            panel.append(info);
            kids.push(panel);
        }
        const hadFocus = bar.contains(document.activeElement) ? (document.activeElement.className || '') : '';
        bar.replaceChildren(...kids);
        if (hadFocus) { const again = hadFocus.split(' ').filter(Boolean).map(c => bar.querySelector('.' + c)).find(Boolean); if (again && again !== document.activeElement) again.focus({ preventScroll: true }); }
        live.textContent = strong.textContent + (win ? ', ' + win : '');
    }

    const api = {
        get size() { return sel.size; },
        has: (id) => sel.has(id),
        toggle(id) { if (sel.has(id)) sel.delete(id); else sel.add(id); ctx.onSelection && ctx.onSelection(sel); render(); },
        clear() { sel.clear(); ctx.onSelection && ctx.onSelection(sel); render(); },
        setRange(r) { range = r && !r.full ? r : null; render(); },
        scope, render,
        destroy() { bar.remove(); live.remove(); }
    };
    return api;
}
