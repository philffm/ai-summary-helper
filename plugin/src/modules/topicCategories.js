// topicCategories.js — the fixed categories every saved article gets one of, and how the TAGS line of a summary is read.
// No imports on purpose: the content script (content/core.js, content/finalize.js) and the popup (the graph) both use it.
// The content-script bundler puts every module into ONE scope, so the top-level names here must be unique (no `clean`, `PATTERNS`…).
//
// A category is coarse and the same in every language (the list is English; topicConcepts.js shows it in the UI language).
// It is not a topic: the graph treats it as a category and never builds topic clusters or names from it.

export const CATEGORIES = ['Technology', 'Business', 'Science', 'Health', 'Politics', 'Environment', 'Society', 'Lifestyle'];

// Only the fallback, when the model named no category: the one whose words occur most often in the text (not the first that matches).
const CATEGORY_PATTERNS = {
    Technology: [/\bai\b/i, /\bartificial intelligence\b/i, /\bsoftware\b/i, /\btech\b/i, /\btechnology\b/i, /\bcyber\b/i, /\bstartup\b/i, /\bsemiconductor\b/i, /\bcloud\b/i],
    Business: [/\bfinance\b/i, /\beconomy\b/i, /\beconomic\b/i, /\bcorporate\b/i, /\bmarket\b/i, /\bhiring\b/i, /\bprofit\b/i, /\brevenue\b/i, /\bindustry\b/i],
    Science: [/\bscience\b/i, /\bresearch\b/i, /\bstudy\b/i, /\banalysis\b/i, /\bevidence\b/i, /\bexperiment\b/i, /\bjournal\b/i],
    Health: [/\bhealth\b/i, /\bmedical\b/i, /\bdisease\b/i, /\bdoctor\b/i, /\bhospital\b/i, /\bphysiology\b/i, /\bnutrition\b/i],
    Politics: [/\bgovernment\b/i, /\belection\b/i, /\bgeopolitics?\b/i, /\bregulations?\b/i],
    Environment: [/\bclimate\b/i, /\bemissions?\b/i, /\bsustainab(le|ility)\b/i, /\benvironment\b/i, /\brenewable\b/i, /\bbiodiversity\b/i, /\bweather\b/i],
    Society: [/\bculture\b/i, /\bcommunity\b/i, /\beducation\b/i, /\bdemographics?\b/i],
    Lifestyle: [/\blifestyle\b/i, /\bcreativity\b/i, /\bmindset\b/i, /\bhabits?\b/i, /\bwellbeing\b/i]
};

const CATEGORY_BY_LOWER = new Map(CATEGORIES.map(c => [c.toLowerCase(), c]));
/** The category spelled as in the list, or '' when `t` is none ("general" is none: it said nothing). */
export const asCategory = (t) => CATEGORY_BY_LOWER.get(String(t == null ? '' : t).trim().toLowerCase()) || '';
export const isCategory = (t) => !!asCategory(t);

/** Fallback category from the text: the one with the most distinct matching words; '' when none matches. */
export function categoryFromText(text) {
    const s = String(text || '');
    let best = '', bestN = 0;
    for (const c of CATEGORIES) {
        const n = CATEGORY_PATTERNS[c].reduce((k, rx) => k + (rx.test(s) ? 1 : 0), 0);
        if (n > bestN) { best = c; bestN = n; }   // a tie keeps the earlier one: the list order is the tie-break, not the first hit
    }
    return best;
}

const cleanTagPart = (t) => String(t || '').trim().replace(/^["'#]+|["']+$/g, '').replace(/\s+/g, ' ').trim();

/**
 * The TAGS comment of a summary: "category: Technology, KI-Regulierung = AI regulation, Chips = chips".
 * Older replies ("eins, zwei") still read: plain tags, no category, no English names.
 * @returns {{ tags: string[], category: string, tagEn: Object<string,string> }} tags without the category, deduped (case-insensitive);
 *          tagEn: tag → its English name, only where the model gave one.
 */
export function parseTagLine(text) {
    const out = { tags: [], category: '', tagEn: {} };
    const seen = new Set();
    String(text || '').replace(/^\s*\[|\]\s*$/g, '').split(/[,;\n|]+/).forEach((part) => {
        const cat = part.match(/^\s*(?:category|kategorie|catégorie|categoría|categoria)\s*:\s*(.+)$/i);
        if (cat) { if (!out.category) out.category = asCategory(cleanTagPart(cat[1])); return; }
        const eq = part.indexOf('=');
        const label = cleanTagPart(eq >= 0 ? part.slice(0, eq) : part), en = eq >= 0 ? cleanTagPart(part.slice(eq + 1)) : '';
        if (!label || label.length > 60) return;
        if (asCategory(label) || label.toLowerCase() === 'general') { if (!out.category) out.category = asCategory(label); return; }   // a category given as a plain tag
        const key = label.toLowerCase();
        if (seen.has(key)) return;
        seen.add(key);
        out.tags.push(label);
        if (en && en.length <= 60) out.tagEn[label] = en;
    });
    return out;
}

/** The instruction for the TAGS comment (one wording for every prompt that asks for it). */
export const TAG_INSTRUCTION = 'first "category: X" where X is exactly one of ' + CATEGORIES.join(', ')
    + '; then 2-4 SPECIFIC topic tags (what this page is about in particular, not a broad field), in the language of the summary, each followed by " = " and its English name';
export const TAG_EXAMPLE = '<!-- TAGS: category: Technology, <tag> = <English name>, <tag> = <English name> -->';
