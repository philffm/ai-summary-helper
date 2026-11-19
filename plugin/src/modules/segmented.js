// segmented.js: behaviour of the shared segmented control (.a11y-seg, look in styles.css, entry "Segmented control" in
// design-system/components.json). One control for every choice of 2-4 options: Appearance, send format, quiz, graph views, ...
//   <div class="a11y-seg [a11y-seg--hug|--sm|--lg|--solid|--stack]" role="radiogroup | tablist | group"> <button>…</button> … </div>
// radiogroup → aria-checked (one option), tablist → aria-selected, group → aria-pressed. The selected button also carries .on.

const ATTR = { radiogroup: 'aria-checked', tablist: 'aria-selected' };
export const segButtons = (el) => [...el.querySelectorAll(':scope > button')];
const attrOf = (el) => ATTR[el.getAttribute('role')] || 'aria-pressed';

/** Marks the button(s) for which `isOn(button)` is true. A radiogroup / tablist gets a roving tabindex (Tab enters on the selected one). */
export function paintSeg(el, isOn) {
    if (!el) return;
    const attr = attrOf(el), roving = attr !== 'aria-pressed', btns = segButtons(el);
    let any = false;
    btns.forEach((b) => { const on = !!isOn(b); any = any || on; b.classList.toggle('on', on); b.setAttribute(attr, String(on)); if (roving) b.tabIndex = on ? 0 : -1; });
    if (roving && !any && btns[0]) btns[0].tabIndex = 0;
}

/** Arrow keys / Home / End move to the neighbouring enabled option and pick it (radio-group behaviour). Safe to call once per control. */
export function bindSegKeys(el) {
    if (!el || el.__segKeys) return;
    el.__segKeys = true;
    el.addEventListener('keydown', (e) => {
        const step = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : e.key === 'Home' ? 'first' : e.key === 'End' ? 'last' : 0;
        if (!step) return;
        const btns = segButtons(el).filter((b) => !b.disabled && !b.hidden);
        const i = btns.indexOf(e.target && e.target.closest ? e.target.closest('button') : null);
        if (i < 0 && typeof step === 'number') return;
        const next = step === 'first' ? btns[0] : step === 'last' ? btns[btns.length - 1] : btns[(i + step + btns.length) % btns.length];
        if (!next) return;
        e.preventDefault(); next.focus(); next.click();
    });
}
