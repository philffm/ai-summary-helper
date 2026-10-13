/**
 * recapSpeech.js — read a briefing (recap) aloud, while the model is still writing it or afterwards.
 * Streaming: sentences that are finished are queued as they arrive (same engine as Instant read); nothing is spoken twice.
 */
import { getReader, speakable } from './reader.js';
import { ttsLang } from './languages.js';

const KEYS = ['SCORES:', 'LABELS:', 'MOOD:'];

/** The briefing's own words: the SCORES / LABELS / MOOD lines (also a half-written one at the end) and markdown marks are removed. */
export function briefingText(raw) {
    const lines = String(raw || '').split('\n');
    const last = lines.length - 1;
    return lines
        .filter((l, i) => {
            if (/^\s*(SCORES|LABELS|MOOD)\s*:/i.test(l)) return false;
            if (i === last) { const up = l.trim().toUpperCase(); if (up && KEYS.some(k => k.startsWith(up))) return false; }
            return true;
        })
        .map(l => l.replace(/^\s*[-•*]\s+/, '').replace(/^\s*#{1,6}\s+/, '').replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/[*_`>]+/g, ''))
        .join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

/** A finished recap ({overview, themes}) as the text that is spoken. */
export function recapSpeechText(r) {
    return [r && r.overview, ...((r && r.themes) || [])].filter(Boolean).join('\n');
}

const summaryLang = async () => {
    try { return ttsLang((await chrome.storage.sync.get('selectedLanguage')).selectedLanguage || 'en'); } catch (_) { return 'en'; }
};

/** 'playing' | 'paused' | 'waiting' while the recap with this id is being read, else ''. */
export function readingState(id) {
    const s = getReader().state;
    const m = s && s.meta;
    return m && m.tool === 'recap' && m.id === id && ['playing', 'paused', 'waiting'].includes(s.state) ? s.state : '';
}

/** Is speech available at all (a voice engine exists)? */
export async function speechAvailable() {
    try { return !!(await getReader().ready); } catch (_) { return false; }
}

/** Streaming speaker for one recap: arm() once (button press), feed() on every progress message, complete() at the end. */
export function createBriefingSpeaker(id) {
    const reader = getReader();
    let armed = false, started = false, spoken = 0, lang = 'en';
    const meta = () => ({ tool: 'recap', id, lang });
    async function push(raw, all) {
        const list = speakable(briefingText(raw), all);
        const more = list.slice(spoken);
        if (!more.length) return;
        spoken = list.length;
        const units = more.map(text => ({ text, lang }));
        if (!started) { started = true; await reader.start(units, lang, { meta: meta() }); }
        else await reader.append(units, lang);
    }
    return {
        get armed() { return armed; },
        async arm(raw) {
            await reader.ready;
            lang = await summaryLang();
            armed = true; started = false; spoken = 0;
            await push(raw, false);
        },
        feed(raw) { if (armed) push(raw, false); },
        async complete(raw) {
            if (!armed) return;
            await push(raw, true);
            if (started) reader.finish();
            armed = false;
        },
        stop() { if (armed || started) reader.stop(); armed = false; started = false; },
    };
}

/** Read a finished recap from the start, or pause / resume when it is already being read. */
export async function toggleReadRecap(id, r) {
    const reader = getReader();
    await reader.ready;
    if (readingState(id)) { reader.toggle(); return; }
    const lang = await summaryLang();
    const units = speakable(briefingText(recapSpeechText(r)), true).map(text => ({ text, lang }));
    if (units.length) await reader.start(units, lang, { meta: { tool: 'recap', id, lang } });
}
