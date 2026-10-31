import { T, N_ } from './feedI18n.js';
import { SK } from './storageKeys.js';
// workspaceManager.js — split-screen workspace for wide windows.
// Shows up to three views side by side inside the History, Feeds and Notes screens (layout switcher lives in the app header).
// History and Feeds choose from List / Graph / Analytics / Notes; the Notes screen from Notes / By article / Tags.
// Narrow windows keep the single-pane behaviour (nothing changes). Breakpoints: <720px one pane · 720–1099px up to two · ≥1100px up to three.

// A set of pane choices: the first is what the screen is without a split ("base").
const SETS = {
    main: { views: ['list', 'graph', 'report', 'notes'], base: 'list', label: { list: N_('List'), graph: N_('Graph'), report: N_('Analytics'), notes: N_('Notes') } },
    notes: { views: ['stream', 'articles', 'tags'], base: 'stream', label: { stream: N_('Notes'), articles: N_('By article'), tags: N_('Tags') } },
};
const STORE_KEY = SK.workspace;

let layout = 1;                                       // user's wish (1..3), the same on every screen
const views = { main: SETS.main.views.slice(), notes: SETS.notes.views.slice() };   // view per pane slot, per set

export const maxPanes = () => (window.innerWidth >= 1100 ? 3 : window.innerWidth >= 720 ? 2 : 1);
const effective = () => Math.min(layout, maxPanes());

const SCREENS = [
    { scope: 'history', id: 'historyScreen', bar: 'historyTopRow', top: 'historyTopBar', set: 'main',
      ids: { list: ['articleList', 'articleDetail'], graph: ['graphContainer'], report: ['reportContainer'], notes: ['historyNotesPane'] } },
    { scope: 'feeds', id: 'feedsScreen', bar: 'feedToolbar', top: 'feedControls', set: 'main',
      ids: { list: ['feedListPane'], graph: ['feedGraph'], report: ['feedInsights'], notes: ['feedsNotesPane'] } },
    { scope: 'notes', id: 'notesScreen', set: 'notes',
      ids: { stream: ['notesRoot'], articles: ['notesArticlesPane'], tags: ['notesTagsPane'] } },
];
const elsOf = (cfg) => Object.fromEntries(SETS[cfg.set].views.map(v => [v, cfg.ids[v].map(i => document.getElementById(i)).filter(Boolean)]));
const emit = (scope, view, open) => document.dispatchEvent(new CustomEvent('aish:ws-view', { detail: { scope, view, open } }));

function save() {
    try { chrome.storage?.local?.set({ [STORE_KEY]: { layout, views: views.main, nviews: views.notes } }); } catch (_) { /* optional */ }
}

function setView(set, slot, view) {
    const list = views[set];
    const other = list.indexOf(view);
    if (other !== -1 && other !== slot) list[other] = list[slot]; // swap, no duplicates
    list[slot] = view;
}

function syncSwitcher() {
    const seg = document.querySelector('.header .ws-seg');
    if (!seg) return;
    seg.hidden = maxPanes() < 2;
    seg.querySelectorAll('button').forEach(b => {
        const k = Number(b.dataset.n);
        b.disabled = k > maxPanes();
        b.setAttribute('aria-pressed', String(k === effective()));
    });
}

function apply() { syncSwitcher(); SCREENS.forEach(applyScreen); }

function applyScreen(cfg) {
    const screen = document.getElementById(cfg.id);
    if (!screen) return;
    const n = effective();
    const on = n > 1;
    const wasSplit = screen.classList.contains('ws-active');
    screen.classList.toggle('ws-active', on);
    screen.style.setProperty('--ws-n', String(n));
    screen.querySelectorAll(':scope > .ws-head').forEach(h => h.remove());
    const e = elsOf(cfg);
    const set = SETS[cfg.set], VIEWS = set.views;
    for (const v of VIEWS) for (const el of e[v]) el.classList.remove('ws-off', 'ws-p1', 'ws-p2', 'ws-p3');
    // The top bar (search, filters) belongs to the LIST pane: it sits in the list's column, so the other panes get the full height.
    const top = cfg.top && document.getElementById(cfg.top);
    if (top) top.classList.remove('ws-off', 'ws-p1', 'ws-p2', 'ws-p3');
    if (!on) {
        // Leaving the split view: back to the list alone. A refresh while already single-pane (every History load
        // sends one) must not close the Graph or Analytics view the user has open there.
        if (wasSplit) {
            for (const v of VIEWS) if (v !== set.base) emit(cfg.scope, v, false);
            if (cfg.scope === 'history') {
                const detailOpen = e.list[1]?.style.display === 'block';
                if (e.list[0] && !detailOpen) e.list[0].style.display = 'block';
            }
        }
        return;
    }
    const shown = views[cfg.set].slice(0, n);
    if (top) { const ls = shown.indexOf(set.base); top.classList.add(ls === -1 ? 'ws-off' : `ws-p${ls + 1}`); }
    for (const v of VIEWS) {
        const slot = shown.indexOf(v);
        for (const el of e[v]) el.classList.add(slot === -1 ? 'ws-off' : `ws-p${slot + 1}`);
        if (v !== set.base) emit(cfg.scope, v, slot !== -1);
    }
    if (cfg.scope === 'history' && shown.includes('list') && e.list[0] && e.list[1]?.style.display !== 'block') e.list[0].style.display = 'block';
    shown.forEach((v, slot) => screen.appendChild(buildHead(cfg, slot, v, n)));
}

function buildHead(cfg, slot, view, n) {
    const set = SETS[cfg.set];
    const head = document.createElement('div');
    head.className = `ws-head ws-p${slot + 1}`;
    const sel = document.createElement('select');
    sel.className = 'ws-select';
    sel.setAttribute('aria-label', T('Pane {n} view', { n: slot + 1 }));
    for (const v of set.views) {
        const o = document.createElement('option');
        o.value = v; o.textContent = T(set.label[v]); o.selected = v === view;
        sel.appendChild(o);
    }
    sel.addEventListener('change', () => { setView(cfg.set, slot, sel.value); save(); apply(); });
    head.appendChild(sel);
    const x = document.createElement('button');
    x.type = 'button'; x.className = 'ws-close'; x.textContent = '✕';
    x.setAttribute('aria-label', T('Close pane {n}', { n: slot + 1 }));
    x.addEventListener('click', () => {
        views[cfg.set].push(views[cfg.set].splice(slot, 1)[0]); // closed view moves out of the visible slots
        layout = n - 1; save(); apply();
    });
    head.appendChild(x);
    return head;
}

// One layout switcher in the app header (shared by Feeds, History and Notes — they use the same layout),
// so the toolbars below keep their full width. CSS shows it only on those screens
// (body[data-screen], set by uiManager.showScreen) and it is hidden when the window fits one pane.
function buildSwitchers() {
    const host = document.querySelector('.header .header-buttons');
    if (!host || host.querySelector('.ws-seg')) return;
    const seg = document.createElement('div');
    seg.className = 'ws-seg';
    seg.setAttribute('role', 'group');
    seg.setAttribute('aria-label', T('Layout'));
    [1, 2, 3].forEach(k => {
        const b = document.createElement('button');
        b.type = 'button'; b.dataset.n = String(k);
        b.title = k === 1 ? T('One pane') : T('{n} panes', { n: k });
        b.setAttribute('aria-label', b.title);
        for (let i = 0; i < k; i++) b.appendChild(document.createElement('i'));
        b.addEventListener('click', () => { layout = k; save(); apply(); });
        seg.appendChild(b);
    });
    host.insertBefore(seg, host.firstChild);
}

export async function initWorkspace() {
    // Feeds: recap card + list + empty state must stack inside ONE pane, so group them.
    if (!document.getElementById('feedListPane')) {
        const first = document.getElementById('feedRecapCard');
        const wrap = document.createElement('div');
        wrap.id = 'feedListPane'; wrap.className = 'ws-listpane';
        if (first && first.parentNode) {
            first.parentNode.insertBefore(wrap, first);
            ['feedRecapCard', 'feedItemList', 'feedEmpty'].forEach(i => { const n = document.getElementById(i); if (n) wrap.appendChild(n); });
        }
    }
    try {
        const r = await chrome.storage?.local?.get(STORE_KEY);
        const s = r?.[STORE_KEY];
        if (s && [1, 2, 3].includes(s.layout)) {
            layout = s.layout;
            // saved before Notes existed: three views, so Notes goes last and nothing a user arranged moves
            if (Array.isArray(s.views) && s.views.length >= 3 && ['list', 'graph', 'report'].every(v => s.views.includes(v))) {
                views.main = s.views.filter(v => SETS.main.views.includes(v));
                if (!views.main.includes('notes')) views.main.push('notes');
            }
            if (Array.isArray(s.nviews) && s.nviews.length === 3 && SETS.notes.views.every(v => s.nviews.includes(v))) views.notes = s.nviews;
        }
    } catch (_) { /* defaults */ }
    buildSwitchers();
    document.addEventListener('aish:ws-refresh', apply);
    let t;
    window.addEventListener('resize', () => { clearTimeout(t); t = setTimeout(apply, 120); });
    apply();
}
