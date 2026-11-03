// topicConcepts.js — the same topic in different languages counts as ONE tag ("News" = "Nachrichten" = "Noticias",
// "Wirtschaft" = "Economics" = "Business"). Common topics are listed per UI locale: the first entry is the label shown in
// that language, the others are aliases (also matched). Anything not listed is compared as plain text.
//
// Beyond the built-in list there is a LEARNED lexicon: { englishKey: { locale: label } } ("football": { en: 'Football', de: 'Fußball' }).
// It lives apart from articles and feeds (nothing is attached to an item, exports keep the original tag) and grows whenever
// the AI names a new tag in another language; see topicLexicon.js for how it is stored and filled.
//
// conceptKey(tag)          → 'c:news' for a known topic in any language, then the learned English key, otherwise the normalized text
// topicLabel(tag, locale)  → the known topic's label in that locale, otherwise the tag unchanged
// conceptList(locale)      → the labels of all known topics in that locale (used as suggested vocabulary for the AI)

const L = (en, de, es, fr, it, pt_PT, ru, hi, ko, ja, zh_CN, zh_TW, ar) => ({ en, de, es, fr, it, pt_PT, ru, hi, ko, ja, zh_CN, zh_TW, zh_HK: zh_TW, pt_BR: pt_PT, ar });

export const CONCEPTS = {
    news: L(['News', 'Headlines', 'Breaking'], ['Nachrichten', 'News', 'Meldungen'], ['Noticias', 'Actualidad'], ['Actualités', 'Actualites', 'Infos', 'Nouvelles'], ['Notizie', 'Attualità', 'News'], ['Notícias', 'Noticias', 'Atualidade'], ['Новости'], ['समाचार', 'खबरें', 'ख़बरें'], ['뉴스', '소식'], ['ニュース'], ['新闻', '资讯'], ['新聞', '資訊', '新聞'], ['أخبار', 'الأخبار']),
    politics: L(['Politics'], ['Politik'], ['Política'], ['Politique'], ['Politica'], ['Política'], ['Политика'], ['राजनीति'], ['정치'], ['政治'], ['政治'], ['政治'], ['سياسة', 'السياسة']),
    economy: L(['Economy', 'Economics', 'Business', 'Finance', 'Markets'], ['Wirtschaft', 'Ökonomie', 'Finanzen', 'Business'], ['Economía', 'Negocios', 'Finanzas'], ['Économie', 'Affaires', 'Finance'], ['Economia', 'Business', 'Finanza'], ['Economia', 'Negócios', 'Finanças'], ['Экономика', 'Бизнес', 'Финансы'], ['अर्थव्यवस्था', 'व्यापार', 'अर्थशास्त्र'], ['경제', '비즈니스', '금융'], ['経済', 'ビジネス', '金融'], ['经济', '商业', '财经', '金融'], ['經濟', '商業', '財經', '金融'], ['اقتصاد', 'الاقتصاد', 'أعمال']),
    tech: L(['Tech', 'Technology', 'IT'], ['Technik', 'Technologie', 'Tech'], ['Tecnología', 'Tech'], ['Technologie', 'Tech', 'Technologies'], ['Tecnologia', 'Tech'], ['Tecnologia', 'Tech'], ['Технологии', 'Технологии и IT', 'Техника'], ['प्रौद्योगिकी', 'तकनीक', 'टेक'], ['기술', '테크', 'IT'], ['テクノロジー', 'テック', 'IT'], ['科技', '技术'], ['科技', '技術'], ['تكنولوجيا', 'تقنية', 'التكنولوجيا']),
    science: L(['Science'], ['Wissenschaft', 'Forschung'], ['Ciencia'], ['Science', 'Sciences'], ['Scienza'], ['Ciência'], ['Наука'], ['विज्ञान'], ['과학'], ['科学'], ['科学'], ['科學'], ['علوم', 'العلوم']),
    health: L(['Health', 'Medicine'], ['Gesundheit', 'Medizin'], ['Salud', 'Medicina'], ['Santé', 'Sante', 'Médecine'], ['Salute', 'Medicina'], ['Saúde', 'Medicina'], ['Здоровье', 'Медицина'], ['स्वास्थ्य'], ['건강', '의학'], ['健康', '医療'], ['健康', '医疗'], ['健康', '醫療'], ['صحة', 'الصحة']),
    sports: L(['Sports', 'Sport'], ['Sport'], ['Deportes', 'Deporte'], ['Sport', 'Sports'], ['Sport'], ['Desporto', 'Desportos', 'Esportes', 'Esporte'], ['Спорт'], ['खेल'], ['스포츠'], ['スポーツ'], ['体育', '体育运动', '运动'], ['體育', '運動'], ['رياضة', 'الرياضة']),
    culture: L(['Culture', 'Arts'], ['Kultur', 'Kunst'], ['Cultura', 'Arte'], ['Culture', 'Arts'], ['Cultura', 'Arte'], ['Cultura', 'Arte'], ['Культура', 'Искусство'], ['संस्कृति', 'कला'], ['문화', '예술'], ['文化', 'アート'], ['文化', '艺术'], ['文化', '藝術'], ['ثقافة', 'الثقافة', 'فنون']),
    world: L(['World', 'International'], ['Welt', 'International', 'Ausland'], ['Mundo', 'Internacional'], ['Monde', 'International'], ['Mondo', 'Internazionale', 'Esteri'], ['Mundo', 'Internacional'], ['Мир', 'В мире', 'Международные'], ['विश्व', 'दुनिया', 'अंतरराष्ट्रीय'], ['세계', '국제'], ['世界', '国際'], ['世界', '国际'], ['世界', '國際'], ['عالم', 'العالم', 'دولي']),
    climate: L(['Climate', 'Environment', 'Climate change'], ['Klima', 'Umwelt', 'Klimawandel'], ['Clima', 'Medio ambiente', 'Cambio climático'], ['Climat', 'Environnement'], ['Clima', 'Ambiente', 'Cambiamento climatico'], ['Clima', 'Ambiente', 'Alterações climáticas'], ['Климат', 'Экология', 'Окружающая среда'], ['जलवायु', 'पर्यावरण'], ['기후', '환경'], ['気候', '環境'], ['气候', '环境', '环保'], ['氣候', '環境', '環保'], ['مناخ', 'المناخ', 'بيئة', 'البيئة']),
    design: L(['Design'], ['Design', 'Gestaltung'], ['Diseño'], ['Design', 'Conception'], ['Design'], ['Design'], ['Дизайн'], ['डिज़ाइन', 'डिजाइन'], ['디자인'], ['デザイン'], ['设计'], ['設計', '設計'], ['تصميم', 'التصميم']),
    entertainment: L(['Entertainment', 'Film & TV', 'Movies'], ['Unterhaltung', 'Entertainment', 'Film & TV', 'Kino'], ['Entretenimiento', 'Cine'], ['Divertissement', 'Cinéma'], ['Intrattenimento', 'Spettacolo', 'Cinema'], ['Entretenimento', 'Cinema'], ['Развлечения', 'Кино'], ['मनोरंजन'], ['엔터테인먼트', '연예'], ['エンタメ', 'エンターテインメント', '芸能'], ['娱乐'], ['娛樂'], ['ترفيه', 'الترفيه', 'منوعات']),
    society: L(['Society', 'Social'], ['Gesellschaft', 'Soziales'], ['Sociedad'], ['Société', 'Societe'], ['Società', 'Societa'], ['Sociedade'], ['Общество'], ['समाज'], ['사회'], ['社会'], ['社会'], ['社會'], ['مجتمع', 'المجتمع']),
    education: L(['Education'], ['Bildung', 'Ausbildung'], ['Educación'], ['Éducation', 'Education'], ['Istruzione', 'Educazione'], ['Educação'], ['Образование'], ['शिक्षा'], ['교육'], ['教育'], ['教育'], ['教育'], ['تعليم', 'التعليم'])
};

/** "🌐 de" / "🌐en" / "🌐 pt-br": a language mark (content/finalize.js writes "🌐 <page language>" and "🌐 <summary language>"), never a topic.
 *  The AI must not be asked what topic it is (it answers "Germany"), and no topic may ever be learned for it. */
export const isLanguageTag = (t) => /^🌐\s*[a-z]{2,3}(?:-[a-z0-9]{2,8})?$/i.test(String(t == null ? '' : t).trim());

/** "ContentPollution" → "Content Pollution", "UXForAll" → "UX For All": a hashtag-style tag written as words. */
export function humanizeTag(t) {
    return String(t || '').replace(/[_#]+/g, ' ').replace(/([a-z\d])([A-Z])/g, '$1 $2').replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2').replace(/\s+/g, ' ').trim();
}

/** Not a topic at all: a colour value ("7f8c8d"), an id, a number. Such a tag is never sent to be named. */
export const isJunkTag = (t) => {
    const s = String(t == null ? '' : t).trim().replace(/^#/, '');
    return s.length < 2 || !/\p{L}/u.test(s) || (/^[0-9a-f]{3,8}$/i.test(s) && /\d/.test(s));
};

export const normalizeTopic = (t) => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[#]/g, '').replace(/\s+/g, ' ').trim().toLowerCase();

const LOOKUP = new Map();
Object.entries(CONCEPTS).forEach(([id, byLocale]) => Object.values(byLocale).forEach((names) => names.forEach((n) => { const k = normalizeTopic(n); if (!LOOKUP.has(k)) LOOKUP.set(k, id); })));

// ── learned lexicon (in memory; topicLexicon.js loads and saves it) ──
// Entry: { en: 'AI in medicine', de: 'KI in der Medizin', '*': [spellings seen], '>': ['artificial intelligence', 'medicine'] }.
// '>' = broader topics (at most 2, English, normalized): what the topic belongs to. Not spellings, never shown as a tag; the graph
// uses them as weak ties so a rare, specific tag sits next to the broader topics it is part of.
const BROADER = '>';
// '!' = checked as a name: the model kept the tag as it is twice ("Nasdaq" in a German article), so a tidy-up does not ask again
const NAME_MARK = '!';
/** Remember that a learned topic is a name that stays as it is in every language. */
export function lexiconMarkName(en) {
    const key = normalizeTopic(en), cur = LEX[key];
    if (!cur || cur[NAME_MARK]) return false;
    cur[NAME_MARK] = true; return true;
}
export const isMarkedName = (key) => !!(LEX[key] && LEX[key][NAME_MARK]);
let LEX = {};                    // englishKey -> { locale: label }
let LEX_REV = new Map();         // normalized label (any language) / englishKey -> englishKey
const buildRev = () => {
    LEX_REV = new Map();
    for (const [key, labels] of Object.entries(LEX)) {
        if (!LEX_REV.has(key)) LEX_REV.set(key, key);
        Object.entries(labels).filter(([k]) => k !== BROADER && k !== NAME_MARK).flatMap(([, v]) => [].concat(v)).forEach((l) => { const n = normalizeTopic(l); if (n && !isLanguageTag(l) && !LEX_REV.has(n)) LEX_REV.set(n, key); });   // '*' holds the spellings seen so far
    }
};
export function setLexicon(obj) {
    LEX = obj && typeof obj === 'object' ? obj : {};
    // An older run may have taught the lexicon that "🌐 de" means a country; forget that for good (language marks are not topics).
    for (const labels of Object.values(LEX)) if (labels && Array.isArray(labels['*'])) labels['*'] = labels['*'].filter((l) => !isLanguageTag(l));
    buildRev();
}
export const getLexicon = () => LEX;
/**
 * Remember that `label` names the topic `en` (its English name). `locale` = the language the label is written in, or
 * null when unknown (the spelling is then only used to recognise the tag, never shown). Returns true when the lexicon changed.
 * A topic that names itself (en = label) marks a tag as seen, so it is not sent to the AI again.
 */
export function lexiconLearn(en, locale, label) {
    const key = normalizeTopic(en), shown = String(label || '').replace(/\s+/g, ' ').trim();
    if (!key || !shown || key.length > 40 || shown.length > 40) return false;
    if (isLanguageTag(en) || isLanguageTag(label)) return false;   // a language mark is never a spelling of a topic, whatever the AI says
    if (locale && LOOKUP.has(key)) return false;        // built-in topics have their labels; only extra spellings (locale = null) are worth keeping
    const cur = LEX[key] || (LEX[key] = {});
    if (locale) { if (cur[locale] === shown) return false; cur[locale] = shown; }
    else { const v = cur['*'] || (cur['*'] = []); if (v.some((x) => normalizeTopic(x) === normalizeTopic(shown))) return false; if (v.length >= 12) v.shift(); v.push(shown); }
    buildRev();
    return true;
}
/**
 * Teach the lexicon the English names the summaries gave their tags (index field `tagEn`: { tag: English name }, written by
 * content/finalize.js). "KI-Regulierung" with "AI regulation" and "AI regulation" from another article become one topic.
 * The tag is learned as a spelling (its language is not known here), the English name as the English label. Returns true when the lexicon changed.
 */
export function learnTagPairs(entries) {
    let changed = false;
    for (const a of entries || []) {
        const m = a && a.tagEn;
        if (!m || typeof m !== 'object') continue;
        for (const [label, en] of Object.entries(m)) {
            if (!en || isLanguageTag(label) || isLanguageTag(en)) continue;
            if (lexiconLearn(en, null, label)) changed = true;
            if (lexiconLearn(en, 'en', String(en).replace(/^./, c => c.toUpperCase()))) changed = true;
        }
    }
    return changed;
}

/**
 * Remember what a learned topic belongs to: up to 2 broader topics (English). An empty list marks it as asked (so it is not sent again).
 * Built-in topics need none (they are broad already). A broader topic that is the topic itself, a language mark or a fixed category
 * (too broad to say anything) is dropped. Returns true when the lexicon changed.
 */
export function lexiconBroader(en, list) {
    const key = normalizeTopic(en);
    if (!key || key.length > 40 || LOOKUP.has(key) || isLanguageTag(en)) return false;
    const out = filterBroader(key, list);
    const cur = LEX[key] || (LEX[key] = {});
    if (Array.isArray(cur[BROADER]) && cur[BROADER].join('|') === out.join('|')) return false;
    cur[BROADER] = out;
    return true;
}
// the fixed categories (topicCategories.js) and catch-alls: as broader topics they would tie everything in a category together
const NOT_BROADER = new Set(['technology', 'business', 'science', 'health', 'politics', 'environment', 'society', 'lifestyle', 'general', 'news', 'other', 'misc', 'miscellaneous', 'uncategorized', 'uncategorised', 'various', 'none', 'n/a']);
/** The broader topics that would be kept for `en` (normalized, at most 2): what a preview shows is what is saved. */
export function filterBroader(en, list) {
    const key = normalizeTopic(en);
    const seen = new Set(), out = [];
    for (const b of Array.isArray(list) ? list : []) {
        const k = normalizeTopic(b);
        if (!k || k.length > 40 || k === key || isLanguageTag(b) || NOT_BROADER.has(k) || seen.has(k)) continue;
        seen.add(k); out.push(k);
        if (out.length === 2) break;
    }
    return out;
}

/** Comparison keys (as conceptKey) of the broader topics of a tag; [] when there are none or it was never asked. */
export function broaderKeysOf(tag) {
    const k = lexKey(tag);
    const list = k && LEX[k] && LEX[k][BROADER];
    return Array.isArray(list) ? list.map(b => conceptKey(b)) : [];
}

/** A learned topic whose broader topics were never asked for (built-in topics never need them). */
export function needsBroader(tag) {
    if (conceptId(tag)) return false;
    const k = lexKey(tag);
    return !!k && !LOOKUP.has(k) && !(LEX[k] && Array.isArray(LEX[k][BROADER]));
}

const lexKey = (tag) => (isLanguageTag(tag) ? null : LEX_REV.get(normalizeTopic(tag)) || null);

/** Known topic id for a tag in any language (null when it is not a built-in topic). A learned tag whose English name is a built-in topic counts too. */
export const conceptId = (tag) => (isLanguageTag(tag) ? null : LOOKUP.get(normalizeTopic(tag)) || LOOKUP.get(lexKey(tag)) || null);

/** Built-in or learned topic (as opposed to free text)? */
export const isKnownTopic = (tag) => !!(conceptId(tag) || lexKey(tag));

/** Comparison key: same for all languages of a topic (built-in or learned), the normalized text otherwise. */
export function conceptKey(tag) {
    const id = conceptId(tag);
    return id ? 'c:' + id : lexKey(tag) || normalizeTopic(tag);
}

/** The tag as it should be shown in `locale` (a _locales folder code like 'de'): known and learned topics are translated, other tags stay as they are. */
export function topicLabel(tag, locale) {
    const id = conceptId(tag);
    const names = id && (CONCEPTS[id][locale] || CONCEPTS[id].en);
    if (names) return names[0];
    const learned = LEX[lexKey(tag)];
    return (learned && learned[locale]) || tag;
}

/** Does this tag have a label in `locale` without asking the AI (built-in topic, or learned in that language)? */
export function hasLabel(tag, locale) {
    if (conceptId(tag)) return true;
    const learned = LEX[lexKey(tag)];
    return !!(learned && learned[locale]);
}

/** The tags of a list that are neither built-in nor learned yet (deduped, most frequent first) — what the AI still has to name. `minCount` leaves out tags that occur fewer times. */
export function unknownTags(list, max = 200, minCount = 1) {
    const n = new Map();
    for (const t of list) { const k = normalizeTopic(t); if (k && k.length <= 40 && !isLanguageTag(t) && !conceptId(t) && !lexKey(t)) { const e = n.get(k) || { tag: String(t).trim(), c: 0 }; e.c++; n.set(k, e); } }
    return [...n.values()].filter((e) => e.c >= minCount).sort((a, b) => b.c - a.c).slice(0, max).map((e) => e.tag);
}

/**
 * Learned topics (English keys) that are used in `list` at least `minCount` times but have no label in `locale` yet —
 * what is left to translate after the UI language was switched. Built-in topics always have one; unknown tags are
 * unknownTags()' business. Most used first.
 */
export function keysNeedingLabel(list, locale, max = 200, minCount = 1) {
    const n = new Map();
    for (const t of list) {
        if (conceptId(t)) continue;
        const k = lexKey(t); if (!k || (LEX[k] && LEX[k][locale])) continue;
        n.set(k, (n.get(k) || 0) + 1);
    }
    return [...n].filter(([, c]) => c >= minCount).sort((a, b) => b[1] - a[1]).slice(0, max).map(([k]) => k);
}

/** Labels of all known topics in `locale` — suggested vocabulary so the AI reuses the same words. */
export const conceptList = (locale) => Object.values(CONCEPTS).map((c) => (c[locale] || c.en)[0]);

/** Label for a comparison key from conceptKey(): 'c:news' → the topic's label in `locale`; a learned key → its label there; else null. */
export function labelOfKey(key, locale) {
    const id = String(key).startsWith('c:') ? String(key).slice(2) : null;
    const names = id && CONCEPTS[id] && (CONCEPTS[id][locale] || CONCEPTS[id].en);
    if (names) return names[0];
    const learned = LEX[key];
    return (learned && (learned[locale] || learned.en)) || null;
}

/**
 * Category counts as shown in `locale`: [[raw, n], …] → [[label, total, raw], …], merged per topic ("Business" and "Economy"
 * are one row) and sorted by count. `raw` is the most frequent original spelling, so a click still searches what is stored.
 */
export function groupedLabels(entries, locale) {
    const g = new Map();
    for (const [raw, n] of entries) {
        const k = conceptKey(raw), e = g.get(k) || { n: 0, best: raw, bestN: 0 };
        e.n += n; if (n > e.bestN) { e.best = raw; e.bestN = n; }
        g.set(k, e);
    }
    return [...g.values()].map((e) => [topicLabel(e.best, locale), e.n, e.best]).sort((a, b) => b[1] - a[1]);
}

/** True when tag `t` matches the search text `q` (lowercase): plain substring, or both name the same known topic ("Nachrichten" finds "News"). */
export function tagMatches(t, q) {
    if (String(t).toLowerCase().includes(q)) return true;
    return isKnownTopic(q) && conceptKey(t) === conceptKey(q);   // the same built-in or learned topic
}
