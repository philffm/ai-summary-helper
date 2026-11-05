// localModels.js — every local model on this computer in ONE list, with a recommendation (AISH-033, decided: A + parts of D).
// Sources: the browser's own model (Chrome / Edge / Opera Prompt API), Ollama, OpenAI-style servers (LM Studio, llama.cpp,
// Jan) and Apple's model via apfel. Nothing is installed or sent while detecting.
//
// Recommendation rule (033.7): with a quick-test result, the fastest model that rated every test headline wins; without one,
// a fixed order: ready before not-ready, then Ollama / LM Studio / llama.cpp / Jan (usually bigger models, longer context),
// then Apple's model, then the browser's model; a browser model that still has to be downloaded comes last.
// The same order is the fallback order (parts of D): when the chosen model is not ready, the next ready one answers.

const SOURCE_RANK = { ollama: 0, lmstudio: 1, llamacpp: 2, jan: 3, apfel: 4, browser: 5 };
export const keyOf = (c) => `${c.source}|${c.model}`;

/** Ranks candidates; `bench` = { [key]: { sec, rated, total } } from the quick test. Pure. */
export function rankLocalModels(cands, bench = {}) {
    const usable = cands.filter(c => c.state === 'ready' || c.state === 'download');
    const measured = (c) => { const b = bench[keyOf(c)]; return b && b.total > 0 && b.rated >= b.total ? b.sec : null; };
    return usable.slice().sort((a, b) => {
        const ma = measured(a), mb = measured(b);
        if (ma !== null && mb !== null) return ma - mb;               // both tested: faster wins
        if (ma !== null) return -1; if (mb !== null) return 1;        // a tested, working model before an untested one
        const ra = a.state === 'ready' ? 0 : 1, rb = b.state === 'ready' ? 0 : 1;
        if (ra !== rb) return ra - rb;                                 // ready before “download first”
        return (SOURCE_RANK[a.source] ?? 9) - (SOURCE_RANK[b.source] ?? 9);
    });
}

/** Why this one, in one line (shown under the recommendation). */
export function reasonFor(c, bench = {}) {
    const b = bench[keyOf(c)];
    if (b && b.rated >= b.total) return { kind: 'measured', sec: b.sec, total: b.total };
    if (c.state === 'download') return { kind: 'download' };
    if (c.source === 'browser') return { kind: 'builtin' };
    if (c.source === 'apfel') return { kind: 'apple' };
    return { kind: 'installed' };
}

/** Ready candidates in recommendation order, as the background's fallback list (Firefox's summarizer never: it only summarizes). */
export function fallbackOrder(ranked) {
    return ranked.filter(c => c.state === 'ready' && c.model !== 'firefox-ml').slice(0, 6).map(c => ({ model: c.model, endpoint: c.endpoint, label: c.label }));
}

/**
 * Looks for everything at once (≤ ~2 s). `ollamaEndpoint` = the configured Ollama chat endpoint.
 * Returns [{ source, label, model, endpoint, state: 'ready'|'download'|'blocked', note? }].
 */
export async function detectLocalModels({ ollamaEndpoint = 'http://localhost:11434/api/chat', browserName = 'Chrome' } = {}) {
    const [{ checkOllama }, { findLocalServers }, { nanoAvailability }] = await Promise.all([import('./ollamaCheck.js'), import('./localServers.js'), import('./nanoModel.js')]);
    const [ollama, servers, nano] = await Promise.all([
        checkOllama(ollamaEndpoint).catch(() => ({ ok: false })),
        findLocalServers().catch(() => []),
        nanoAvailability().catch(() => 'unsupported'),
    ]);
    const out = [];
    if (nano === 'available' || nano === 'downloadable' || nano === 'downloading' || nano === 'unavailable') {
        out.push({ source: 'browser', label: `${browserName} · built-in`, model: 'chrome-builtin', endpoint: ollamaEndpoint,
            state: nano === 'available' ? 'ready' : nano === 'unavailable' ? 'blocked' : 'download', downloading: nano === 'downloading' });
    }
    if (ollama && ollama.ok) for (const m of ollama.models || []) out.push({ source: 'ollama', label: `Ollama · ${m}`, model: m, endpoint: ollamaEndpoint, state: 'ready' });
    for (const s of servers) {
        if (s.blocked) { out.push({ source: s.id, label: s.name, model: '', endpoint: s.endpoint, state: 'blocked', origin: s.origin, fix: s.fix }); continue; }
        for (const m of s.models) out.push({ source: s.id, label: s.id === 'apfel' ? 'Apple Intelligence' : `${s.name} · ${m}`, model: m, endpoint: s.endpoint, state: 'ready' });
    }
    return { cands: out, ollamaReachable: !!(ollama && ollama.ok), ollamaReason: ollama && ollama.reason };
}
