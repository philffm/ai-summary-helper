/**
 * feedAi.js — AI day recaps and AI mood scoring for feed items.
 *
 * Only runs on an explicit click. Sends titles, source names and short
 * snippets (never full articles) to the user's configured AI connection via
 * the background worker's `aiComplete` action.
 */

import { languageEnglishName } from './languages.js';
import { T } from './feedI18n.js';
import { resolveFeedStyle, styleSuffix } from './promptBuilder.js';
export const MAX_RECAP_ITEMS = 40;   // batch size for scoring requests
let recapLimit = MAX_RECAP_ITEMS;     // items per recap request (user setting)
export const getRecapLimit = () => recapLimit;
export function setRecapLimit(n) { n = Math.round(Number(n)); recapLimit = n >= 10 ? Math.min(n, 400) : MAX_RECAP_ITEMS; }
const SNIPPET_MAX = 160;

export function aiComplete(system, user) {
    return new Promise((resolve, reject) => {
        chrome.runtime.sendMessage({ action: 'aiComplete', system, user }, (res) => {
            if (chrome.runtime.lastError) {
                const m = chrome.runtime.lastError.message || '';
                return reject(new Error(/port closed|Receiving end/i.test(m)
                    ? T('Background script is outdated — reload the extension at chrome://extensions')
                    : m));
            }
            if (!res || !res.ok) return reject(new Error((res && res.error) || T('AI request failed')));
            resolve(res.text || '');
        });
    });
}

async function languageName() {
    try {
        const { selectedLanguage } = await chrome.storage.sync.get('selectedLanguage');
        return languageEnglishName(selectedLanguage || 'en-US');
    } catch (e) { return 'en-US'; }
}

/** The user's saved style preferences for 'briefing' or 'recap' as a system-prompt suffix ('' when none). */
async function feedStyle(scope) {
    try {
        const { feedPromptCfg } = await chrome.storage.sync.get('feedPromptCfg');
        return styleSuffix(resolveFeedStyle(feedPromptCfg, scope));
    } catch (e) { return ''; }
}

function clip(s, n) {
    s = String(s || '').replace(/\s+/g, ' ').trim();
    return s.length > n ? s.slice(0, n - 1) + '…' : s;
}

/** Fingerprint of what the AI actually sees of an item (title + snippet) — changes when a news article is edited. */
export function itemSig(i) {
    const t = `${clip(i.title, 140)}|${clip(i.snippet, SNIPPET_MAX)}`;
    let h = 0x811c9dc5;
    for (let k = 0; k < t.length; k++) { h ^= t.charCodeAt(k); h = Math.imul(h, 0x01000193); }
    return (h >>> 0).toString(36);
}

export function itemsForPrompt(list, subTitleFn, mark) {
    return list.map((i, k) => {
        const parts = [`[${k + 1}] ${clip(subTitleFn(i), 40)} — ${clip(i.title, 140)}${mark ? mark(i) : ''}`];
        const sn = clip(i.snippet, SNIPPET_MAX);
        if (sn) parts.push(sn);
        return parts.join(' — ');
    }).join('\n');
}

export function cleanLabel(v) {
    const t = String(v || '').replace(/["'`*#]/g, '').replace(/\s+/g, ' ').trim().slice(0, 24);
    return t || null;
}

/** "1:Tech | 2:Politics" -> array aligned to n items (null where missing). */
export function parseLabelLine(line, n) {
    const out = new Array(n).fill(null);
    String(line || '').split(/[|;]/).forEach(part => {
        const m = part.match(/(\d+)\s*[:=]\s*(.+)/);
        if (!m) return;
        const k = Number(m[1]) - 1;
        if (k >= 0 && k < n) out[k] = cleanLabel(m[2]);
    });
    return out;
}

/** "1:0.6 | 2:-0.4" -> sentiment array aligned to n items (null where missing), clamped to [-1, 1]. */
export function parseScoreLine(line, n) {
    const out = new Array(n).fill(null);
    String(line || '').split(/[|;]/).forEach(part => {
        const m = part.match(/(\d+)\s*[:=]\s*([+-]?\d*\.?\d+)/);
        if (!m) return;
        const k = Number(m[1]) - 1, v = Number(m[2]);
        if (k >= 0 && k < n && Number.isFinite(v)) out[k] = Math.max(-1, Math.min(1, v));
    });
    return out;
}

export function parseRecap(text, n = 0) {
    const lines = String(text || '').split('\n').map(l => l.trim()).filter(Boolean);
    let mood = 'neu';
    const overview = [];
    const themes = [];
    let labels = null;
    let scores = null;
    for (const l of lines) {
        const lm = l.match(/^LABELS\s*:\s*(.*)$/i);
        if (lm) { labels = parseLabelLine(lm[1], n); continue; }
        const sm = l.match(/^SCORES\s*:\s*(.*)$/i);
        if (sm) { scores = parseScoreLine(sm[1], n); continue; }
        const m = l.match(/^MOOD\s*:\s*(positive|mixed|negative|neutral)/i);
        if (m) {
            const v = m[1].toLowerCase();
            mood = v === 'positive' ? 'pos' : v === 'negative' ? 'neg' : 'neu';
        } else if (/^[-•*]\s+/.test(l)) themes.push(l.replace(/^[-•*]\s+/, ''));
        else overview.push(l);
    }
    return { overview: overview.join(' '), themes: themes.slice(0, 5), mood, labels, scores };
}

/** rate = also return a category label and a sentiment score for every item (one extra line, no extra request). */
export async function generateRecap(list, subTitleFn, { rate = true, styleText } = {}) {
    const lang = await languageName();
    const suffix = styleText !== undefined ? styleSuffix(styleText) : await feedStyle('briefing');
    const system = 'You write brief news-digest recaps from headlines and snippets. '
        + `Reply in the language ${lang}. Use ONLY the given items; do not invent facts. Format exactly:\n`
        + 'First, 2-3 sentences of overview.\n'
        + 'Then up to 5 lines starting with "- ", each one theme or standout story, naming the source.\n'
        + 'Then one line: MOOD: positive, MOOD: mixed or MOOD: negative (overall tone of the news).\n'
        + (rate
            ? 'Then one line: LABELS: 1:Tech | 2:Politics | ... giving EVERY numbered item a category label of one or two words '
              + '(e.g. Tech, Politics, Business, Science, Health, Culture, Sports, World, Climate, Design). Reuse the same label for similar items; use at most 8 different labels.\n'
              + 'Finally one line: SCORES: 1:0.6 | 2:-0.4 | ... giving EVERY numbered item a sentiment number from -1 (very negative news) through 0 (neutral) to 1 (very positive news), judged on the news content.\n'
            : '')
        + 'No headings, no markdown other than the "- " lines.' + suffix;
    const chunk = list.slice(0, recapLimit);
    const text = await aiComplete(system, `Items:\n${itemsForPrompt(chunk, subTitleFn)}`);
    const r = parseRecap(text, chunk.length);
    if (!r.overview && !r.themes.length) throw new Error(T('The AI returned an empty recap'));
    return r;
}

/**
 * Refresh an existing recap with ONLY the items that are new or were edited since it was written
 * (the previous recap text stands in for everything already covered, so no old headline is sent again).
 */
export async function generateRecapUpdate(prev, fresh, subTitleFn, { rate = true, edited = () => false } = {}) {
    const lang = await languageName();
    const suffix = await feedStyle('briefing');
    const system = 'You maintain a brief news-digest recap. You get the CURRENT recap and a numbered list of NEW or EDITED items (edited ones are marked). '
        + `Update the recap so it covers the earlier points and the new items. Reply in the language ${lang}. Use ONLY the given text; do not invent facts. `
        + 'Keep still-relevant points, add new standout stories naming the source, and drop or correct anything an edited item contradicts. Format exactly:\n'
        + 'First, 2-3 sentences of overview.\n'
        + 'Then up to 5 lines starting with "- ", each one theme or standout story, naming the source.\n'
        + 'Then one line: MOOD: positive, MOOD: mixed or MOOD: negative (overall tone of ALL the news).\n'
        + (rate
            ? 'Then one line: LABELS: 1:Tech | 2:Politics | ... giving EVERY numbered NEW/EDITED item a category label of one or two words (e.g. Tech, Politics, Business, Science, Health, Culture, Sports, World, Climate, Design).\n'
              + 'Finally one line: SCORES: 1:0.6 | 2:-0.4 | ... giving EVERY numbered NEW/EDITED item a sentiment number from -1 (very negative news) through 0 to 1 (very positive news).\n'
            : '')
        + 'No headings, no markdown other than the "- " lines.' + suffix;
    const chunk = fresh.slice(0, recapLimit);
    const cur = [prev.overview, ...(prev.themes || []).map(t => '- ' + t), `Mood: ${{ pos: 'positive', neg: 'negative' }[prev.mood] || 'mixed'}`].filter(Boolean).join('\n');
    const text = await aiComplete(system, `Current recap:\n${cur}\n\nNew or edited items:\n${itemsForPrompt(chunk, subTitleFn, i => edited(i) ? ' (edited)' : '')}`);
    const r = parseRecap(text, chunk.length);
    if (!r.overview && !r.themes.length) throw new Error(T('The AI returned an empty recap'));
    return { ...r, sent: chunk };
}

export function parseScores(text, n) {
    const s = String(text || '');
    const a = s.indexOf('['), b = s.lastIndexOf(']');
    let arr = null;
    try {
        const obj = s.indexOf('{') !== -1 ? JSON.parse(s.slice(s.indexOf('{'), s.lastIndexOf('}') + 1)) : null;
        if (obj && Array.isArray(obj.scores)) arr = obj.scores;
    } catch (e) { /* fall through */ }
    if (!arr && a !== -1 && b > a) { try { arr = JSON.parse(s.slice(a, b + 1)); } catch (e) { /* ignore */ } }
    if (!Array.isArray(arr)) return null;
    const out = [];
    for (let k = 0; k < n; k++) {
        const v = Number(arr[k]);
        out.push(Number.isFinite(v) ? Math.max(-1, Math.min(1, v)) : null);
    }
    return out;
}

export function parseLabelsJson(text, n) {
    const out = new Array(n).fill(null);
    try {
        const s = String(text || '');
        const obj = JSON.parse(s.slice(s.indexOf('{'), s.lastIndexOf('}') + 1));
        if (Array.isArray(obj.labels)) obj.labels.slice(0, n).forEach((v, k) => { out[k] = typeof v === 'string' ? cleanLabel(v) : null; });
    } catch (e) { /* labels are optional */ }
    return out;
}

export async function scoreItems(list, subTitleFn) {
    const chunk = list.slice(0, MAX_RECAP_ITEMS);
    const system = 'You rate the sentiment of news headlines. For each numbered item return a number from -1 '
        + '(very negative news) through 0 (neutral) to 1 (very positive news), judged on the news content, not tone of voice. '
        + 'Also give each item a category label of one or two words (e.g. Tech, Politics, Business, Science, Health, Culture, Sports, World, Climate, Design); '
        + 'reuse the same label for similar items, at most 8 different labels. '
        + `Reply with ONLY JSON: {"scores":[...],"labels":[...]} with exactly ${chunk.length} numbers and ${chunk.length} label strings in item order.`;
    const text = await aiComplete(system, `Items:\n${itemsForPrompt(chunk, subTitleFn)}`);
    const scores = parseScores(text, chunk.length);
    if (!scores) throw new Error(T('The AI reply could not be read'));
    return { scores, labels: parseLabelsJson(text, chunk.length) };
}

const INTRO_STYLES = {
    short: 'exactly one sentence (at most 25 words)',
    briefing: '2 to 3 sentences in a neutral, informative briefing tone',
    personal: '2 to 3 sentences in a friendly, personal tone, like a note to myself (you may address the reader as "you")',
};

/**
 * Short introduction for a reading digest, written ONLY from the already-written summaries
 * (title + start of each) — no article text is sent. style: 'short' | 'briefing' | 'personal'.
 */
export async function generateDigestIntro(list, style = 'briefing') {
    const lang = await languageName();
    const plain = (h) => String(h || '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ');
    const system = `You write the short introduction at the top of a reading digest made of several article summaries. Write it in ${lang}. `
        + `Length and tone: ${INTRO_STYLES[style] || INTRO_STYLES.briefing}. `
        + 'Mention what the pieces have in common or how they differ. Use ONLY information from the summaries: no new facts, no quotes, no markdown, no lists, no title, no greeting. Reply with the intro text only.';
    const user = list.slice(0, 12).map((a, i) => `[${i + 1}] ${clip(a.title, 140)} — ${clip(plain(a.summary), 400)}`).join('\n');
    const raw = await aiComplete(system, user);
    const text = String(raw || '').replace(/[*#_`>]/g, '').replace(/^["“”'\s]+|["“”'\s]+$/g, '').replace(/\s+/g, ' ').trim().slice(0, 700);
    if (!text) throw new Error(T('The AI reply could not be read'));
    return text;
}

/** Stable fingerprint of a recap (what a week/month recap was built from) — changes when a day/week recap is regenerated. */
export function recapSig(r) {
    const t = [r.overview, (r.themes || []).join('|'), r.mood].join('¦');
    let h = 0x811c9dc5;
    for (let k = 0; k < t.length; k++) { h ^= t.charCodeAt(k); h = Math.imul(h, 0x01000193); }
    return (h >>> 0).toString(36);
}

function partText(p) {
    const r = p.recap;
    return [`[${p.label}] ${clip(r.overview, 400)}`,
        ...(r.themes || []).slice(0, 5).map(t => '- ' + clip(t, 160)),
        `Mood: ${{ pos: 'positive', neg: 'negative' }[r.mood] || 'mixed'}`].join('\n');
}

/**
 * Week / month recap built ONLY from already-written recaps (day recaps, or week recaps for a month) — no article is sent again.
 * With `prev`, only the new or changed parts are sent and the previous roll-up stands in for everything else.
 * parts = [{ label, recap }]
 */
export async function generateRollup(parts, { label = '', prev = null, edited = () => false } = {}) {
    const lang = await languageName();
    const suffix = await feedStyle('recap');
    const system = 'You merge brief news-digest recaps of several days or weeks into ONE recap for the whole period. '
        + (prev ? 'You get the CURRENT period recap plus only the NEW or CHANGED recaps (changed ones are marked); keep still-relevant points and correct anything a changed recap contradicts. ' : '')
        + `Reply in the language ${lang}. Use ONLY the given recaps; do not invent facts. Format exactly:\n`
        + 'First, 2-3 sentences of overview of the whole period.\n'
        + 'Then up to 5 lines starting with "- ", each one theme or standout story, naming the day or week and the source.\n'
        + 'Then one line: MOOD: positive, MOOD: mixed or MOOD: negative (overall tone of the whole period).\n'
        + 'No headings, no markdown other than the "- " lines.' + suffix;
    const body = parts.map(p => partText(p) + (edited(p) ? ' (changed)' : '')).join('\n\n');
    const cur = prev ? [prev.overview, ...(prev.themes || []).map(t => '- ' + t), `Mood: ${{ pos: 'positive', neg: 'negative' }[prev.mood] || 'mixed'}`].filter(Boolean).join('\n') : '';
    const text = await aiComplete(system, `Period: ${label}\n\n${prev ? `Current period recap:\n${cur}\n\nNew or changed recaps:\n` : 'Recaps:\n'}${body}`);
    const r = parseRecap(text, 0);
    if (!r.overview && !r.themes.length) throw new Error(T('The AI returned an empty recap'));
    return r;
}
