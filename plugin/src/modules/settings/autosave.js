// settings/autosave.js — split out of settingsManager.js (R4 phase 1).
import StorageManager from '../storageManager.js';
import { T } from '../feedI18n.js';
import { setLabel } from '../icons.js';

// ── UI Helper: Visual Auto-Save Indicator ──────────────────────────
export function flashSaveIndicator() {
    const saveButton = document.querySelector('button[form="settingsForm"]');
    if (!saveButton) return;
    // Keep the button's own nodes (icon + label), not its text: restoring text would drop the icon.
    if (!saveButton._origNodes) saveButton._origNodes = [...saveButton.childNodes].map(n => n.cloneNode(true));
    clearTimeout(saveButton._flashTimer);
    setLabel(saveButton, T('Saved! ✓'));
    saveButton.classList.add('is-saved');   // green + green glow, see .settings-save-fab.is-saved
    saveButton.disabled = true;
    saveButton._flashTimer = setTimeout(() => {
        saveButton.replaceChildren(...saveButton._origNodes.map(n => n.cloneNode(true)));
        saveButton.classList.remove('is-saved');
        saveButton.disabled = false;
    }, 1500);
}

export const autoSave = async (key, value) => {
    await StorageManager.set({ [key]: value });
    flashSaveIndicator();
};

