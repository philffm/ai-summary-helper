// compactNav.js — the iPhone sheet (canvas boards R-A and S). Safari shows the popup in a sheet that opens half high and
// already says "Kaivo", so the popup's own header goes: every list keeps one row (pick what to see, search), the row
// leaves while reading down, and everything else sits behind "More" in the bar. Nothing here has logic of its own: each
// control presses the one that already exists, which stays in the page, hidden. Runs on iPhones only (styles: html[data-compact]).
import { T, keyOf } from './feedI18n.js';
import { iconEl } from './icons.js';
import { isPhone } from './shortcuts.js';

export const isCompact = (nav = navigator) => isPhone() && /\b(iPhone|iPod)\b/.test(nav.userAgent);

export function initCompact(doc = document) {
    doc.documentElement.dataset.compact = '1';
    const $ = (id) => doc.getElementById(id);
    const make = (tag, cls, text) => { const e = doc.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; };
    const button = (cls, label, icon) => {
        const b = make('button', cls); b.type = 'button';
        if (icon) { b.append(iconEl(icon)); b.setAttribute('aria-label', label); b.title = label; } else b.textContent = label;
        return b;
    };
    const watch = (target, fn, options = { childList: true, subtree: true, attributes: true, characterData: true }) => {
        if (target) new (doc.defaultView.MutationObserver)(fn).observe(target, options);
    };

    // ── One popover for every menu ──
    let open = null;
    const close = () => {
        if (!open) return;
        open.menu.remove(); open.anchor.setAttribute('aria-expanded', 'false'); open = null;
    };
    function menu(anchor, groups, cls) {
        const same = open && open.anchor === anchor;
        close();
        if (same) return;
        const box = make('div', 'compact-menu ' + cls); box.setAttribute('role', 'menu');
        for (const { title, items } of groups.filter((g) => g.items.length)) {
            if (title) box.append(make('p', 'compact-menu-title', title));
            for (const item of items) {
                const b = button('compact-menu-item', ''); b.setAttribute('role', item.checked === undefined ? 'menuitem' : 'menuitemradio');
                if (item.checked !== undefined) b.setAttribute('aria-checked', String(item.checked));
                b.append(make('span', '', item.label), make('span', 'compact-menu-note', item.note || ''));
                b.addEventListener('click', () => { close(); item.run(); });
                box.append(b);
            }
        }
        doc.body.append(box);
        anchor.setAttribute('aria-expanded', 'true');
        open = { menu: box, anchor };
        box.querySelector('button')?.focus({ preventScroll: true });
    }
    doc.addEventListener('click', (e) => { if (open && !open.menu.contains(e.target) && !open.anchor.contains(e.target)) close(); }, true);
    doc.addEventListener('keydown', (e) => { if (e.key === 'Escape' && open) { const a = open.anchor; close(); a.focus(); } });
    // the popup may start before its translations are there: marked elements get them when they arrive
    const named = (el, en) => { el.textContent = T(en); el.dataset.i18n = keyOf(en); return el; };
    const titled = (el, en) => { el.dataset.i18nTitle = keyOf(en); el.dataset.i18nAria = keyOf(en); return el; };
    const press = (id) => () => $(id)?.click();
    const usable = (id) => { const e = $(id); return !!e && !e.hidden; };

    // ── "More" in the bar: what belongs to the open view, then Kaivo itself ──
    const nav = $('bottomNav');
    const more = button('nav-item nav-more', '');
    more.id = 'navMore'; more.setAttribute('aria-haspopup', 'menu'); more.setAttribute('aria-expanded', 'false');
    const moreIcon = make('span', 'nav-icon'); moreIcon.append(iconEl('ellipsis'));
    more.append(moreIcon, named(make('span', 'nav-label'), 'More'));
    if (nav) {
        nav.append(more);
        // the dock settings put the tabs in order again: "More" stays last
        watch(nav, () => { if (nav.lastElementChild !== more) nav.append(more); }, { childList: true });
    }
    const toggle = (id, label) => ({ label, checked: $(id)?.getAttribute('aria-pressed') === 'true', run: press(id) });
    const viewItems = () => {
        const screen = doc.body.dataset.screen;
        if (screen === 'history') return [toggle('graphToggleBtn', T('Graph')), toggle('reportToggleBtn', T('Analytics'))];
        if (screen === 'feeds') return [toggle('feedGraphBtn', T('Graph')), toggle('feedInsightsBtn', T('Analytics')),
            { label: T('Refresh'), run: press('feedRefreshBtn') }, { label: T('Add feed'), run: press('feedAddBtn') }];
        if (screen === 'notes') return [...doc.querySelectorAll('#notesViewToggle button')].map((b) => ({ label: b.textContent.trim(), checked: b.getAttribute('aria-checked') === 'true', run: () => b.click() }));
        return [];
    };
    more.addEventListener('click', () => {
        const kaivo = [];
        if (doc.body.dataset.screen !== 'settings') kaivo.push({ label: T('Settings'), run: press('settingsButton') });
        if (usable('openTabButton')) kaivo.push({ label: T('Open in new tab'), run: press('openTabButton') });
        menu(more, [{ title: T('This view'), items: viewItems() }, { title: 'Kaivo', items: kaivo }], 'compact-menu--more');
    });

    // ── A picker that stands for a row of tabs or filters ──
    function picker(source, current) {
        const b = button('button-secondary compact-pick', '');
        b.setAttribute('aria-haspopup', 'menu'); b.setAttribute('aria-expanded', 'false');
        const label = make('span', 'compact-pick-label'), count = make('span', 'compact-pick-count');
        b.append(label, count, iconEl('chevron-down'));
        const words = (x) => ({ label: (x.querySelector('span') || x).textContent.trim(), note: x.querySelector('.tabbar-n')?.textContent || '' });
        const paint = () => {
            const on = source().find(current) || source()[0];
            const w = on ? words(on) : { label: '', note: '' };
            if (label.textContent !== w.label) label.textContent = w.label;
            if (count.textContent !== w.note) count.textContent = w.note;
        };
        b.addEventListener('click', () => menu(b, [{ items: source().filter((x) => !x.hidden).map((x) => ({ ...words(x), checked: current(x), run: () => { x.click(); paint(); } })) }], 'compact-menu--pick'));
        return { element: b, paint };
    }

    /** The search button of a row; `bar` shows its search field while it is open, and a dot says that something narrows the list. */
    function searcher(bar, field, narrowed) {
        const b = titled(button('button-secondary compact-search', T('Search'), 'search'), 'Search');
        b.setAttribute('aria-expanded', 'false');
        b.addEventListener('click', () => {
            const now = !bar.classList.contains('compact-open');
            bar.classList.toggle('compact-open', now); b.setAttribute('aria-expanded', String(now));
            if (now) field()?.focus({ preventScroll: true });
        });
        const paint = () => b.classList.toggle('is-narrowed', !!narrowed());
        bar.addEventListener('input', paint); bar.addEventListener('click', () => setTimeout(paint, 0));
        paint();
        return b;
    }

    // ── Feeds: the source pill that is there, and search with its filters ──
    const feeds = $('feedControls');
    const feedRow = feeds?.querySelector('.feed-controlbar');
    if (feedRow) {
        feedRow.append(searcher(feeds, () => $('feedSearch'), () => $('feedSearch')?.value.trim()
            || feeds.querySelector('#feedChipRow [data-status].active:not([data-status="all"])') || $('feedMoodChip')?.getAttribute('aria-pressed') === 'true'));
    }

    // ── History: Inbox, Read, Archive … as one picker ──
    const history = $('historyTopBar'), historyRow = $('historyTopRow');
    if (history && historyRow) {
        const tabs = () => [...doc.querySelectorAll('#historyScreen .history-tab')];
        const pick = picker(tabs, (x) => x.getAttribute('aria-selected') === 'true');
        pick.element.id = 'historyPick';
        historyRow.prepend(pick.element);
        historyRow.append(searcher(history, () => $('searchInput'), () => $('searchInput')?.value.trim()));
        let due = false;
        watch($('historyScreen'), () => { if (due) return; due = true; setTimeout(() => { due = false; pick.paint(); }, 60); });
        pick.paint();
    }

    // ── Notes: filter, search; the composer waits behind a plus ──
    const notes = $('notesRoot'), notesScreen = $('notesScreen');
    function notesRow() {
        const bar = notes?.querySelector('.notes-bar'), filters = notes?.querySelector('.notes-filters');
        if (!bar || !filters || notes.querySelector('.compact-row')) return;
        const row = make('div', 'compact-row');
        const chips = () => [...filters.querySelectorAll('button')];
        const pick = picker(chips, (x) => x.classList.contains('is-selected'));
        pick.element.id = 'notesPick';
        row.append(pick.element);
        notes.prepend(row);
        row.append(searcher(notes, () => $('notesSearch'), () => $('notesSearch')?.value.trim()));
        watch(filters, pick.paint);
        pick.paint();
    }
    watch(notes, notesRow, { childList: true });
    notesRow();
    const plus = titled(button('compact-plus', T('New note'), 'plus'), 'New note');
    plus.id = 'notesPlus';
    // outside the screens: those slide (a transform), and inside one even a "fixed" button scrolls along with the list
    doc.body.append(plus);
    const writing = (on) => { notesScreen.classList.toggle('compact-writing', on); doc.body.classList.toggle('compact-writing', on); if (on) $('notesInput')?.focus({ preventScroll: true }); };
    plus.addEventListener('click', () => writing(true));
    // away again once the field is left empty, or the note is added
    notesScreen?.addEventListener('focusout', (e) => {
        if (!e.target.closest('#notesComposer')) return;
        setTimeout(() => { if (!$('notesComposer')?.contains(doc.activeElement) && !$('notesInput')?.value.trim()) writing(false); }, 150);
    });
    notesScreen?.addEventListener('click', (e) => {
        if (e.target.closest('.notes-add')) setTimeout(() => { if (!$('notesInput')?.value.trim()) writing(false); }, 150);
    });
    // the notes row leaves while reading down and returns on the way up, as the other bars do
    let last = 0;
    notesScreen?.addEventListener('scroll', (e) => {
        const top = Math.max(0, e.target.scrollTop || 0), d = top - last;
        const row = notes?.querySelector('.compact-row');
        if (row) { if (top <= 8 || d < -4) row.classList.remove('scroll-hidden'); else if (d > 6) row.classList.add('scroll-hidden'); }
        last = top;
    }, { passive: true, capture: true });

    // ── The page: the options behind one chip ──
    const chips = doc.querySelector('#mainScreen .chip-row');
    if (chips) {
        const all = button('chip compact-options', '');
        all.setAttribute('aria-expanded', 'false');
        const text = make('span', '');
        all.append(text, iconEl('chevron-down'));
        chips.append(all);
        const paint = () => {
            const next = ['chipLanguageLabel', 'chipLengthLabel', 'chipModelLabel'].map((id) => $(id)?.textContent.trim()).filter(Boolean).join(' · ');
            if (text.textContent !== next) text.textContent = next;
        };
        all.addEventListener('click', () => { const now = !chips.classList.contains('compact-open'); chips.classList.toggle('compact-open', now); all.setAttribute('aria-expanded', String(now)); });
        watch(chips, paint, { childList: true, subtree: true, characterData: true });
        paint();
    }

    // the main tab is about the page one is on
    const mainLabel = nav?.querySelector('.nav-item[data-screen="main"] .nav-label');
    if (mainLabel) named(mainLabel, 'Page');

    // ── The graph: what the colours and lines mean, and what is left out, only when asked ──
    function legendButtons() {
        for (const tools of doc.querySelectorAll('.graph-tools')) {
            if (tools.querySelector('.graph-tool--info')) continue;
            const view = tools.parentElement;
            const b = titled(button('graph-tool graph-tool--info', T('Legend'), 'info'), 'Legend');
            b.setAttribute('aria-pressed', String(view.classList.contains('legend-open')));
            b.addEventListener('click', () => b.setAttribute('aria-pressed', String(view.classList.toggle('legend-open'))));
            tools.append(b);
        }
    }
    for (const id of ['historyScreen', 'feedsScreen']) watch($(id), legendButtons, { childList: true, subtree: true });

    // a menu belongs to the view it was opened in
    watch(doc.body, close, { attributes: true, attributeFilter: ['data-screen'] });
    return { close };
}
