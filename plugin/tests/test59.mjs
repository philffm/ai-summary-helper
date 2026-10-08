// Recap status card: stages advance with feedAi's onStage callback; aiComplete reports send → wait → parse.
import assert from 'assert';
import { setup, imp } from './harness.mjs';
setup({});
globalThis.chrome.runtime.sendMessage = (m, cb) => setTimeout(() => cb({ ok: true, text: 'Overview.\n- A\nMOOD: mixed' }), 500);
const { createRecapStatus } = await imp('modules/recapStatus.js');
const { generateRecap } = await imp('modules/feedAi.js');
const st = createRecapStatus({ title: 'Writing', detail: 'Sending 1 title' });
const cls = (n) => [...st.node.querySelectorAll('.recap-step')].map(li => li.className.replace('recap-step', '').trim());
assert.deepEqual(cls(), ['active', '', '', '', '']);
const stages = [];
const r = await generateRecap([{ id: 1, title: 'Hi', snippet: '' }], () => '', { rate: false, onStage: (s) => { stages.push(s); st.onStage(s); } });
st.stop();
assert.deepEqual(stages, ['send', 'wait', 'parse']);
assert.deepEqual(cls(), ['done', 'done', 'done', 'done', 'active']);
assert(r.overview);
// Streaming progress: aiProgress messages move the card to "writing" and show counts.
const st3 = createRecapStatus({ title: 'S' });
st3.onStage('wait'); st3.onStage('write'); st3.onStage('wait');
st3.onProgress({ phase: 'stream', chars: 120, think: 40, tail: 'abc' });
const rowsTxt = [...st3.node.querySelectorAll('.recap-step')].map(li => li.textContent);
assert(/120/.test(rowsTxt[3]) && /40/.test(rowsTxt[3]), rowsTxt[3]);
assert(st3.node.querySelectorAll('.recap-step.active')[0].textContent.startsWith('Model is writing'), 'monotonic stages');
st3.stop();
// Cancel: aborts, rejects with .cancelled and tells the worker.
const sent = [];
globalThis.chrome.runtime.sendMessage = (m, cb) => { sent.push(m.action); if (m.action === 'aiComplete') setTimeout(() => cb({ ok: true, text: 'x' }), 2000); else cb && cb({ ok: true }); };
const st2 = createRecapStatus({ title: 'W' });
const p = generateRecap([{ id: 1, title: 'Hi', snippet: '' }], () => '', { rate: false, onStage: st2.onStage, signal: st2.signal });
setTimeout(() => st2.node.querySelector('.recap-cancel').click(), 100);
await assert.rejects(p, (e) => e.cancelled === true);
assert(sent.includes('aiCancel'));
st2.stop();
// Reset button exists in both recap UIs (source check; the sheets need the full feed UI).
import fs from 'fs';
const here = new URL('../src/modules/', import.meta.url);
assert(/confirmBtn\(T\('Reset'\)/.test(fs.readFileSync(new URL('feedManager.js', here), 'utf8')));
assert(/refreshFromScratch/.test(fs.readFileSync(new URL('feedRollup.js', here), 'utf8')));
console.log('TEST 59 OK'); process.exit(0);
