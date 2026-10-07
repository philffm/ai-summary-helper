// reviewPrompt.js — a polite, dismissible nudge to review the extension on the Chrome Web Store.
// Shown at most 3 times, only after a few days of use and a few real summaries, only in Chrome
// (other stores/builds have their own review URLs). One tap on "No thanks" or "Rate" ends it for good.

import { T } from './feedI18n.js';

export const STORE_REVIEW_URL = 'https://chromewebstore.google.com/detail/hldbejcjaedipeegjcinmhejdndchkmb/reviews';
export const MIN_DAYS = 5;
export const MIN_SUMMARIES = 3;
export const SNOOZE_DAYS = 14;
export const MAX_ASKS = 3;
const DAY = 86400e3;
const KEY = 'reviewPrompt';

/** Chrome (not Edge/Opera/Firefox/Android) → the Chrome Web Store link applies. */
export function isChromeStore(ua = (typeof navigator !== 'undefined' ? navigator.userAgent : '')) {
    return /Chrome\//.test(ua) && !/Edg\/|OPR\/|Firefox|Android/.test(ua);
}

/** Pure decision. state = { done?, dismissed?, asks?, snoozeUntil? } */
export function shouldShow({ now, installedAt, summaries, state = {}, chrome: isChrome = true }) {
    if (!isChrome || state.done || state.dismissed) return false;
    if ((state.asks || 0) >= MAX_ASKS) return false;
    if (state.snoozeUntil && now < state.snoozeUntil) return false;
    if (!installedAt || now - installedAt < MIN_DAYS * DAY) return false;
    return summaries >= MIN_SUMMARIES;
}

async function readState() {
    const d = await chrome.storage.local.get([KEY, 'installedAt', 'articlesIndex']).catch(() => ({}));
    let installedAt = d.installedAt;
    if (!installedAt) { installedAt = Date.now(); chrome.storage.local.set({ installedAt }).catch(() => {}); }
    const summaries = (d.articlesIndex || []).filter(a => a && a.summary && !a.feedStub).length;
    return { state: d[KEY] || {}, installedAt, summaries };
}

const save = patch => chrome.storage.local.get(KEY).then(d => chrome.storage.local.set({ [KEY]: { ...(d[KEY] || {}), ...patch } })).catch(() => {});

export async function initReviewPrompt(el = document.getElementById('reviewPrompt')) {
    if (!el) return;
    const { state, installedAt, summaries } = await readState();
    if (!shouldShow({ now: Date.now(), installedAt, summaries, state, chrome: isChromeStore() })) return;
    el.innerHTML = `<div class="review-card-text"><strong>${T('Enjoying AI Summary Helper?')}</strong>
        <span>${T('A quick review on the Chrome Web Store helps other people find it.')}</span></div>
      <div class="review-card-actions">
        <button type="button" class="button-primary btn-sm" data-r="rate">${T('⭐ Leave a review')}</button>
        <button type="button" class="button-secondary btn-sm" data-r="later">${T('Later')}</button>
        <button type="button" class="review-link" data-r="never">${T('No thanks')}</button>
      </div>`;
    el.hidden = false;
    save({ asks: (state.asks || 0) + 1 });
    el.addEventListener('click', async (e) => {
        const b = e.target.closest('[data-r]'); if (!b) return;
        const r = b.dataset.r;
        if (r === 'rate') { await save({ done: true }); try { chrome.tabs.create({ url: STORE_REVIEW_URL }); } catch (_) { window.open(STORE_REVIEW_URL, '_blank', 'noopener'); } }
        else if (r === 'later') await save({ snoozeUntil: Date.now() + SNOOZE_DAYS * DAY });
        else await save({ dismissed: true });
        el.hidden = true;
    });
}
