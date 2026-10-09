/**
 * recapJobs.js — recap generations keep running when their sheet is closed.
 * Registry of in-flight jobs (so reopening the same recap shows live progress instead of starting a second
 * request) plus the "ready" notice: a toast, and a system notification when the page is not visible.
 */
const jobs = new Map();

/** The sheet body of a running job for `key`, or null. */
export const runningJob = (key) => (jobs.get(key) || {}).body || null;

/** Register a running job; returns finish(). */
export function trackJob(key, body) {
    const job = { body };
    jobs.set(key, job);
    return () => { if (jobs.get(key) === job) jobs.delete(key); };
}

/** Is `body` what the user is looking at right now? */
export function isShowing(body) {
    const layer = document.getElementById('feedSheetLayer');
    return !!(layer && !layer.hidden && body.isConnected);
}

/** Tell the user a recap finished — only when they are not already looking at it. */
export function notifyReady(body, message, toast) {
    if (isShowing(body) && !document.hidden) return;
    if (toast) toast(message);
    if (!document.hidden) return;
    try {
        chrome.notifications.create(`recap_ready_${Date.now()}`, {
            type: 'basic',
            iconUrl: chrome.runtime.getURL('icons/icon128.png'),
            title: 'AI Summary Helper',
            message,
        });
    } catch (e) { /* notifications unavailable */ }
}
