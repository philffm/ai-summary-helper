// qaView.js — DOM for follow-up turns, shared by the Summarize feed and the History detail.
import { T, TN } from './feedI18n.js';
import { pinnedCount } from './conversation.js';

/** One Q&A turn: question bubble, answer bubble with 📌 pin toggle and ¶ source chips. */
export function turnEl(turn, { onPin, onSource } = {}) {
    const wrap = document.createElement('div');
    wrap.className = 'chat-turn-group';
    wrap.dataset.turn = turn.id;
    const q = document.createElement('div'); q.className = 'chat-q'; q.textContent = turn.q;
    const a = document.createElement('div'); a.className = 'chat-a';
    const body = document.createElement('div'); body.className = 'chat-a-body'; body.textContent = turn.a;
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
