// Preloaded by `node --import` (see run.mjs / npm test): gives every test the repo paths.
import path from 'path';
import { fileURLToPath } from 'url';
const here = path.dirname(fileURLToPath(import.meta.url));
process.env.AISH_TESTS = here;
process.env.AISH_SRC = path.resolve(here, '../src');
process.env.AISH_ROOT = path.resolve(here, '../..');

// Tests wait in real time (typing animation, 4–6 s timers, polling). Timer delays above 4 ms are divided by AISH_TEST_SPEED (default 8, 1 = off)
// for the test and the code under test alike, so their relative order is unchanged and the suite stops sleeping.
const speed = Number(process.env.AISH_TEST_SPEED || 8);
if (speed > 1) {
    const scale = (ms) => (ms > 4 ? Math.max(1, Math.round(ms / speed)) : ms);
    const realTimeout = globalThis.setTimeout, realInterval = globalThis.setInterval;
    globalThis.setTimeout = (fn, ms, ...rest) => realTimeout(fn, scale(Number(ms) || 0), ...rest);
    globalThis.setInterval = (fn, ms, ...rest) => realInterval(fn, scale(Number(ms) || 0), ...rest);
}
