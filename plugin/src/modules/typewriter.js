// typewriter.js — types a text out like a person at a keyboard (uneven key timing, longer pauses after punctuation).
// Used for the instant short answer of a suggested follow-up while the full answer is requested.
/** Delay (ms) before the next key press, after `prev` was typed. `rnd` is injectable for tests. */
export function typingDelay(prev, rnd = Math.random) {
    let d = 22 + rnd() * 38;                                   // 22–60 ms per key
    if (prev === ',' || prev === ';' || prev === ':') d += 70 + rnd() * 90;
    else if (prev === '.' || prev === '!' || prev === '?' || prev === '…') d += 170 + rnd() * 220;
    else if (prev === ' ' && rnd() < 0.07) d += 120 + rnd() * 200;   // a small hesitation between words
    else if (rnd() < 0.03) d += 90 + rnd() * 160;                // a slip of the fingers
    return d;
}

/**
 * Type `text` into `onUpdate(partial)`. `fast()` → true speeds it up (the full answer is already there).
 * Returns { done: Promise<boolean>, stop() } — done resolves true when the text was typed completely.
 */
export function typeText(text, onUpdate, { fast = () => false, rnd = Math.random, instant = false, setTimer = setTimeout, clearTimer = clearTimeout } = {}) {
    const chars = Array.from(String(text || ''));
    let i = 0, timer = null, stopped = false, resolveDone;
    const done = new Promise((r) => { resolveDone = r; });
    const finish = (complete) => { if (timer) clearTimer(timer); timer = null; resolveDone(complete); };
    const step = () => {
        if (stopped) return;
        i = Math.min(chars.length, i + (fast() ? 4 : 1));
        onUpdate(chars.slice(0, i).join(''));
        if (i >= chars.length) { finish(true); return; }
        timer = setTimer(step, fast() ? 8 : typingDelay(chars[i - 1], rnd));
    };
    if (instant || !chars.length) { onUpdate(chars.join('')); finish(true); }
    else timer = setTimer(step, 250 + rnd() * 250);               // a beat before the first key
    return { done, stop() { stopped = true; finish(false); } };
}
