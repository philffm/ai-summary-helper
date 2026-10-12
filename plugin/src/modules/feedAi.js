/**
 * feedAi.js — AI day recaps and AI mood scoring for feed items.
 *
 * Only runs on an explicit click. Sends titles, source names and short
 * snippets (never full articles) to the user's configured AI connection via
 * the background worker's `aiComplete` action.
 */

import { languageEnglishName, languageRule } from './languages.js';
import { T } from './feedI18n.js';
import { dedupeArticles } from './textUtils.js';
import { resolveLocale } from './i18n.js';
import { conceptKey, conceptList, topicLabel, hasLabel, lexiconLearn, normalizeTopic } from './topicConcepts.js';
import { resolveFeedStyle, styleSuffix } from './promptBuilder.js';
export const MAX_RECAP_ITEMS = 40;   // batch size for scoring requests
let recapLimit = Infinity;            // items per recap request (user setting); 0 / Infinity = no limit
export const getRecapLimit = () => recapLimit;
export function setRecapLimit(n) { n = Math.round(Number(n)); recapLimit = n === 0 || n === Infinity ? Infinity : n >= 10 ? n : Infinity; }
const SNIPPET_MAX = 160;
let titlesOnly = true;                // setting aiDetail: 0 = the AI reads titles only (default: ~80% of the accuracy for a fraction of the work), 1 = titles + descriptions
export const getAiDetail = () => (titlesOnly ? 0 : 1);
export function setAiDetail(n) { titlesOnly = n === undefined || n === null || n === '' ? true : Number(n) === 0; }

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

/**
 * The instructions again, AFTER the items. A long list can push the system prompt out of a small local model's context window
 * (or out of its attention); the model then just describes the list ("this appears to be a compilation of headlines…").
 * The end of the prompt is what such a model keeps, so the task is repeated there in one line.
 */
const AFTER = {
    recap: (rate) => `\n\nNow write the recap exactly as instructed: ${rate ? 'the SCORES line, the LABELS line, ' : ''}2-3 sentences of overview about the news itself, up to 5 "- " lines, and the MOOD line. Do not describe the list and do not ask for a question.`,
    scores: '\n\nNow give the scores exactly in the requested format, nothing else.',
    cats: '\n\nNow give the categories exactly in the requested format, nothing else.',
    topics: '\n\nNow reply with ONLY the tags, nothing else.',
    intro: '\n\nNow write only the short introduction text, nothing else.',
};

export function itemsForPrompt(list, subTitleFn, mark, snippetMax = titlesOnly ? 0 : SNIPPET_MAX) {
    return list.map((i, k) => {
        const parts = [`[${k + 1}] ${clip(subTitleFn(i), 40)} — ${clip(i.title, 140)}${mark ? mark(i) : ''}`];
        const sn = snippetMax > 0 ? clip(i.snippet, snippetMax) : '';
        if (sn) parts.push(sn);
        return parts.join(' — ');
    }).join('\n');
}

export function cleanLabel(v) {
    const t = String(v || '').replace(/["'`*#]/g, '').replace(/\s+/g, ' ').trim().slice(0, 24);
    return t || null;
}

/**
 * Reply of the topic prompt ("Fußball = Football, Wirtschaft = Economy") -> up to 3 distinct { label, en }.
 * label = the tag in the UI language, en = its English name (the language-independent identity, '' when not given).
 * "News" and "Nachrichten" are one tag (see topicConcepts.js).
 */
export function parseTopicPairs(text) {
    const seen = new Set(), out = [];
    String(text || '').split(/[,;|\n]/).forEach(part => {
        const [a, b] = part.replace(/^\s*(?:tags?|topics?)\s*:\s*/i, '').replace(/^\s*(?:[-•*]|\d+[.):])\s*/, '').replace(/^#+/, '').split(/\s*(?:=|→|->|:)\s*/);
        const label = cleanLabel(a), en = b ? cleanLabel(b) : null;
        const key = label && conceptKey(en || label);
        if (label && !seen.has(key)) { seen.add(key); out.push({ label, en: en ? en.toLowerCase() : '' }); }
    });
    return out.slice(0, 3);
}
export const parseTopicTags = (text) => parseTopicPairs(text).map(p => p.label);

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
        + (code === 'en' ? 'Reply with ONLY the tags separated by commas, nothing else.'
            : 'Write each tag as "tag in that language = its English name", e.g. "Fußball = Football". Reply with ONLY these pairs separated by commas, nothing else.');
    const dist = cats.length ? `\nCategory distribution of all its posts: ${cats.map(([c, n]) => `${c} ×${n}`).join(', ')}` : '';
    const user = `Feed: ${clip(title, 60)}${dist}\nSample of its headlines:\n${itemsForPrompt(list, () => '', null, titlesOnly ? 0 : 80)}${AFTER.topics}`;
    const pairs = parseTopicPairs(await aiComplete(system, user, onStage, signal, onProgress, { service }));
    if (!pairs.length) throw new Error(T('The AI reply could not be read'));
    // keys = language-independent identity of each tag (its English name); the lexicon learns "Fußball" = "football" for every feed and article
    const keys = pairs.map(p => normalizeTopic(p.en || (code === 'en' ? p.label : '')));
    pairs.forEach((p, n) => { if (keys[n]) { lexiconLearn(keys[n], code, p.label); if (code !== 'en') lexiconLearn(keys[n], 'en', keys[n].replace(/^./, c => c.toUpperCase())); } });
    return { tags: pairs.map(p => p.label), keys, lang: code };
}

/**
 * The same tags in a NEW UI language, without looking at the feed again: known topics come from the dictionary,
 * the rest from one short translation request over their English names (keys). Returns { tags, lang }.
 */
export async function translateFeedTopics(keys, { signal, onStage, onProgress, service } = {}) {
    const { code, name } = await uiLanguage();
    const tags = keys.map(k => (hasLabel(k, code) ? topicLabel(k, code) : null));   // built-in or already learned in this language
    const todo = keys.filter((_, n) => tags[n] === null);
    if (todo.length) {
        const system = `Translate these topic names into ${name}. Each stays a short tag of one or two words. Reply with ONLY the translations, in the same order, separated by commas.`;
        const parts = String(await aiComplete(system, todo.join(', '), onStage, signal, onProgress, { service })).split(/[,;|\n]/).map(cleanLabel).filter(Boolean);
        if (parts.length !== todo.length) throw new Error(T('The AI reply could not be read'));
        let k = 0; keys.forEach((_, n) => { if (tags[n] === null) { tags[n] = parts[k++]; lexiconLearn(keys[n], code, tags[n]); } });
    }
    return { tags, lang: code };
}

/** "1:Football = Fußball | 2:Economy" -> [{ en, ui }] aligned to n tags (null where missing). */
export function parseTagNames(text, n) {
    const out = new Array(n).fill(null);
    String(text || '').split(/[|;\n]/).forEach(part => {
        const m = part.match(/(\d+)\s*[:=]\s*([^=]+?)(?:\s*=\s*(.+))?\s*$/);
        const k = m ? Number(m[1]) - 1 : -1;
        if (k >= 0 && k < n && cleanLabel(m[2])) out[k] = { en: normalizeTopic(cleanLabel(m[2])), ui: m[3] ? cleanLabel(m[3]) : null };
    });
    return out;
}

/**
 * Name tags that are neither built-in nor learned yet (e.g. the tags of saved articles, written in the summary language):
 * the model gives each its English name and, when the UI is not English, the word in the UI language. The pairs go into the
 * lexicon only — nothing is stored on the articles. A tag the model skips is marked as seen, so it is never asked twice.
 * Returns how many tags were named.
 */
export async function learnTagNames(tags, { signal, onStage, onProgress, service } = {}) {
    const { code, name } = await uiLanguage();
    const system = 'You normalize topic tags of saved articles that are written in various languages. '
        + 'For each numbered tag reply with its English name (one or two words, singular, e.g. Football, Climate, Economy)'
        + (code === 'en' ? '' : ` followed by " = " and the same topic written in ${name}`)
        + '. Format exactly, one line: 1:Football' + (code === 'en' ? '' : ' = Fußball') + ' | 2:Economy' + (code === 'en' ? '' : ' = Wirtschaft') + ' | … for EVERY tag, nothing else.';
    const text = await aiComplete(system, tags.map((t, k) => `[${k + 1}] ${clip(t, 40)}`).join('\n'), onStage, signal, onProgress, { service });
    const names = parseTagNames(text, tags.length);
    if (!names.some(Boolean)) throw new Error(T('The AI reply could not be read'));
    let named = 0;
    tags.forEach((t, k) => {
        const r = names[k];
        if (!r || !r.en) { lexiconLearn(normalizeTopic(t), null, t); return; }
        lexiconLearn(r.en, null, t);
        if (code === 'en') lexiconLearn(r.en, 'en', r.en.replace(/^./, c => c.toUpperCase()));
        else { lexiconLearn(r.en, 'en', r.en.replace(/^./, c => c.toUpperCase())); if (r.ui) lexiconLearn(r.en, code, r.ui); }
        named++;
    });
    return named;
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
    // Some models wrap the whole answer in a ```markdown fence: drop the fence lines, keep what is inside.
    // Headings glued into one line ("… themes: ### Economy ### Politics --- …") are broken up again, and horizontal rules ("---") dropped.
    const lines = String(text || '').split('\n')
        .flatMap(l => l.split(/\s+(?=#{2,6}\s+\S)|\s+-{3,}\s+/))
        .map(l => l.replace(/\s+-{3,}\s*$/, '').trim())
        .filter(l => l && !/^```[\w-]*$/.test(l) && !/^([-*_])\1{2,}$/.test(l));
    let mood = 'neu';
    const overview = [];
    const themes = [];
    let labels = null;
    let scores = null;
    // A model that answers with headings ("### Economy") has written a structured briefing: keep it whole so the
    // bullets stay under their heading instead of being pulled out into one flat, capped theme list.
    const structured = lines.some(l => /^#{1,6}\s+\S/.test(l));
    for (const l of lines) {
        const lm = l.match(/^LABELS\s*:\s*(.*)$/i);
        if (lm) { labels = parseLabelLine(lm[1], n); continue; }
        const sm = l.match(/^SCORES\s*:\s*(.*)$/i);
        if (sm) { scores = parseScoreLine(sm[1], n); continue; }
        const m = l.match(/^MOOD\s*:\s*(positive|mixed|negative|neutral)/i);
        if (m) {
            const v = m[1].toLowerCase();
            mood = v === 'positive' ? 'pos' : v === 'negative' ? 'neg' : 'neu';
        } else if (!structured && /^[-•*]\s+/.test(l)) themes.push(l.replace(/^[-•*]\s+/, ''));
        else overview.push(l);
    }
    // Lines stay separate (the view renders markdown); the old single-line form is what a plain-text model gave anyway.
    return { overview: overview.join(structured ? '\n' : ' '), themes: themes.slice(0, 5), mood, labels, scores };
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
    const text = await aiComplete(system, `Items:\n${itemsForPrompt(chunk, subTitleFn)}${AFTER.recap(rate)}`, onStage, signal,
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
    const text = await aiComplete(system, `Current recap:\n${cur}\n\nNew or edited items:\n${itemsForPrompt(chunk, subTitleFn, i => edited(i) ? ' (edited)' : '')}${AFTER.recap(rate)}`, onStage, signal,
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

export const DEFAULT_CATS = ['Tech', 'Politics', 'Business', 'Science', 'Health', 'Culture', 'Sports', 'World', 'Climate', 'Design'];
export const MAX_NEW_CATS = 2;   // per request: the model may add this many categories that are not in the known list

/** Categories already in use (most used first) followed by the defaults, de-duplicated, at most 14. */
export function categoryVocab(used = []) {
    const seen = new Set(), out = [];
    for (const c of [...used, ...DEFAULT_CATS]) {
        const v = cleanLabel(c); if (!v) continue;
        const k = v.toLowerCase(); if (seen.has(k)) continue;
        seen.add(k); out.push(v);
    }
    return out.slice(0, 14);
}

/**
 * "1:Tech | 2:Politics" -> labels aligned to n items (null where missing). Known categories are snapped to their spelling;
 * at most `maxNew` different new categories are accepted (the first ones); items with any further new label stay null.
 */
export function parseCategoryLines(text, n, vocab = DEFAULT_CATS, maxNew = MAX_NEW_CATS) {
    const out = new Array(n).fill(null);
    const known = new Map(vocab.map(c => [c.toLowerCase(), c]));
    const fresh = new Map();   // lowercased new label -> spelling
    String(text || '').split(/[|;\n]/).forEach(part => {
        const m = part.match(/(\d+)\s*[:=)]\s*(.+)/);
        if (!m) return;
        const k = Number(m[1]) - 1, label = cleanLabel(m[2]);
        if (!(k >= 0 && k < n) || !label) return;
        const key = label.toLowerCase();
        if (known.has(key)) { out[k] = known.get(key); return; }
        if (!fresh.has(key) && fresh.size < maxNew) fresh.set(key, label);
        if (fresh.has(key)) out[k] = fresh.get(key);
    });
    return out;
}

const isCancel = (e, signal) => !!(e && (e.cancelled || e.name === 'AbortError')) || !!(signal && signal.aborted);

/**
 * Two small requests instead of one big JSON: (1) sentiment as "1:3 | 2:-2" pairs, (2) a category per item, picked from the
 * known list (categories already in use + defaults) — the model may add up to MAX_NEW_CATS new ones. A failed category request
 * never costs the scores. labels = false stops after the first request (cheapest). knownCats = categories already in use.
 * onTiming({ scoreSec, catSec, retried }) reports where the time went.
 */
export async function scoreItems(list, subTitleFn, { labels = true, onStage, signal, onProgress, service, knownCats = [], onTiming } = {}) {
    const chunk = list.slice(0, MAX_RECAP_ITEMS);
    const n = chunk.length;
    const rule = (m) => `For each numbered item return a number from -${m} `
        + `(very negative news) through 0 (neutral) to ${m} (very positive news), judged on the news content, not tone of voice. `;
    const system = 'You rate the sentiment of news headlines. ' + rule(5)
        + 'Reply with ONLY the item number and its whole-number score, one pair per item, nothing else, like: 1:3 | 2:-2 | 3:0';
    const items = `Items:\n${itemsForPrompt(chunk, subTitleFn)}`;
    const usable = (a) => a && a.some(v => v !== null);
    const read = (text) => { const a = parseScoreLine(text, n); return usable(a) ? a : parseScores(text, n); };

    const t0 = Date.now();
    let scores = read(await aiComplete(system, items + AFTER.scores, onStage, signal, onProgress, { service }));
    let retried = false;
    if (!usable(scores)) {   // small local models sometimes ignore the format: one more try
        retried = true;
        scores = read(await aiComplete(system, items + AFTER.scores, onStage, signal, onProgress, { service }));
    }
    if (!usable(scores)) throw new Error(T('The AI reply could not be read'));
    const t1 = Date.now();

    let out = new Array(n).fill(null);
    if (labels) {
        const vocab = categoryVocab(knownCats);
        const catSystem = 'You assign a topic category to each news headline. '
            + `Known categories: ${vocab.join(', ')}. For each numbered item pick the best known category. `
            + `If none fits, you may use a NEW category of one or two words, but at most ${MAX_NEW_CATS} different new categories in total and only when really needed. `
            + 'Reply with ONLY the item number and its category, one pair per item, nothing else, like: 1:Tech | 2:Politics | 3:Science';
        try {
            out = parseCategoryLines(await aiComplete(catSystem, items + AFTER.cats, onStage, signal, onProgress, { service }), n, vocab);
        } catch (e) {
            if (isCancel(e, signal)) throw e;   // anything else: keep the scores, the caller marks the items as "category tried"
        }
    }
    if (onTiming) onTiming({ scoreSec: (t1 - t0) / 1000, catSec: labels ? (Date.now() - t1) / 1000 : 0, retried });
    return { scores, labels: out };
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
    const user = list.slice(0, 12).map((a, i) => `[${i + 1}] ${clip(a.title, 140)} — ${clip(plain(a.summary), 400)}`).join('\n') + AFTER.intro;
    const raw = await aiComplete(system, user, onStage, signal, onProgress, { partial: true });
    const text = String(raw || '').replace(/[*#_`>]/g, '').replace(/^["“”'\s]+|["“”'\s]+$/g, '').replace(/\s+/g, ' ').trim().slice(0, 700);
    if (!text) throw new Error(T('The AI reply could not be read'));
    return text;
}

/**
 * One request over a cluster of saved articles (a topic in the graph), written ONLY from their summaries:
 * a short briefing when there is no question, otherwise an answer to it. Items are cited as [n].
 * Returns { text, used, articles } — `used` = how many articles went in (capped at CLUSTER_MAX); articles[n-1] is item [n].
 */
export const CLUSTER_MAX = 15;          // summaries per request
export const CLUSTER_RUNS = 4;          // max requests → at most 60 summaries, then one more request merges the parts
export async function askCluster(list, { topic = '', question = '', layout = '' } = {}, { onStage, signal, onProgress, onPart } = {}) {
    const lang = await languageName();
    const plain = (h) => String(h || '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ');
    const q = String(question || '').trim();
    const unique = dedupeArticles(list);   // the same page saved twice (or reached by two feeds) counts once
    const all = unique.map(a => ({ a, body: clip(plain(a.summary || a.snippet || ''), 500) })).filter(x => x.body);
    const items = all.slice(0, CLUSTER_MAX * CLUSTER_RUNS);
    if (!items.length) throw new Error(T('These articles have no summaries yet'));
    const base = `You work from a reader's own saved article summaries${topic ? ` on the topic "${clip(topic, 40)}"` : ''}. Write in ${lang}. `
        + 'Use ONLY the numbered summaries: no outside facts. Refer to items as [n]. If they do not contain the answer, say so. ';
    // layout: 'time' → sections per period, 'topic' → sections per topic; the items then carry their month / tags.
    const meta = (a) => layout === 'time' ? ` (${String(a.timestamp || '').slice(0, 7)})` : layout === 'topic' && Array.isArray(a.tags) && a.tags.length ? ` (${a.tags.slice(0, 4).join(', ')})` : '';
    const sections = layout === 'time' ? ' Group it into at most 5 sections by period (use the item dates): each section starts with a heading line "## <period>" followed by 2 to 3 short bullet lines.'
        : layout === 'topic' ? ' Group it into at most 6 sections by topic (use the item tags): each section starts with a heading line "## <topic>" followed by 2 to 3 short bullet lines.' : '';
    const lines = (arr, from) => arr.map((x, i) => `[${from + i + 1}] ${clip(x.a.title, 140)}${meta(x.a)} — ${x.body}`).join('\n');
    const clean = (raw) => String(raw || '').replace(/^```\w*\n?|```$/gm, '').trim();
    const chunks = [];
    for (let i = 0; i < items.length; i += CLUSTER_MAX) chunks.push(items.slice(i, i + CLUSTER_MAX));
    let text;
    if (chunks.length === 1) {
        const system = base + (q ? 'Answer the question in at most 3 short paragraphs or 6 bullet lines. No headings.'
            : layout ? 'Write a short overview paragraph first (2 sentences), then the sections.' + sections
            : 'Write a short briefing: what they say together, where they differ or add to each other, and which one to read first. At most 8 bullet lines, no headings.');
        text = clean(await aiComplete(system, lines(items, 0) + (q ? `\n\nQuestion: ${clip(q, 400)}` : ''), onStage, signal, onProgress, { partial: true }));
    } else {
        // Too many for one request: one pass per group of CLUSTER_MAX (numbers stay global), then merge the partial answers.
        const partSys = base + (q ? 'Answer the question from these summaries only, in at most 4 bullet lines. If they do not contain the answer, say so in one line.'
            : 'Write 4 to 6 bullet lines: the main points of these summaries, each with its [n] references.' + (layout ? ` Start each line with its ${layout === 'time' ? 'month' : 'topic'}.` : '') + ' No headings.');
        const parts = [];
        for (let k = 0; k < chunks.length; k++) {
            if (signal && signal.aborted) throw Object.assign(new Error(T('Cancelled')), { name: 'AbortError', cancelled: true });
            if (onPart) onPart({ done: k, total: chunks.length + 1 });
            const from = k * CLUSTER_MAX;
            parts.push(clean(await aiComplete(partSys, lines(chunks[k], from) + (q ? `\n\nQuestion: ${clip(q, 400)}` : ''), onStage, signal, onProgress, {})));
        }
        if (onPart) onPart({ done: chunks.length, total: chunks.length + 1 });
        const mergeSys = `You combine partial notes that were each written from different numbered article summaries${topic ? ` on the topic "${clip(topic, 40)}"` : ''}. Write in ${lang}. `
            + 'Use ONLY the notes. Keep the [n] references exactly as they are. '
            + (q ? 'Give one answer to the question in at most 3 short paragraphs or 6 bullet lines. No headings.'
                : layout ? 'Write a short overview paragraph first (2 sentences), then the sections.' + sections
                : 'Write one briefing: what the articles say together, where they differ or add to each other, and which to read first. At most 10 bullet lines, no headings.');
        text = clean(await aiComplete(mergeSys, parts.map((p, k) => `Notes ${k + 1} (items ${k * CLUSTER_MAX + 1}-${Math.min(items.length, (k + 1) * CLUSTER_MAX)}):\n${p}`).join('\n\n') + (q ? `\n\nQuestion: ${clip(q, 400)}` : ''), onStage, signal, onProgress, { partial: true }));
    }
    if (!text) throw new Error(T('The AI reply could not be read'));
    return { text, used: items.length, runs: chunks.length > 1 ? chunks.length + 1 : 1, skipped: all.length - items.length, duplicates: (list || []).length - unique.length, articles: items.map(x => x.a) };   // articles[n-1] is what the text cites as [n]
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
