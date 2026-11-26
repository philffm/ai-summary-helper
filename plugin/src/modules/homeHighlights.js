// modules/homeHighlights.js — highlighting in the briefing of the home page ("Today at a glance").
// A highlight is an ordinary record on a placeholder address for the briefing of that day, with via 'briefing', briefingDay
// and, when the marked paragraph names a source ([3]), cites = that article's address. The words are the briefing's, not the
// source's, so the record never sits on the source's page: nothing there (reader, notes, phone) may show them as a quote.
import { ancBuildIndex, ancMakeSelector } from '../content/anchor.js';
import { selectionIn, wrapRange, unwrapMarks, paintAll } from './readerHighlights.js';
import { pageKeyForUrl } from './pageKey.js';

/** .invalid never resolves; the address is the same on every device and in every brand. */
export const BRIEFING_PAGE = 'https://briefing.invalid/';
export const isBriefingPage = (url) => String(url || '').startsWith(BRIEFING_PAGE);

const pad = (n) => String(n).padStart(2, '0');
export const briefingPage = (day) => { const d = new Date(day); return BRIEFING_PAGE + d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); };

const newId = () => 'hl_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);

/** The address of the source the selected passage cites: the first chip after the selection in its paragraph, else the last one in it. */
export function citedSourceFor(root, range) {
    const start = range.startContainer.nodeType === 3 ? range.startContainer.parentElement : range.startContainer;
    const block = start && start.closest('li, p, h1, h2, h3, h4, blockquote');
    if (!block || !root.contains(block)) return '';
    const chips = [...block.querySelectorAll('a.rc-cite')];
    const after = chips.find((c) => range.comparePoint(c, 0) >= 0);   // 0 or 1: inside or behind the selection
    const chip = after || chips[chips.length - 1];
    return chip && /^https?:\/\//i.test(chip.href) ? chip.href : '';
}

/** The selected words without the source numbers. */
export function selectedText(range) {
    const part = range.cloneContents();
    part.querySelectorAll('.rc-cite').forEach((c) => c.remove());
    return part.textContent.replace(/\s+/g, ' ').trim();
}

/**
 * One highlighter for the page; attach() is called each time the briefing card is drawn.
 * deps: store (createHighlightStore), T, tell (message to the worker), doc
 */
export function createBriefingHighlighter({ store, T, tell = () => {}, doc = document }) {
    let root = null, day = 0, annotations = [], pop = null;

    const close = () => { if (pop) { pop.remove(); pop = null; } };

    /** A button right under `rect`, inside the scrolling text. */
    function offer(label, rect, run) {
        close();
        const b = doc.createElement('button'); b.type = 'button'; b.className = 'button-primary btn-sm hm-mark-pop'; b.textContent = label;
        const box = root.getBoundingClientRect();
        b.style.insetBlockStart = Math.round(rect.bottom - box.top + root.scrollTop + 6) + 'px';
        b.style.insetInlineStart = Math.max(0, Math.round(rect.left - box.left)) + 'px';
        b.addEventListener('mousedown', (e) => e.preventDefault());   // the selection stays while the button is pressed
        b.addEventListener('click', async () => { close(); await run(); });
        root.append(b); pop = b;
    }

    async function add(range) {
        const text = selectedText(range), selector = ancMakeSelector(ancBuildIndex(root), range);
        if (!text || !selector) return null;
        const cites = citedSourceFor(root, range);
        const hl = { id: newId(), url: briefingPage(day), ...(cites ? { cites } : {}), text, type: 'user', timestamp: new Date().toISOString(), v: 2,
            quote: { exact: selector.exact, prefix: selector.prefix, suffix: selector.suffix }, via: 'briefing', briefingDay: day };
        const marks = wrapRange(range, { 'data-hl-n': String(annotations.length), 'data-hl-id': hl.id, 'data-hl-type': 'user' });
        if (!marks.length) return null;
        annotations.push(hl); reach(marks);
        const sel = doc.defaultView.getSelection(); if (sel) sel.removeAllRanges();
        try { await store.apply([{ op: 'add', hl }]); } catch (_) { unwrapMarks(marks); annotations.pop(); return null; }
        return hl;
    }

    async function remove(id) {
        const hl = annotations.find((a) => a && a.id === id); if (!hl) return false;
        await store.apply([{ op: 'remove', page: pageKeyForUrl(hl.url), id }]);
        tell({ action: 'syncHlDeleted', ids: [id] });
        unwrapMarks([...root.querySelectorAll(`mark[data-hl-id="${id}"]`)]);
        annotations[annotations.indexOf(hl)] = null;
        return true;
    }

    /** Marks can be reached with the keyboard; Enter or a click offers to remove them. */
    function reach(marks) {
        for (const m of marks) {
            m.tabIndex = 0; m.setAttribute('role', 'button'); m.setAttribute('aria-label', T('Remove highlight') + ': ' + m.textContent);
        }
    }

    const markAt = (target) => { const m = target && target.closest && target.closest('mark[data-hl-id]'); return m && root && root.contains(m) ? m : null; };

    function check() {
        if (!root || !root.isConnected) return;
        const range = selectionIn(root, doc.defaultView);
        if (range) offer(T('Highlight'), range.getBoundingClientRect(), () => add(range.cloneRange()));
        else if (pop && !pop.dataset.remove) close();
    }
    let timer = 0;
    doc.addEventListener('selectionchange', () => { clearTimeout(timer); timer = setTimeout(check, 250); });
    doc.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') close();
        const m = (e.key === 'Enter' || e.key === ' ') && markAt(e.target);
        if (m) { e.preventDefault(); askRemove(m); pop.focus(); }
    });
    doc.addEventListener('click', (e) => { const m = markAt(e.target); if (m && !selectionIn(root, doc.defaultView)) askRemove(m); else if (pop && pop.dataset.remove && e.target !== pop) close(); });

    function askRemove(mark) {
        const id = mark.getAttribute('data-hl-id');
        offer(T('Remove highlight'), mark.getBoundingClientRect(), () => remove(id));
        pop.dataset.remove = '1';
    }

    return {
        add, remove,
        /** textRoot: the element with the briefing's text. Draws what was highlighted before. */
        async attach(textRoot, briefingDay) {
            close(); root = textRoot; day = briefingDay; annotations = [];
            let found = [];
            try { found = await store.forPage(pageKeyForUrl(briefingPage(day))); } catch (_) { return 0; }
            if (root !== textRoot) return 0;   // drawn again meanwhile
            annotations = found.filter((h) => h.type !== 'ghost' && !h.dismissed);
            const placed = paintAll([textRoot], annotations);
            reach(textRoot.querySelectorAll('mark[data-hl-id]'));
            return placed;
        },
    };
}
