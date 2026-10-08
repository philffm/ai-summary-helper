// composerState.js
// The Summarize composer morphs between three states (data-state on .controls-bar):
//   fetch    – initial: label + textarea + chips + "Fetch Summary"
//   working  – summary streaming: compact, button is "Stop"
//   followup – summary done: placeholder "Ask a follow-up…", button "Send"
// DOM-pure (no chrome.*, no storage) so it is unit-testable in jsdom.
import { T } from './feedI18n.js';
import { t } from './i18n.js';

export const COMPOSER_STATES = ['fetch', 'working', 'followup'];

/** Same page? Compares origin+path+search, ignores #hash and a trailing slash. */
export function samePage(a, b) {
    const norm = (u) => {
        try { const x = new URL(u); return x.origin + x.pathname.replace(/\/+$/, '') + x.search; } catch (_) { return String(u || ''); }
    };
    return !!a && !!b && norm(a) === norm(b);
}

/** The "What I used" rows for a summaryContext event — only things really sent to the model. */
export function contextRows(ctx = {}) {
    const rows = [];
    const words = Number(ctx.words) || 0;
    rows.push({
        key: 'page',
        text: T('Page text · {n} words', { n: words.toLocaleString('en-US') }) + (ctx.host ? ` · ${ctx.host}` : '')
            + (ctx.shortened ? ' · ' + T('shortened to fit') : '')
    });
    if (ctx.highlights > 0) rows.push({ key: 'highlights', text: T('Your highlights · {n}', { n: ctx.highlights }) });
    if (ctx.focus) rows.push({ key: 'focus', text: T('Your focus question') });
    if (ctx.source) rows.push({ key: 'source', text: T('Feed item from {host}', { host: ctx.source }) });
    const tail = [ctx.language, ctx.length ? `~${ctx.length} ${T('words')}` : '', ctx.model].filter(Boolean).join(' · ');
    if (tail) rows.push({ key: 'settings', text: tail });
    return rows;
}

/** Status lines for the card while working: read → (highlights) → sent to the model → writing. */
export function statusLines(ctx = {}) {
    const lines = [T('Read the page · {n} words', { n: (Number(ctx.words) || 0).toLocaleString('en-US') })];
    if (ctx.highlights > 0) lines.push(T('Found your {n} highlights · using as focus', { n: ctx.highlights }));
    lines.push(T('Sent to {model}', { model: ctx.model || T('the model') }));
    lines.push(T('Writing a {n}-word summary…', { n: Number(ctx.length) || 200 }));
    return lines;
}

/** Which line is the active one: the "sent" line while we wait for the model, the last one once it writes. */
export function activeStep(lines, phase) {
    return phase >= 2 ? lines.length - 1 : lines.length - 2;
}

export function createComposer(bar, { onChange } = {}) {
    if (!bar) return null;
    const button = bar.querySelector('#fetchSummary');
    const textarea = bar.querySelector('#additionalQuestions');
    const label = bar.querySelector('.input-card-label');
    let state = 'fetch';
    const copy = {
        // One short word, already translated for the bottom tab ("Summarize", "Zusammenfassen", "要約" …).
        fetch: () => { const w = t('navSummarize'); return '✨ ' + (w === 'navSummarize' ? 'Summarize' : w); },
        working: () => T('■ Stop'),
        followup: () => T('Send')
    };
    if (textarea && !textarea.dataset.fetchPlaceholder) textarea.dataset.fetchPlaceholder = T('Focus on something… (optional)');   // short: it must fit one line in a narrow popup
    const apply = () => {
        bar.dataset.state = state;
        if (button) {
            button.dataset.state = state; button.textContent = copy[state](); button.disabled = false;
            // Shortcut keycap on the button (drawn by CSS from data-kbd; Stop has none).
            if (state === 'working') { delete button.dataset.kbd; button.removeAttribute('aria-keyshortcuts'); }
            else { const mac = /Mac|iPhone|iPad/i.test((navigator.userAgentData && navigator.userAgentData.platform) || navigator.platform || ''); button.dataset.kbd = (mac ? '⌘' : 'Ctrl') + ' ↵'; button.setAttribute('aria-keyshortcuts', mac ? 'Meta+Enter' : 'Control+Enter'); }
        }
        if (label) label.hidden = state !== 'fetch';
        if (textarea) {
            textarea.placeholder = state === 'fetch' ? textarea.dataset.fetchPlaceholder
                : state === 'followup' ? T('Ask a follow-up…')
                : T('Queue a question…');
            textarea.setAttribute('aria-label', textarea.placeholder);   // the visible label only fits the fetch state
        }
    };
    apply();
    try { document.addEventListener('aish:translationsApplied', apply); } catch (_) { /* no document */ }
    return {
        get state() { return state; },
        set(next) {
            if (!COMPOSER_STATES.includes(next) || next === state) return;
            const prev = state;
            state = next;
            apply();
            if (onChange) onChange(next, prev);
        },
        refresh: apply
    };
}
