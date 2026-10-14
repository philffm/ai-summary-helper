// openaiModelsCheck.js — lists the models of an OpenAI-compatible server: GET <base>/models → { data: [{ id }] }.
// A failing list is never an error for the user: the model name can always be typed by hand.
import { modelsUrl } from './endpointUrl.js';

/**
 * @param {string} endpoint stored chat endpoint (or base URL)
 * @param {string} [apiKey]
 * @returns {Promise<{ok:true, models:string[]} | {ok:false, reason:'unreachable'|'unauthorized'|'notfound'|'http'|'invalid', status?:number}>}
 */
export async function checkOpenAiModels(endpoint, apiKey) {
    const url = modelsUrl(endpoint);
    if (!url) return { ok: false, reason: 'invalid' };
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 4000);
    try {
        const res = await fetch(url, { signal: ctrl.signal, headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {} });
        if (res.status === 401 || res.status === 403) return { ok: false, reason: 'unauthorized', status: res.status };
        if (res.status === 404) return { ok: false, reason: 'notfound', status: 404 };
        if (!res.ok) return { ok: false, reason: 'http', status: res.status };
        const data = await res.json();
        const list = Array.isArray(data) ? data : (Array.isArray(data.data) ? data.data : []);
        const models = [...new Set(list.map(m => String((m && (m.id || m.name)) || '').trim()).filter(Boolean))];
        return { ok: true, models };
    } catch (_) {
        return { ok: false, reason: 'unreachable' };
    } finally {
        clearTimeout(timer);
    }
}
