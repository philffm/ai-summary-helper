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
 * The list itself: a search field, the ranked entries and an empty note, mounted into `container`. Used by the ⌘K overlay
 * (openPalette) and inline on the home page. getCommands(): entries shown at once; findMore(query): optional async source (articles).
 * An entry: { id, title, sub?, group, keywords?, keys?, run() }.
 * onRun(entry) runs after an entry was chosen (the overlay closes there); onEscape() when Esc is pressed in the field.
 * → { input, list, update(), focus(), destroy() }
 */
let seq = 0;
export function mountCommandList(container, { getCommands, findMore, onRun, onEscape, doc = document, expanded = true }) {
    const mk = (tag, cls, text) => { const e = doc.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; };
    const uid = 'cmdk' + (++seq);
    const input = mk('input', 'cmdk-input'); input.type = 'text'; input.placeholder = T('Type a command or search your articles…'); input.setAttribute('aria-label', T('Command palette'));
    input.setAttribute('role', 'combobox'); input.setAttribute('aria-expanded', String(expanded)); input.setAttribute('aria-controls', uid + '-list'); input.autocomplete = 'off'; input.spellcheck = false;
    const list = mk('ul', 'cmdk-list'); list.id = uid + '-list'; list.setAttribute('role', 'listbox');
    const empty = mk('div', 'cmdk-empty', T('Nothing found')); empty.hidden = true;
    container.append(input, list, empty);

    let shown = [], active = 0, token = 0, alive = true;
    const base = getCommands();
    const paint = () => {
        list.textContent = '';
        let group = null;
        shown.forEach((c, i) => {
            if (c.group !== group) { group = c.group; const h = mk('li', 'cmdk-group', group); h.setAttribute('role', 'presentation'); list.append(h); }
            const li = mk('li', 'cmdk-item'); li.id = uid + '-' + i; li.setAttribute('role', 'option'); li.setAttribute('aria-selected', String(i === active));
            li.append(mk('span', 'cmdk-title', c.title));
            if (c.sub) li.append(mk('span', 'cmdk-sub', c.sub));
            if (c.keys) { const k = mk('span', 'cmdk-keys'); c.keys.forEach((x) => k.append(mk('kbd', 'kbd-key', x))); li.append(k); }
            li.addEventListener('pointermove', () => { if (active !== i) { active = i; mark(); } });
            li.addEventListener('click', () => run(i));
            list.append(li);
        });
        empty.hidden = shown.length > 0;
        input.setAttribute('aria-activedescendant', shown.length ? uid + '-' + active : '');
    };
    const mark = () => {
        list.querySelectorAll('.cmdk-item').forEach((li, i) => li.setAttribute('aria-selected', String(i === active)));
        input.setAttribute('aria-activedescendant', uid + '-' + active);
        const cur = doc.getElementById(uid + '-' + active); if (cur && cur.scrollIntoView) cur.scrollIntoView({ block: 'nearest' });
    };
    const update = async () => {
        const q = input.value, mine = ++token;
        shown = rankCommands(base, q); active = 0; paint();
        if (findMore && q.trim().length >= 2) {
            let more = []; try { more = await findMore(q) || []; } catch (_) { /* the commands stay */ }
            if (mine !== token || !alive) return;
            shown = shown.concat(more); paint();
        }
    };
    function run(i) { const c = shown[i]; if (!c) return; if (onRun) onRun(c); Promise.resolve().then(() => c.run()); }
    input.addEventListener('input', update);
    container.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') { if (onEscape) { e.preventDefault(); e.stopPropagation(); onEscape(); } }
        else if (e.key === 'ArrowDown') { e.preventDefault(); if (shown.length) { active = (active + 1) % shown.length; mark(); } }
        else if (e.key === 'ArrowUp') { e.preventDefault(); if (shown.length) { active = (active - 1 + shown.length) % shown.length; mark(); } }
        else if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); run(active); }
    });
    shown = rankCommands(base, ''); paint();
    return { input, list, update, focus: () => input.focus(), destroy: () => { alive = false; } };
}

/** The ⌘K overlay: the list in a dialog. */
export function openPalette({ getCommands, findMore, doc = document }) {
    if (open) { closePalette(); return; }
    const mk = (tag, cls) => { const e = doc.createElement(tag); e.className = cls; return e; };
    const root = mk('div', 'cmdk'), scrim = mk('div', 'cmdk-scrim'), panel = mk('div', 'cmdk-panel');
    root.append(scrim, panel);
    const trap = trapFocus(root, { label: T('Command palette') });
    const close = () => { if (!open) return; open = null; mounted.destroy(); trap.release(); root.remove(); };
    const mounted = mountCommandList(panel, { getCommands, findMore, doc, onRun: close, onEscape: close });
    open = { close };
    scrim.addEventListener('click', close);
    doc.body.append(root);
    mounted.focus();
}
