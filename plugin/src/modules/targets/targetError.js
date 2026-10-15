// targetError.js — the one error type adapters and safeFetch throw. `kind` decides what the outbox does next:
//   retry      network trouble, timeout, 408, 429, 5xx → try again later (backoff)
//   auth       401 / 403 → the connection needs a new login; its jobs pause, nothing is retried
//   permanent  anything else (other 4xx, unusable data) → the job fails at once
export const ERROR_KINDS = ['retry', 'auth', 'permanent'];

export class TargetError extends Error {
    constructor({ kind = 'permanent', message = '', status = 0, retryAfterMs = 0 } = {}) {
        super(message || kind);
        this.name = 'TargetError';
        this.kind = ERROR_KINDS.includes(kind) ? kind : 'permanent';
        this.status = status;
        this.retryAfterMs = retryAfterMs;
    }
}

/** HTTP status → error kind (see plugin/formats/target-adapter.md). */
export function kindOfStatus(status) {
    if (status === 401 || status === 403) return 'auth';
    if (status === 408 || status === 429 || status >= 500) return 'retry';
    return 'permanent';
}
