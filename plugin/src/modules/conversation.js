// conversation.js — follow-up Q&A on a summarized page. Pure helpers (no chrome.*, no DOM): testable in jsdom/node.
// A turn: { id, q, a, sources: [quote], pinned, ts }.
import { T } from './feedI18n.js';
import { parseSuggestionList } from './suggestions.js';

export const MAX_PROMPT_TURNS = 6;      // turns sent back to the model (plus summary)
export const MAX_PAGE_CHARS = 20000;

import { escapeHtml as esc } from './textUtils.js';
const plain = (html) => String(html || '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
const norm = (s) => plain(s).replace(/[‘’]/g, "'").replace(/[“”]/g, '"').toLowerCase();

/**
 * Models sometimes answer in HTML or wrap the reply in ```html fences (and add <!-- comments -->).
 * Turn that into light markdown-style plain text: paragraphs, "- " bullets, **bold**. Never returns markup.
 */
export function cleanAnswer(raw) {
    let t = String(raw == null ? '' : raw).replace(/\r\n?/g, '\n');
    t = t.replace(/```[a-zA-Z]*\n?/g, '').replace(/```/g, '');           // code fences (also unclosed ones while streaming)
    t = t.replace(/<!--[\s\S]*?(-->|$)/g, '');                          // HTML comments, incl. a half-streamed one
    t = t.replace(/<\s*(strong|b)\s*>([\s\S]*?)<\s*\/\s*\1\s*>/gi, '**$2**')
        .replace(/<\s*br\s*\/?>/gi, '\n')
        .replace(/<\s*li[^>]*>/gi, '\n- ')
        .replace(/<\s*\/\s*li\s*>/gi, '')
        .replace(/<\s*\/\s*(p|div|h[1-6]|ul|ol|blockquote|tr)\s*>/gi, '\n\n')
        .replace(/<\s*(p|div|h[1-6]|ul|ol|blockquote|tr)[^>]*>/gi, '\n')
        .replace(/<\/?[a-zA-Z][^>]*>?/g, '')                              // anything else (also an unfinished tag at the end)
        .replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
    return t.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

/** The answer part of a (possibly still streaming) reply: cleaned, without the trailing SOURCES line. */
export function answerPreview(raw) {
    const t = cleanAnswer(raw);
    const m = t.match(/\n?\s*(?:SOURCES?\s*:|QUESTIONS?\s*:\s*(?:\[|$))/i);
    return (m ? t.slice(0, m.index) : t).trim();
}

export function newTurn(turns, { q, a, sources = [] }) {
    return {
        id: `q_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
        q, a, sources,
        pinned: !(turns && turns.length),   // the first follow-up is pinned by default, later ones are not
        ts: new Date().toISOString()
    };
}

export function buildPrompt({ title, content, summary, turns = [], question, draft = '' }) {
    const system = 'You answer follow-up questions about one web page. Use only the page text and the summary below. '
        + 'Be concise and answer in the language of the question. Reply in plain text (short paragraphs, "- " bullets, **bold**) — never HTML or code blocks. '
        + 'After the answer add one last line: SOURCES: "quote 1" | "quote 2" — up to 3 short passages copied word for word from the page text '
        + '(each at least 8 words) that support the answer. Omit the line if no passage fits. '
        + 'Then one final line: QUESTIONS: [{"q":"question 1","a":"answer 1"}, {"q":"question 2","a":"answer 2"}] — up to 3 short follow-up questions (3-6 words each, in the language of your answer) '
        + 'the reader may want to ask next, answerable from the page and different from the earlier questions, each with "a": a 2-sentence answer from the page.';
    const history = turns.slice(-MAX_PROMPT_TURNS).map(t => `Q: ${t.q}\nA: ${t.a}`).join('\n\n');
    const user = `PAGE TITLE: ${title || ''}\n\nPAGE TEXT:\n${plain(content).slice(0, MAX_PAGE_CHARS)}\n\n`
        + `SUMMARY:\n${plain(summary)}\n\n`
        + (history ? `EARLIER QUESTIONS:\n${history}\n\n` : '')
        + (draft ? `THE READER ALREADY SEES THE FIRST PART OF YOUR ANSWER (it is being typed out on screen):\n${draft}\n`
            + 'Continue directly after it: do NOT repeat or rephrase it, write only what follows (more depth, details, context) in the same language and style. '
            + 'Then the SOURCES and QUESTIONS lines as usual.\n\n' : '')
        + `QUESTION: ${question}`;
    return { system, user };
}

/**
 * Short answer already on screen + the model's continuation → one answer. A model that repeats the start anyway
 * is tolerated (the repeated part is cut); a list or new paragraph continues on its own line.
 */
export function joinContinuation(head, cont) {
    const h = String(head || '').trim();
    let c = String(cont || '').trim();
    if (!h) return c;
    if (!c) return h;
    const nh = norm(h);
    if (nh.length >= 20 && norm(c).startsWith(nh)) {      // the model started over: drop the repeated part
        const words = h.split(/\s+/).length;
        c = c.split(/\s+/).slice(words).join(' ').trim();
        if (!c) return h;
    }
    return h + (/^(?:[-*•]\s|\d+[.)]\s|\n)/.test(c) ? '\n\n' : ' ') + c;
}

/** Split the model reply into the answer and its source quotes; quotes not found in the page text are dropped. */
export function parseAnswer(raw, pageContent) {
    let text = cleanAnswer(raw);
    let quotes = [];
    let questions = [], quick = {};
    // QUESTIONS: [...] — suggestions for the next turn (cut first so its quoted strings never look like source quotes)
    const qm = text.match(/\n?\s*QUESTIONS?\s*:\s*(\[[\s\S]*)$/i);
    if (qm) {
        text = text.slice(0, qm.index).trim();
        ({ questions, quick } = parseSuggestionList(qm[1]));
    }
    const m = text.match(/\n?\s*SOURCES?\s*:\s*(.*)$/is);
    if (m) {
        text = text.slice(0, m.index).trim();
        quotes = [...m[1].matchAll(/["“]([^"”]{12,400})["”]/g)].map(x => x[1].trim());
    }
    const hay = norm(pageContent);
    const seen = new Set();
    const sources = quotes.filter(q => { const n = norm(q); if (!n || seen.has(n) || !hay.includes(n)) return false; seen.add(n); return true; }).slice(0, 3);
    return { a: text, sources, questions, quick };
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

export function parseSuggestions(raw) {
    try {
        const m = String(raw || '').match(/\[[\s\S]*\]/);
        const arr = JSON.parse(m ? m[0] : '');
        return Array.isArray(arr) ? arr.map(x => String(x || '').trim()).filter(x => x.length >= 4 && x.length <= 120).slice(0, 3) : [];
    } catch (_) { return []; }
}
