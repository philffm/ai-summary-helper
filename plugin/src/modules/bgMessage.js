// bgMessage.js — one way to ask the background worker something from a page.
// Never rejects and never hangs: a sleeping or crashed worker, a closed channel or a missing answer all resolve to `fallback`
// (default null), a worker that does not answer within `timeout` ms too (0 = wait as long as it takes).
export function bgMessage(msg, { timeout = 20000, fallback = null, api = globalThis.chrome } = {}) {
    return new Promise((resolve) => {
        let done = false, timer = null;
        const finish = (v) => { if (done) return; done = true; if (timer) clearTimeout(timer); resolve(v); };
        if (timeout > 0) timer = setTimeout(() => finish(fallback), timeout);
        try {
            api.runtime.sendMessage(msg, (res) => { void api.runtime.lastError; finish(res == null ? fallback : res); });
        } catch (_) { finish(fallback); }
    });
}
