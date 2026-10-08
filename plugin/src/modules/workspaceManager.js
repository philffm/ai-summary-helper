import { T, N_ } from './feedI18n.js';
import { SK } from './storageKeys.js';
// workspaceManager.js — split-screen workspace for wide windows.
// Shows up to three of List / Graph / Analytics side by side inside the History
// and Feeds screens (layout switcher lives in the app header). Narrow windows keep the single-pane behaviour (nothing changes).
// Breakpoints: <720px one pane · 720–1099px up to two · ≥1100px up to three.

const VIEWS = ['list', 'graph', 'report'];
const LABEL = { list: N_('List'), graph: N_('Graph'), report: N_('Analytics') };
const STORE_KEY = SK.workspace;

let layout = 1;                       // user's wish (1..3)
let views = ['list', 'graph', 'report']; // view per pane slot

export const maxPanes = () => (window.innerWidth >= 1100 ? 3 : window.innerWidth >= 720 ? 2 : 1);
const effective = () => Math.min(layout, maxPanes());

const SCREENS = [
    { scope: 'history', id: 'historyScreen', bar: 'historyTopRow', top: 'historyTopBar',
      ids: { list: ['articleList', 'articleDetail'], graph: ['graphContainer'], report: ['reportContainer'] } },
    { scope: 'feeds', id: 'feedsScreen', bar: 'feedToolbar', top: 'feedControls',
      ids: { list: ['feedListPane'], graph: ['feedGraph'], report: ['feedInsights'] } },
];
const elsOf = (cfg) => Object.fromEntries(VIEWS.map(v => [v, cfg.ids[v].map(i => document.getElementById(i)).filter(Boolean)]));
const emit = (scope, view, open) => document.dispatchEvent(new CustomEvent('aish:ws-view', { detail: { scope, view, open } }));

function save() {
    try { chrome.storage?.local?.set({ [STORE_KEY]: { layout, views } }); } catch (_) { /* optional */ }
}

function setView(slot, view) {
    const other = views.indexOf(view);
    if (other !== -1 && other !== slot) views[other] = views[slot]; // swap, no duplicates
    views[slot] = view;
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
    screen.classList.toggle('ws-active', on);
    screen.style.setProperty('--ws-n', String(n));
    screen.querySelectorAll(':scope > .ws-head').forEach(h => h.remove());
    const e = elsOf(cfg);
    for (const v of VIEWS) for (const el of e[v]) el.classList.remove('ws-off', 'ws-p1', 'ws-p2', 'ws-p3');
    // The top bar (search, filters) belongs to the LIST pane: it sits in the list's column, so the other panes get the full height.
    const top = cfg.top && document.getElementById(cfg.top);
    if (top) top.classList.remove('ws-off', 'ws-p1', 'ws-p2', 'ws-p3');
    if (!on) {
        emit(cfg.scope, 'graph', false);
        emit(cfg.scope, 'report', false);
        if (cfg.scope === 'history') {
            const detailOpen = e.list[1]?.style.display === 'block';
            if (e.list[0] && !detailOpen) e.list[0].style.display = 'block';
        }
        return;
    }
    const shown = views.slice(0, n);
    if (top) { const ls = shown.indexOf('list'); top.classList.add(ls === -1 ? 'ws-off' : `ws-p${ls + 1}`); }
    for (const v of VIEWS) {
        const slot = shown.indexOf(v);
        for (const el of e[v]) el.classList.add(slot === -1 ? 'ws-off' : `ws-p${slot + 1}`);
        if (v !== 'list') emit(cfg.scope, v, slot !== -1);
    }
    if (cfg.scope === 'history' && shown.includes('list') && e.list[0] && e.list[1]?.style.display !== 'block') e.list[0].style.display = 'block';
    shown.forEach((v, slot) => screen.appendChild(buildHead(slot, v, n)));
}

function buildHead(slot, view, n) {
    const head = document.createElement('div');
    head.className = `ws-head ws-p${slot + 1}`;
    const sel = document.createElement('select');
    sel.className = 'ws-select';
    sel.setAttribute('aria-label', T('Pane {n} view', { n: slot + 1 }));
    for (const v of VIEWS) {
        const o = document.createElement('option');
        o.value = v; o.textContent = T(LABEL[v]); o.selected = v === view;
        sel.appendChild(o);
    }
    sel.addEventListener('change', () => { setView(slot, sel.value); save(); apply(); });
    head.appendChild(sel);
    const x = document.createElement('button');
    x.type = 'button'; x.className = 'ws-close'; x.textContent = '✕';
    x.setAttribute('aria-label', T('Close pane {n}', { n: slot + 1 }));
    x.addEventListener('click', () => {
        views.push(views.splice(slot, 1)[0]); // closed view moves out of the visible slots
        layout = n - 1; save(); apply();
    });
    head.appendChild(x);
    return head;
}

// One layout switcher in the app header (shared by Feeds and History — they use the same layout),
// so the toolbars below keep their full width. CSS shows it only on those two screens
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
        if (s && [1, 2, 3].includes(s.layout) && Array.isArray(s.views) && s.views.length === 3 && VIEWS.every(v => s.views.includes(v))) {
            layout = s.layout; views = s.views;
        }
    } catch (_) { /* defaults */ }
    buildSwitchers();
    document.addEventListener('aish:ws-refresh', apply);
    let t;
    window.addEventListener('resize', () => { clearTimeout(t); t = setTimeout(apply, 120); });
    apply();
}
