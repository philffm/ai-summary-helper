// Send targets, step 2: outbox, ledger, retry/backoff, auth pause, restart recovery (fake adapter, fake clock, fake alarms).
import assert from 'assert';
import { pathToFileURL } from 'url';
import { imp } from './harness.mjs';
const shared = (rel) => import(pathToFileURL(process.env.AISH_SRC + '/' + rel).href);   // same instance the outbox imports (no cache-busting)
const [{ createTargetsStore }, { createOutbox, BACKOFF_MS, MAX_JOBS }, { registerAdapter, clearAdapters }, { TargetError }] = await Promise.all([
    imp('modules/targets/targetsStore.js'), imp('modules/targets/outbox.js'), shared('modules/targets/adapters.js'), shared('modules/targets/targetError.js')]);

const mem = (init = {}) => { const d = JSON.parse(JSON.stringify(init)); return { d, get: async (keys) => Object.fromEntries([].concat(keys).filter((k) => k in d).map((k) => [k, JSON.parse(JSON.stringify(d[k]))])), set: async (o) => { for (const [k, v] of Object.entries(o)) d[k] = JSON.parse(JSON.stringify(v)); }, remove: async (k) => { [].concat(k).forEach((x) => delete d[x]); } }; };
const T0 = 1_800_000_000_000;
const world = (extra = {}) => {
    const storage = mem({
        'articles:index': [{ id: 'a1', title: 'First', url: 'https://e.com/1', timestamp: '2026-10-01T10:00:00Z', summary: '<p>Hello</p>', tags: ['x'] },
            { id: 'a2', title: 'Second', url: 'https://e.com/2', timestamp: '2026-10-02T10:00:00Z', summary: '<p>World</p>' }],
        'articles:rec:a1': { summary: '<p>Hello</p>' },
        'targets:connections': [{ id: 'c1', preset: 'fake', baseUrl: 'https://dav.example', auth: 'basic', label: 'Fake' }],
        'targets:list': [{ id: 't1', connectionId: 'c1', adapter: 'fake', format: 'md', options: {}, rule: 'manual' }, { id: 't2', connectionId: 'c1', adapter: 'fake', format: 'json-v1', options: {}, rule: 'manual' }],
        ...extra
    });
    const clock = { t: T0 }; const alarm = { when: undefined, calls: 0 };
    const store = createTargetsStore(storage);
    const outbox = createOutbox({ store, now: () => clock.t, scheduleAt: (w) => { alarm.when = w; alarm.calls++; } });
    return { storage, clock, alarm, store, outbox };
};
const calls = []; let behave = () => ({ remote: 'r/1.md', etag: 'e1' });
clearAdapters();
registerAdapter('fake', { accepts: ['md', 'json-v1'], async push(ctx, payload, previous) { calls.push({ ctx, payload, previous }); return behave(calls.length); } });
const reset = () => { calls.length = 0; behave = () => ({ remote: 'r/1.md', etag: 'e1' }); };

// 1) enqueue → send → ledger entry → outbox empty
{ reset(); const w = world();
  const r = await w.outbox.enqueue('t1', 'a1'); assert(r.ok && r.jobId);
  await w.outbox.drain();
  assert.equal(calls.length, 1); assert.equal(calls[0].previous, null);
  assert(/^# First/m.test(calls[0].payload.text) && calls[0].payload.fileBase === 'First' && /^First \([A-Za-z0-9]+\)$/.test(calls[0].payload.fileBaseWithId));
  assert.equal(calls[0].ctx.connection.id, 'c1'); assert.equal(typeof calls[0].ctx.safeFetch, 'function');
  assert.deepEqual(w.storage.d['targets:outbox'], []);
  const led = w.storage.d['targets:ledger:t1'].a1; assert.equal(led.remote, 'r/1.md'); assert.equal(led.etag, 'e1'); assert.match(led.hash, /^[0-9a-f]{64}$/);
  assert.equal(w.alarm.when, null, 'nothing left → alarm cleared');
  // json-v1 payload has no blocks
  await w.outbox.enqueue('t2', 'a1'); await w.outbox.drain();
  const j = JSON.parse(calls.at(-1).payload.text); assert.equal(j.aish, 'article/1'); assert(!('blocks' in j)); assert.equal(j.id, 'a1');
}
// unknown target / unknown article
{ reset(); const w = world();
  assert.deepEqual(await w.outbox.enqueue('nope', 'a1'), { ok: false, error: 'unknown-target' });
  assert(!('targets:outbox' in w.storage.d), 'nothing written');
}
// 2) the same (target, article) twice → one job
{ reset(); const w = world();
  w.outbox.drain = w.outbox.drain; // keep API
  const store = w.store; const ob = createOutbox({ store, now: () => w.clock.t, scheduleAt() {}, build: async () => { await new Promise(r => setTimeout(r, 5)); return { text: 'x', format: 'md' }; } });
  const a = await ob.enqueue('t1', 'a1'); await ob.drain(); // sent and removed
  assert(a.ok);
  // queue two while nothing drains: use a failing adapter so the job stays queued
  behave = () => { throw new TargetError({ kind: 'retry', message: 'later' }); };
  const w2 = world(); const r1 = await w2.outbox.enqueue('t1', 'a1'); await w2.outbox.drain();
  const r2 = await w2.outbox.enqueue('t1', 'a1');
  assert.equal(r2.jobId, r1.jobId); assert(r2.merged);
  assert.equal(w2.storage.d['targets:outbox'].length, 1);
  await w2.outbox.drain();   // the merge kicked a run (it fails again and backs off)
}
// 3) retry → backoff 1 min, 5 min → success on 3rd attempt
{ reset(); const w = world();
  behave = (n) => { if (n < 3) throw new TargetError({ kind: 'retry', message: 'busy', status: 503 }); return { remote: 'r' }; };
  await w.outbox.enqueue('t1', 'a1'); await w.outbox.drain();
  let job = w.storage.d['targets:outbox'][0];
  assert.equal(job.state, 'queued'); assert.equal(job.attempts, 1); assert.equal(job.nextAt, T0 + 60e3); assert.equal(w.alarm.when, T0 + 60e3);
  await w.outbox.drain(); assert.equal(calls.length, 1, 'not due yet → not retried');
  w.clock.t = T0 + 60e3; await w.outbox.drain();
  job = w.storage.d['targets:outbox'][0]; assert.equal(job.attempts, 2); assert.equal(job.nextAt, T0 + 60e3 + 5 * 60e3);
  w.clock.t = job.nextAt; await w.outbox.drain();
  assert.equal(calls.length, 3); assert.deepEqual(w.storage.d['targets:outbox'], []); assert(w.storage.d['targets:ledger:t1'].a1);
}
// 4) six retries → failed, no further alarm; stays visible
{ reset(); const w = world();
  behave = () => { throw new TargetError({ kind: 'retry', message: 'down' }); };
  await w.outbox.enqueue('t1', 'a1'); await w.outbox.drain();
  for (let i = 0; i < 5; i++) { const j = w.storage.d['targets:outbox'][0]; assert.equal(j.nextAt - w.clock.t, BACKOFF_MS[i]); w.clock.t = j.nextAt; await w.outbox.drain(); }
  const j = w.storage.d['targets:outbox'][0];
  assert.equal(j.state, 'failed'); assert.equal(j.attempts, 6); assert.equal(calls.length, 6);
  assert.equal(w.alarm.when, null, 'no alarm for a failed job');
  w.clock.t += 7 * 24 * 3600e3; await w.outbox.drain(); assert.equal(calls.length, 6, 'never tried again');
  const st = await w.outbox.status('t1'); assert.equal(st.jobs.length, 1);
  // Retry-After wins when longer
  reset(); const w3 = world(); behave = () => { throw new TargetError({ kind: 'retry', retryAfterMs: 3600e3 }); };
  await w3.outbox.enqueue('t1', 'a1'); await w3.outbox.drain(); assert.equal(w3.storage.d['targets:outbox'][0].nextAt, T0 + 3600e3);
}
// permanent → failed at once
{ reset(); const w = world(); behave = () => { throw new TargetError({ kind: 'permanent', message: 'no' }); };
  await w.outbox.enqueue('t1', 'a1'); await w.outbox.drain();
  assert.equal(w.storage.d['targets:outbox'][0].state, 'failed'); assert.equal(calls.length, 1);
}
// 5) auth → connection needsLogin, all its jobs paused, nothing retried
{ reset(); const w = world(); behave = () => { throw new TargetError({ kind: 'auth', status: 401 }); };
  w.storage.d['targets:outbox'] = [];
  await w.outbox.enqueue('t1', 'a2'); await w.outbox.enqueue('t2', 'a1'); await w.outbox.drain();
  const jobs = w.storage.d['targets:outbox'];
  assert.equal(w.storage.d['targets:connections'][0].needsLogin, true);
  assert(jobs.length === 2 && jobs.every((j) => j.state === 'failed' && j.lastError === 'auth'), JSON.stringify(jobs));
  assert.equal(calls.length, 1, 'second job was not tried');
  w.clock.t += 3600e3; await w.outbox.drain(); assert.equal(calls.length, 1);
  // later jobs for a connection that needs login fail without a request
  await w.outbox.enqueue('t1', 'a1'); await w.outbox.drain(); assert.equal(calls.length, 1);
}
// 6) same hash → unchanged, push not called; changed content → pushed with previous
{ reset(); const w = world();
  await w.outbox.enqueue('t1', 'a1'); await w.outbox.drain(); assert.equal(calls.length, 1);
  await w.outbox.enqueue('t1', 'a1'); await w.outbox.drain(); assert.equal(calls.length, 1, 'unchanged');
  assert.deepEqual(w.storage.d['targets:outbox'], []);
  w.storage.d['articles:index'][0].title = 'First (edited)';
  await w.outbox.enqueue('t1', 'a1'); await w.outbox.drain(); assert.equal(calls.length, 2);
  assert.equal(calls[1].previous.remote, 'r/1.md', 'adapter may update instead of create');
}
// adapter with check(): same hash but remote gone → pushed again
{ reset(); clearAdapters(); let exists = true;
  registerAdapter('fake', { accepts: ['md'], caps: { check: true }, async push() { calls.push(1); return { remote: 'r' }; }, async check() { return { exists }; } });
  const w = world(); await w.outbox.enqueue('t1', 'a1'); await w.outbox.drain();
  await w.outbox.enqueue('t1', 'a1'); await w.outbox.drain(); assert.equal(calls.length, 1);
  exists = false; await w.outbox.enqueue('t1', 'a1'); await w.outbox.drain(); assert.equal(calls.length, 2);
  clearAdapters(); registerAdapter('fake', { accepts: ['md', 'json-v1'], async push(ctx, payload, previous) { calls.push({ ctx, payload, previous }); return behave(calls.length); } });
}
// 7) worker restart: a `running` job becomes queued again and is processed
{ reset(); const w = world({ 'targets:outbox': [{ id: 'job_x', targetId: 't1', articleId: 'a1', enqueuedAt: T0, attempts: 0, nextAt: T0, state: 'running' }] });
  const again = createOutbox({ store: w.store, now: () => w.clock.t, scheduleAt() {} });   // module "reloaded", storage kept
  await again.drain(); assert.equal(calls.length, 0, 'a running job is not picked up by chance');
  await again.recover(); assert.equal(w.storage.d['targets:outbox'][0].state, 'queued');
  await again.drain(); assert.equal(calls.length, 1); assert.deepEqual(w.storage.d['targets:outbox'], []);
}
// 12) deleted article → job dropped silently
{ reset(); const w = world();
  await w.outbox.enqueue('t1', 'a1'); w.storage.d['articles:index'] = [];
  await w.outbox.drain(); assert.equal(calls.length, 0); assert.deepEqual(w.storage.d['targets:outbox'], []);
  assert(!('targets:ledger:t1' in w.storage.d));
}
// limit and cancel; blocks refused with a clear error; no adapter / wrong format → failed permanent
{ reset(); const w = world({ 'targets:outbox': Array.from({ length: MAX_JOBS }, (_, i) => ({ id: 'j' + i, targetId: 't1', articleId: 'z' + i, enqueuedAt: T0, attempts: 0, nextAt: T0 + 1e9, state: 'queued' })) });
  assert.deepEqual(await w.outbox.enqueue('t1', 'a1'), { ok: false, error: 'outbox-full' });
  assert.deepEqual(await w.outbox.cancel('j3'), { ok: true }); assert.equal(w.storage.d['targets:outbox'].length, MAX_JOBS - 1);
  assert.deepEqual(await w.outbox.cancel('missing'), { ok: false });
  const { buildPayload } = await imp('modules/targets/payload.js');
  await assert.rejects(buildPayload({ articleId: 'a1', format: 'md', storage: w.storage, includeBlocks: true }), /offscreen/);
  const w2 = world({ 'targets:list': [{ id: 'tx', connectionId: 'c1', adapter: 'ghost', format: 'md' }] });
  await w2.outbox.enqueue('tx', 'a1'); await w2.outbox.drain();
  assert.equal(w2.storage.d['targets:outbox'][0].state, 'failed'); assert.match(w2.storage.d['targets:outbox'][0].lastMessage, /No adapter/);
}
console.log('TEST 171 OK'); process.exit(0);
