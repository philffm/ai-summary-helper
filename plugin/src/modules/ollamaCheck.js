// ollamaCheck.js — probes a local Ollama server and lists the installed models.
// GET <origin>/api/tags answers with { models: [{ name, size, … }] }.

const DEFAULT_ENDPOINT = 'http://localhost:11434/api/chat';

/**
 * @param {string} [endpoint] chat endpoint configured for Ollama
 * @returns {Promise<{ok:true, models:string[]} | {ok:false, reason:'unreachable'|'forbidden'|'http'|'invalid', status?:number}>}
 */
export async function checkOllama(endpoint) {
    let origin;
    try { origin = new URL(endpoint || DEFAULT_ENDPOINT).origin; } catch (_) { return { ok: false, reason: 'invalid' }; }
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 4000);
    try {
        const res = await fetch(`${origin}/api/tags`, { signal: ctrl.signal });
        if (res.status === 403) return { ok: false, reason: 'forbidden', status: 403 };
        if (!res.ok) return { ok: false, reason: 'http', status: res.status };
        const data = await res.json();
        const models = [...new Set((Array.isArray(data.models) ? data.models : []).map(m => String(m.name || m.model || '').trim()).filter(Boolean))];
        return { ok: true, models };
    } catch (_) {
        return { ok: false, reason: 'unreachable' };
    } finally {
        clearTimeout(timer);
    }
}
