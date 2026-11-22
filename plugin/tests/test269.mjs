// bgMessage: one wrapper for "ask the background worker" — never rejects, never hangs.
import { setup, imp } from './harness.mjs'; import assert from 'assert';
setup({});
const { bgMessage } = await imp('../src/modules/bgMessage.js');
const mk = (fn) => ({ runtime: { lastError: undefined, sendMessage: fn } });
assert.deepEqual(await bgMessage({ a: 1 }, { api: mk((m, cb) => cb({ ok: true })) }), { ok: true }, 'answer passes through');
assert.equal(await bgMessage({}, { api: mk((m, cb) => cb(undefined)) }), null, 'no answer → fallback');
assert.deepEqual(await bgMessage({}, { fallback: { ok: false }, api: mk(() => { throw new Error('gone'); }) }), { ok: false }, 'throw → fallback');
assert.equal(await bgMessage({}, { timeout: 30, fallback: 'late', api: mk(() => {}) }), 'late', 'silent worker → fallback after the timeout');
const t = Date.now(); await bgMessage({}, { timeout: 5000, api: mk((m, cb) => cb(1)) }); assert(Date.now() - t < 500, 'answer cancels the timer');
console.log('TEST 269 OK'); process.exit(0);
