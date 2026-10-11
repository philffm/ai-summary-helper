// graphClusters.js — what you can DO with a topic in the graph: tap a tag node and get a card with the unopened
// articles of that topic, a one-tap briefing, a question box (both answered only from the saved summaries) and a
// Markdown export of just that cluster. Everything shown is set as text; AI output goes through the safe renderer.
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

export function showClusterCard(container, { label, articles }) {
    container.querySelectorAll('.graph-preview-card').forEach(c => c.remove());
    const list = (articles || []).slice().sort((a, b) => new Date(a.lastOpened || a.timestamp) - new Date(b.lastOpened || b.timestamp));
    const st = clusterStats(list);
    const unopened = list.filter(a => !isOpened(a));
    const focus = unopened.length ? unopened : list;   // the briefing covers what was never opened, else the whole topic

    const card = el('div', 'graph-preview-card graph-cluster-card');
    const head = el('div', 'graph-preview-head');
    head.append(el('strong', null, label));
    const close = el('button', 'graph-preview-card-close', '✕');
    close.type = 'button'; close.setAttribute('aria-label', T('Close'));
    close.addEventListener('click', (e) => { e.stopPropagation(); card.remove(); });
    head.append(close);

    const scroll = el('div', 'graph-preview-card-scroll');
    scroll.append(el('div', 'graph-preview-date', TN(st.total, '{n} article', '{n} articles') + ' · ' + T('{n} never opened', { n: st.unopened })));

    if (unopened.length) {
        const ul = el('ul', 'graph-cluster-list');
        unopened.slice(0, 5).forEach(a => {
            const li = el('li');
            const b = el('button', 'graph-cluster-open', title(a));
            b.type = 'button';
            b.addEventListener('click', (e) => {
                e.stopPropagation();
                container.dispatchEvent(new CustomEvent('open-article', { detail: a, bubbles: true, composed: true }));
            });
            li.append(b); ul.append(li);
        });
        scroll.append(ul);
        if (unopened.length > 5) scroll.append(el('div', 'graph-preview-date', T('and {n} more', { n: unopened.length - 5 })));
    }

    const out = el('div', 'graph-cluster-answer');
    out.setAttribute('aria-live', 'polite');
    let ctl = null;
    const run = async (question, trigger) => {
        if (ctl) ctl.abort();
        ctl = new AbortController();
        const mine = ctl;
        out.className = 'graph-cluster-answer is-busy';
        out.textContent = T('Reading {n} summaries…', { n: Math.min(focus.filter(hasText).length, 15) });
        trigger.disabled = true;
        try {
            const { askCluster } = await import('./feedAi.js');
            const { renderAnswer } = await import('./qaView.js');
            const r = await askCluster(question ? list : focus, { topic: label, question }, { signal: mine.signal });
            if (!card.isConnected || mine !== ctl) return;
            out.className = 'graph-cluster-answer md-body';
            out.textContent = '';
            renderAnswer(out, r.text);
            linkCitations(out, r.articles, (a) => container.dispatchEvent(new CustomEvent('open-article', { detail: a, bubbles: true, composed: true })));
            out.append(el('div', 'graph-preview-date', T('From {n} summaries — nothing else was sent', { n: r.used })));
        } catch (e) {
            if (!card.isConnected || mine !== ctl || (e && e.cancelled)) return;
            out.className = 'graph-cluster-answer is-error';
            out.textContent = (e && e.message) || T('AI request failed');
        } finally { trigger.disabled = false; }
    };

    const ask = el('form', 'graph-cluster-ask');
    const input = el('input'); input.type = 'text'; input.maxLength = 300;
    input.placeholder = T('Ask about these articles…'); input.setAttribute('aria-label', input.placeholder);
    const go = el('button', 'button-secondary', T('Ask')); go.type = 'submit';
    ask.append(input, go);
    ask.addEventListener('submit', (e) => { e.preventDefault(); const q = input.value.trim(); if (q) run(q, go); });
    if (st.withSummary) scroll.append(ask);
    scroll.append(out);

    const foot = el('div', 'graph-preview-foot graph-cluster-foot');
    const show = el('button', 'button-secondary', T('Show list'));
    show.type = 'button';
    show.addEventListener('click', (e) => {
        e.stopPropagation(); card.remove();
        container.dispatchEvent(new CustomEvent('filter-by-tag', { detail: { tag: label }, bubbles: true, composed: true }));
    });
    foot.append(show);
    if (st.withSummary) {
        const brief = el('button', 'graph-preview-open');
        setIconLabel(brief, 'sparkles', unopened.length ? T('✨ Brief me on the {n} unopened', { n: unopened.length }) : T('✨ Brief me on this topic'));
        brief.type = 'button';
        brief.addEventListener('click', (e) => { e.stopPropagation(); run('', brief); });
        foot.append(brief);
    }
    if (st.exportable) {
        const exp = el('button', 'button-secondary');
        setIconLabel(exp, 'download', T('⬇ Markdown'));
        exp.type = 'button'; exp.title = T('Export these articles as a .zip of Markdown files');
        exp.addEventListener('click', async (e) => {
            e.stopPropagation(); exp.disabled = true;
            try {
                const m = await import('./markdownArchive.js');
                await m.exportHistoryMarkdown({ ids: list.filter(a => a.id && !a.feedStub).map(a => a.id), name: label });
            } finally { exp.disabled = false; }
        });
        foot.append(exp);
    }
    card.append(head, scroll, foot);
    container.appendChild(card);
    return card;
}
