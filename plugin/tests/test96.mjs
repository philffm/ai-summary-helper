// Whole-library run (Ollama): plan from stored state, batches of 20, resume after a stop, failed batches are skipped, today is left alone.
import assert from 'assert';
import { planLibrary, runLibrary, countRequests, chunksOf, cleanBatchSize, formatEta } from '../src/modules/libraryBatch.js';

const DAY = 86400000;
const startOfDay = (ts) => { const d = new Date(ts); d.setHours(0, 0, 0, 0); return d.getTime(); };
const today = startOfDay(Date.now());
const itemSig = (i) => i.title;
let n = 0;
const mk = (daysAgo, extra = {}) => ({ id: 'i' + (++n), title: 't' + n, published: today - daysAgo * DAY + 3600000 + n, ...extra });
const items = [
    ...Array.from({ length: 45 }, () => mk(1)),                       // yesterday: 45 items, nothing rated
    ...Array.from({ length: 5 }, () => mk(2, { ai: true, cat: 'Tech' })),   // rated, but no recap yet
    ...Array.from({ length: 3 }, () => mk(0)),                        // today: never recapped by the batch run
];
const ctx = (recaps = {}) => ({ items, recaps, source: 'all', inSource: () => true, startOfDay, itemSig, today });

let plan = planLibrary(ctx());
assert.equal(plan.rate.length, 48, 'every unrated item, today included (rating is cheap)');
assert.deepEqual(plan.days.map(d => d.todo.length), [5, 45], 'oldest day first, today skipped');
assert.equal(countRequests(plan, 20), 3 + 1 + 3, '48/20 rating batches + 1 + 3 recap batches');
assert.deepEqual(chunksOf([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]]);
assert.equal(cleanBatchSize(20), 20); assert.equal(cleanBatchSize(7), 20); assert.equal(cleanBatchSize('40'), 40);

// a partial recap only asks for the items it has not covered
const yDay = startOfDay(today - DAY);
const covered = Object.fromEntries(items.filter(i => startOfDay(i.published) === yDay).slice(0, 25).map(i => [i.id, itemSig(i)]));
plan = planLibrary(ctx({ [`${yDay}|all`]: { overview: 'x', covered } }));
assert.equal(plan.days.find(d => d.day === yDay).todo.length, 20, '45 items - 25 covered');
assert.equal(plan.days.find(d => d.day === yDay).hasRecap, true);
// a complete recap needs nothing
const full = Object.fromEntries(items.filter(i => startOfDay(i.published) === yDay).map(i => [i.id, itemSig(i)]));
assert(!planLibrary(ctx({ [`${yDay}|all`]: { covered: full } })).days.some(d => d.day === yDay));

// run: order, batch sizes, progress, failures
plan = planLibrary(ctx());
const calls = [], progress = [];
let out = await runLibrary(plan, 20, {
    rateChunk: async (c) => { calls.push('rate' + c.length); if (calls.length === 2) throw new Error('unreadable reply'); },
    recapDay: async (d) => { calls.push('recap' + d.todo.length); },
    onProgress: (p) => progress.push(p),
});
assert.deepEqual(calls, ['rate20', 'rate20', 'rate8', 'recap5', 'recap45']);
assert.equal(out.failed, 20, 'the failed batch is counted and the run goes on');
assert.equal(out.rated, 28); assert.equal(out.recaps, 2); assert.equal(out.stopped, false);
assert.equal(progress.at(-1).doneRequests, progress.at(-1).totalRequests);

// stop: the signal ends the run between batches, nothing after it runs
const ctl = new AbortController(); const seen = [];
out = await runLibrary(plan, 20, {
    signal: ctl.signal,
    rateChunk: async (c) => { seen.push('rate'); ctl.abort(); },
    recapDay: async () => { seen.push('recap'); },
});
assert.deepEqual(seen, ['rate']); assert.equal(out.stopped, true);
// a cancelled request counts as a stop, not as a failure
const ctl2 = new AbortController();
out = await runLibrary(plan, 20, { signal: ctl2.signal, rateChunk: async () => { ctl2.abort(); throw Object.assign(new Error('x'), { cancelled: true }); }, recapDay: async () => {} });
assert.equal(out.failed, 0); assert.equal(out.stopped, true);

const T = (s, v = {}) => s.replace(/\{(\w+)\}/g, (_, k) => v[k]);
assert.equal(formatEta(5 * 60000, T), 'about 5 min'); assert.equal(formatEta(135 * 60000, T), 'about 2 h 15 min'); assert.equal(formatEta(NaN, T), null);
console.log('TEST 96 OK'); process.exit(0);
