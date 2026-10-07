// workspaceManager.js — split-screen workspace for wide windows.
// Shows up to three of List / Graph / Analytics side by side inside the History
// screen. Narrow windows keep the single-pane behaviour (nothing changes).
// Breakpoints: <720px one pane · 720–1099px up to two · ≥1100px up to three.

const VIEWS = ['list', 'graph', 'report'];
const LABEL = { list: 'List', graph: 'Graph', report: 'Analytics' };
const STORE_KEY = 'ws_layout';

let layout = 1;                       // user's wish (1..3)
let views = ['list', 'graph', 'report']; // view per pane slot

export const maxPanes = () => (window.innerWidth >= 1100 ? 3 : window.innerWidth >= 720 ? 2 : 1);
const effective = () => Math.min(layout, maxPanes());

const SCREENS = [
    { scope: 'history', id: 'historyScreen', bar: 'historyTopRow',
      ids: { list: ['articleList', 'articleDetail'], graph: ['graphContainer'], report: ['reportContainer'] } },
    { scope: 'feeds', id: 'feedsScreen', bar: 'feedToolbar',
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

function apply() { SCREENS.forEach(applyScreen); }

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
    screen.querySelectorAll('.ws-seg').forEach(seg => {
        seg.hidden = maxPanes() < 2;
        seg.querySelectorAll('button').forEach(b => {
            const k = Number(b.dataset.n);
            b.disabled = k > maxPanes();
            b.setAttribute('aria-pressed', String(k === n));
        });
    });
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
    sel.setAttribute('aria-label', `Pane ${slot + 1} view`);
    for (const v of VIEWS) {
        const o = document.createElement('option');
        o.value = v; o.textContent = LABEL[v]; o.selected = v === view;
        sel.appendChild(o);
    }
    sel.addEventListener('change', () => { setView(slot, sel.value); save(); apply(); });
    head.appendChild(sel);
    const x = document.createElement('button');
    x.type = 'button'; x.className = 'ws-close'; x.textContent = '✕';
    x.setAttribute('aria-label', `Close pane ${slot + 1}`);
    x.addEventListener('click', () => {
        views.push(views.splice(slot, 1)[0]); // closed view moves out of the visible slots
        layout = n - 1; save(); apply();
    });
    head.appendChild(x);
    return head;
}

function buildSwitchers() {
    for (const cfg of SCREENS) {
        const bar = document.getElementById(cfg.bar);
        if (!bar || bar.querySelector('.ws-seg')) continue;
        const seg = document.createElement('div');
        seg.className = 'ws-seg';
        seg.setAttribute('role', 'group');
        seg.setAttribute('aria-label', 'Layout');
        [1, 2, 3].forEach(k => {
            const b = document.createElement('button');
            b.type = 'button'; b.dataset.n = String(k);
            b.title = k === 1 ? 'One pane' : `${k} panes`;
            b.setAttribute('aria-label', b.title);
            for (let i = 0; i < k; i++) b.appendChild(document.createElement('i'));
            b.addEventListener('click', () => { layout = k; save(); apply(); });
            seg.appendChild(b);
        });
        bar.appendChild(seg);
    }
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
