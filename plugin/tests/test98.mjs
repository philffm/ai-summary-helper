// Automatic feed processing is alarm-driven by the worker, not by an open Feeds screen.
import assert from 'assert';
import { setup, imp, tick } from './harness.mjs';
const { store, sent } = setup({});
store['feeds:settings'] = { autoProcess: true, autoProcessMinutes: 15, autoProcessAt: 0 };
let aiCalls = 0;
globalThis.__ai = () => { aiCalls++; return { ok: true, text: '{}' }; };
const fm = await imp('modules/feedManager.js');
fm.initFeedManager({ showToast() {}, showScreen() {} });
await tick(100);
assert(sent.some(message => message.action === 'feedPollConfig'), 'automatic setting configures the background alarm');
assert.equal(aiCalls, 0, 'the popup does not start a competing automatic run');
assert.equal(store['feeds:settings'].autoProcessAt, 0, 'only the background worker tracks automatic runs');
console.log('TEST 98 OK');
process.exit(0);
