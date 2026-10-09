// topicConcepts.js — the same topic in different languages counts as ONE tag ("News" = "Nachrichten" = "Noticias",
// "Wirtschaft" = "Economics" = "Business"). Common topics are listed per UI locale: the first entry is the label shown in
// that language, the others are aliases (also matched). Anything not listed is compared as plain text.
//
// conceptKey(tag)          → 'c:news' for a known topic in any language, otherwise the normalized text
// topicLabel(tag, locale)  → the known topic's label in that locale, otherwise the tag unchanged
// conceptList(locale)      → the labels of all known topics in that locale (used as suggested vocabulary for the AI)

const L = (en, de, es, fr, it, pt_PT, ru, hi, ko, ja, zh_CN, zh_TW, ar) => ({ en, de, es, fr, it, pt_PT, ru, hi, ko, ja, zh_CN, zh_TW, zh_HK: zh_TW, ar });

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

export const normalizeTopic = (t) => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[#]/g, '').replace(/\s+/g, ' ').trim().toLowerCase();

const LOOKUP = new Map();
Object.entries(CONCEPTS).forEach(([id, byLocale]) => Object.values(byLocale).forEach((names) => names.forEach((n) => { const k = normalizeTopic(n); if (!LOOKUP.has(k)) LOOKUP.set(k, id); })));

/** Known topic id for a tag in any language (null when it is not a known topic). */
export const conceptId = (tag) => LOOKUP.get(normalizeTopic(tag)) || null;

/** Comparison key: same for all languages of a known topic, the normalized text otherwise. */
export function conceptKey(tag) {
    const id = conceptId(tag);
    return id ? 'c:' + id : normalizeTopic(tag);
}

/** The tag as it should be shown in `locale` (a _locales folder code like 'de'): known topics are translated, other tags stay as they are. */
export function topicLabel(tag, locale) {
    const id = conceptId(tag);
    const names = id && (CONCEPTS[id][locale] || CONCEPTS[id].en);
    return names ? names[0] : tag;
}

/** Labels of all known topics in `locale` — suggested vocabulary so the AI reuses the same words. */
export const conceptList = (locale) => Object.values(CONCEPTS).map((c) => (c[locale] || c.en)[0]);
