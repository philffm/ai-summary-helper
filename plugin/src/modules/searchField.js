// searchField.js — one behaviour for every search box: a ✕ inside the field that appears while there is text and empties it.
// Works for static inputs (History, Feeds, Settings, Languages) and ones built in JS (source picker, shortcuts filter).
// The ✕ sits in a `.search-wrap` (styles.css) and fires a normal `input` event, so each screen's own filter code needs no change.
import { icon } from './icons.js';
import { T } from './feedI18n.js';


/**
 * @param {HTMLInputElement} input
 * @param {{ button?: HTMLButtonElement }} [opts] an existing ✕ button to reuse (History's markup already has one)
 * @returns {{ sync: () => void }|null}  null when the input was already set up
 */
export function attachSearchClear(input, { button } = {}) {
    if (!input || input.__searchClear) return null;
    let wrap = input.parentElement;
    if (!wrap || !wrap.classList.contains('search-wrap')) {
        wrap = document.createElement('div');
        wrap.className = 'search-wrap';
        input.replaceWith(wrap);
        wrap.append(input);
    }
    let btn = button;
    if (!btn) {
        let actions = wrap.querySelector('.search-actions');
        if (!actions) { actions = document.createElement('div'); actions.className = 'search-actions'; wrap.append(actions); }
        btn = document.createElement('button');
        btn.type = 'button'; btn.className = 'search-clear'; btn.hidden = true;
        btn.innerHTML = icon('x', 'icon--sm');
        actions.prepend(btn);
    }
    const label = T('Clear search');
    btn.title = label; btn.setAttribute('aria-label', label);

    const sync = () => {
        const has = input.value.length > 0;
        btn.hidden = !has;
        input.classList.toggle('has-clear', has);
    };
    input.addEventListener('input', sync);
    btn.addEventListener('click', (e) => {
        e.preventDefault(); e.stopPropagation();
        input.value = '';
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.focus();
    });
    // Code elsewhere empties the box directly (`input.value = ''`, no event): keep the ✕ in step with it.
    const win = input.ownerDocument && input.ownerDocument.defaultView;
    const valueDesc = win && win.HTMLInputElement && Object.getOwnPropertyDescriptor(win.HTMLInputElement.prototype, 'value');
    if (valueDesc && valueDesc.set) {
        Object.defineProperty(input, 'value', {
            configurable: true,
            get() { return valueDesc.get.call(this); },
            set(v) { valueDesc.set.call(this, v); sync(); }
        });
    }
    input.__searchClear = { sync };
    sync();
    return input.__searchClear;
}

/** The search boxes that exist in popup.html from the start. */
export function initSearchFields(doc = document) {
    const hist = doc.getElementById('searchInput');
    if (hist) attachSearchClear(hist, { button: doc.getElementById('searchClearBtn') || undefined });
    ['feedSearch', 'settingsSearch', 'languageSearch'].forEach((id) => attachSearchClear(doc.getElementById(id)));
}
