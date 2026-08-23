// textMetrics.js
// Pure-math readability scoring + lexicon-based sentiment. Everything here
// runs on text already sitting in chrome.storage — no network calls, no ML
// model. The only asset is a bundled word->score list (AFINN-111, Apache-2.0,
// via github.com/fnielsen/afinn), fetched once from the extension package
// and cached in memory for the life of the page/popup.

import { stripHtml, tokenize, countSyllables, NEGATORS } from './textUtils.js';

let afinnCache = null;
let afinnLoadPromise = null;

function loadAfinn() {
    if (afinnCache) return Promise.resolve(afinnCache);
    if (afinnLoadPromise) return afinnLoadPromise;
    afinnLoadPromise = fetch(chrome.runtime.getURL('lib/afinn-111.json'))
        .then(r => r.json())
        .then(json => { afinnCache = json; return json; })
        .catch(() => { afinnCache = {}; return {}; });
    return afinnLoadPromise;
}

const WPM = 200; // shared with analyticsManager.js's time-savings estimate

/**
 * Flesch Reading Ease + Flesch-Kincaid Grade Level from raw HTML/text.
 * @returns {{ ease: number, grade: number, label: string, words: number } | null}
 */
export function readingLevel(html) {
    const text = stripHtml(html);
    if (!text || text.length < 20) return null;

    const sentences = text.split(/[.!?]+(?:\s|$)/).map(s => s.trim()).filter(Boolean);
    const words = text.split(/\s+/).filter(Boolean);
    if (words.length === 0 || sentences.length === 0) return null;

    let syllables = 0;
    for (const w of words) syllables += countSyllables(w);

    const wordsPerSentence = words.length / sentences.length;
    const syllablesPerWord = syllables / words.length;

    const ease = 206.835 - 1.015 * wordsPerSentence - 84.6 * syllablesPerWord;
    const grade = 0.39 * wordsPerSentence + 11.8 * syllablesPerWord - 15.59;

    let label;
    if (ease >= 80) label = 'Easy';
    else if (ease >= 60) label = 'Standard';
    else if (ease >= 40) label = 'Fairly hard';
    else label = 'Hard';

    return {
        ease: Math.round(Math.max(0, Math.min(100, ease))),
        grade: Math.round(Math.max(0, grade) * 10) / 10,
        label,
        words: words.length
    };
}

/**
 * Lexicon-based sentiment. Bag-of-words AFINN lookup with a lightweight
 * negation flip (checks the two tokens before each hit) — not a full NLP
 * model, but consistent and free.
 * @returns {Promise<{ score: number, comparative: number, label: string, matches: number } | null>}
 */
export async function sentiment(html) {
    const afinn = await loadAfinn();
    const text = stripHtml(html);
    if (!text) return null;

    // Keep stopwords here — negators like "not" must survive tokenization.
    const tokens = tokenize(text, { removeStopwords: false, minLength: 1 });
    let total = 0;
    let matches = 0;

    for (let i = 0; i < tokens.length; i++) {
        const word = tokens[i];
        const wordScore = afinn[word];
        if (wordScore === undefined) continue;
        const precededByNegator = NEGATORS.has(tokens[i - 1]) || NEGATORS.has(tokens[i - 2]);
        total += precededByNegator ? -wordScore : wordScore;
        matches++;
    }

    if (matches === 0) return { score: 0, comparative: 0, label: 'Neutral', matches: 0 };

    const comparative = total / tokens.length;
    let label = 'Neutral';
    if (comparative > 0.05) label = 'Positive';
    else if (comparative < -0.05) label = 'Negative';

    return { score: total, comparative: Math.round(comparative * 1000) / 1000, label, matches };
}

/** Lexical diversity (unique words / total words) — a cheap "density" signal. */
export function lexicalDiversity(html) {
    const words = tokenize(html, { removeStopwords: false, minLength: 1 });
    if (words.length === 0) return null;
    const unique = new Set(words).size;
    return Math.round((unique / words.length) * 100) / 100;
}

/** Convenience: compute everything at once for an article's detail view. */
export async function computeMetrics(article) {
    const source = article.content || article.html || article.summary || '';
    const [level, sent] = await Promise.all([
        Promise.resolve(readingLevel(source)),
        sentiment(source)
    ]);
    return {
        readingLevel: level,
        sentiment: sent,
        lexicalDiversity: lexicalDiversity(source),
        estimatedMinutes: level ? Math.max(1, Math.round(level.words / WPM)) : null
    };
}
