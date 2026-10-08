// askThread.js — "Ask" on History cards: chat about any saved summary, not just the latest one.
// The thread opens right under the card; one composer is docked above the nav ("About: <title> ✕").
// Turns are the same ones the Summarize screen and the detail view use (StorageManager conversation API).
import StorageManager from './storageManager.js';
import { T, TN } from './feedI18n.js';
import { buildPrompt, parseAnswer, newTurn, answerPreview } from './conversation.js';
import { turnEl, renderAnswer } from './qaView.js';
import { aiComplete } from './feedAi.js';

const clip = (s, n) => { s = String(s || ''); return s.length > n ? s.slice(0, n - 1) + '…' : s; };

let active = null;      // { article, li, thread, turns, pool, content, summary, title }
let busy = false;
let dock = null;

const countLabel = (n) => TN(n, '💬 {n} reply', '💬 {n} replies');

/** The "💬 Ask" button (+ reply count) for a History card. null for feed placeholders. */
export function buildAskRow(article, li) {
    if (!article || article.feedStub || !article.id) return null;
    const row = document.createElement('div');
    row.className = 'card-actions ask-actions';
    const btn = document.createElement('button');
    btn.type = 'button'; btn.className = 'ask-btn';
    btn.textContent = T('💬 Ask');
    btn.setAttribute('aria-expanded', 'false');
    btn.addEventListener('click', (e) => { e.stopPropagation(); toggleAsk(article, li); });
    row.appendChild(btn);
    if (article.qaCount) {
        const c = document.createElement('button');
        c.type = 'button'; c.className = 'ask-count'; c.textContent = countLabel(article.qaCount);
        c.addEventListener('click', (e) => { e.stopPropagation(); toggleAsk(article, li); });
        row.appendChild(c);
    }
    return row;
}

function paintCount(a) {
    const row = a.li.querySelector('.ask-actions');
    if (!row) return;
    let c = row.querySelector('.ask-count');
    if (!a.turns.length) { if (c) c.remove(); return; }
    if (!c) {
        c = document.createElement('button'); c.type = 'button'; c.className = 'ask-count';
        c.addEventListener('click', (e) => { e.stopPropagation(); toggleAsk(a.article, a.li); });
        row.appendChild(c);
    }
    c.textContent = countLabel(a.turns.length);
}

function ensureDock() {
    if (dock && dock.isConnected) return dock;
    const list = document.getElementById('articleList');
    if (!list || !list.parentNode) return null;
    dock = document.createElement('div');
    dock.id = 'askDock'; dock.className = 'ask-dock'; dock.hidden = true;
    const chip = document.createElement('div'); chip.className = 'ask-chip';
    const lab = document.createElement('span'); lab.className = 'ask-chip-lab'; lab.textContent = T('About:');
    const ttl = document.createElement('b'); ttl.className = 'ask-chip-title';
    const x = document.createElement('button'); x.type = 'button'; x.className = 'ask-chip-x'; x.textContent = '✕';
    x.title = T('Close conversation'); x.setAttribute('aria-label', T('Close conversation'));
    x.addEventListener('click', () => closeAsk());
    chip.append(lab, ttl, x);
    const row = document.createElement('div'); row.className = 'ask-row';
    const input = document.createElement('input'); input.type = 'text'; input.className = 'ask-input';
    input.placeholder = T('Ask a follow-up…'); input.setAttribute('aria-label', T('Ask a follow-up…'));
    const send = document.createElement('button'); send.type = 'button'; send.className = 'ask-send'; send.textContent = '↑';
    send.title = T('Send'); send.setAttribute('aria-label', T('Send'));
    const go = () => { const q = input.value.trim(); if (q) send_(q); };
    send.addEventListener('click', go);
    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); go(); }
        else if (e.key === 'Escape') { e.stopPropagation(); closeAsk(); }
    });
    row.append(input, send);
    dock.append(chip, row);
    list.after(dock);
    return dock;
}

export function closeAsk() {
    if (!active) { if (dock) dock.hidden = true; return; }
    active.thread.remove();
    active.li.classList.remove('ask-open');
    const b = active.li.querySelector('.ask-btn'); if (b) b.setAttribute('aria-expanded', 'false');
    active = null;
    if (dock) { dock.hidden = true; const i = dock.querySelector('.ask-input'); if (i) i.value = ''; }
    const scr = document.getElementById('historyScreen'); if (scr) scr.classList.remove('asking');
}

async function toggleAsk(article, li) {
    if (busy) return;
    if (active && active.li === li) { closeAsk(); return; }
    closeAsk();
    const d = ensureDock(); if (!d) return;
    let full = null; let turns = [];
    try { full = await StorageManager.getArticleFull(article.id); } catch (_) { /* fall back to the index entry */ }
    try { turns = await StorageManager.getConversation(article.id); } catch (_) { turns = []; }
    if (!li.isConnected) return;
    const thread = document.createElement('div');
    thread.className = 'ask-thread';
    thread.addEventListener('click', (e) => e.stopPropagation());
    li.appendChild(thread);
    li.classList.add('ask-open');
    const b = li.querySelector('.ask-btn'); if (b) b.setAttribute('aria-expanded', 'true');
    active = {
        article, li, thread, turns: Array.isArray(turns) ? turns : [], pool: [],
        title: (full && full.title) || article.title || '', content: (full && full.content) || '', summary: (full && full.summary) || article.summary || ''
    };
    active.turns.forEach(t => thread.appendChild(turnOf(t)));
    renderSuggestions();
    d.querySelector('.ask-chip-title').textContent = clip(active.title || T('Summary'), 60);
    d.querySelector('.ask-chip-title').title = active.title || '';
    d.hidden = false;
    const scr = document.getElementById('historyScreen'); if (scr) scr.classList.add('asking');
    try { li.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); } catch (_) { /* cosmetic */ }
    d.querySelector('.ask-input').focus({ preventScroll: true });
}

const save = (a) => StorageManager.saveConversation(a.article.id, a.turns).catch(() => {});

function turnOf(t) {
    return turnEl(t, {
        onPin: () => { if (active) save(active); },
        onSource: (quote, chip) => {
            chip.classList.toggle('chat-src--open');
            chip.textContent = chip.classList.contains('chat-src--open') ? '¶ ' + quote : '¶ ' + (quote.length > 38 ? quote.slice(0, 37) + '…' : quote);
        }
    });
}

function renderSuggestions() {
    if (!active) return;
    active.thread.querySelector('.chat-suggest')?.remove();
    const asked = new Set(active.turns.map(t => t.q.trim().toLowerCase()));
    active.pool = (active.pool || []).filter((q, i, arr) => !asked.has(q.trim().toLowerCase()) && arr.findIndex(x => x.trim().toLowerCase() === q.trim().toLowerCase()) === i);
    const sug = document.createElement('div'); sug.className = 'chat-suggest';
    active.pool.slice(0, 3).forEach((q) => {
        const c = document.createElement('button'); c.type = 'button'; c.className = 'chat-suggest-chip'; c.textContent = q;
        c.addEventListener('click', () => send_(q));
        sug.appendChild(c);
    });
    if (sug.children.length) active.thread.appendChild(sug);
}

async function send_(q) {
    const a = active;
    if (!a || !q || busy) return;
    busy = true;
    const input = dock && dock.querySelector('.ask-input'); if (input) { input.value = ''; input.disabled = true; }
    const send = dock && dock.querySelector('.ask-send'); if (send) send.disabled = true;
    a.thread.querySelector('.chat-suggest')?.remove();
    const qEl = document.createElement('div'); qEl.className = 'chat-turn chat-q'; qEl.textContent = q;
    const ans = document.createElement('div'); ans.className = 'chat-turn chat-a chat-a--pending'; ans.textContent = T('Thinking…');
    a.thread.append(qEl, ans);
    const keepInView = () => { try { ans.scrollIntoView({ block: 'nearest' }); } catch (_) { /* cosmetic */ } };
    keepInView();
    try {
        const { system, user } = buildPrompt({ title: a.title, content: a.content, summary: a.summary, turns: a.turns, question: q });
        const raw = await aiComplete(system, user, null, null, (m) => {
            const t = m && m.text ? answerPreview(m.text) : '';
            if (t) { ans.classList.remove('chat-a--pending'); renderAnswer(ans, t); keepInView(); }
        }, { partial: true });
        const { a: text, sources, questions } = parseAnswer(raw, a.content);
        const turn = newTurn(a.turns, { q, a: text || T('No answer.'), sources });
        a.turns.push(turn);
        a.article.qaCount = a.turns.length;
        const el = turnOf(turn);
        qEl.remove(); ans.replaceWith(el);
        a.pool = [...(questions || []), ...(a.pool || [])];
        if (active === a) renderSuggestions();
        paintCount(a);
        await save(a);
    } catch (err) {
        ans.textContent = '❌ ' + ((err && err.message) || T('AI request failed'));
        ans.classList.remove('chat-a--pending');
        if (active === a) renderSuggestions();
    }
    busy = false;
    if (input) { input.disabled = false; input.focus({ preventScroll: true }); }
    if (send) send.disabled = false;
    keepInView();
}
