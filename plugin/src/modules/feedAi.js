/**
 * feedAi.js — AI day recaps and AI mood scoring for feed items.
 *
 * Only runs on an explicit click. Sends titles, source names and short
 * snippets (never full articles) to the user's configured AI connection via
 * the background worker's `aiComplete` action.
 */

import { languageEnglishName, languageRule } from './languages.js';
import { T } from './feedI18n.js';
import { resolveLocale } from './i18n.js';
import { conceptKey, conceptList } from './topicConcepts.js';
import { resolveFeedStyle, styleSuffix } from './promptBuilder.js';
export const MAX_RECAP_ITEMS = 40;   // batch size for scoring requests
let recapLimit = Infinity;            // items per recap request (user setting); 0 / Infinity = no limit
export const getRecapLimit = () => recapLimit;
export function setRecapLimit(n) { n = Math.round(Number(n)); recapLimit = n === 0 || n === Infinity ? Infinity : n >= 10 ? n : Infinity; }
const SNIPPET_MAX = 160;

let aiSeq = 0;
let aiTransport = null;
export function setAiTransport(transport) { aiTransport = typeof transport === 'function' ? transport : null; }
/** `signal` (AbortSignal) cancels the request in the background worker too — there is no timeout, slow local models may take minutes. */
export function aiComplete(system, user, onStage, signal, onProgress, { partial = false, service = '' } = {}) {
    if (aiTransport) return aiTransport({ system, user, signal, partial, service, onStage, onProgress });
    return new Promise((resolve, reject) => {
        const id = `ai${Date.now()}_${++aiSeq}`;
        let settled = false;
        const cancelled = () => Object.assign(new Error(T('Cancelled')), { name: 'AbortError', cancelled: true });
        if (signal && signal.aborted) return reject(cancelled());
        if (signal) signal.addEventListener('abort', () => {
            if (settled) return;
            settled = true; done();
            try { chrome.runtime.sendMessage({ action: 'aiCancel', id }, () => void chrome.runtime.lastError); } catch (e) { /* worker gone */ }
            reject(cancelled());
        }, { once: true });
        const onMsg = (m) => { if (m && m.action === 'aiProgress' && m.id === id) { if (onStage) onStage(m.phase === 'stream' ? 'write' : 'wait'); if (onProgress) onProgress(m); } };
        const done = () => { try { chrome.runtime.onMessage.removeListener(onMsg); } catch (e) { /* no listener API */ } };
        try { chrome.runtime.onMessage.addListener(onMsg); } catch (e) { /* tests */ }
        if (onStage) { onStage('send'); setTimeout(() => onStage('wait'), 350); }
        chrome.runtime.sendMessage({ action: 'aiComplete', system, user, id, partial, ...(service ? { service } : {}) }, (res) => {
            if (settled) { void chrome.runtime.lastError; return; }
            settled = true; done();
            if (onStage) onStage('parse');
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

async function langRule() {
    try { const { selectedLanguage } = await chrome.storage.sync.get('selectedLanguage'); const r = languageRule(selectedLanguage); return r ? ' ' + r : ''; }
    catch (e) { return ''; }
}

async function languageName() {
    try {
        const { selectedLanguage } = await chrome.storage.sync.get('selectedLanguage');
        return languageEnglishName(selectedLanguage || 'en-US');
    } catch (e) { return 'en-US'; }
}

// English names of the UI locale folders: tags follow the UI language (`uiLanguage`), not the summary language.
const UI_LANGUAGE_NAMES = {
    en: 'English', de: 'German', es: 'Spanish', fr: 'French', it: 'Italian', pt_PT: 'Portuguese', ru: 'Russian', hi: 'Hindi',
    ko: 'Korean', ja: 'Japanese', zh_CN: 'Simplified Chinese (简体中文)', zh_TW: 'Traditional Chinese (繁體中文, Taiwan)',
    zh_HK: 'Traditional Chinese (繁體中文, Hong Kong)', ar: 'Arabic'
};

/** The UI language as { code, name }: code = locale folder (stored with the tags), name = what the model is told. */
export async function uiLanguage() {
    let saved = '';
    try { saved = (await chrome.storage.sync.get('uiLanguage')).uiLanguage || ''; } catch (e) { /* default to the browser's language */ }
    const code = resolveLocale(saved);
    return { code, name: UI_LANGUAGE_NAMES[code] || 'English' };
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

export function itemsForPrompt(list, subTitleFn, mark, snippetMax = SNIPPET_MAX) {
    return list.map((i, k) => {
        const parts = [`[${k + 1}] ${clip(subTitleFn(i), 40)} — ${clip(i.title, 140)}${mark ? mark(i) : ''}`];
        const sn = clip(i.snippet, snippetMax);
        if (sn) parts.push(sn);
        return parts.join(' — ');
    }).join('\n');
}

export function cleanLabel(v) {
    const t = String(v || '').replace(/["'`*#]/g, '').replace(/\s+/g, ' ').trim().slice(0, 24);
    return t || null;
}

/** Reply of the topic prompt ("Climate, Energy, Policy") -> up to 3 distinct short tags. */
export function parseTopicTags(text) {
    const seen = new Set(), out = [];
    String(text || '').split(/[,;|\n]/).forEach(part => {
        const v = cleanLabel(part.replace(/^\s*(?:tags?|topics?)\s*:\s*/i, '').replace(/^\s*(?:[-•*]|\d+[.):])\s*/, '').replace(/^#+/, ''));
        if (v && !seen.has(conceptKey(v))) { seen.add(conceptKey(v)); out.push(v); }   // "News" and "Nachrichten" are one tag
    });
    return out.slice(0, 3);
}

/**
 * Up to 3 topic tags for ONE feed, written in the UI language. The model sees an even sample of the feed's headlines
 * (short snippets) plus, as a hint for the whole feed, how often its items fall into each category (cats = [[label, n], …]).
 * Returns { tags, lang } (lang = UI locale code, stored so the tags are redone when the language changes).
 */
export async function generateFeedTopics(title, list, { cats = [], signal, onStage, onProgress, service } = {}) {
    const { code, name } = await uiLanguage();
    const vocab = conceptList(code);   // the known topics in the UI language, so every feed uses the same word for the same topic
    const system = 'You assign topic tags to a news feed or blog from its name, a sample of its headlines and how its posts are distributed over categories. '
        + `Reply in the language ${name}. Give at most 3 tags, each one or two words, naming what the source mainly posts about `
        + (`Reuse these words when they fit (so the same topic always has the same tag): ${vocab.join(', ')}; otherwise choose your own, more specific tag. `)
        + 'Prefer topics that recur across the whole sample over one-off stories, and use fewer tags when the source is narrow. '
        + 'Reply with ONLY the tags separated by commas, nothing else.';
    const dist = cats.length ? `\nCategory distribution of all its posts: ${cats.map(([c, n]) => `${c} ×${n}`).join(', ')}` : '';
    const user = `Feed: ${clip(title, 60)}${dist}\nSample of its headlines:\n${itemsForPrompt(list, () => '', null, 80)}`;
    const tags = parseTopicTags(await aiComplete(system, user, onStage, signal, onProgress, { service }));
    if (!tags.length) throw new Error(T('The AI reply could not be read'));
    return { tags, lang: code };
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

/**
 * "1:3 | 2:-2" -> sentiment array aligned to n items (null where missing), clamped to [-1, 1].
 * Whole numbers are on the -5..5 scale the recap prompt asks for (fewer tokens); decimals are taken as -1..1 already.
 */
export function parseScoreLine(line, n) {
    const out = new Array(n).fill(null);
    String(line || '').split(/[|;\n]/).forEach(part => {
        const m = part.match(/(\d+)\s*[:=]\s*([+-]?\d*\.?\d+)/);
        if (!m) return;
        const k = Number(m[1]) - 1, v = /\./.test(m[2]) ? Number(m[2]) : Number(m[2]) / 5;
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

/**
 * Wraps onProgress so that labels/scores are handed to onRatings({ labels, scores }) while the reply is still streaming.
 * Only complete entries count: an unfinished last entry ("3:0.") is cut off until its separator or newline arrives.
 */
function streamRatings(n, onProgress, onRatings) {
    if (!onRatings) return onProgress;
    return (m) => {
        if (onProgress) onProgress(m);
        if (!m || typeof m.text !== 'string' || !/(^|\n)\s*(LABELS|SCORES)\s*:/i.test(m.text)) return;
        const lines = m.text.split('\n');
        const last = lines.length - 1;
        if (/^\s*(LABELS|SCORES)\s*:/i.test(lines[last])) lines[last] = lines[last].replace(/[^|;]*$/, '');
        const r = parseRecap(lines.join('\n'), n);
        if (r.labels || r.scores) onRatings({ labels: r.labels, scores: r.scores });
    };
}

/** rate = also return a category label and a sentiment score for every item (one extra line, no extra request). onRatings = called with the ratings already complete while the reply streams in. */
export async function generateRecap(list, subTitleFn, { rate = true, styleText, onStage, signal, onProgress, onRatings, service } = {}) {
    const lang = await languageName();
    const suffix = styleText !== undefined ? styleSuffix(styleText) : await feedStyle('briefing');
    const lr = await langRule();
    const system = 'You write brief news-digest recaps from headlines and snippets. '
        + `Reply in the language ${lang}. Use ONLY the given items; do not invent facts. Format exactly:\n`
        + (rate
            ? 'First one line: SCORES: 1:3 | 2:-2 | ... giving EVERY numbered item a whole-number sentiment from -5 (very negative news) through 0 (neutral) to 5 (very positive news), judged on the news content.\n'
              + 'Then one line: LABELS: 1:Tech | 2:Politics | ... giving EVERY numbered item a category label of one or two words '
              + '(e.g. Tech, Politics, Business, Science, Health, Culture, Sports, World, Climate, Design). Reuse the same label for similar items; use at most 8 different labels.\n'
            : '')
        + (rate ? 'Then' : 'First') + ', 2-3 sentences of overview.\n'
        + 'Then up to 5 lines starting with "- ", each one theme or standout story, naming the source.\n'
        + 'Finally one line: MOOD: positive, MOOD: mixed or MOOD: negative (overall tone of the news).\n'
        + 'No headings, no markdown other than the "- " lines.' + suffix + lr;
    const chunk = list.slice(0, recapLimit);
    const text = await aiComplete(system, `Items:\n${itemsForPrompt(chunk, subTitleFn)}`, onStage, signal,
        streamRatings(chunk.length, onProgress, rate && onRatings), { partial: !!(rate && onRatings), service });
    const r = parseRecap(text, chunk.length);
    if (!r.overview && !r.themes.length) throw new Error(T('The AI returned an empty recap'));
    return r;
}

/**
 * Refresh an existing recap with ONLY the items that are new or were edited since it was written
 * (the previous recap text stands in for everything already covered, so no old headline is sent again).
 */
export async function generateRecapUpdate(prev, fresh, subTitleFn, { rate = true, edited = () => false, onStage, signal, onProgress, onRatings, service } = {}) {
    const lang = await languageName();
    const suffix = await feedStyle('briefing');
    const lr = await langRule();
    const system = 'You maintain a brief news-digest recap. You get the CURRENT recap and a numbered list of NEW or EDITED items (edited ones are marked). '
        + `Update the recap so it covers the earlier points and the new items. Reply in the language ${lang}. Use ONLY the given text; do not invent facts. `
        + 'Keep still-relevant points, add new standout stories naming the source, and drop or correct anything an edited item contradicts. Format exactly:\n'
        + (rate
            ? 'First one line: SCORES: 1:3 | 2:-2 | ... giving EVERY numbered NEW/EDITED item a whole-number sentiment from -5 (very negative news) through 0 to 5 (very positive news).\n'
              + 'Then one line: LABELS: 1:Tech | 2:Politics | ... giving EVERY numbered NEW/EDITED item a category label of one or two words (e.g. Tech, Politics, Business, Science, Health, Culture, Sports, World, Climate, Design).\n'
            : '')
        + (rate ? 'Then' : 'First') + ', 2-3 sentences of overview.\n'
        + 'Then up to 5 lines starting with "- ", each one theme or standout story, naming the source.\n'
        + 'Finally one line: MOOD: positive, MOOD: mixed or MOOD: negative (overall tone of ALL the news).\n'
        + 'No headings, no markdown other than the "- " lines.' + suffix + lr;
    const chunk = fresh.slice(0, recapLimit);
    const cur = [prev.overview, ...(prev.themes || []).map(t => '- ' + t), `Mood: ${{ pos: 'positive', neg: 'negative' }[prev.mood] || 'mixed'}`].filter(Boolean).join('\n');
    const text = await aiComplete(system, `Current recap:\n${cur}\n\nNew or edited items:\n${itemsForPrompt(chunk, subTitleFn, i => edited(i) ? ' (edited)' : '')}`, onStage, signal,
        streamRatings(chunk.length, onProgress, rate && onRatings), { partial: !!(rate && onRatings), service });
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

/**
 * labels = false asks for the cheapest possible reply: only "id:score" pairs (e.g. "1:0.6 | 2:-0.4"), no labels, no JSON.
 */
export async function scoreItems(list, subTitleFn, { labels = true, onStage, signal, onProgress, service } = {}) {
    const chunk = list.slice(0, MAX_RECAP_ITEMS);
    const rule = (m) => `For each numbered item return a number from -${m} `
        + `(very negative news) through 0 (neutral) to ${m} (very positive news), judged on the news content, not tone of voice. `;
    const system = labels
        ? 'You rate the sentiment of news headlines. ' + rule(1)
            + 'Also give each item a category label of one or two words (e.g. Tech, Politics, Business, Science, Health, Culture, Sports, World, Climate, Design); '
            + 'reuse the same label for similar items, at most 8 different labels. '
            + `Reply with ONLY JSON: {"scores":[...],"labels":[...]} with exactly ${chunk.length} numbers and ${chunk.length} label strings in item order.`
        : 'You rate the sentiment of news headlines. ' + rule(5)
            + 'Reply with ONLY the item number and its whole-number score, one pair per item, nothing else, like: 1:3 | 2:-2 | 3:0';
    const user = `Items:\n${itemsForPrompt(chunk, subTitleFn)}`;
    const usable = (a) => a && a.some(v => v !== null);
    const text = await aiComplete(system, user, onStage, signal, onProgress, { service });
    // Small local models often ignore the JSON format: fall back to "1:3 | 2:-2" pairs, then retry once with the simplest prompt.
    let scores = parseScores(text, chunk.length);
    if (!usable(scores)) scores = parseScoreLine(text, chunk.length);
    if (usable(scores)) return { scores, labels: labels ? parseLabelsJson(text, chunk.length) : new Array(chunk.length).fill(null) };
    if (labels) {
        const simple = 'You rate the sentiment of news headlines. ' + rule(5)
            + 'Reply with ONLY the item number and its whole-number score, one pair per item, nothing else, like: 1:3 | 2:-2 | 3:0';
        const text2 = await aiComplete(simple, user, onStage, signal, onProgress, { service });
        const s2 = parseScoreLine(text2, chunk.length);
        if (usable(s2)) return { scores: s2, labels: new Array(chunk.length).fill(null) };
    }
    throw new Error(T('The AI reply could not be read'));
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
export async function generateDigestIntro(list, style = 'briefing', { onStage, signal, onProgress } = {}) {
    const lang = await languageName();
    const plain = (h) => String(h || '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ');
    const system = `You write the short introduction at the top of a reading digest made of several article summaries. Write it in ${lang}. `
        + `Length and tone: ${INTRO_STYLES[style] || INTRO_STYLES.briefing}. `
        + 'Mention what the pieces have in common or how they differ. Use ONLY information from the summaries: no new facts, no quotes, no markdown, no lists, no title, no greeting. Reply with the intro text only.';
    const user = list.slice(0, 12).map((a, i) => `[${i + 1}] ${clip(a.title, 140)} — ${clip(plain(a.summary), 400)}`).join('\n');
    const raw = await aiComplete(system, user, onStage, signal, onProgress, { partial: true });
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
export async function generateRollup(parts, { label = '', prev = null, edited = () => false, onStage, signal, onProgress } = {}) {
    const lang = await languageName();
    const suffix = await feedStyle('recap');
    const lr = await langRule();
    const system = 'You merge brief news-digest recaps of several days or weeks into ONE recap for the whole period. '
        + (prev ? 'You get the CURRENT period recap plus only the NEW or CHANGED recaps (changed ones are marked); keep still-relevant points and correct anything a changed recap contradicts. ' : '')
        + `Reply in the language ${lang}. Use ONLY the given recaps; do not invent facts. Format exactly:\n`
        + 'First, 2-3 sentences of overview of the whole period.\n'
        + 'Then up to 5 lines starting with "- ", each one theme or standout story, naming the day or week and the source.\n'
        + 'Then one line: MOOD: positive, MOOD: mixed or MOOD: negative (overall tone of the whole period).\n'
        + 'No headings, no markdown other than the "- " lines.' + suffix + lr;
    const body = parts.map(p => partText(p) + (edited(p) ? ' (changed)' : '')).join('\n\n');
    const cur = prev ? [prev.overview, ...(prev.themes || []).map(t => '- ' + t), `Mood: ${{ pos: 'positive', neg: 'negative' }[prev.mood] || 'mixed'}`].filter(Boolean).join('\n') : '';
    const text = await aiComplete(system, `Period: ${label}\n\n${prev ? `Current period recap:\n${cur}\n\nNew or changed recaps:\n` : 'Recaps:\n'}${body}`, onStage, signal, onProgress);
    const r = parseRecap(text, 0);
    if (!r.overview && !r.themes.length) throw new Error(T('The AI returned an empty recap'));
    return r;
}
