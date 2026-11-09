// bg/aiComplete.js — one-shot AI completion (feed recaps, tone scoring) and the model connection (cloud, own key, local servers).
// A classic script of the background worker, loaded where background.js says importScripts('bg/aiComplete.js')
// (Chrome/Android) or listed after background.js in the manifest (Firefox/iOS). Same global scope as background.js:
// it uses names from there and background.js uses its functions, only ever from inside listeners and functions.
/* global FEED_WORKER, SK, localGet */
/* exported cloudRegionHeader, usedModelOf, noteCloudRoute, LOCAL_URL, aiFetch, aiJobs, aiResyncAsked, aiComplete */

// ── One-shot AI completion (feed recaps, tone scoring) ──────────────────────
// Same connection logic as the page summarizer (byPhil Cloud, own key, or a
// local Ollama), but non-streaming and callable from any extension page.

const AISH_API_BASE = 'https://api.byphil.eu';

// "Prefer EU servers" (Settings → Models, hosted models only): the hosted service pins EU endpoints for models that have them and runs the others
// as usual. A service that does not know the header ignores it. The answer's X-AISH-Region says which route was really used; the app shows that.
const AISH_FEATURES = ['summary', 'qa', 'recap', 'tags', 'analysis', 'translate'];
async function cloudRegionHeader(url, feature) {
    if (!String(url).startsWith(AISH_API_BASE + '/v1/projects/')) return {};
    const s = await chrome.storage.sync.get(['cloudRegionPref']).catch(() => ({}));
    return {
        ...(s.cloudRegionPref === 'prefer-eu' ? { 'X-AISH-Region': 'prefer-eu' } : {}),
        // what the request is for: the hosted service's Auto models use it to pick a model (an older service ignores it)
        ...(AISH_FEATURES.includes(feature) ? { 'X-AISH-Feature': feature } : {}),
    };
}
// The model that really answered (the hosted service says so in X-AISH-Model-Used), so history and stats show it and never just "auto". '' when not reported.
function usedModelOf(url, res) {
    try {
        if (!String(url).startsWith(AISH_API_BASE + '/v1/projects/')) return '';
        const m = res.headers.get('x-aish-model-used') || '';
        return /^[A-Za-z0-9_.:\-]{1,60}\/[A-Za-z0-9_.:\-]{1,80}$/.test(m) ? m : '';
    } catch (_) { return ''; }
}
function noteCloudRoute(url, res, model) {
    try {
        if (!String(url).startsWith(AISH_API_BASE + '/v1/projects/')) return;
        const region = res.headers.get('x-aish-region');
        if (region !== 'eu' && region !== 'global') return;   // an older service says nothing: nothing is recorded
        const used = (res.headers.get('x-aish-model-used') || '').slice(0, 120), switched = res.headers.get('x-aish-switched') === 'long-text' ? 'long-text' : '';
        const am = /^(tiny|small|large):([a-z-]{1,24})$/.exec(res.headers.get('x-aish-auto') || '');   // Auto: which tier it chose and why
        chrome.storage.local.set({ [SK.cloudRoute]: { region, model: model || '', ...(used ? { used } : {}), ...(switched ? { switched } : {}), ...(am ? { auto: { tier: am[1], reason: am[2] } } : {}), at: Date.now() } });
    } catch (_) { /* a status note must never break a summary */ }
}

// Login-token expiry (same rule as modules/sessionToken.js; this file is not a module). Only a readable JWT with a past `exp` counts.
function aiTokenExpired(token) {
    if (!token || typeof token !== 'string') return false;
    try {
        let b64 = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
        if (b64.length % 4) b64 += '='.repeat(4 - (b64.length % 4));
        const p = JSON.parse(decodeURIComponent(atob(b64).split('').map((c) => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2)).join('')));
        return typeof p.exp === 'number' && p.exp * 1000 <= Date.now();
    } catch (_) { return false; }
}

// Silent login renewal for the worker (same rule as refreshSession() in modules/sessionToken.js): a token with under 7 days left is
// swapped via POST /v1/auth/refresh. Never throws; on any failure the old token stays.
let aiRefreshFailedAt = 0, aiRefreshInflight = null;
function aiTokenNeedsRefresh(token) {
    if (!token || typeof token !== 'string' || aiTokenExpired(token)) return false;
    try {
        let b64 = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
        if (b64.length % 4) b64 += '='.repeat(4 - (b64.length % 4));
        const p = JSON.parse(decodeURIComponent(atob(b64).split('').map((c) => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2)).join('')));
        return typeof p.exp === 'number' && p.exp * 1000 - Date.now() < 7 * 24 * 3600e3;
    } catch (_) { return false; }
}
function aiRefreshSession(token) {
    if (aiRefreshInflight) return aiRefreshInflight;
    if (Date.now() - aiRefreshFailedAt < 10 * 60e3) return Promise.resolve(false);
    aiRefreshInflight = (async () => {
        try {
            const res = await fetch('https://api.byphil.eu/v1/auth/refresh', { method: 'POST', headers: { Authorization: `Bearer ${token}` } });
            const body = res.ok ? await res.json() : null;
            if (!body || !body.success || !body.token) { aiRefreshFailedAt = Date.now(); return false; }
            const write = { [SK.token]: body.token };
            if (body.record && body.record.id) write[SK.user] = body.record;
            if (body.record && body.record.license_key) write[SK.licenseKey] = body.record.license_key;
            await chrome.storage.local.set(write);
            return true;
        } catch (_) { aiRefreshFailedAt = Date.now(); return false; } finally { aiRefreshInflight = null; }
    })();
    return aiRefreshInflight;
}

function aiFriendlyError(status, body, cloud) {
    const e = `${status} ${body || ''}`;
    // Server-side cost budget (byphilapi): specific codes before the generic "limit" wording below.
    if (/quota_exceeded/.test(e)) return 'Your monthly AI allowance is used up. It resets on the 1st \u2014 local models still work.';
    if (/rate_limited/.test(e)) return 'Too many AI requests in a short time. Please wait a few minutes.';
    if (/too_large/.test(e)) return 'That is too much text for one request. Try fewer items.';
    if (/402|429|trial exhausted|requests per day|requests per week|quota|too many|rate/i.test(e)) {
        return 'You\u2019ve reached your free daily limit. Come back tomorrow \u2014 or upgrade to Pro for unlimited use.' + (cloud ? ' Already a Pro user? Sign in again under Settings \u203a Account.' : '');
    }
    if (cloud && (status === 401 || status === 403)) return 'Your session could not be verified. Please sign in again under Settings \u203a Account.';
    if (status === 401 || status === 403) return `The server rejects the key or the request (${status}). Check the API key in Settings.`;
    if (status === 404) return 'The path does not match (404). With your own server the address usually needs /v1 at the end.';
    return `AI request failed (${status}${body ? ': ' + String(body).slice(0, 160) : ''})`;
}

function parseAiResponseText(raw) {
    const t = (raw || '').trim();
    // SSE (some providers stream even when asked not to): accumulate deltas.
    // NDJSON (Ollama's native /api/chat streams one JSON object per line, possibly "thinking" first, then "content").
    if (t.startsWith('{')) {
        let single = true;
        try { JSON.parse(t); } catch (_) { single = false; }
        if (!single) {
            let out = '';
            // One object per line, or objects glued together with just whitespace between them.
            for (const line of t.split(/\r?\n|(?<=\})\s+(?=\{)/)) { const d = aiDelta(line); if (d) out += d.text; }
            if (out.trim()) return out.trim();
        }
    }
    if (/^data:/m.test(t) && !t.startsWith('{')) {
        let out = '';
        for (const line of t.split('\n')) {
            if (!line.startsWith('data:')) continue;
            const payload = line.slice(5).trim();
            if (!payload || payload === '[DONE]') continue;
            try {
                const j = JSON.parse(payload);
                out += j.choices?.[0]?.delta?.content ?? j.choices?.[0]?.message?.content ?? j.message?.content
                    ?? (j.candidates?.[0]?.content?.parts || []).map(p => p.text || '').join('') ?? '';
            } catch (_) { /* ignore partial lines */ }
        }
        return out.trim();
    }
    let j;
    try { j = JSON.parse(t); } catch (_) { return t; }
    const gem = (j.candidates?.[0]?.content?.parts || []).map(p => p.text || '').join('');
    return String(j.choices?.[0]?.message?.content ?? j.message?.content ?? j.choices?.[0]?.text ?? gem ?? '').trim();
}

/** Text added by one SSE/NDJSON line: { text, think } (think = reasoning tokens of "thinking" models). */
function aiDelta(line) {
    line = line.trim();
    if (line.startsWith('data:')) line = line.slice(5).trim();
    if (!line || line === '[DONE]' || line[0] !== '{') return null;
    try {
        const j = JSON.parse(line);
        const d = j.choices?.[0]?.delta || {};
        const text = d.content ?? j.message?.content ?? (j.candidates?.[0]?.content?.parts || []).map(p => p.text || '').join('') ?? '';
        const think = d.reasoning_content ?? d.reasoning ?? j.message?.thinking ?? '';
        return { text: text || '', think: think || '' };
    } catch (_) { return null; }
}

// Local model servers (Ollama, apfel, LM Studio, llama.cpp, Jan) often accept requests only from localhost pages (Ollama:
// OLLAMA_ORIGINS, apfel: "origin: localhost only"). For requests this extension itself sends to them, the Origin header is
// set to http://127.0.0.1 so they are accepted. Web pages are not affected (only requests that belong to no tab: this
// extension's worker, popup and offscreen page; an extension's rules never touch other extensions); session rules,
// renewed whenever the worker starts.
const LOCAL_MODEL_PORTS = [11434, 1234, 8080, 1337];   // Ollama / apfel, LM Studio, llama.cpp, Jan
async function allowLocalModelServers() {
    try {
        const dnr = chrome.declarativeNetRequest;
        if (!dnr || !dnr.updateSessionRules || !chrome.runtime.id) return;
        const rules = []; let id = 9100;
        for (const host of ['127.0.0.1', 'localhost']) for (const port of LOCAL_MODEL_PORTS) {
            rules.push({ id: id++, priority: 1,
                action: { type: 'modifyHeaders', requestHeaders: [{ header: 'origin', operation: 'set', value: 'http://127.0.0.1' }] },
                condition: { urlFilter: `|http://${host}:${port}/`, tabIds: [-1], resourceTypes: ['xmlhttprequest', 'other'] } });
        }
        await dnr.updateSessionRules({ removeRuleIds: rules.map(r => r.id), addRules: rules });
        console.info('[AISH] local model origin rules set', rules.length);
    } catch (e) { console.warn('[AISH] local model origin rule not set', e && e.message); }
}
allowLocalModelServers();

// Model requests: Chrome's built-in model (model id `chrome-builtin`, see builtinAi.js) answers here, everything else is a normal fetch.
const aiFetchRaw = (url, init) => (typeof AishBuiltin !== 'undefined' ? AishBuiltin.aiFetch(url, init) : fetch(url, init));
// A local model that is still loading (apfel right after Apple Intelligence was turned on or updated: "Model assets are loading.
// Try again in a moment.") accepts the request and then breaks the stream. For local servers the start of the stream is read
// first: real text → hand on everything (nothing lost); "loading" → wait and ask again, up to about two minutes; still loading →
// a clear 503 instead of an empty summary.
const LOCAL_URL = /^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])(:\d+)?\//i;
const MODEL_LOADING = /assets are loading|model (is )?loading|\[model loading\]/i;
// Parts of D (AISH-033): when the chosen local model is not ready (not reachable, still loading, server error), the next ready
// local model from Settings › Models › Local answers instead (sync: localFallbackOrder, saved there in recommendation order;
// switch: localFallback, on by default). The answer carries `x-aish-fallback` so the summary says who wrote it.
async function localFallbacks(model) {
    try {
        const s = await chrome.storage.sync.get(['localFallback', 'localFallbackOrder']);
        if (s.localFallback === false || !Array.isArray(s.localFallbackOrder)) return [];
        return s.localFallbackOrder.filter(c => c && c.model && c.model !== model && LOCAL_URL.test(String(c.endpoint || '')));
    } catch (_) { return []; }
}
const withModel = (body, model) => { try { const j = JSON.parse(body); j.model = model; return JSON.stringify(j); } catch (_) { return body; } };   // same messages in both formats
async function aiFetch(url, init = {}) {
    if (!LOCAL_URL.test(String(url))) return aiFetchRaw(url, init);
    let first = null, firstErr = null;
    try { first = await aiFetchOne(url, { ...init, quick: true }); } catch (e) { if (e && e.name === 'AbortError') throw e; firstErr = e; }
    if (first && first.ok) return first;
    let wanted = ''; try { wanted = JSON.parse(init.body || '{}').model || ''; } catch (_) { /* not JSON */ }
    for (const alt of await localFallbacks(wanted)) {
        try {
            const res = await aiFetchOne(alt.endpoint, { ...init, body: withModel(init.body, alt.model), quick: true });
            if (res && res.ok) {
                const h = new Headers(res.headers); h.set('x-aish-fallback', alt.label || alt.model); h.set('x-aish-fallback-from', wanted);
                return new Response(res.body, { status: res.status, headers: h });
            }
        } catch (e) { if (e && e.name === 'AbortError') throw e; }
    }
    if (first && first.status !== 425) return first;   // no fallback answered: the original answer (error) stands
    if (firstErr) throw firstErr;
    return aiFetchOne(url, init);   // only “still loading” is left: wait for it (up to ~2 minutes)
}
async function aiFetchOne(url, init = {}) {
    const { quick, ...req } = init;   // quick: on “still loading” return 425 at once, so a fallback can answer first
    if (!LOCAL_URL.test(String(url))) return aiFetchRaw(url, req);
    const signal = init.signal, dec = new TextDecoder();
    for (let attempt = 0; attempt < 24; attempt++) {
        const res = await aiFetchRaw(url, req);
        if (!res.ok || !res.body) {
            const body = res.ok ? '' : await res.clone().text().catch(() => '');
            if (!MODEL_LOADING.test(body)) return res;
        } else {
            const reader = res.body.getReader(); const head = []; let seen = '', loading = false;
            for (;;) {
                const { value, done } = await reader.read();
                if (done) break;
                head.push(value); seen += dec.decode(value, { stream: true });
                if (MODEL_LOADING.test(seen)) { loading = true; try { await reader.cancel(); } catch (_) { /* gone */ } break; }
                if (/"content"\s*:\s*"(?!")/.test(seen) || /"response"\s*:\s*"(?!")/.test(seen) || seen.length > 6000) break;   // text has started
            }
            if (!loading) {
                const stream = new ReadableStream({
                    start(ctrl) { head.forEach(c => ctrl.enqueue(c)); },
                    async pull(ctrl) { try { const { value, done } = await reader.read(); if (done) ctrl.close(); else ctrl.enqueue(value); } catch (e) { ctrl.error(e); } },
                    cancel() { try { reader.cancel(); } catch (_) { /* gone */ } }
                });
                return new Response(stream, { status: res.status, headers: res.headers });
            }
        }
        if (signal && signal.aborted) throw Object.assign(new Error('Aborted'), { name: 'AbortError' });
        if (init.quick) return new Response('{"error":{"message":"model loading"}}', { status: 425, headers: { 'content-type': 'application/json' } });   // let a fallback answer first
        await new Promise(r => setTimeout(r, 5000));   // the model loads in the background; ask again
    }
    return new Response(JSON.stringify({ error: { message: "The local model is still loading on this computer (the first use after turning it on or after an update can take a few minutes). Try again in a moment." } }), { status: 503, headers: { 'content-type': 'application/json' } });
}
const aiJobs = new Map(); // request id → AbortController, so the popup can cancel a slow (e.g. local) model
const aiResyncAsked = new Set(); // request ids whose receiver lost a streamed delta: the next tick resends the whole text
async function aiComplete({ system, user, id, partial, service: forcedService, signal, feature, target }) {
    const sync = await chrome.storage.sync.get(['activeService', 'connectionMode', 'preferredCloudModel']).catch(() => ({}));
    let local = await localGet([SK.servicesConfig, SK.licenseKey, SK.token, SK.installId]).catch(() => ({}));
    if (!forcedService && (sync.connectionMode || 'cloud') === 'cloud' && aiTokenNeedsRefresh(local[SK.token]) && await aiRefreshSession(local[SK.token])) {
        local = await localGet([SK.servicesConfig, SK.licenseKey, SK.token, SK.installId]).catch(() => local);
    }
    // `forcedService` (only 'ollama') lets the whole-library run use the local model whatever is active for summaries.
    const forced = forcedService === 'ollama' ? 'ollama' : '';
    const connectionMode = forced ? 'local' : (sync.connectionMode || 'cloud');
    let service = forced || sync.activeService || 'openai';
    const cfg = (local[SK.servicesConfig] || {})[service] || {};
    const modelId = (m) => (!m ? '' : typeof m === 'string' ? m : (m.id || ''));

    let url = cfg.endpointUrl || cfg.endpoint;
    let model = modelId(cfg.activeModelId) || (Array.isArray(cfg.customModel) ? modelId(cfg.customModel[0]) : modelId(cfg.customModel)) || cfg.model;
    let apiKey = cfg.apiKey || '';
    let keyOptional = false;

    if (connectionMode === 'cloud') {
        service = 'cloud';
        url = `${AISH_API_BASE}/v1/projects/ai_summary_helper/chat`;
        model = sync.preferredCloudModel || 'google/gemini-3.8-flash';
        // An expired login token is not sent (the API would treat it as signed out): use the license key, else ask for a new sign-in.
        const tokenExpired = aiTokenExpired(local[SK.token]);
        apiKey = (!tokenExpired && local[SK.token]) || local[SK.licenseKey] || '';
        if (tokenExpired && !apiKey) throw new Error('Your session has expired. Please sign in again under Settings \u203a Account.');
        keyOptional = true;
    } else {
        url = cfg.endpointUrl || url;
        model = cfg.modelIdentifier || model;
        try {
            const list = await (await fetch(chrome.runtime.getURL('services.json'))).json();
            const meta = list.find(x => (x.id || '').toLowerCase() === service.toLowerCase());
            if (meta) {
                keyOptional = !!meta.apiKeyOptional;
                url = url || meta.endpointUrl;
                model = model || meta.defaultModel;
            }
        } catch (_) { /* services.json unavailable */ }
        if (service === 'ollama') {
            keyOptional = true;
            if (!model) throw new Error('No Ollama model selected. Install one (e.g. "ollama pull llama3.2") and pick it in the model panel.');
        }
        if (service === 'custom' && !model) throw new Error('No model selected for your own server. Pick or type the model name in the model panel.');
    }
    // The quick test in Settings › Models › Local asks one particular local model (never anything outside this computer).
    if (target && target.model && LOCAL_URL.test(String(target.endpoint || ''))) {
        service = 'ollama'; url = target.endpoint; model = target.model; apiKey = ''; keyOptional = true;
    }
    if (!apiKey && !keyOptional) throw new Error('Set your API key under Settings \u203a Models & API first.');
    if (!url && service !== 'gemini') throw new Error('Model endpoint is not configured.');
    if (url) new URL(url);

    const headers = { 'Content-Type': 'application/json' };
    let body;
    if (service === 'gemini') {
        url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:streamGenerateContent?alt=sse`;
        headers['x-goog-api-key'] = apiKey;
        body = JSON.stringify({ contents: [{ role: 'user', parts: [{ text: `${system}\n\n${user}` }] }] });
    } else {
        if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;
        if (local[SK.installId]) headers['X-Install-ID'] = local[SK.installId];
        body = JSON.stringify({ model, messages: [{ role: 'system', content: system }, { role: 'user', content: user }], stream: true });
    }

    // No timeout: local models can take minutes. The user cancels from the recap status card instead.
    const ctrl = new AbortController();
    const abort = () => ctrl.abort();
    if (signal) {
        if (signal.aborted) ctrl.abort();
        else signal.addEventListener('abort', abort, { once: true });
    }
    if (id) aiJobs.set(id, ctrl);
    const progress = (p) => { if (id) { try { chrome.runtime.sendMessage({ action: 'aiProgress', id, ...p }, () => void chrome.runtime.lastError); } catch (_) { /* popup closed */ } } };
    try {
        Object.assign(headers, await cloudRegionHeader(url, feature));
        const send = target ? aiFetchOne : aiFetch;   // the quick test measures exactly this model: no fallback
        let res = await send(url, { method: 'POST', headers, body, signal: ctrl.signal });
        noteCloudRoute(url, res, model);
        // A provider that rejects "stream": true gets one retry without streaming.
        if ((res.status === 400 || res.status === 422) && service !== 'gemini') {
            res = await send(url, { method: 'POST', headers, body: body.replace('"stream":true', '"stream":false'), signal: ctrl.signal });
        }
        if (!res.ok) throw new Error(aiFriendlyError(res.status, await res.text(), service === 'cloud'));
        progress({ phase: 'headers' });
        let raw = '';
        if (res.body && res.body.getReader) {
            const reader = res.body.getReader();
            const dec = new TextDecoder('utf-8');
            let buf = '', chars = 0, think = 0, last = 0, acc = '', sent = 0;
            // Only what is new since the last tick goes over the wire (the full text every 250 ms is O(n²)); the receiver appends.
            const partialPart = () => {
                if (!partial) return {};
                if (id && aiResyncAsked.delete(id)) sent = 0; // receiver missed a tick: resend from the start (it replaces what it holds)
                const from = sent, delta = acc.slice(sent); sent = acc.length; return { delta, from };
            };
            for (;;) {
                const { value, done } = await reader.read();
                if (done) break;
                const chunk = dec.decode(value, { stream: true });
                raw += chunk; buf += chunk;
                const lines = buf.split('\n'); buf = lines.pop();
                let tail = '';
                for (const l of lines) { const d = aiDelta(l); if (d) { chars += d.text.length; think += d.think.length; tail += d.text; if (partial) acc += d.text; } }
                const now = Date.now();
                if (now - last > 250) { last = now; progress({ phase: 'stream', chars, think, tail: tail.slice(-80), ...partialPart() }); }
            }
            raw += dec.decode();
            progress({ phase: 'stream', chars, think, tail: '', ...partialPart() });
        } else raw = await res.text();
        const text = parseAiResponseText(raw);
        if (!text) throw new Error('The model returned an empty response.');
        return { text, model };
    } catch (e) {
        if (e.name === 'AbortError') throw new Error('The AI request was cancelled.');
        throw e;
    } finally {
        if (id) { aiJobs.delete(id); aiResyncAsked.delete(id); }
        if (signal) signal.removeEventListener('abort', abort);
    }
}

if (typeof FEED_WORKER !== 'undefined' && FEED_WORKER) {
    FEED_WORKER.setAiTransport(({ system, user, signal, partial, service, feature }) =>
        aiComplete({ system, user, signal, partial, service, feature }).then(result => result.text));
}
