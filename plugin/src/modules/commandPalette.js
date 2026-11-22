// commandPalette.js — ⌘K / Ctrl+K: one box for "go there", "do that" and "find that article".
// Pure part (rankCommands) is tested without a DOM; openPalette() is the dialog. The commands come from commands.js.
import { T } from './feedI18n.js';
import { trapFocus } from './sheet.js';

const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

/** 0 = no match. Every word of the query must occur; earlier / whole-word / title hits score higher. */
export function scoreCommand(cmd, query) {
    const words = norm(query).split(/\s+/).filter(Boolean);
    if (!words.length) return 1;
    const title = norm(cmd.title), hay = title + ' ' + norm(cmd.keywords) + ' ' + norm(cmd.sub);
    let total = 0;
    for (const w of words) {
        const at = title.indexOf(w);
        if (at === 0) total += 6;
        else if (at > 0) total += title[at - 1] === ' ' ? 4 : 2;
        else if (hay.includes(w)) total += 1;
        else return 0;
    }
    return total;
}

/** Commands matching `query`, best first (stable for equal scores). With no query: the given order. */
export function rankCommands(commands, query, { limit = 12 } = {}) {
    return commands.map((c, i) => ({ c, i, s: scoreCommand(c, query) })).filter((r) => r.s > 0)
        .sort((a, b) => (b.s - a.s) || (a.i - b.i)).slice(0, limit).map((r) => r.c);
}

let open = null;
export const paletteOpen = () => !!open;
export function closePalette() { if (open) open.close(); }

/**
 * getCommands(): commands synchronously (shown at once). findMore(query): optional async source (articles) appended after them.
 * A command: { id, title, sub?, group, keywords?, keys?, run() }.
 */
export function openPalette({ getCommands, findMore, doc = document }) {
    if (open) { closePalette(); return; }
    const mk = (tag, cls, text) => { const e = doc.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; };
    const root = mk('div', 'cmdk');
    const scrim = mk('div', 'cmdk-scrim');
    const panel = mk('div', 'cmdk-panel');
    const input = mk('input', 'cmdk-input'); input.type = 'text'; input.placeholder = T('Type a command or search your articles…'); input.setAttribute('aria-label', T('Command palette'));
    input.setAttribute('role', 'combobox'); input.setAttribute('aria-expanded', 'true'); input.setAttribute('aria-controls', 'cmdkList'); input.autocomplete = 'off'; input.spellcheck = false;
    const list = mk('ul', 'cmdk-list'); list.id = 'cmdkList'; list.setAttribute('role', 'listbox');
    const empty = mk('div', 'cmdk-empty', T('Nothing found')); empty.hidden = true;
    panel.append(input, list, empty); root.append(scrim, panel);

    let shown = [], active = 0, token = 0;
    const base = getCommands();
    const paint = () => {
        list.textContent = '';
        let group = null;
        shown.forEach((c, i) => {
            if (c.group !== group) { group = c.group; const h = mk('li', 'cmdk-group', group); h.setAttribute('role', 'presentation'); list.append(h); }
            const li = mk('li', 'cmdk-item'); li.id = 'cmdk-' + i; li.setAttribute('role', 'option'); li.setAttribute('aria-selected', String(i === active));
            li.append(mk('span', 'cmdk-title', c.title));
            if (c.sub) li.append(mk('span', 'cmdk-sub', c.sub));
            if (c.keys) { const k = mk('span', 'cmdk-keys'); c.keys.forEach((x) => k.append(mk('kbd', 'kbd-key', x))); li.append(k); }
            li.addEventListener('pointermove', () => { if (active !== i) { active = i; mark(); } });
            li.addEventListener('click', () => run(i));
            list.append(li);
        });
        empty.hidden = shown.length > 0;
        input.setAttribute('aria-activedescendant', shown.length ? 'cmdk-' + active : '');
    };
    const mark = () => {
        list.querySelectorAll('.cmdk-item').forEach((li, i) => li.setAttribute('aria-selected', String(i === active)));
        input.setAttribute('aria-activedescendant', 'cmdk-' + active);
        const cur = doc.getElementById('cmdk-' + active); if (cur && cur.scrollIntoView) cur.scrollIntoView({ block: 'nearest' });
    };
    const update = async () => {
        const q = input.value, mine = ++token;
        shown = rankCommands(base, q); active = 0; paint();
        if (findMore && q.trim().length >= 2) {
            let more = []; try { more = await findMore(q) || []; } catch (_) { /* the commands stay */ }
            if (mine !== token || !open) return;
            shown = shown.concat(more); paint();
        }
    };
    function run(i) { const c = shown[i]; if (!c) return; close(); Promise.resolve().then(() => c.run()); }
    const trap = trapFocus(root, { label: T('Command palette') });
    function close() { if (!open) return; open = null; trap.release(); root.remove(); }
    open = { close };
    input.addEventListener('input', update);
    root.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); }
        else if (e.key === 'ArrowDown') { e.preventDefault(); if (shown.length) { active = (active + 1) % shown.length; mark(); } }
        else if (e.key === 'ArrowUp') { e.preventDefault(); if (shown.length) { active = (active - 1 + shown.length) % shown.length; mark(); } }
        else if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); run(active); }
    });
    scrim.addEventListener('click', close);
    doc.body.append(root);
    shown = rankCommands(base, ''); paint(); input.focus();
}
