// promptBuilder.js — turns the guided chips (tone / length / focus / extra text) into prompt text.
// Pure functions: no DOM, no storage. The wording is English on purpose: it is sent to the AI,
// which answers in the language chosen in the popup.

export const TONES = ['neutral', 'casual', 'formal'];
export const LENGTHS = ['short', 'medium', 'long'];

const TONE_TEXT = {
    neutral: 'Tone: neutral and factual.',
    casual: 'Tone: casual and friendly.',
    formal: 'Tone: formal and precise.'
};

// ── Full articles ───────────────────────────────────────────────────────────
const ARTICLE_LENGTH = {
    short: 'Keep it short: under 300 words.',
    medium: 'Aim for about 600 words.',
    long: 'Be thorough: up to 1000 words.'
};

/** id → sentence. `group` decides the chip row it appears in. */
export const ARTICLE_FOCUS = [
    { id: 'facts',   group: 'focus',  text: 'Highlight the key facts and the main argument.' },
    { id: 'numbers', group: 'focus',  text: 'Keep names, numbers and dates exact.' },
    { id: 'opinions', group: 'focus', text: 'Separate facts from opinions and point out the author’s stance.' },
    { id: 'actions', group: 'focus',  text: 'End with concrete action items or takeaways I can apply.' },
    // Building blocks of the original “Phil’s secret prompt”
    { id: 'title',   group: 'extras', text: 'Give the summary a creative title that explains the article in simple terms.' },
    { id: 'quotes',  group: 'extras', text: 'Include the most significant quotes, exactly as stated and in the original language.' },
    { id: 'ux',      group: 'extras', text: 'Add a fun reference to the topic related to my competence as a UX designer.' },
    { id: 'standup', group: 'extras', text: 'Add a humorous take on the topic like a standup comedian.' },
    { id: 'media',   group: 'extras', text: 'Recommend related books and media.' },
    { id: 'style',   group: 'extras', text: 'Add emojis and hashtags, use HTML and highlight interesting parts.' }
];

// ── About me: a mindset (lens) and free tags ────────────────────────────────
/** One optional viewpoint. id → sentence; '' (no lens) is the default. */
export const LENSES = [
    { id: 'stoic',     text: 'Frame the key points through a Stoic lens: what can the reader control, and what is noise?' },
    { id: 'skeptic',   text: 'Take a skeptical view: question the claims, check the evidence and point out gaps.' },
    { id: 'optimist',  text: 'Look for opportunities and constructive angles.' },
    { id: 'pragmatic', text: 'Stay pragmatic: what is useful in practice, and what is hype?' }
];
export const MAX_TAGS = 8;
export const MAX_TAG_LENGTH = 30;

/** Free tags (“UX designer”, “parent of two” …): trimmed, one line, unique, limited. Returns a new array. */
export function normalizeTags(list) {
    const out = [], seen = new Set();
    for (const raw of Array.isArray(list) ? list : []) {
        const t = String(raw == null ? '' : raw).replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().replace(/^[-•*]+\s*/, '').slice(0, MAX_TAG_LENGTH).trim();
        const k = t.toLocaleLowerCase();
        if (!t || seen.has(k)) continue;
        seen.add(k); out.push(t);
        if (out.length >= MAX_TAGS) break;
    }
    return out;
}

export const PHIL_MIX = { tone: 'neutral', length: 'long', focus: ['title', 'quotes', 'ux', 'standup', 'media', 'style'], extra: '' };
export const ARTICLE_DEFAULTS = { tone: 'neutral', length: 'medium', focus: ['facts', 'numbers'], extra: '' };

function pick(list, ids) {
    const set = new Set(ids || []);
    return list.filter(f => set.has(f.id)).map(f => f.text);
}

export function normalizeBuilder(b, defaults = ARTICLE_DEFAULTS) {
    const o = { ...defaults, ...(b || {}) };
    if (!TONES.includes(o.tone)) o.tone = defaults.tone;
    if (!LENGTHS.includes(o.length)) o.length = defaults.length;
    o.focus = Array.isArray(o.focus) ? o.focus.filter(x => typeof x === 'string') : [...defaults.focus];
    o.extra = String(o.extra || '').slice(0, 800);
    // Optional “about me” parts: only present when set, so older stored builders keep their exact shape.
    if (LENSES.some(l => l.id === o.lens)) o.lens = o.lens; else delete o.lens;
    const about = normalizeTags(o.about);
    if (about.length) o.about = about; else delete o.about;
    return o;
}

export function buildArticlePrompt(b) {
    const o = normalizeBuilder(b, ARTICLE_DEFAULTS);
    const parts = [
        'Summarize the article clearly, explaining it in simple terms.',
        ...pick(ARTICLE_FOCUS, o.focus),
        ...(o.lens ? [LENSES.find(l => l.id === o.lens).text] : []),
        ...(o.about ? [`About me: ${o.about.join(', ')}. Match examples, comparisons and recommendations to this.`] : []),
        TONE_TEXT[o.tone],
        ARTICLE_LENGTH[o.length],
        'Answer additional questions in a serious and engaging way.'
    ];
    if (o.extra.trim()) parts.push(o.extra.trim());
    return parts.map(p => '- ' + p).join(' ');
}

// ── Feeds & briefings ───────────────────────────────────────────────────────
// The recap/briefing output format is machine-parsed, so these only steer style and wording.
const FEED_LENGTH = {
    short: 'Keep the overview to one or two sentences.',
    medium: 'Keep the overview to two or three sentences.',
    long: 'Make the overview a little more detailed (four or five sentences).'
};

export const FEED_FOCUS = [
    { id: 'facts',   text: 'Stick to hard facts and name the sources.' },
    { id: 'numbers', text: 'Include concrete numbers where the items give them.' },
    { id: 'impact',  text: 'Briefly say why each standout story matters.' },
    { id: 'humor',   text: 'A touch of light humor is welcome, never at the expense of accuracy.' }
];
export const FEED_DEFAULTS = { tone: 'neutral', length: 'medium', focus: [], extra: '' };

export function buildFeedStyle(b) {
    const o = normalizeBuilder(b, FEED_DEFAULTS);
    const parts = [TONE_TEXT[o.tone], FEED_LENGTH[o.length], ...pick(FEED_FOCUS, o.focus)];
    if (o.extra.trim()) parts.push(o.extra.trim());
    return parts.join(' ');
}

/** Effective style text of a stored feed style {mode:'builder'|'custom', builder, text}. '' = nothing to add. */
export function feedStyleText(s) {
    if (!s) return '';
    if (s.mode === 'custom') return String(s.text || '').trim().slice(0, 2000);
    if (s.mode === 'builder') return buildFeedStyle(s.builder);
    return '';
}

/** Appended to the fixed system prompt of recaps/briefings. */
export function styleSuffix(text) {
    const t = String(text || '').trim();
    return t ? `\nThe reader’s style preferences (follow them, but keep the output format above exactly): ${t}` : '';
}

/** Resolve which stored style applies to a scope: 'briefing' | 'recap' (recap falls back to briefing). */
export function resolveFeedStyle(cfg, scope) {
    if (!cfg) return '';
    if (scope === 'recap' && cfg.recap) return feedStyleText(cfg.recap);
    return feedStyleText(cfg.briefing);
}
