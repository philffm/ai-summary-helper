// quiz/quizGen.js — a multiple-choice quiz over several saved articles (Figma AISH-040).
//
// Every question carries the sentence(s) it comes from, copied word for word from the article text; a question whose quote is not
// in the text is dropped. One request per article returns its questions plus a few key sentences ("facts", also checked). The
// questions that connect articles are then written from those checked facts only, so a cross-article question always cites two real
// sentences from two different articles. Everything here except `createQuiz` is pure (tests: test262).
import { T } from '../feedI18n.js';

export const QUIZ_MIN_ARTICLES = 2;
export const QUIZ_MAX_ARTICLES = 15;                 // = collections MAX_SOURCES
export const QUIZ_SIZES = [5, 10, 15, 20];
export const QUIZ_MIXES = ['article', 'across', 'both'];
const TEXT_MAX = 9000;                               // characters of article text per request (few articles)
const TEXT_MAX_MANY = 3500;                          // … when there are more than MANY articles
const MANY = 8;
const Q_MAX = 160, A_MAX = 110, QUOTE_MIN = 20, QUOTE_MAX = 420;

const plain = (html) => String(html || '').replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ').replace(/<\/(p|li|h[1-6]|blockquote|div|br)>/gi, '\n').replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
/** Lower case, unified quotes and dashes, single spaces: how quotes and texts are compared. */
export const normQuote = (s) => plain(s).replace(/[‘’‚′]/g, "'").replace(/[“”„″«»]/g, '"').replace(/[–—]/g, '-').replace(/…/g, '...').replace(/\s+/g, ' ').trim().toLowerCase();
const clip = (s, n) => { s = String(s || '').replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s; };

/** Paragraphs of an article (plain text), for "¶ n" and for the text sent to the model. */
export function articleParagraphs(article) {
    const src = article && (article.content || article.html || article.text || '');
    const paras = plain(src).split(/\n+/).map(p => p.replace(/\s+/g, ' ').trim()).filter(p => p.length > 1);
    if (paras.length) return paras;
    return plain(article && article.summary).split(/\n+/).map(p => p.replace(/\s+/g, ' ').trim()).filter(Boolean);
}

/** 1-based paragraph that holds the quote, 0 when not found. */
export function paragraphOf(paras, quote) {
    const q = normQuote(quote);
    if (!q) return 0;
    const i = paras.findIndex(p => normQuote(p).includes(q));
    return i + 1;
}

/** How many questions each article gets and how many connect articles. Pure. */
export function quizPlan(total, nArticles, mix = 'both') {
    total = Math.max(1, Math.round(Number(total) || 10));
    const canAcross = nArticles >= 2;
    let across = !canAcross ? 0 : mix === 'across' ? total : mix === 'article' ? 0 : Math.max(1, Math.round(total / 4));
    const per = new Array(nArticles).fill(0);
    let rest = total - across;
    for (let i = 0; rest > 0; i = (i + 1) % nArticles, rest--) per[i]++;
    return { per, across };
}

/** Deterministic shuffle of the four answers (so the right one is not always first), keyed by the question. Pure. */
export function shuffleAnswers(options, correct, key) {
    let h = 2166136261;
    for (const ch of String(key)) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); }
    const idx = options.map((_, i) => i);
    for (let i = idx.length - 1; i > 0; i--) { h = Math.imul(h ^ (h >>> 15), 2246822507) >>> 0; const j = h % (i + 1); [idx[i], idx[j]] = [idx[j], idx[i]]; }
    return { options: idx.map(i => options[i]), correct: idx.indexOf(correct) };
}

/** The JSON object in a model reply (tolerates ``` fences and text around it). */
export function parseJsonReply(raw) {
    const s = String(raw || '').replace(/```(?:json)?/gi, '');
    const a = s.indexOf('{'), b = s.lastIndexOf('}');
    if (a < 0 || b <= a) return null;
    try { return JSON.parse(s.slice(a, b + 1)); } catch (_) { return null; }
}

const qid = (s) => { let h = 5381; for (const ch of String(s)) h = ((h << 5) + h + ch.charCodeAt(0)) | 0; return 'q' + (h >>> 0).toString(36); };

/** One raw question → checked question, or null (with why). `findIn(quote)` → { articleId, para } | null. Pure. */
export function checkQuestion(raw, findIn) {
    if (!raw || typeof raw !== 'object') return { drop: 'shape' };
    const q = clip(raw.q || raw.question, Q_MAX);
    const opts = (Array.isArray(raw.options) ? raw.options : raw.answers || []).map(o => clip(o, A_MAX));
    const correct = Number(raw.correct);
    if (q.length < 8 || opts.length !== 4 || opts.some(o => !o)) return { drop: 'shape' };
    if (new Set(opts.map(o => o.toLowerCase())).size !== 4) return { drop: 'shape' };
    if (!Number.isInteger(correct) || correct < 0 || correct > 3) return { drop: 'shape' };
    const quotes = (Array.isArray(raw.quotes) ? raw.quotes : [raw.quote]).map(x => String(x || '').trim()).filter(x => x.length >= QUOTE_MIN && x.length <= QUOTE_MAX);
    const sources = [];
    for (const quote of quotes) { const at = findIn(quote); if (at && !sources.some(s => s.articleId === at.articleId && s.quote === quote)) sources.push({ ...at, quote }); }
    if (!sources.length) return { drop: 'source' };
    const sh = shuffleAnswers(opts, correct, q);
    return { question: { id: qid(q), q, options: sh.options, correct: sh.correct, sources } };
}

const LANG_LINE = (lang) => `Write the questions and answers in ${lang}. Quotes stay in the language of the text, copied exactly.`;

/** Prompt for one article: n questions (+1 spare) and up to 4 key sentences. */
export function articlePrompt({ title, text, n, lang }) {
    const system = 'You write multiple-choice quiz questions that test whether a reader understood an article. '
        + LANG_LINE(lang) + ' '
        + 'Rules: each question has exactly 4 short answers, exactly one is right, the wrong ones are plausible. Ask about what the article says, not about trivia like dates of publication. '
        + 'Question at most 110 characters, each answer at most 70 characters. '
        + 'For every question copy ONE sentence (or part of one, at least 6 words) word for word from the article that shows the right answer. Never paraphrase the quote. '
        + 'Also copy up to 4 key sentences word for word ("facts") that state the article\'s main points. '
        + 'Reply with JSON only: {"questions":[{"q":"…","options":["…","…","…","…"],"correct":0,"quote":"…"}],"facts":["…"]}';
    const user = `Article: ${clip(title, 160)}\n\n${text}\n\nWrite ${n + 1} questions.`;
    return { system, user };
}

/** Prompt for questions that connect articles, from the checked facts only. facts: [{ id: 'A1', article: 1, title, text }] */
export function acrossPrompt({ facts, n, lang }) {
    const system = 'You write multiple-choice quiz questions that connect two different articles a reader has read. '
        + LANG_LINE(lang) + ' '
        + 'Use ONLY the numbered facts below; each fact belongs to one article. Every question must need facts from two DIFFERENT articles (for example: what both say, how they differ, which one claims what). '
        + 'Exactly 4 short answers, one right, plausible wrong ones. Question at most 110 characters, each answer at most 70. '
        + 'List the ids of the facts the right answer rests on (at least one from each of two articles). '
        + 'Reply with JSON only: {"questions":[{"q":"…","options":["…","…","…","…"],"correct":0,"facts":["A1","B2"]}]}';
    const user = facts.map(f => `${f.id} (article ${f.article}: ${clip(f.title, 80)}): ${f.text}`).join('\n') + `\n\nWrite ${n + 1} questions.`;
    return { system, user };
}

/** The article text sent to the model: the paragraphs, cut at a paragraph end. */
export function articleText(paras, max) {
    let out = '';
    for (const p of paras) { if (out.length + p.length + 2 > max) { if (!out) out = p.slice(0, max); break; } out += (out ? '\n\n' : '') + p; }
    return out;
}

/**
 * Generates the quiz. articles: full records ({ id, title, content, summary }). opts: { total, mix, lang, aiComplete, signal,
 * onArticle({ index, state: 'writing'|'done'|'failed', made, dropped }), onAcross({ state, made, dropped }) }.
 * Returns { questions, perArticle: [{ id, made, dropped }], across: { made, dropped }, requests }.
 */
export async function createQuiz(articles, { total = 10, mix = 'both', lang = 'English', aiComplete, signal, onArticle = () => {}, onAcross = () => {} } = {}) {
    const list = articles.slice(0, QUIZ_MAX_ARTICLES);
    const plan = quizPlan(total, list.length, mix);
    const max = list.length > MANY ? TEXT_MAX_MANY : TEXT_MAX;
    const paras = list.map(articleParagraphs);
    const hay = paras.map(ps => normQuote(ps.join(' ')));
    const findInArticle = (k) => (quote) => { const n = normQuote(quote); return n.length >= QUOTE_MIN && hay[k].includes(n) ? { articleId: list[k].id, para: paragraphOf(paras[k], quote) } : null; };
    const perQ = list.map(() => []), spare = list.map(() => []), facts = [];
    const perArticle = list.map(a => ({ id: a.id, made: 0, dropped: 0 }));
    let requests = 0;
    const seen = new Set();
    const fresh = (q) => { const k = normQuote(q.q); if (seen.has(k)) return false; seen.add(k); return true; };
    for (let k = 0; k < list.length; k++) {
        if (signal && signal.aborted) throw Object.assign(new Error(T('Cancelled')), { name: 'AbortError', cancelled: true });
        const want = plan.per[k];
        const needFacts = plan.across > 0;
        if (!want && !needFacts) continue;
        onArticle({ index: k, state: 'writing' });
        const text = articleText(paras[k], max);
        if (!text) { perArticle[k].failed = true; onArticle({ index: k, state: 'failed' }); continue; }
        try {
            const p = articlePrompt({ title: list[k].title, text, n: Math.max(want, 1), lang });
            requests++;
            const reply = parseJsonReply(await aiComplete(p.system, p.user, null, signal, null, { feature: 'qa' }));
            const find = findInArticle(k);
            for (const raw of (reply && reply.questions) || []) {
                const r = checkQuestion(raw, find);
                if (r.question && fresh(r.question)) (perQ[k].length < want ? perQ[k] : spare[k]).push({ ...r.question, kind: 'article' });
                else perArticle[k].dropped++;
            }
            ((reply && reply.facts) || []).slice(0, 5).forEach((f, i) => { const at = find(String(f || '')); if (at) facts.push({ id: String.fromCharCode(65 + (k % 26)) + (i + 1), article: k + 1, k, title: list[k].title, text: String(f).trim(), at }); });
            perArticle[k].made = perQ[k].length;
            onArticle({ index: k, state: 'done', made: perQ[k].length, dropped: perArticle[k].dropped });
        } catch (e) {
            if (e && (e.name === 'AbortError' || e.cancelled)) throw e;
            perArticle[k].failed = true; onArticle({ index: k, state: 'failed' });
        }
    }
    const acrossQ = [], across = { made: 0, dropped: 0 };
    const arts = new Set(facts.map(f => f.k));
    if (plan.across > 0 && arts.size >= 2) {
        onAcross({ state: 'writing' });
        try {
            const p = acrossPrompt({ facts, n: plan.across, lang });
            requests++;
            const reply = parseJsonReply(await aiComplete(p.system, p.user, null, signal, null, { feature: 'qa' }));
            const byId = new Map(facts.map(f => [f.id.toUpperCase(), f]));
            for (const raw of (reply && reply.questions) || []) {
                const used = (Array.isArray(raw && raw.facts) ? raw.facts : []).map(x => byId.get(String(x).trim().toUpperCase())).filter(Boolean);
                const r = checkQuestion({ ...raw, quotes: used.map(f => f.text) }, (quote) => { const f = used.find(u => u.text === quote); return f ? f.at : null; });
                const twoArticles = r.question && new Set(r.question.sources.map(s => s.articleId)).size >= 2;
                if (twoArticles && fresh(r.question) && acrossQ.length < plan.across) acrossQ.push({ ...r.question, kind: 'across' });
                else across.dropped++;
            }
            across.made = acrossQ.length;
            onAcross({ state: 'done', made: across.made, dropped: across.dropped });
        } catch (e) {
            if (e && (e.name === 'AbortError' || e.cancelled)) throw e;
            onAcross({ state: 'failed' });
        }
    } else if (plan.across > 0) onAcross({ state: 'failed' });
    // fill what is missing (dropped questions, a failed article, too few connecting questions) from the spares
    const out = [];
    const rounds = Math.max(...perQ.map(x => x.length), 0);
    for (let r = 0; r < rounds; r++) perQ.forEach(qs => { if (qs[r]) out.push(qs[r]); });   // interleave articles
    acrossQ.forEach((q, i) => out.splice(Math.min(out.length, Math.round(((i + 1) * out.length) / (acrossQ.length + 1)) + i), 0, q));
    const spares = spare.flat();
    while (out.length < total && spares.length) out.push(spares.shift());
    return { questions: out.slice(0, total), perArticle, across, requests };
}
