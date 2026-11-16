// quiz/quizGen.js — a multiple-choice quiz over several saved articles (Figma AISH-040).
//
// Comprehension questions from the full text: one request per article sends the whole article (long ones as paragraphs spread over
// the whole text, not just the start) and asks for questions about main points, reasons, consequences and arguments.
// Every question shows the article's own sentence(s) behind its answer. The model's quote only has to be close: it is looked up in
// the text (punctuation, a changed word or "…" are fine) and the article's real sentence is shown instead. Without a usable quote,
// the sentence that best supports the right answer is used; only a question the text does not support at all is dropped.
// The questions that connect articles are written from the checked key sentences ("facts") of two different articles.
// Everything here except `createQuiz` is pure (tests: test260).
import { T } from '../feedI18n.js';

export const QUIZ_MIN_ARTICLES = 2;
export const QUIZ_MAX_ARTICLES = 15;                 // = collections MAX_SOURCES
export const QUIZ_SIZES = [5, 10, 15, 20];
export const QUIZ_MIXES = ['article', 'across', 'both'];
const TEXT_MAX = 24000;                              // characters of article text per request (few articles) ≈ 6k tokens
const TEXT_MAX_MANY = 10000;                         // … when there are more than MANY articles
const MANY = 8;
const Q_MAX = 180, A_MAX = 120, QUOTE_MIN = 12, QUOTE_MAX = 900;

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

const words = (s) => normQuote(s).split(/[^\p{L}\p{N}]+/u).filter(Boolean);
const content = (ws) => ws.filter(w => w.length >= 4 || (w.length >= 2 && /\d/.test(w)));   // rough, language-independent: skip short function words and lone digits

/** Sentences of each paragraph, in the article's own wording: [{ p (1-based paragraph), text, w (words) }]. */
export function articleSentences(paras) {
    const out = [];
    paras.forEach((para, i) => {
        // split after . ! ? only when a space follows (so 1.5 °C or e.g. stay whole), after 。！？ always
        const parts = para.replace(/([.!?]+["“”’)\]]*)\s+/g, '$1\u0001').replace(/([。！？]+)/g, '$1\u0001').split('\u0001');
        parts.map(t => t.trim()).filter(t => t.length > 1).forEach(t => out.push({ p: i + 1, text: t, w: words(t) }));
    });
    return out;
}

/** How much of `need` (word list) the window covers, as a share 0…1 (each word counted as often as it occurs). */
function coverage(need, have) {
    if (!need.length) return 0;
    const bag = new Map(); have.forEach(w => bag.set(w, (bag.get(w) || 0) + 1));
    let hit = 0; need.forEach(w => { const n = bag.get(w) || 0; if (n) { hit++; bag.set(w, n - 1); } });
    return hit / need.length;
}

/**
 * Finds the model's quote in the article and returns the article's own sentence(s) for it: { p, quote } or null.
 * Exact (after normalising quotes, dashes and spaces) or close: at least 75 % of the quote's words, within 1–3 neighbouring
 * sentences of one paragraph. "…" splits a quote into parts that are looked up together. Pure.
 */
export function locateQuote(sents, quote) {
    const parts = String(quote || '').split(/\s*(?:\[\s*(?:\.\.\.|…)\s*\]|\.\.\.|…)\s*/).map(x => x.trim()).filter(x => words(x).length >= 3);
    if (!parts.length) return null;
    const need = words(parts.join(' '));
    if (need.length < 3) return null;
    let best = null;
    for (let i = 0; i < sents.length; i++) {
        let have = [], text = '';
        for (let j = i; j < Math.min(sents.length, i + 3) && sents[j].p === sents[i].p; j++) {
            have = have.concat(sents[j].w); text += (text ? ' ' : '') + sents[j].text;
            if (have.length > need.length * 3 + 12) break;
            const c = coverage(need, have);
            const exact = parts.every(x => normQuote(text).includes(normQuote(x)));
            const score = exact ? 2 : c;
            if (score >= 0.75 && (!best || score > best.score || (score === best.score && have.length < best.len))) best = { score, len: have.length, p: sents[i].p, quote: text };
            if (exact) break;
        }
    }
    return best ? { p: best.p, quote: best.quote, exact: best.score === 2 } : null;
}

/** Without a usable quote: the sentence that best supports the right answer (its content words, helped by the question). Pure. */
export function supportingSentence(sents, question, answer) {
    const a = content(words(answer)), q = content(words(question));
    if (!a.length) return null;
    let best = null;
    for (const s of sents) {
        const ca = coverage(a, s.w), cq = coverage(q, s.w);
        const score = ca + cq * 0.25;
        if (ca >= 0.6 && (!best || score > best.score)) best = { score, p: s.p, quote: s.text };
    }
    return best ? { p: best.p, quote: best.quote, exact: false } : null;
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

/**
 * One raw question → checked question, or { drop }. `findIn(quote)` → { articleId, para, quote } | null (the article's own wording);
 * `support(question, answer)` → the same, used when no quote was found. Pure.
 */
export function checkQuestion(raw, findIn, support = null) {
    if (!raw || typeof raw !== 'object') return { drop: 'shape' };
    const q = clip(raw.q || raw.question, Q_MAX);
    const opts = (Array.isArray(raw.options) ? raw.options : raw.answers || []).map(o => clip(o, A_MAX));
    const correct = Number(raw.correct);
    if (q.length < 8 || opts.length !== 4 || opts.some(o => !o)) return { drop: 'shape' };
    if (new Set(opts.map(o => o.toLowerCase())).size !== 4) return { drop: 'shape' };
    if (!Number.isInteger(correct) || correct < 0 || correct > 3) return { drop: 'shape' };
    const quotes = (Array.isArray(raw.quotes) ? raw.quotes : [raw.quote]).map(x => String(x || '').trim()).filter(x => x.length >= QUOTE_MIN && x.length <= QUOTE_MAX);
    const sources = [];
    const add = (at) => { if (at && !sources.some(s => s.articleId === at.articleId && s.quote === at.quote)) sources.push({ articleId: at.articleId, para: at.para, quote: at.quote }); };
    quotes.forEach(x => add(findIn(x)));
    if (!sources.length && support) add(support(q, opts[correct]));
    if (!sources.length) return { drop: 'source' };
    const sh = shuffleAnswers(opts, correct, q);
    return { question: { id: qid(q), q, options: sh.options, correct: sh.correct, sources } };
}

const LANG_LINE = (lang) => `Write the questions and answers in ${lang}. Quotes stay in the language of the text, copied exactly.`;

/** Prompt for one article: n comprehension questions (+1 spare) and up to 5 key sentences. */
export function articlePrompt({ title, text, n, lang, partial = false }) {
    const system = 'You write multiple-choice questions that check whether a reader UNDERSTOOD an article, like a good teacher would. '
        + LANG_LINE(lang) + ' '
        + 'Read the whole article first. Ask about its main points, the reasons and causes it gives, consequences, comparisons, the author\'s argument and what follows from it. '
        + 'Spread the questions over the whole text, not just the beginning. Phrase questions and answers in your own words; do not copy a sentence and blank out a word. '
        + 'Avoid trivia: no questions whose answer is only a name, a date or a number unless it is central to the article, and nothing about the publication itself. '
        + 'Each question has exactly 4 answers, exactly one is right; the wrong ones are plausible to someone who skimmed, but clearly wrong for someone who read carefully. '
        + 'Question at most 150 characters, each answer at most 100 characters. '
        + 'For every question add "quote": the sentence from the article that shows the right answer, copied as exactly as you can. '
        + 'Also add "facts": up to 5 sentences from the article (copied) that state its most important points. '
        + (partial ? 'The text is a selection of paragraphs from a longer article; […] marks skipped parts. ' : '')
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

/**
 * The article text sent to the model: all of it when it fits; otherwise paragraphs spread evenly over the whole article
 * (beginning, middle, end) up to `max` characters, with […] where paragraphs were skipped. Returns { text, partial }. Pure.
 */
export function articleText(paras, max) {
    const all = paras.join('\n\n');
    if (all.length <= max) return { text: all, partial: false };
    const keep = new Set();
    let used = 0;
    // even spread: walk the paragraphs with a step that fits the budget, then fill gaps while room remains
    const avg = all.length / Math.max(1, paras.length);
    const want = Math.max(1, Math.floor(max / (avg + 2)));
    const step = paras.length / want;
    for (let k = 0; k < want; k++) {
        const i = Math.min(paras.length - 1, Math.floor(k * step));
        if (keep.has(i)) continue;
        const len = Math.min(paras[i].length, 1500) + 2;
        if (used + len > max) continue;
        keep.add(i); used += len;
    }
    for (let i = 0; i < paras.length && used < max; i++) {
        if (keep.has(i)) continue;
        const len = Math.min(paras[i].length, 1500) + 2;
        if (used + len <= max) { keep.add(i); used += len; }
    }
    const out = []; let last = -1;
    [...keep].sort((a, b) => a - b).forEach((i) => { if (i > last + 1) out.push('[…]'); out.push(paras[i].length > 1500 ? paras[i].slice(0, 1500) + ' […]' : paras[i]); last = i; });
    if (last < paras.length - 1) out.push('[…]');
    return { text: out.join('\n\n'), partial: true };
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
    const sents = paras.map(articleSentences);
    const at = (k, r) => (r ? { articleId: list[k].id, para: r.p, quote: r.quote } : null);
    const findInArticle = (k) => (quote) => at(k, locateQuote(sents[k], quote));
    const supportIn = (k) => (question, answer) => at(k, supportingSentence(sents[k], question, answer));
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
        const { text, partial } = articleText(paras[k], max);
        if (!text) { perArticle[k].failed = true; onArticle({ index: k, state: 'failed' }); continue; }
        try {
            const p = articlePrompt({ title: list[k].title, text, n: Math.max(want, 1), lang, partial });
            requests++;
            const reply = parseJsonReply(await aiComplete(p.system, p.user, null, signal, null, { feature: 'qa' }));
            const find = findInArticle(k), support = supportIn(k);
            for (const raw of (reply && reply.questions) || []) {
                const r = checkQuestion(raw, find, support);
                if (r.question && fresh(r.question)) (perQ[k].length < want ? perQ[k] : spare[k]).push({ ...r.question, kind: 'article' });
                else perArticle[k].dropped++;
            }
            ((reply && reply.facts) || []).slice(0, 6).forEach((f) => {
                const hit = find(String(f || ''));
                if (hit && !facts.some(x => x.k === k && x.text === hit.quote)) facts.push({ id: String.fromCharCode(65 + (k % 26)) + (facts.filter(x => x.k === k).length + 1), article: k + 1, k, title: list[k].title, text: hit.quote, at: hit });
            });
            // a quiz across articles needs facts: fall back to the sentences behind this article's own questions
            if (plan.across > 0 && !facts.some(x => x.k === k)) perQ[k].concat(spare[k]).slice(0, 4).forEach((q) => { const s0 = q.sources[0]; if (s0 && !facts.some(x => x.k === k && x.text === s0.quote)) facts.push({ id: String.fromCharCode(65 + (k % 26)) + (facts.filter(x => x.k === k).length + 1), article: k + 1, k, title: list[k].title, text: s0.quote, at: s0 }); });
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
