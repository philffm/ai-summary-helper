// targetClient.js — the popup's side of send targets. The popup never writes the outbox; it asks the background worker.
// Not used by any screen yet (the first adapter brings the UI); tested against a fake sender.
const defaultSend = (msg) => new Promise((resolve) => {
    try { chrome.runtime.sendMessage(msg, (res) => resolve(chrome.runtime.lastError ? { ok: false, error: chrome.runtime.lastError.message } : (res || { ok: false, error: 'no-answer' }))); }
    catch (e) { resolve({ ok: false, error: String((e && e.message) || e) }); }
});

export const enqueueTargetSend = (targetId, articleId, send = defaultSend) => send({ action: 'targetEnqueue', targetId, articleId });
export const getTargetStatus = (targetId, send = defaultSend) => send({ action: 'targetStatus', ...(targetId ? { targetId } : {}) });
export const cancelTargetJob = (jobId, send = defaultSend) => send({ action: 'targetCancel', jobId });
