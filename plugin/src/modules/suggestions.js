// suggestions.js — follow-up suggestions the model returns: [{ q: "question", a: "short answer" }] (older replies: plain strings).
// Pure helpers, shared by the summary finalizer (content bundle / background) and the follow-up conversation.
export const MAX_SUGGESTIONS = 3;
const Q_MIN = 4, Q_MAX = 120, A_MIN = 8, A_MAX = 500;

const clean = (x) => String(x == null ? '' : x).replace(/\s+/g, ' ').trim();

/** Normalise a parsed list (strings and/or {q,a} objects) → { questions: [string], quick: { question: shortAnswer } }. */
function fromArray(arr) {
    const questions = [], quick = {};
    for (const it of Array.isArray(arr) ? arr : []) {
        const q = clean(it && typeof it === 'object' ? (it.q || it.question) : it);
        if (q.length < Q_MIN || q.length > Q_MAX || questions.includes(q)) continue;
        questions.push(q);
        const a = clean(it && typeof it === 'object' ? (it.a || it.answer) : '');
        if (a.length >= A_MIN) quick[q] = a.slice(0, A_MAX);
        if (questions.length >= MAX_SUGGESTIONS) break;
    }
    return { questions, quick };
}

/**
 * Forgiving parser for the text after "QUESTIONS:" — a JSON list of strings or {q,a} objects, a truncated/invalid one,
 * or just quoted strings. Never returns the JSON keys ("q", "a") as questions.
 */
export function parseSuggestionList(raw) {
    const body = String(raw == null ? '' : raw).trim().replace(/^```json/i, '').replace(/^```/, '').replace(/```$/, '').trim();
    const m = body.match(/\[[\s\S]*\]/);
    try { return fromArray(JSON.parse(m ? m[0] : body)); } catch (_) { /* fall through to the lenient paths */ }
    const str = '"((?:[^"\\\\\\n]|\\\\.){1,600})"';
    const pairs = [...body.matchAll(new RegExp('"q"\\s*:\\s*' + str + '\\s*,\\s*"a"\\s*:\\s*' + str, 'g'))]
        .map(x => ({ q: x[1].replace(/\\(.)/g, '$1'), a: x[2].replace(/\\(.)/g, '$1') }));
    if (pairs.length) return fromArray(pairs);
    if (/"q"\s*:/.test(body)) return fromArray([...body.matchAll(new RegExp('"q"\\s*:\\s*' + str, 'g'))].map(x => ({ q: x[1] })));
    return fromArray([...body.matchAll(/["“]([^"”\n]{4,120})["”]/g)].map(x => x[1]));
}
