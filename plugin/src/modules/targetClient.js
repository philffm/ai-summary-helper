// targetClient.js — the popup's side of send targets. The popup never writes the outbox; it asks the background worker.
// Not used by any screen yet (the first adapter brings the UI); tested against a fake sender.
import { bgMessage } from './bgMessage.js';
const defaultSend = (msg) => bgMessage(msg, { fallback: { ok: false, error: 'no-answer' } });

export const enqueueTargetSend = (targetId, articleId, send = defaultSend) => send({ action: 'targetEnqueue', targetId, articleId });
export const getTargetStatus = (targetId, send = defaultSend) => send({ action: 'targetStatus', ...(targetId ? { targetId } : {}) });
export const cancelTargetJob = (jobId, send = defaultSend) => send({ action: 'targetCancel', jobId });
