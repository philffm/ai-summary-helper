// Translations that did not come from OpenRouter (scripts/translate.mjs --import): checked, then added to the cache.
// All or nothing: one problem and the cache stays as it was.

/** Things a translation must carry over unchanged. Each returns the list of tokens found in a string. */
const KEEP = {
    entity: (s) => s.match(/&(#\d+|#x[\da-f]+|[a-z]+\d*);/gi) || [],
    url: (s) => s.match(/https?:\/\/[^\s"'<>)]*[^\s"'<>).,;:!?。、]/g) || [],
    code: (s) => s.match(/`[^`]+`/g) || [],
    angle: (s) => s.match(/[<>]/g) || [],
};

/** Pages escape what is written into them: an entity the English text does not have would show up literally. */
export function problemsOf(en, text) {
    if (typeof text !== 'string' || !text.trim()) return ['empty'];
    const out = [];
    if (text !== text.trim()) out.push('leading or trailing space');
    for (const [name, find] of Object.entries(KEEP)) {
        const a = find(en).slice().sort().join(' ');
        const b = find(text).slice().sort().join(' ');
        const bad = name === 'entity' ? find(text).some((e) => !find(en).includes(e)) : a !== b;
        if (bad) out.push(`${name} differs (${a || 'none'} → ${b || 'none'})`);
    }
    if (/AI Summary Helper/.test(en) && !/AI Summary Helper/.test(text)) out.push('product name "AI Summary Helper" is missing');
    if (/Kaivo\b/.test(text) && !/Kaivo\b/i.test(en)) out.push('"Kaivo" in the cache: docs/ is the source brand, the brand build renames');
    return out;
}

/**
 * @param manifest  the cache ({ strings: { key: { en, translations } } }), changed only when there are no errors
 * @param input     { localeCode: { key: translatedText } }
 * @returns {{ added: number, errors: string[] }}
 */
export function importTranslations(manifest, input, { config, english, model, now = new Date().toISOString() }) {
    const errors = [];
    const adds = [];
    if (!model) errors.push('--model=<who translated> is required: the cache records where every string came from');
    for (const [code, map] of Object.entries(input || {})) {
        if (!config.locales[code]) { errors.push(`unknown locale "${code}"`); continue; }
        for (const [key, text] of Object.entries(map)) {
            const en = english.get(key);
            if (en === undefined) { errors.push(`${code} ${key.slice(0, 12)}: no such string on the English pages`); continue; }
            const problems = problemsOf(en, text);
            if (problems.length) errors.push(`${code} ${key.slice(0, 12)} "${en.slice(0, 40)}": ${problems.join('; ')}`);
            else adds.push({ code, key, en, text });
        }
    }
    if (errors.length) return { added: 0, errors };
    for (const { code, key, en, text } of adds) {
        manifest.strings[key] = manifest.strings[key] || { en, translations: {} };
        manifest.strings[key].en = en;
        manifest.strings[key].translations[code] = { text, translatedAt: now, model };
    }
    return { added: adds.length, errors };
}
