// modules/articleLock.js
// One exclusive lock for every read-modify-write of the article index (articles:index) and of article records.
// chrome.storage has no transactions and each mutation rewrites the whole index array, so two writers that overlap
// (a tag edit and a status change, a feed refresh and a delete) used to lose one of the updates.
//
// Web Locks (navigator.locks) serialize across all extension pages and the background worker, which share one origin;
// without them (tests, old engines) a promise chain serializes within the one context.
// Not re-entrant: never call a locked function from inside withArticleLock.
// Content scripts run in the page's origin and cannot take this lock; the main summarize path (content/core.js) is the
// one writer left outside it.

const NAME = 'aish-articles';
let tail = Promise.resolve();

export function withArticleLock(fn) {
    if (typeof navigator !== 'undefined' && navigator.locks && typeof navigator.locks.request === 'function') {
        return navigator.locks.request(NAME, () => fn());
    }
    const run = tail.then(() => fn(), () => fn());
    tail = run.catch(() => {});
    return run;
}
