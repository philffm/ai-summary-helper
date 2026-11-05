// nanoModel.js — Chrome's built-in model (Gemini Nano, Prompt API `LanguageModel`) as a local FALLBACK for the Feed
// library run: no install, nothing leaves the computer, no tokens. It is a small model: ratings, categories and recaps are
// clearly weaker than Ollama with a 7–8B model or a cloud model, and it only exists in desktop Google Chrome on capable
// hardware (GPU with > 4 GB or 16 GB RAM, 22 GB free disk). The UI says so wherever it is offered.
// Runs in the page (popup / side panel), not in the service worker: the library run already needs the panel open.
import { T } from './feedI18n.js';

export const NANO_SERVICE = 'nano';
const LANGS = ['en', 'de', 'es', 'fr', 'ja'];   // what the model reads and writes today (Chrome docs)
let defaultLang = 'en';
/** The Feed language (feedManager sets it when it picks the engine). */
export function setNanoLang(code) { defaultLang = nanoLang(code); }
const api = () => (typeof globalThis !== 'undefined' && globalThis.LanguageModel) || null;

/** Output language for the session: the UI language when the model supports it, otherwise English. */
export const nanoLang = (code) => (LANGS.includes(String(code || '').slice(0, 2)) ? String(code).slice(0, 2) : 'en');
const full = (lang) => ({
    expectedInputs: [{ type: 'text', languages: [...new Set(['en', nanoLang(lang)])] }],
    expectedOutputs: [{ type: 'text', languages: [nanoLang(lang)] }],
});
// Other browsers' models (Opera: Gemma or Apple's model, Edge: Phi-4-mini) may refuse a language list Chrome accepts and
// answer 'unavailable'. Then try English only, then no options at all, and keep what worked for create().
const variants = (lang) => [full(lang), { expectedInputs: [{ type: 'text', languages: ['en'] }], expectedOutputs: [{ type: 'text', languages: ['en'] }] }, {}];
const working = new Map();
const options = (lang) => working.get(nanoLang(lang)) || full(lang);

/**
 * 'unsupported' (not Chrome / API missing) · 'unavailable' (hardware or settings) · 'downloadable' · 'downloading' · 'available'.
 * Never throws.
 */
export async function nanoAvailability(lang = 'en') {
    const LM = api();
    if (!LM || typeof LM.availability !== 'function') return 'unsupported';
    let best = 'unavailable';
    for (const o of variants(lang)) {
        let st; try { st = String(await LM.availability(o)); } catch (_) { continue; }
        if (st !== 'unavailable') { working.set(nanoLang(lang), o); return st; }
    }
    return best;
}

/** Starts (or continues) the one-time model download. Needs a click (user activation). onProgress(0…1). */
export async function nanoDownload(lang = 'en', onProgress = () => {}) {
    const LM = api(); if (!LM) throw new Error(T('This browser has no built-in model.'));
    const s = await LM.create({ ...options(lang), monitor(m) { m.addEventListener('downloadprogress', (e) => onProgress(e.total ? e.loaded / e.total : e.loaded)); } });
    try { s.destroy(); } catch (_) { /* gone already */ }
}

/**
 * One request, same contract as feedAi.aiComplete: onStage('send'|'wait'|'write'|'parse'), onProgress({ phase: 'stream', text }).
 * A fresh session per request (the system prompt differs per task), destroyed afterwards.
 */
export async function nanoComplete({ system, user, signal, onStage, onProgress, lang = defaultLang }) {
    const LM = api(); if (!LM) throw new Error(T('This browser has no built-in model.'));
    const cancelled = () => Object.assign(new Error(T('Cancelled')), { name: 'AbortError', cancelled: true });
    if (signal && signal.aborted) throw cancelled();
    if (onStage) onStage('send');
    let session;
    try {
        session = await LM.create({ ...options(lang), initialPrompts: system ? [{ role: 'system', content: system }] : [], signal });
    } catch (e) { if (signal && signal.aborted) throw cancelled(); throw friendly(e); }
    try {
        if (onStage) onStage('wait');
        let text = '';
        const stream = session.promptStreaming(user, { signal });
        for await (const chunk of stream) {
            text += chunk;   // chunks are the new part of the reply
            if (onStage) onStage('write');
            if (onProgress) onProgress({ phase: 'stream', text });
        }
        if (onStage) onStage('parse');
        return text;
    } catch (e) {
        if (signal && signal.aborted) throw cancelled();
        throw friendly(e);
    } finally { try { session.destroy(); } catch (_) { /* gone */ } }
}

function friendly(e) {
    const name = e && e.name;
    if (name === 'QuotaExceededError') return new Error(T('Too much text for the built-in model at once. Choose fewer items per batch.'));
    if (name === 'NotSupportedError') return new Error(T('The built-in model does not support this language or input.'));
    if (name === 'NotAllowedError') return new Error(T('The built-in model is turned off in this browser.'));
    return e instanceof Error ? e : new Error(String(e));
}
