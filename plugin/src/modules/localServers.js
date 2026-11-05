// localServers.js — other local model servers next to Ollama, for Settings › Models › Local. All speak the OpenAI API:
// GET <origin>/v1/models lists the models, POST <origin>/v1/chat/completions answers. Probed in parallel with a short
// timeout; nothing found = nothing shown. A server that answers but refuses the extension (401/403: it only accepts
// requests from localhost pages) is reported as `blocked`, so the panel can say how to allow it.
// (Ollama is probed separately: ollamaCheck.js; the browser's own model: nanoModel.js / builtinAi.js.)
export const LOCAL_SERVERS = [
    { id: 'lmstudio', name: 'LM Studio', origins: ['http://localhost:1234'] },
    { id: 'llamacpp', name: 'llama.cpp / llamafile', origins: ['http://localhost:8080'] },
    { id: 'jan', name: 'Jan', origins: ['http://localhost:1337'] },
    // Apple's on-device model (macOS 26 Tahoe, Apple Intelligence on) via the open-source `apfel --serve`, on its default port
    // 11434 (Ollama's: one of the two runs at a time). Only its own model id counts, so Ollama's /v1/models is never listed twice.
    { id: 'apfel', name: 'Apple Intelligence (apfel)', origins: ['http://127.0.0.1:11434'], only: (id) => id === 'apple-foundationmodel', fix: 'apfel' },
];
export const chatEndpoint = (origin) => origin.replace(/\/+$/, '') + '/v1/chat/completions';

async function probeOrigin(server, origin, timeoutMs) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
        const res = await fetch(origin + '/v1/models', { signal: ctrl.signal });
        if (res.status === 401 || res.status === 403) {
            // Ollama answers 403 too when OLLAMA_ORIGINS is not set: on a shared port only a server that names itself counts.
            if (server.only) {
                let body = ''; try { body = await res.text(); } catch (_) { /* no body */ }
                if (!/apfel|foundation|allowed-origins/i.test(body)) return null;   // apfel's refusal: "… Use --allowed-origins to configure."
            }
            return { ...server, origin, endpoint: chatEndpoint(origin), models: [], blocked: true };
        }
        if (!res.ok) return null;
        const j = await res.json();
        const models = [...new Set((Array.isArray(j.data) ? j.data : Array.isArray(j.models) ? j.models : []).map(m => String(m.id || m.name || m.model || '').trim()).filter(Boolean))]
            .filter(id => !/embed/i.test(id))   // embedding models cannot write
            .filter(id => !server.only || server.only(id));
        return models.length ? { ...server, origin, endpoint: chatEndpoint(origin), models } : null;
    } catch (_) { return null; } finally { clearTimeout(t); }
}

async function probe(server, timeoutMs) {
    const hits = await Promise.all(server.origins.map(o => probeOrigin(server, o, timeoutMs)));
    return hits.find(h => h && !h.blocked) || hits.find(Boolean) || null;   // a working port wins over a refusing one
}

/** The local servers that answer, with their chat endpoint and models (or `blocked: true` when they refuse the extension). */
export async function findLocalServers({ timeoutMs = 1500, servers = LOCAL_SERVERS } = {}) {
    return (await Promise.all(servers.map(s => probe(s, timeoutMs)))).filter(Boolean);
}
