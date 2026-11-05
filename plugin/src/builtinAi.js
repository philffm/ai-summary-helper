// builtinAi.js — Chrome's built-in model (Prompt API, `LanguageModel`) behind the same request path as Ollama.
// Classic script: loaded by the service worker (importScripts) and by offscreen.html. The model id `chrome-builtin`
// (picked under Settings › Models › Ollama / local) makes background.js answer a request here instead of fetch():
// AishBuiltin.response(url, init) returns a fetch-like Response whose body is Ollama NDJSON (for …/api/chat) or
// OpenAI SSE, so the existing stream parsers read it unchanged. Where the worker has no LanguageModel, the prompt runs in
// the offscreen document over a port ('aish-builtin').
(function () {
    const MODEL_ID = 'chrome-builtin';
    const FIREFOX_ID = 'firefox-ml';   // Firefox's AI runtime (browser.trial.ml, optional permission trialML): summaries only
    const LANGS = ['en', 'de', 'es', 'fr', 'ja'];
    // Chrome takes the language list; other browsers' models (Opera: Gemma / Apple's model, Edge: Phi-4-mini) may refuse it
    // ('unavailable' or a throw). Then English only, then no options; the first that is not 'unavailable' is kept.
    const VARIANTS = [{ expectedInputs: [{ type: 'text', languages: LANGS }], expectedOutputs: [{ type: 'text', languages: LANGS }] },
        { expectedInputs: [{ type: 'text', languages: ['en'] }], expectedOutputs: [{ type: 'text', languages: ['en'] }] }, {}];
    let picked = null;
    async function opts() {
        if (picked) return picked;
        const LM = self.LanguageModel;
        if (!LM || typeof LM.availability !== 'function') return (picked = VARIANTS[0]);
        for (const o of VARIANTS) { try { if (String(await LM.availability(o)) !== 'unavailable') return (picked = o); } catch (_) { /* next */ } }
        return VARIANTS[0];
    }
    const hasApi = () => typeof self.LanguageModel !== 'undefined' && self.LanguageModel && typeof self.LanguageModel.create === 'function';

    /** Streams one prompt here (this context has LanguageModel). onDelta(text) per new part. Retries once with a shorter text on overflow. */
    async function runHere({ system, user, signal, onDelta }) {
        const LM = self.LanguageModel;
        const session = await LM.create({ ...(await opts()), initialPrompts: system ? [{ role: 'system', content: system }] : [], signal });
        try {
            const go = async (text) => { for await (const chunk of session.promptStreaming(text, { signal })) onDelta(String(chunk)); };
            try { await go(user); }
            catch (e) {
                if (!(e && e.name === 'QuotaExceededError')) throw e;
                // The page is longer than the model's window: keep the start and the instructions at the end, drop the middle.
                const ratio = e.requested && e.contextWindow ? Math.max(0.2, (e.contextWindow * 0.8) / e.requested) : 0.5;
                const keep = Math.floor(user.length * ratio), tail = Math.min(2000, Math.floor(keep * 0.25));
                await go(user.slice(0, keep - tail) + '\n…\n' + user.slice(user.length - tail));
            }
        } finally { try { session.destroy(); } catch (_) { /* gone */ } }
    }

    /** In the worker: run here if possible, else in the offscreen document. */
    async function run({ system, user, signal, onDelta }) {
        if (hasApi()) return runHere({ system, user, signal, onDelta });
        if (!(self.chrome && chrome.offscreen && chrome.offscreen.createDocument)) throw new Error('The built-in Chrome model is not available in this browser.');
        const has = chrome.runtime.getContexts ? (await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] })).length > 0 : false;
        if (!has) await chrome.offscreen.createDocument({ url: 'offscreen.html', reasons: ['WORKERS', 'AUDIO_PLAYBACK'], justification: 'Run the built-in Chrome model and play podcast episodes' }).catch((e) => { if (!/single offscreen/i.test(String(e && e.message))) throw e; });
        return new Promise((resolve, reject) => {
            const port = chrome.runtime.connect({ name: 'aish-builtin' });
            let done = false;
            const finish = (err) => { if (done) return; done = true; try { port.disconnect(); } catch (_) { /* closed */ } err ? reject(err) : resolve(); };
            port.onMessage.addListener((m) => {
                if (m.delta) onDelta(m.delta);
                if (m.error) finish(Object.assign(new Error(m.error), { name: m.name || 'Error' }));
                if (m.done) finish();
            });
            port.onDisconnect.addListener(() => finish(done ? null : new Error('The built-in model stopped.')));
            if (signal) signal.addEventListener('abort', () => finish(Object.assign(new Error('Aborted'), { name: 'AbortError' })), { once: true });
            port.postMessage({ system, user });
        });
    }

    // ── Firefox: task models (Transformers.js), not a chat model. The summarization task (distilbart) writes a short summary
    // of the page text; it cannot follow instructions, so anything that is not a page summary is refused with a clear message.
    const ffApi = () => (typeof browser !== 'undefined' && browser.trial && browser.trial.ml) || null;
    let ffEngine = null;
    const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    /** The page text inside a summary request (between "Content:" and the final instructions); '' when it is no summary request. */
    function pageOf(user) {
        const i = user.indexOf('Content: '), j = user.indexOf('=== FINAL INSTRUCTIONS');
        if (i < 0 || j < 0) return '';
        return user.slice(i + 9, j).trim();
    }
    async function runFirefox({ user, onDelta }) {
        const ml = ffApi();
        if (!ml) throw new Error("Firefox's built-in AI is off. Allow it under Settings › Models › Local (and in Firefox Beta/Release set browser.ml.enable and extensions.ml.enabled to true in about:config).");
        const page = pageOf(user);
        if (!page) throw new Error("Firefox's built-in model can only summarize pages. Pick another local model for feeds, questions and tags.");
        if (!ffEngine) ffEngine = Promise.resolve(ml.createEngine({ modelHub: 'huggingface', taskName: 'summarization' })).catch((e) => { ffEngine = null; throw e; });
        await ffEngine;
        const res = await ml.runEngine({ args: [page.slice(0, 4000)], options: { max_new_tokens: 220 } });   // the model reads about 1,000 tokens
        const out = String((res && res[0] && (res[0].summary_text || res[0].generated_text)) || '').trim();
        if (!out) throw new Error('No summary returned.');
        onDelta('<div><h2>Summary</h2><p>' + esc(out) + '</p></div>');
    }

    /** The request body (Ollama /api/chat or OpenAI chat) → system + user text. */
    function split(body) {
        let j = {}; try { j = JSON.parse(body || '{}'); } catch (_) { /* not JSON */ }
        const msgs = Array.isArray(j.messages) ? j.messages : [];
        const text = (m) => typeof m.content === 'string' ? m.content : Array.isArray(m.content) ? m.content.map(p => p.text || '').join('\n') : '';
        return { model: j.model || '', system: msgs.filter(m => m.role === 'system').map(text).join('\n\n'), user: msgs.filter(m => m.role !== 'system').map(text).join('\n\n') };
    }
    const modelOf = (body) => { try { return JSON.parse(body || '{}').model || ''; } catch (_) { return ''; } };
    const isBuiltin = (body) => { const m = modelOf(body); return m === MODEL_ID || m === FIREFOX_ID; };

    /** A fetch-like Response streaming the reply in the format the caller's endpoint would use. */
    function response(url, init = {}) {
        const { system, user, model } = split(init.body);
        const runner = model === FIREFOX_ID ? runFirefox : run;
        const ndjson = /\/api\/chat\b/.test(String(url || ''));
        const enc = new TextEncoder();
        const line = (delta) => ndjson ? JSON.stringify({ model: MODEL_ID, message: { role: 'assistant', content: delta }, done: false }) + '\n'
            : 'data: ' + JSON.stringify({ choices: [{ delta: { content: delta } }] }) + '\n\n';
        const stream = new ReadableStream({
            async start(ctrl) {
                try {
                    await runner({ system, user, signal: init.signal, onDelta: (d) => ctrl.enqueue(enc.encode(line(d))) });
                    ctrl.enqueue(enc.encode(ndjson ? JSON.stringify({ model: MODEL_ID, done: true }) + '\n' : 'data: [DONE]\n\n'));
                    ctrl.close();
                } catch (e) { ctrl.error(e); }
            }
        });
        return new Response(stream, { status: 200, headers: { 'content-type': ndjson ? 'application/x-ndjson' : 'text/event-stream' } });
    }

    /** fetch() for model requests: the built-in model answers `chrome-builtin`, everything else goes to the network. */
    const aiFetch = (url, init) => (isBuiltin(init && init.body) ? Promise.resolve(response(url, init)) : fetch(url, init));

    /** Offscreen side: answer the worker's prompts. */
    function host() {
        chrome.runtime.onConnect.addListener((port) => {
            if (port.name !== 'aish-builtin') return;
            const ctl = new AbortController();
            port.onDisconnect.addListener(() => ctl.abort());
            port.onMessage.addListener(async (m) => {
                try {
                    if (!hasApi()) throw new Error('The built-in Chrome model is not available in this browser.');
                    await runHere({ system: m.system, user: m.user, signal: ctl.signal, onDelta: (delta) => port.postMessage({ delta }) });
                    port.postMessage({ done: true });
                } catch (e) { try { port.postMessage({ error: String((e && e.message) || e), name: e && e.name }); } catch (_) { /* gone */ } }
            });
        });
    }

    self.AishBuiltin = { MODEL_ID, FIREFOX_ID, isBuiltin, response, aiFetch, host, split, pageOf };
})();
