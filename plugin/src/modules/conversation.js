// conversation.js — follow-up Q&A on a summarized page. Pure helpers (no chrome.*, no DOM): testable in jsdom/node.
// A turn: { id, q, a, sources: [quote], pinned, ts }.
import { T } from './feedI18n.js';

export const MAX_PROMPT_TURNS = 6;      // turns sent back to the model (plus summary)
export const MAX_PAGE_CHARS = 20000;

const esc = (x) => String(x == null ? '' : x).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const plain = (html) => String(html || '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
const norm = (s) => plain(s).replace(/[‘’]/g, "'").replace(/[“”]/g, '"').toLowerCase();

export function newTurn(turns, { q, a, sources = [] }) {
    return {
        id: `q_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
        q, a, sources,
        pinned: !(turns && turns.length),   // the first follow-up is pinned by default, later ones are not
        ts: new Date().toISOString()
    };
}

export function buildPrompt({ title, content, summary, turns = [], question }) {
    const system = 'You answer follow-up questions about one web page. Use only the page text and the summary below. '
        + 'Be concise and answer in the language of the question. '
        + 'After the answer add one last line: SOURCES: "quote 1" | "quote 2" — up to 3 short passages copied word for word from the page text '
        + '(each at least 8 words) that support the answer. Omit the line if no passage fits.';
    const history = turns.slice(-MAX_PROMPT_TURNS).map(t => `Q: ${t.q}\nA: ${t.a}`).join('\n\n');
    const user = `PAGE TITLE: ${title || ''}\n\nPAGE TEXT:\n${plain(content).slice(0, MAX_PAGE_CHARS)}\n\n`
        + `SUMMARY:\n${plain(summary)}\n\n`
        + (history ? `EARLIER QUESTIONS:\n${history}\n\n` : '') + `QUESTION: ${question}`;
    return { system, user };
}

/** Split the model reply into the answer and its source quotes; quotes not found in the page text are dropped. */
export function parseAnswer(raw, pageContent) {
    let text = String(raw || '').trim();
    let quotes = [];
    const m = text.match(/\n?\s*SOURCES?\s*:\s*(.*)$/is);
    if (m) {
        text = text.slice(0, m.index).trim();
        quotes = [...m[1].matchAll(/["“]([^"”]{12,400})["”]/g)].map(x => x[1].trim());
    }
    const hay = norm(pageContent);
    const seen = new Set();
    const sources = quotes.filter(q => { const n = norm(q); if (!n || seen.has(n) || !hay.includes(n)) return false; seen.add(n); return true; }).slice(0, 3);
    return { a: text, sources };
}

/** "From your question(s)" HTML block. all=false → pinned turns only. '' when nothing to show. */
export function qaHtml(turns, { all = false } = {}) {
    const list = (turns || []).filter(t => all || t.pinned);
    if (!list.length) return '';
    return '<section class="aish-qa"><h3>' + esc(list.length === 1 ? T('From your question') : T('From your questions')) + '</h3>\n'
        + list.map(t => `<p><strong>${esc(t.q)}</strong></p>\n<p>${esc(t.a).replace(/\n/g, '<br>')}</p>\n`).join('') + '</section>';
}

/** Summary HTML with the questions appended (used by every export path). */
export function withQuestions(summaryHtml, turns, opts) {
    return String(summaryHtml || '') + qaHtml(turns, opts);
}

export function pinnedCount(turns) { return (turns || []).filter(t => t.pinned).length; }

/** Markdown block for .md export. */
export function qaMarkdown(turns, { all = false } = {}) {
    const list = (turns || []).filter(t => all || t.pinned);
    if (!list.length) return '';
    return `## ${list.length === 1 ? T('From your question') : T('From your questions')}\n\n`
        + list.map(t => `**${t.q}**\n\n${t.a}\n`).join('\n');
}

/** Fallback when the summary reply carried no QUESTIONS comment: ask for three follow-up questions separately. */
export function buildSuggestPrompt({ title, summary, content }) {
    return {
        system: 'You suggest follow-up questions a curious reader would ask about a web page. Reply with ONLY a JSON array of exactly 3 short questions '
            + '(3-6 words each), answerable from the page, written in the language of the summary.',
        user: `TITLE: ${title || ''}\n\nSUMMARY:\n${plain(summary)}\n\nPAGE EXCERPT:\n${plain(content).slice(0, 4000)}`
    };
}

export function parseSuggestions(raw) {
    try {
        const m = String(raw || '').match(/\[[\s\S]*\]/);
        const arr = JSON.parse(m ? m[0] : '');
        return Array.isArray(arr) ? arr.map(x => String(x || '').trim()).filter(x => x.length >= 4 && x.length <= 120).slice(0, 3) : [];
    } catch (_) { return []; }
}
