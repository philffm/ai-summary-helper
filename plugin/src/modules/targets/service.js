// service.js — what the background worker exposes: one outbox on the real storage and alarms.
import { createTargetsStore } from './targetsStore.js';
import { createOutbox, ALARM } from './outbox.js';

export function createTargets({ storage, alarms, fetchFn, now, build, log } = {}) {
    const store = createTargetsStore(storage);
    const scheduleAt = (when) => {
        const a = alarms || (typeof chrome !== 'undefined' ? chrome.alarms : null);
        if (!a) return;
        if (when == null) { try { a.clear(ALARM); } catch (_) { /* no alarms */ } return; }
        try { a.create(ALARM, { when: Math.max(when, Date.now() + 1000) }); } catch (_) { /* no alarms */ }
    };
    const outbox = createOutbox({ store, scheduleAt, fetchFn, now, build, log });
    return {
        ...outbox,
        ALARM,
        /** Worker start: interrupted jobs are queued again, then everything due is sent. */
        async start() { await outbox.recover(); await outbox.drain(); }
    };
}
