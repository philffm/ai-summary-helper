// paperInfo.js — popup side of "Research mode": effective paper state (detected + the user's override), badges, DOI link.
// Detection itself lives in content/paper.js (runs on the page); the result is stored as index fields {paper, doi, preprint}
// and as meta.paper on the record. The user's choice is index.paperOverride ('yes' | 'no').
import { T } from './feedI18n.js';
import StorageManager from './storageManager.js';
import { applyScholarly } from '../content/paper.js';

const metaPaper = (a) => (a && a.meta && a.meta.paper) || null;

/** 'yes' | 'likely' | null — the user's override wins over detection. */
export function paperState(a) {
    if (!a) return null;
    if (a.paperOverride === 'no') return null;
    if (a.paperOverride === 'yes') return 'yes';
    const s = a.paper || (metaPaper(a) && metaPaper(a).state);
    return s === 'yes' || s === 'likely' ? s : null;
}

export const paperDoi = (a) => (a && (a.doi || (metaPaper(a) && metaPaper(a).doi))) || '';
const isPreprint = (a) => !!(a && (a.preprint || (metaPaper(a) && metaPaper(a).preprint)));

/** 'review' | 'trial' | 'preprint' | 'study' | '' — as read by the model (or implied by the host). */
export function paperType(a) {
    if (!paperState(a)) return '';
    if (isPreprint(a)) return 'preprint';
    return (a && a.paperType) || (metaPaper(a) && metaPaper(a).type) || '';
}

/** Key facts the model extracted: [[label, text], …] (empty when none). */
export function paperFacts(a) {
    const f = metaPaper(a) && metaPaper(a).facts;
    if (!f || !paperState(a)) return [];
    return [['design', T('Design')], ['sample', T('Sample')], ['limitations', T('Limitations')]]
        .filter(([k]) => f[k]).map(([k, label]) => [label, String(f[k])]);
}

/** Text the History search also looks at: DOI + authors. */
export const paperSearchText = (a) => paperState(a) ? [paperDoi(a), a.paperAuthors || (metaPaper(a) && metaPaper(a).authors) || ''].join(' ').toLowerCase() : '';

/** [tone, text] chips for a card: tone is 'ok' | 'acc' | 'warn' | 'mut'. */
export function paperChips(a) {
    const s = paperState(a);
    if (!s) return [];
    if (isPreprint(a)) return [['acc', T('🎓 Preprint')], ['warn', T('⚠ Not peer-reviewed')]];
    const ty = paperType(a);
    const kind = ty === 'review' ? [['acc', T('Review')]] : ty === 'trial' ? [['acc', T('Trial')]] : [];
    if (s === 'likely') return [['mut', T('🎓 Likely paper')], ...kind];
    return [['ok', paperDoi(a) ? T('🎓 Paper · DOI ✓') : T('🎓 Paper')], ...kind];
}

/** What the "Mark" button does next: { label, value } with value 'yes' | 'no'. */
export function paperToggle(a) {
    return paperState(a) ? { label: T('Not a paper'), value: 'no' } : { label: T('🎓 Mark as paper'), value: 'yes' };
}

/** https://doi.org/<doi> for a validated DOI, '' otherwise (never builds a link from unchecked text). */
export function doiUrl(doi) {
    const m = String(doi || '').match(/^10\.\d{4,9}\/[^\s"'<>]+$/);
    return m ? 'https://doi.org/' + encodeURI(m[0]) : '';
}

/** "Smith; Lee et al. · Nature · 2026" from the stored page metadata ('' when there is none). */
export function paperLine(a) {
    const p = metaPaper(a);
    if (!p) return '';
    return [p.authors, p.journal, p.year].filter(Boolean).join(' · ');
}

const FACTS_SYSTEM = 'You read a scientific paper (or page about one) and extract key facts. Answer with ONE JSON object only, no prose, no code fences: {"scholarly":true|false,"type":"review|trial|preprint|study","design":"study design","sample":"who or what was studied, n","limitations":"main limitations"}. design, sample and limitations: at most 20 words each, empty string if the text does not say. Write them in the language named by the user.';

/** On-demand key facts for a paper that has none (older saves, or a model that left the comment out). Returns the merged paper object. */
export async function extractPaperFacts(article, ai, langName) {
    const full = article.content !== undefined ? article : await StorageManager.getArticleFull(article.id);
    const text = String(full.content || full.summary || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').slice(0, 14000);
    if (!text) throw new Error(T('Nothing to analyse'));
    const raw = await ai(FACTS_SYSTEM, `Language: ${langName || 'English'}\nTitle: ${full.title || ''}\n\n${text}`);
    const base = (full.meta && full.meta.paper) || { state: paperState(article) || 'likely' };
    const merged = applyScholarly(Object.assign({}, base, { state: 'yes' }), raw);
    if (!merged || !merged.facts) throw new Error(T('No key facts found'));
    await StorageManager.savePaperInfo(article.id, { state: merged.state, type: merged.type, facts: merged.facts, ...(merged.preprint ? { preprint: true } : {}) });
    return merged;
}
