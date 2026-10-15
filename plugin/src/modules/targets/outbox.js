// outbox.js — the durable send queue. Jobs hold ids only; the payload is built at send time, so what leaves is always the
// current state and the queue stays small.
//
// Only this module writes targets:outbox, and every write goes through one promise chain (read-modify-write on one key).
// A job interrupted by the worker being stopped is `running` in storage; recover() puts it back to `queued` at start.
import { getAdapter } from './adapters.js';
import { createSafeFetch } from './safeFetch.js';
import { TargetError } from './targetError.js';
import { createLedger, sha256Hex } from './ledger.js';
import { buildPayload as defaultBuild } from './payload.js';

export const MAX_JOBS = 500;
export const BACKOFF_MS = [60e3, 5 * 60e3, 30 * 60e3, 2 * 3600e3, 6 * 3600e3];
export const MAX_ATTEMPTS = BACKOFF_MS.length + 1;   // the 6th failed attempt ends it
export const ALARM = 'targets_outbox';

const newId = () => 'job_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

/**
 * @param {object} deps
 *   store      createTargetsStore()
 *   scheduleAt (whenMs|null) → void   one-shot alarm for the next due job; null clears it
 *   fetchFn, now, build (payload builder), log
 */
export function createOutbox({ store, scheduleAt = () => {}, fetchFn, now = () => Date.now(), build = defaultBuild, log = () => {} }) {
    const ledger = createLedger(store.storage, { now });
    let chain = Promise.resolve();
    const locked = (fn) => { const run = chain.then(fn, fn); chain = run.catch(() => {}); return run; };
    let draining = null;

    async function scheduleNext() {
        const due = (await store.getOutbox()).filter((j) => j.state === 'queued').map((j) => j.nextAt);
        scheduleAt(due.length ? Math.min(...due) : null);
    }

    async function enqueue(targetId, articleId) {
        const out = await locked(async () => {
            const target = (await store.getList()).find((t) => t.id === targetId);
            if (!target) return { ok: false, error: 'unknown-target' };
            const jobs = await store.getOutbox();
            const same = jobs.find((j) => j.targetId === targetId && j.articleId === articleId && j.state === 'queued');
            if (same) { same.nextAt = now(); await store.setOutbox(jobs); return { ok: true, jobId: same.id, merged: true }; }
            if (jobs.length >= MAX_JOBS) return { ok: false, error: 'outbox-full' };
            const job = { id: newId(), targetId, articleId, enqueuedAt: now(), attempts: 0, nextAt: now(), state: 'queued' };
            jobs.push(job);
            await store.setOutbox(jobs);
            return { ok: true, jobId: job.id };
        });
        if (out.ok) { await scheduleNext(); drain().catch(() => {}); }
        return out;
    }

    async function cancel(jobId) {
        const ok = await locked(async () => {
            const jobs = await store.getOutbox();
            const j = jobs.find((x) => x.id === jobId);
            if (!j || j.state === 'running') return false;
            await store.setOutbox(jobs.filter((x) => x.id !== jobId));
            return true;
        });
        await scheduleNext();
        return { ok };
    }

    async function status(targetId) {
        const jobs = (await store.getOutbox()).filter((j) => !targetId || j.targetId === targetId);
        const ids = targetId ? [targetId] : [...new Set((await store.getList()).map((t) => t.id))];
        const ledgerInfo = {};
        for (const id of ids) ledgerInfo[id] = await ledger.summary(id);
        return { ok: true, jobs, ledger: ledgerInfo };
    }

    /** At worker start: a job that was `running` when the worker stopped is queued again. */
    function recover() {
        return locked(async () => {
            const jobs = await store.getOutbox();
            let changed = false;
            for (const j of jobs) if (j.state === 'running') { j.state = 'queued'; j.nextAt = now(); changed = true; }
            if (changed) await store.setOutbox(jobs);
        });
    }

    const update = (jobId, fn) => locked(async () => {
        const jobs = await store.getOutbox();
        const j = jobs.find((x) => x.id === jobId);
        if (!j) return;
        const keep = fn(j, jobs);
        await store.setOutbox(keep === null ? jobs.filter((x) => x.id !== jobId) : jobs);
    });

    async function runJob(job) {
        const target = (await store.getList()).find((t) => t.id === job.targetId);
        if (!target) throw new TargetError({ kind: 'permanent', message: 'The target does not exist any more.' });
        const connection = (await store.getConnections()).find((c) => c.id === target.connectionId);
        if (!connection) throw new TargetError({ kind: 'permanent', message: 'The connection does not exist any more.' });
        if (connection.needsLogin) throw new TargetError({ kind: 'auth', message: 'Sign-in needed.' });
        const adapter = getAdapter(target.adapter);
        if (!adapter) throw new TargetError({ kind: 'permanent', message: `No adapter "${target.adapter}".` });
        if (!adapter.accepts.includes(target.format)) throw new TargetError({ kind: 'permanent', message: `The adapter does not take format "${target.format}".` });

        const payload = await build({ articleId: job.articleId, format: target.format, storage: store.storage, includeBlocks: !!(target.options && target.options.includeBlocks) });
        if (!payload) return { discard: true };
        const hash = await sha256Hex(payload.text);
        const previous = await ledger.get(target.id, job.articleId);
        const secret = (await store.getSecrets())[connection.id] || null;
        const ctx = { connection, secret, target, safeFetch: createSafeFetch(connection, { fetchFn, now, log }), log };
        if (previous && previous.hash === hash) {
            let stillThere = true;
            if (adapter.caps.check && typeof adapter.check === 'function') stillThere = !!(await adapter.check(ctx, previous)).exists;
            if (stillThere) return { unchanged: true };
        }
        const res = await adapter.push(ctx, payload, previous);
        await ledger.put(target.id, job.articleId, { remote: res && res.remote, etag: res && res.etag, hash });
        return { sent: true };
    }

    async function failAuth(connectionId, why) {
        await locked(async () => {
            const conns = await store.getConnections();
            const c = conns.find((x) => x.id === connectionId);
            if (c && !c.needsLogin) { c.needsLogin = true; await store.setConnections(conns); }
            const mine = new Set((await store.getList()).filter((t) => t.connectionId === connectionId).map((t) => t.id));
            const jobs = await store.getOutbox();
            for (const j of jobs) if (mine.has(j.targetId) && j.state !== 'failed') { j.state = 'failed'; j.lastError = 'auth'; j.lastMessage = why; }
            await store.setOutbox(jobs);
        });
    }

    async function step() {
        const job = await locked(async () => {
            const jobs = await store.getOutbox();
            const t = now();
            const due = jobs.filter((j) => j.state === 'queued' && j.nextAt <= t).sort((a, b) => a.nextAt - b.nextAt)[0];
            if (!due) return null;
            due.state = 'running';
            await store.setOutbox(jobs);
            return { ...due };
        });
        if (!job) return false;
        try {
            const r = await runJob(job);
            await update(job.id, () => null);
            if (r.discard) log('article gone, job dropped');
        } catch (e) {
            const err = e instanceof TargetError ? e : new TargetError({ kind: 'retry', message: String((e && e.message) || e) });
            if (err.kind === 'auth') {
                const target = (await store.getList()).find((t) => t.id === job.targetId);
                if (target) await failAuth(target.connectionId, err.message);
                else await update(job.id, (j) => { j.state = 'failed'; j.lastError = 'auth'; });
            } else if (err.kind === 'permanent') {
                await update(job.id, (j) => { j.state = 'failed'; j.attempts += 1; j.lastError = 'permanent'; j.lastMessage = err.message; });
            } else {
                await update(job.id, (j) => {
                    j.attempts += 1; j.lastError = 'retry'; j.lastMessage = err.message;
                    if (j.attempts >= MAX_ATTEMPTS) { j.state = 'failed'; return; }
                    j.state = 'queued';
                    j.nextAt = now() + Math.max(BACKOFF_MS[j.attempts - 1], err.retryAfterMs || 0);
                });
            }
        }
        return true;
    }

    /** Works through everything that is due, one job after the other, then sets the alarm for the next one. */
    function drain() {
        if (!draining) {
            draining = (async () => {
                try { while (await step()) { /* next */ } } finally { draining = null; await scheduleNext(); }
            })();
        }
        return draining;
    }

    return { enqueue, cancel, status, recover, drain, scheduleNext };
}
