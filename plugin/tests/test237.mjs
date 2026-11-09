// Summary queue: a running job whose finish message never arrives (the page navigated and the background finished it,
// or the content script stopped early) is cleared, so the next queued summary starts instead of waiting forever.
import { bgSource } from './bgSource.mjs';
import assert from 'assert';
import fs from 'fs';
const src = bgSource();
const start = src.indexOf('// ── Summary job queue');
const end = src.indexOf('/** Open a feed link', start);
assert(start >= 0 && end > start, 'queue block found');
const block = src.slice(start, end);

function makeQueue({ tabState = {} } = {}) {
    const sent = [];
    const runs = new Map();
    const chrome = {
        storage: { session: { get: async () => ({ sumJobs: null }), set: async () => {} }, sync: { get: async () => ({ notifyWhenDone: false }) } },
        action: { setBadgeBackgroundColor: async () => {}, setBadgeText: async () => {}, setTitle: async () => {} },
        runtime: { sendMessage: async () => {} },
        notifications: { onClicked: { addListener() {} } },
        tabs: {
            onRemoved: { addListener() {} },
            sendMessage: async (tabId, m) => {
                sent.push([tabId, m.action]);
                if (m.action === 'getSummaryState') {
                    if (!(tabId in tabState)) throw new Error('no receiver');
                    return tabState[tabId];
                }
                return { success: true };
            }
        }
    };
    const api = new Function('chrome', 'localGet', 'SK', 'INBOX', 'runs', 'openFeedItem',
        `${block}\nreturn { enqueueSumJob, sumJobs, sumJobTabFinished, reapSumJob };`)(
        chrome, async () => ({}), {}, null, runs, async () => {});
    return { api, sent, runs, tabState };
}
const tick = () => new Promise(r => setTimeout(r, 0));

// 1. Normal path: second job waits, starts when the first tab reports done.
{
    const { api, sent } = makeQueue({ tabState: { 1: { running: true } } });
    const a = await api.enqueueSumJob({ kind: 'tab', tabId: 1, url: 'https://a.test/1', message: { action: 'fetchSummary' } });
    assert.equal(a.queued, false);
    const b = await api.enqueueSumJob({ kind: 'tab', tabId: 2, url: 'https://b.test/2', message: { action: 'fetchSummary' } });
    assert.equal(b.queued, true, 'a fresh running job is not probed away');
    api.sumJobTabFinished(1, true);
    await tick();
    assert.equal(api.sumJobs.running.tabId, 2);
    assert(sent.some(([t, act]) => t === 2 && act === 'fetchSummary'), 'next job sent to its tab');
    clearTimeout(api.sumJobs.timer); clearInterval(api.sumJobs.probe);
}

// 2. The finish message got lost: the tab reports nothing running → the queue moves on by itself.
{
    const { api, sent, tabState } = makeQueue({ tabState: { 1: { running: true } } });
    await api.enqueueSumJob({ kind: 'tab', tabId: 1, url: 'https://a.test/1', message: { action: 'fetchSummary' } });
    await api.enqueueSumJob({ kind: 'tab', tabId: 2, url: 'https://b.test/2', message: { action: 'fetchSummary' } });
    api.sumJobs.running.startedAt -= 60 * 1000;   // past the start-up grace
    await api.reapSumJob();
    assert.equal(api.sumJobs.running.tabId, 1, 'still running in its tab: kept');
    tabState[1] = { running: false, busy: true };
    await api.reapSumJob();
    assert.equal(api.sumJobs.running.tabId, 1, 'still reading the page (busy): kept');
    tabState[1] = { running: false, busy: false };
    await api.reapSumJob();
    await tick();
    assert.equal(api.sumJobs.running.tabId, 2, 'dead job cleared, next one started');
    assert(sent.some(([t, act]) => t === 2 && act === 'fetchSummary'));
    clearTimeout(api.sumJobs.timer); clearInterval(api.sumJobs.probe);
}

// 3. Page navigated away: the background stream still runs → kept; a third request reaps once it is gone.
{
    const { api, runs } = makeQueue({ tabState: {} });   // tab 1 has no content script any more
    await api.enqueueSumJob({ kind: 'tab', tabId: 1, url: 'https://a.test/1', message: { action: 'fetchSummary' } });
    await api.enqueueSumJob({ kind: 'tab', tabId: 2, url: 'https://b.test/2', message: { action: 'fetchSummary' } });
    api.sumJobs.running.startedAt -= 60 * 1000;
    runs.set('r1', { id: 'r1', tabId: 1, saved: false });
    await api.reapSumJob();
    assert.equal(api.sumJobs.running.tabId, 1, 'background still streams it: kept');
    runs.delete('r1');
    const c = await api.enqueueSumJob({ kind: 'tab', tabId: 3, url: 'https://c.test/3', message: { action: 'fetchSummary' } });
    await tick();
    assert.equal(api.sumJobs.running.tabId, 2, 'enqueue itself clears the stale job');
    assert.equal(c.queued, true);
    assert.deepEqual(api.sumJobs.queue.map(j => j.tabId), [3]);
    clearTimeout(api.sumJobs.timer); clearInterval(api.sumJobs.probe);
}

// 4. A job restored from before this fix (no startedAt) never blocks the queue.
{
    const { api } = makeQueue({ tabState: { 9: { running: true } } });
    api.sumJobs.running = { id: 5, kind: 'tab', tabId: 9, url: 'https://old.test/' };
    api.sumJobs.seq = 5;
    const r = await api.enqueueSumJob({ kind: 'tab', tabId: 2, url: 'https://b.test/2', message: { action: 'fetchSummary' } });
    assert.equal(r.queued, false, 'starts right away');
    assert.equal(api.sumJobs.running.tabId, 2);
    clearTimeout(api.sumJobs.timer); clearInterval(api.sumJobs.probe);
}

// 5. The background-finished path tells the queue directly (its own broadcast never reaches its listener).
const fin = src.slice(src.indexOf('async function finishRun(r)'), src.indexOf('const stoppedStreams'));
assert(/finally \{[\s\S]*sumJobTabFinished\(r\.tabId/.test(fin), 'finishRun reports to the queue');
assert(/run\.detached\) sumJobsReady\(\)\.then\(\(\) => sumJobTabFinished\(run\.tabId, false\)\)/.test(src), 'detached stream error reports to the queue');
const content = fs.readFileSync(process.env.AISH_SRC + '/content.js', 'utf8');
assert(/busy: summaryBusy > 0/.test(content), 'content script reports a summary that is still reading the page');
console.log('test237 ok');
