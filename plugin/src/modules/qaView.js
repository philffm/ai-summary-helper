// qaView.js — DOM for follow-up turns, shared by the Summarize feed and the History detail.
import { T, TN } from './feedI18n.js';
import { pinnedCount, cleanAnswer } from './conversation.js';

/** One Q&A turn: question bubble, answer bubble with 📌 pin toggle and ¶ source chips. */
/** Safe renderer for cleaned answer text: headings, paragraphs, lists, **bold** / *italic* / `code` and pipe tables (DOM nodes only, no innerHTML). */
const TABLE_ROW = /^\s*\|.*\|\s*$/;
const TABLE_SEP = /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/;
const LIST_ITEM = /^\s*([-*\u2022]|\d+[.)])\s+/;
const cells = (line) => line.trim().replace(/^\|/, '').replace(/\|\s*$/, '').split('|').map(c => c.trim());

/** **bold**, *italic* and `code` inside one line, as DOM nodes (also used for single recap bullets). */
export function renderInline(parent, line) {
    String(line || '').split(/(\*\*[^*]+\*\*|`[^`]+`|(?<![*\w])\*[^*\s][^*]*\*(?![*\w]))/).forEach((part) => {
        if (/^\*\*[^*]+\*\*$/.test(part)) { const b = document.createElement('strong'); b.textContent = part.slice(2, -2); parent.appendChild(b); }
        else if (/^`[^`]+`$/.test(part)) { const c = document.createElement('code'); c.textContent = part.slice(1, -1); parent.appendChild(c); }
        else if (/^\*[^*]+\*$/.test(part)) { const i = document.createElement('em'); i.textContent = part.slice(1, -1); parent.appendChild(i); }
        else if (part) parent.appendChild(document.createTextNode(part));
    });
}

export function renderAnswer(target, text) {
    target.replaceChildren();
    const inline = renderInline;
    const lines = String(text || '').split('\n');
    let para = [], items = [], ordered = false;
    const flushPara = () => {
        if (!para.length) return;
        const p = document.createElement('p');
        para.forEach((l, i) => { if (i) p.appendChild(document.createElement('br')); inline(p, l); });
        target.appendChild(p); para = [];
    };
    const flushList = () => {
        if (!items.length) return;
        const ul = document.createElement(ordered ? 'ol' : 'ul');
        items.forEach(l => { const li = document.createElement('li'); inline(li, l); ul.appendChild(li); });
        target.appendChild(ul); items = [];
    };
    const flush = () => { flushPara(); flushList(); };
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (!line.trim()) { flush(); continue; }
        const h = line.match(/^\s*(#{1,6})\s+(.*?)\s*#*\s*$/);
        if (h) { flush(); const el = document.createElement('h' + Math.min(6, Math.max(3, h[1].length + 1))); el.className = 'md-h'; inline(el, h[2]); target.appendChild(el); continue; }
        if (TABLE_ROW.test(line) && i + 1 < lines.length && TABLE_SEP.test(lines[i + 1])) {
            flush();
            const head = cells(line);
            const align = cells(lines[i + 1]).map(c => (/^:-+:$/.test(c) ? 'center' : /-:$/.test(c) ? 'right' : ''));
            const wrap = document.createElement('div'); wrap.className = 'md-table-wrap';
            const table = document.createElement('table'); table.className = 'md-table';
            const thead = table.createTHead().insertRow();
            head.forEach((c, k) => { const th = document.createElement('th'); th.scope = 'col'; if (align[k]) th.style.textAlign = align[k]; inline(th, c); thead.appendChild(th); });
            const tbody = table.createTBody();
            let j = i + 2;
            while (j < lines.length && TABLE_ROW.test(lines[j])) {
                const tr = tbody.insertRow();
                const row = cells(lines[j]);
                head.forEach((_, k) => { const td = tr.insertCell(); if (align[k]) td.style.textAlign = align[k]; inline(td, row[k] || ''); });
                j++;
            }
            wrap.appendChild(table); target.appendChild(wrap);
            i = j - 1; continue;
        }
        if (LIST_ITEM.test(line)) {
            flushPara();
            const isOrdered = /^\s*\d+[.)]\s+/.test(line);
            if (items.length && isOrdered !== ordered) flushList();
            ordered = isOrdered;
            items.push(line.replace(LIST_ITEM, '')); continue;
        }
        flushList(); para.push(line);
    }
    flush();
}

export function turnEl(turn, { onPin, onSource } = {}) {
    const wrap = document.createElement('div');
    wrap.className = 'chat-turn-group';
    wrap.dataset.turn = turn.id;
    const q = document.createElement('div'); q.className = 'chat-q'; q.textContent = turn.q;
    const a = document.createElement('div'); a.className = 'chat-a';
    const body = document.createElement('div'); body.className = 'chat-a-body'; renderAnswer(body, cleanAnswer(turn.a));
    a.appendChild(body);
    const foot = document.createElement('div'); foot.className = 'chat-a-foot';
    (turn.sources || []).forEach((src) => {
        const c = document.createElement('button');
        c.type = 'button'; c.className = 'chat-src'; c.title = src;
        c.textContent = '¶ ' + (src.length > 38 ? src.slice(0, 37) + '…' : src);
        c.addEventListener('click', (e) => { e.stopPropagation(); if (onSource) onSource(src, c); });
        foot.appendChild(c);
    });
    const pin = document.createElement('button');
    pin.type = 'button'; pin.className = 'chat-pin';
    const paint = () => {
        pin.setAttribute('aria-pressed', String(!!turn.pinned));
        pin.textContent = turn.pinned ? T('📌 In article') : T('📍 Add to article');
        pin.title = turn.pinned ? T('Shown in the article and included in exports') : T('Only in the conversation log');
    };
    paint();
    pin.addEventListener('click', (e) => { e.stopPropagation(); turn.pinned = !turn.pinned; paint(); if (onPin) onPin(turn); });
    foot.appendChild(pin);
    a.appendChild(foot);
    wrap.append(q, a);
    return wrap;
}

/** History detail: pinned turns inline, the rest collapsed ("N more questions"), plus the export switch. */
export function qaSection(turns, { onPin, onSource, includeAll = false, onIncludeAll } = {}) {
    const root = document.createElement('div');
    root.className = 'qa-section';
    if (!turns || !turns.length) return root;
    const pinned = turns.filter(t => t.pinned);
    const rest = turns.filter(t => !t.pinned);
    const h = document.createElement('strong'); h.className = 'qa-title'; h.textContent = '💬 ' + T('Your questions');
    root.appendChild(h);
    pinned.forEach(t => root.appendChild(turnEl(t, { onPin, onSource })));
    if (rest.length) {
        const det = document.createElement('details'); det.className = 'qa-more';
        const sum = document.createElement('summary');
        sum.textContent = TN(rest.length, '{n} more question', '{n} more questions');
        det.appendChild(sum);
        rest.forEach(t => det.appendChild(turnEl(t, { onPin, onSource })));
        root.appendChild(det);
    }
    if (rest.length || pinnedCount(turns) < turns.length) {
        const lab = document.createElement('label'); lab.className = 'qa-all';
        const cb = document.createElement('input'); cb.type = 'checkbox'; cb.checked = !!includeAll;
        cb.addEventListener('change', () => { if (onIncludeAll) onIncludeAll(cb.checked); });
        lab.append(cb, document.createTextNode(' ' + T('Include all questions in exports')));
        root.appendChild(lab);
    }
    return root;
}
