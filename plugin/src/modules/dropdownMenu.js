// dropdownMenu.js
// Minimal, dependency-free dropdown menu used to consolidate related
// action buttons into a single compact trigger instead of a long row of
// individual buttons (e.g. Share/Copy/Kindle/LocalSend/.MD -> one "Share"
// menu; Reader/Listen -> one "Reader" menu).
//
// Only one AISH dropdown is ever open at a time — opening a new one closes
// whichever was already open, and outside clicks / Escape close it too.

let openDropdownCloser = null;

function closeOpenDropdown() {
    if (openDropdownCloser) {
        openDropdownCloser();
        openDropdownCloser = null;
    }
}

/**
 * @param {object} config
 * @param {string} config.label - trigger button text, e.g. "Share ▾"
 * @param {string} [config.title] - trigger button title/tooltip
 * @param {Array<{ label: string, onClick: Function, danger?: boolean }>} config.items
 * @returns {HTMLElement} a <div class="aish-dropdown"> ready to insert into the DOM
 */
export function createDropdown({ label, title = '', items }) {
    const wrap = document.createElement('div');
    wrap.className = 'aish-dropdown';

    const trigger = document.createElement('button');
    trigger.type = 'button';
    trigger.className = 'button-secondary aish-dropdown-trigger';
    trigger.textContent = label;
    if (title) trigger.title = title;

    const menu = document.createElement('div');
    menu.className = 'aish-dropdown-menu';
    menu.setAttribute('role', 'menu');
    menu.style.display = 'none';

    items.forEach(item => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.setAttribute('role', 'menuitem');
        btn.className = 'aish-dropdown-item' + (item.danger ? ' aish-dropdown-item-danger' : '');
        btn.textContent = item.label;
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            closeOpenDropdown();
            item.onClick(e, btn);
        });
        menu.appendChild(btn);
    });

    const close = () => {
        menu.style.display = 'none';
        document.removeEventListener('click', outsideHandler, true);
        document.removeEventListener('keydown', escHandler, true);
    };
    const outsideHandler = (e) => { if (!wrap.contains(e.target)) close(); };
    const escHandler = (e) => { if (e.key === 'Escape') close(); };

    trigger.addEventListener('click', (e) => {
        e.stopPropagation();
        const wasOpen = menu.style.display !== 'none';
        closeOpenDropdown();
        if (wasOpen) return; // click just closed it — nothing more to do
        menu.style.display = 'flex';
        openDropdownCloser = close;
        document.addEventListener('click', outsideHandler, true);
        document.addEventListener('keydown', escHandler, true);
    });

    wrap.appendChild(trigger);
    wrap.appendChild(menu);
    return wrap;
}

/** Closes any open AISH dropdown — call this when navigating away from a view. */
export function closeAllDropdowns() {
    closeOpenDropdown();
}
