// paperInfo.js — popup side of "Research mode": effective paper state (detected + the user's override), badges, DOI link.
// Detection itself lives in content/paper.js (runs on the page); the result is stored as index fields {paper, doi, preprint}
// and as meta.paper on the record. The user's choice is index.paperOverride ('yes' | 'no').
import { T } from './feedI18n.js';

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

/** [tone, text] chips for a card: tone is 'ok' | 'acc' | 'warn' | 'mut'. */
export function paperChips(a) {
    const s = paperState(a);
    if (!s) return [];
    if (isPreprint(a)) return [['acc', T('🎓 Preprint')], ['warn', T('⚠ Not peer-reviewed')]];
    if (s === 'likely') return [['mut', T('🎓 Likely paper')]];
    return [['ok', paperDoi(a) ? T('🎓 Paper · DOI ✓') : T('🎓 Paper')]];
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
