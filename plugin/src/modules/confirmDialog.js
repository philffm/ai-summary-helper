import { T } from './feedI18n.js';
// confirmDialog.js — type-to-confirm dialog for destructive actions (replaces window.confirm/alert).
// Resolves true only when the user typed the confirmation word and pressed the red button.

export function confirmDestructive({ title, body, confirmLabel, word = 'DELETE', extraLabel, onExtra }) {
    return new Promise((resolve) => {
        const prevFocus = document.activeElement;
        const layer = document.createElement('div');
        layer.className = 'confirm-layer';
        layer.innerHTML = `
          <div class="confirm-scrim"></div>
          <div class="confirm-dialog" role="alertdialog" aria-modal="true" aria-labelledby="cdTitle" aria-describedby="cdBody">
            <h3 id="cdTitle"></h3>
            <p id="cdBody"></p>
            <input type="text" class="confirm-input" autocomplete="off" spellcheck="false" />
            <div class="confirm-actions">
              <button type="button" class="button-secondary btn-sm confirm-extra" hidden></button>
              <span class="confirm-spacer"></span>
              <button type="button" class="button-tertiary btn-sm confirm-cancel">${T('Cancel')}</button>
              <button type="button" class="button-danger btn-sm confirm-ok" disabled></button>
            </div>
          </div>`;
        const q = (s) => layer.querySelector(s);
        q('#cdTitle').textContent = title;
        q('#cdBody').textContent = body;
        const input = q('.confirm-input'), ok = q('.confirm-ok'), cancel = q('.confirm-cancel'), extra = q('.confirm-extra');
        input.placeholder = T('Type {word} to confirm', { word });
        ok.textContent = confirmLabel;
        if (extraLabel && onExtra) { extra.hidden = false; extra.textContent = extraLabel; extra.addEventListener('click', onExtra); }

        const close = (v) => { layer.remove(); document.removeEventListener('keydown', onKey, true); if (prevFocus && prevFocus.focus) prevFocus.focus(); resolve(v); };
        const onKey = (e) => {
            if (e.key === 'Escape') { e.preventDefault(); close(false); }
            if (e.key === 'Tab') {   // keep focus inside the dialog
                const f = [...layer.querySelectorAll('button:not([hidden]):not([disabled]), input')];
                if (!f.length) return;
                const i = f.indexOf(document.activeElement);
                e.preventDefault();
                f[(i + (e.shiftKey ? -1 : 1) + f.length) % f.length].focus();
            }
        };
        input.addEventListener('input', () => { ok.disabled = input.value.trim() !== word; });
        input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !ok.disabled) close(true); });
        ok.addEventListener('click', () => close(true));
        cancel.addEventListener('click', () => close(false));
        q('.confirm-scrim').addEventListener('click', () => close(false));
        document.addEventListener('keydown', onKey, true);
        document.body.appendChild(layer);
        input.focus();
    });
}
