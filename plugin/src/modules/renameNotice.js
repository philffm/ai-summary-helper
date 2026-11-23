// renameNotice.js — a one-time, dismissible note for people who update from before the rename: the extension has a new name.
// background.js sets { pending } on an update of an existing install ({ done } on a fresh one, who knows the name already).
// It sits in the popup and on the home page; "Got it" or the video ends it for good. Nothing is fetched until the video is opened.

import { SK } from './storageKeys.js';
import { T } from './feedI18n.js';

// the old name is built in two pieces on purpose: the brand build replaces the whole name in every file, and this sentence has to keep it
export const OLD_NAME = 'AI Summary' + ' Helper';
export const NEW_NAME = 'Kaivo';
export const VIDEO_URL = 'https://ai-summary-helper.byphil.eu/assets/video/kaivo-rename-en.mp4';   // the site host is swapped by the brand build

/** Pure: show it only while the update has flagged it and it has not been dismissed. */
export const shouldShow = (state) => !!(state && state.pending && !state.done);

export async function initRenameNotice(el = document.getElementById('renameNotice')) {
    if (!el) return;
    const d = await chrome.storage.local.get(SK.renameNotice).catch(() => ({}));
    if (!shouldShow(d[SK.renameNotice])) return;
    const done = () => chrome.storage.local.set({ [SK.renameNotice]: { done: true } }).catch(() => {});
    el.innerHTML = `<div class="review-card-text"><strong></strong><span></span></div>
      <div class="review-card-actions">
        <button type="button" class="button-primary btn-sm" data-r="video"></button>
        <button type="button" class="button-secondary btn-sm" data-r="ok"></button>
      </div>`;
    el.querySelector('strong').textContent = T('{old} is now {new}', { old: OLD_NAME, new: NEW_NAME });
    el.querySelector('span').textContent = T('Same extension, same data, a new name. Your settings, articles and notes stay as they are.');
    el.querySelector('[data-r=video]').textContent = T('Watch the video');
    el.querySelector('[data-r=ok]').textContent = T('Got it');
    el.hidden = false;
    el.addEventListener('click', async (e) => {
        const b = e.target.closest('[data-r]'); if (!b) return;
        await done();
        if (b.dataset.r === 'video') { try { chrome.tabs.create({ url: VIDEO_URL }); } catch (_) { window.open(VIDEO_URL, '_blank', 'noopener'); } }
        el.hidden = true;
    });
}
