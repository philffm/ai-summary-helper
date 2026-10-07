// moodSetting.js — one switch for the whole mood feature (AI tone score, mood
// chips/filters, mood charts, Source-diet mood). On by default; stored in
// chrome.storage.sync as `moodEnabled`. The flag is mirrored to
// <html data-mood="off"> so CSS can hide mood UI without touching each view.
let enabled = true;

export const moodEnabled = () => enabled;

function apply(v) {
    enabled = v !== false;
    try { document.documentElement.dataset.mood = enabled ? 'on' : 'off'; } catch (e) { /* no DOM */ }
    document.dispatchEvent(new CustomEvent('aish:mood-setting', { detail: { enabled } }));
}

export async function initMoodSetting() {
    try {
        const d = await chrome.storage.sync.get({ moodEnabled: true });
        apply(d.moodEnabled);
        if (chrome.storage.onChanged && chrome.storage.onChanged.addListener) {
            chrome.storage.onChanged.addListener((ch, area) => {
                if (area === 'sync' && ch && ch.moodEnabled) apply(ch.moodEnabled.newValue);
            });
        }
    } catch (e) { apply(true); }
}

export async function setMoodEnabled(v) {
    apply(v);
    try { await chrome.storage.sync.set({ moodEnabled: !!v }); } catch (e) { /* best effort */ }
}
