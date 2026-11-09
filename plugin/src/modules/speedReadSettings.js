// modules/speedReadSettings.js — the Speed-Read settings (chrome.storage.sync `speedRead`), one shape for the reader on the
// page (content/speedRead.js), the popup menu, the context menu and Settings › Reading › Speed-Read.
// Names start with `speedRead` (the content-script bundle shares one scope).
import { RSVP_DEFAULT_WPM, rsvpClampWpm } from './rsvp.js';
import { DECISION_TIMEFRAMES, DEFAULT_REMINDER_TIME } from './decisionTime.js';

export const SPEED_READ_KEY = 'speedRead';
export const SPEED_READ_DEFAULTS = Object.freeze({
    enabled: true,          // the entries in the popup menu and the page's right-click menu
    wpm: RSVP_DEFAULT_WPM,
    chunk: 1,               // words at a time (1–3)
    fullscreen: false,      // false = the reader card (variant C), true = full screen (variant A)
    closeTab: true,         // offer to close the tab at the end (5 s countdown, stops on any input)
    reminder: 'none',       // preselected reminder on the end card: none | tomorrow | weekend | week
    reminderTime: DEFAULT_REMINDER_TIME,
});

/** Stored value (anything) → a complete, valid settings object. */
export function speedReadNormalize(raw) {
    const s = raw && typeof raw === 'object' ? raw : {};
    const d = SPEED_READ_DEFAULTS;
    return {
        enabled: s.enabled !== false,
        wpm: rsvpClampWpm(s.wpm == null ? d.wpm : s.wpm),
        chunk: Math.max(1, Math.min(3, Math.round(Number(s.chunk) || d.chunk))),
        fullscreen: s.fullscreen === true,
        closeTab: s.closeTab !== false,
        reminder: DECISION_TIMEFRAMES.includes(s.reminder) ? s.reminder : d.reminder,
        reminderTime: /^([01]?\d|2[0-3]):[0-5]\d$/.test(s.reminderTime || '') ? s.reminderTime : d.reminderTime,
    };
}
