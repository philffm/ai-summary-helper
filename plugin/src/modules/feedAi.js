/**
 * feedAi.js — AI day recaps and AI mood scoring for feed items.
 *
 * Only runs on an explicit click. Sends titles, source names and short
 * snippets (never full articles) to the user's configured AI connection via
 * the background worker's `aiComplete` action.
 */

export const MAX_RECAP_ITEMS = 40;
const SNIPPET_MAX = 160;

export function aiComplete(system, user) {
    return new Promise((resolve, reject) => {
        chrome.runtime.sendMessage({ action: 'aiComplete', system, user }, (res) => {
            if (chrome.runtime.lastError) {
                const m = chrome.runtime.lastError.message || '';
                return reject(new Error(/port closed|Receiving end/i.test(m)
                    ? 'Background script is outdated — reload the extension at chrome://extensions'
                    : m));
            }
            if (!res || !res.ok) return reject(new Error((res && res.error) || 'AI request failed'));
            resolve(res.text || '');
        });
    });
}

async function languageName() {
    try {
        const { selectedLanguage } = await chrome.storage.sync.get('selectedLanguage');
        return selectedLanguage || 'en-US';
    } catch (e) { return 'en-US'; }
}

function clip(s, n) {
    s = String(s || '').replace(/\s+/g, ' ').trim();
    return s.length > n ? s.slice(0, n - 1) + '…' : s;
}

export function itemsForPrompt(list, subTitleFn) {
    return list.slice(0, MAX_RECAP_ITEMS).map((i, k) => {
        const parts = [`[${k + 1}] ${clip(subTitleFn(i), 40)} — ${clip(i.title, 140)}`];
        const sn = clip(i.snippet, SNIPPET_MAX);
        if (sn) parts.push(sn);
        return parts.join(' — ');
    }).join('\n');
}

export function parseRecap(text) {
    const lines = String(text || '').split('\n').map(l => l.trim()).filter(Boolean);
    let mood = 'neu';
    const overview = [];
    const themes = [];
    for (const l of lines) {
        const m = l.match(/^MOOD\s*:\s*(positive|mixed|negative|neutral)/i);
        if (m) {
            const v = m[1].toLowerCase();
            mood = v === 'positive' ? 'pos' : v === 'negative' ? 'neg' : 'neu';
        } else if (/^[-•*]\s+/.test(l)) themes.push(l.replace(/^[-•*]\s+/, ''));
        else overview.push(l);
    }
    return { overview: overview.join(' '), themes: themes.slice(0, 5), mood };
}

export async function generateRecap(list, subTitleFn) {
    const lang = await languageName();
    const system = 'You write brief news-digest recaps from headlines and snippets. '
        + `Reply in the language with code ${lang}. Use ONLY the given items; do not invent facts. Format exactly:\n`
        + 'First, 2-3 sentences of overview.\n'
        + 'Then up to 5 lines starting with "- ", each one theme or standout story, naming the source.\n'
        + 'Finally one line: MOOD: positive, MOOD: mixed or MOOD: negative (overall tone of the news).\n'
        + 'No headings, no markdown other than the "- " lines.';
    const text = await aiComplete(system, `Items:\n${itemsForPrompt(list, subTitleFn)}`);
    const r = parseRecap(text);
    if (!r.overview && !r.themes.length) throw new Error('The AI returned an empty recap');
    return r;
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

export async function scoreItems(list, subTitleFn) {
    const chunk = list.slice(0, MAX_RECAP_ITEMS);
    const system = 'You rate the sentiment of news headlines. For each numbered item return a number from -1 '
        + '(very negative news) through 0 (neutral) to 1 (very positive news), judged on the news content, not tone of voice. '
        + `Reply with ONLY JSON: {"scores":[...]} with exactly ${chunk.length} numbers in item order.`;
    const text = await aiComplete(system, `Items:\n${itemsForPrompt(chunk, subTitleFn)}`);
    const scores = parseScores(text, chunk.length);
    if (!scores) throw new Error('The AI reply could not be read');
    return scores;
}
