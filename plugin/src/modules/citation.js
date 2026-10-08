// citation.js — citations for papers. The data comes from the DOI registry (doi.org content negotiation → CSL JSON),
// never from the AI; only the DOI leaves the device. Formatting (APA 7, MLA 9, Chicago author-date, BibTeX, RIS) is local,
// so one lookup serves every style and the result is cached on the article record (meta.paper.csl).
import StorageManager from './storageManager.js';
import { doiUrl } from './paperInfo.js';

export const CITE_STYLES = [['apa', 'APA 7'], ['mla', 'MLA'], ['chicago', 'Chicago'], ['bibtex', 'BibTeX'], ['ris', 'RIS']];

const str = (v, n = 400) => (typeof v === 'string' ? v : typeof v === 'number' ? String(v) : '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim().slice(0, n);

/** Keep only the CSL fields we format, as plain text (the registry response is untrusted). */
export function cleanCsl(j) {
    if (!j || typeof j !== 'object') return null;
    const first = (v) => Array.isArray(v) ? v[0] : v;
    const authors = (Array.isArray(j.author) ? j.author : []).slice(0, 60).map((a) => a && (a.literal ? { literal: str(a.literal, 120) } : { family: str(a.family, 80), given: str(a.given, 80) })).filter((a) => a && (a.literal || a.family));
    const parts = j.issued && Array.isArray(j.issued['date-parts']) && Array.isArray(j.issued['date-parts'][0]) ? j.issued['date-parts'][0].map(Number).filter(Number.isFinite) : [];
    const out = { type: str(j.type, 40), title: str(first(j.title), 400), author: authors, container: str(first(j['container-title']), 200), volume: str(j.volume, 30), issue: str(j.issue, 30), page: str(j.page, 40), publisher: str(j.publisher, 120), DOI: str(j.DOI, 200), year: parts[0] ? String(parts[0]) : '' };
    return out.title ? out : null;
}

/** Look the DOI up at doi.org (CSL JSON). Throws on failure; `fetchImpl` is injectable for tests. */
export async function fetchCsl(doi, fetchImpl = fetch) {
    const url = doiUrl(doi);
    if (!url) throw new Error('no DOI');
    const r = await fetchImpl(url, { headers: { Accept: 'application/vnd.citationstyles.csl+json' }, credentials: 'omit', redirect: 'follow' });
    if (!r.ok) throw new Error('doi.org ' + r.status);
    const csl = cleanCsl(await r.json());
    if (!csl) throw new Error('no citation data');
    return csl;
}

/** Cached CSL of an article, or a lookup (then cached). `fetchImpl` for tests. */
export async function ensureCsl(article, doi, fetchImpl) {
    const full = await StorageManager.getArticleFull(article.id);
    const cached = full && full.meta && full.meta.paper && full.meta.paper.csl;
    if (cached) return cached;
    const csl = await fetchCsl(doi, fetchImpl);
    await StorageManager.savePaperInfo(article.id, { csl });
    return csl;
}

// ---- formatting -------------------------------------------------------------------------------------------------
const initials = (g) => String(g || '').split(/[\s]+/).filter(Boolean).map((p) => p.split('-').map((x) => x[0].toUpperCase() + '.').join('-')).join(' ');
const pages = (p) => String(p || '').replace(/\s*[-–—]+\s*/, '–');
const doiLink = (c) => c.DOI ? 'https://doi.org/' + c.DOI : '';
const period = (s) => (/[.?!]$/.test(s) ? s : s + '.');
const given = (a) => a.given || '';
const nameInv = (a) => a.literal || (given(a) ? a.family + ', ' + given(a) : a.family);
const nameDir = (a) => a.literal || (given(a) ? given(a) + ' ' + a.family : a.family);

function apa(c) {
    const A = c.author.map((a) => a.literal || (a.family + (given(a) ? ', ' + initials(given(a)) : '')));
    let au = '';
    if (A.length === 1) au = A[0];
    else if (A.length <= 20) au = A.slice(0, -1).join(', ') + ', & ' + A[A.length - 1];
    else au = A.slice(0, 19).join(', ') + ', ... ' + A[A.length - 1];
    const src = [c.container, c.volume ? c.volume + (c.issue ? '(' + c.issue + ')' : '') : '', pages(c.page)].filter(Boolean).join(', ');
    return [au ? period(au) : '', '(' + (c.year || 'n.d.') + ').', period(c.title), src ? period(src) : (c.publisher ? period(c.publisher) : ''), doiLink(c)].filter(Boolean).join(' ');
}

function mla(c) {
    const a = c.author;
    let au = '';
    if (a.length === 1) au = nameInv(a[0]);
    else if (a.length === 2) au = nameInv(a[0]) + ', and ' + nameDir(a[1]);
    else if (a.length > 2) au = nameInv(a[0]) + ', et al';
    const src = [c.container, c.volume ? 'vol. ' + c.volume : '', c.issue ? 'no. ' + c.issue : '', c.year, c.page ? 'pp. ' + pages(c.page) : ''].filter(Boolean).join(', ');
    return [au ? period(au) : '', '“' + period(c.title) + '”', src ? period(src) : (c.publisher ? period(c.publisher) : ''), doiLink(c)].filter(Boolean).join(' ');
}

function chicago(c) {
    const a = c.author;
    let au = '';
    if (a.length === 1) au = nameInv(a[0]);
    else if (a.length > 1 && a.length <= 10) au = [nameInv(a[0]), ...a.slice(1).map(nameDir)].reduce((s, n, i, arr) => s + (i === 0 ? n : (i === arr.length - 1 ? ', and ' : ', ') + n), '');
    else if (a.length > 10) au = [nameInv(a[0]), ...a.slice(1, 7).map(nameDir)].join(', ') + ', et al.';
    const vol = c.volume ? ' ' + c.volume + (c.issue ? ' (' + c.issue + ')' : '') + (c.page ? ': ' + pages(c.page) : '') : (c.page ? ', ' + pages(c.page) : '');
    const src = c.container ? period(c.container + vol) : (c.publisher ? period(c.publisher) : '');
    return [au ? period(au) : '', period(c.year || 'n.d.'), '“' + period(c.title) + '”', src, doiLink(c)].filter(Boolean).join(' ');
}

const bibEsc = (s) => String(s || '').replace(/([&%$#_])/g, '\\$1');
const asciiKey = (s) => String(s || '').normalize('NFKD').replace(/[^\w]/g, '').toLowerCase();
export function bibKey(c) {
    const fam = asciiKey((c.author[0] && (c.author[0].family || c.author[0].literal)) || 'anon').slice(0, 20) || 'anon';
    const w = asciiKey(c.title.split(/\s+/).find((x) => x.length > 3) || c.title.split(/\s+/)[0] || '').slice(0, 12);
    return fam + (c.year || '') + w;
}
function bibtex(c, extra) {
    const t = c.type === 'article-journal' ? 'article' : c.type === 'paper-conference' ? 'inproceedings' : 'misc';
    const f = [];
    if (c.author.length) f.push(['author', c.author.map((a) => a.literal ? '{' + bibEsc(a.literal) + '}' : bibEsc(nameInv(a))).join(' and ')]);
    f.push(['title', '{' + bibEsc(c.title) + '}']);                       // inner braces keep the capitalisation
    if (c.container) f.push([t === 'inproceedings' ? 'booktitle' : t === 'article' ? 'journal' : 'howpublished', bibEsc(c.container)]);
    if (c.year) f.push(['year', c.year]);
    if (c.volume) f.push(['volume', bibEsc(c.volume)]);
    if (c.issue) f.push(['number', bibEsc(c.issue)]);
    if (c.page) f.push(['pages', c.page.replace(/\s*[-–—]+\s*/, '--')]);
    if (c.publisher && t !== 'article') f.push(['publisher', bibEsc(c.publisher)]);
    if (c.DOI) { f.push(['doi', c.DOI]); f.push(['url', doiLink(c)]); }
    if (extra) f.push(['annote', bibEsc(extra)]);
    return '@' + t + '{' + bibKey(c) + ',\n' + f.map(([k, v]) => '  ' + k + ' = {' + v + '}').join(',\n') + '\n}';
}
function ris(c, extra) {
    const ty = c.type === 'article-journal' ? 'JOUR' : c.type === 'paper-conference' ? 'CPAPER' : 'GEN';
    const [sp, ep] = String(c.page || '').split(/\s*[-–—]+\s*/);
    const L = [['TY', ty], ...c.author.map((a) => ['AU', a.literal || nameInv(a)]), ['TI', c.title]];
    if (c.container) L.push(['T2', c.container]);
    if (c.year) L.push(['PY', c.year]);
    if (c.volume) L.push(['VL', c.volume]);
    if (c.issue) L.push(['IS', c.issue]);
    if (sp) L.push(['SP', sp]); if (ep) L.push(['EP', ep]);
    if (c.publisher) L.push(['PB', c.publisher]);
    if (c.DOI) { L.push(['DO', c.DOI]); L.push(['UR', doiLink(c)]); }
    if (extra) L.push(['N1', extra]);
    L.push(['ER', '']);
    return L.map(([k, v]) => k + '  - ' + v).join('\n');
}

/** One formatted reference (plain text). `note` (a summary) is added as annote / N1 for BibTeX / RIS. */
export function formatCitation(csl, style, note) {
    if (!csl || !csl.title) return '';
    const c = { ...csl, author: Array.isArray(csl.author) ? csl.author : [] };
    if (style === 'mla') return mla(c);
    if (style === 'chicago') return chicago(c);
    if (style === 'bibtex') return bibtex(c, note);
    if (style === 'ris') return ris(c, note);
    return apa(c);
}

/** Reference list for several papers. items: [{ csl, summary? }]. Text styles are sorted by first author; with summaries each reference is followed by its summary. */
export function formatList(items, style, { summaries = false } = {}) {
    const rows = items.filter((i) => i && i.csl && i.csl.title).map((i) => ({ csl: i.csl, note: summaries ? str(i.summary, 1500) : '' }));
    const key = (r) => ((r.csl.author[0] && (r.csl.author[0].family || r.csl.author[0].literal)) || r.csl.title).toLowerCase();
    if (style === 'bibtex' || style === 'ris') return rows.map((r) => formatCitation(r.csl, style, r.note)).join(style === 'ris' ? '\n\n' : '\n\n');
    return rows.sort((a, b) => key(a).localeCompare(key(b))).map((r) => formatCitation(r.csl, style) + (r.note ? '\n    ' + r.note : '')).join('\n\n');
}

export const citeFileName = (style) => style === 'bibtex' ? ['references.bib', 'application/x-bibtex'] : style === 'ris' ? ['references.ris', 'application/x-research-info-systems'] : ['references.txt', 'text/plain'];

export async function copyText(text) {
    try { await navigator.clipboard.writeText(text); return true; } catch (_) { /* fall back below */ }
    try {
        const t = document.createElement('textarea'); t.value = text; t.style.position = 'fixed'; t.style.opacity = '0';
        document.body.appendChild(t); t.select(); const ok = document.execCommand('copy'); t.remove(); return ok;
    } catch (_) { return false; }
}

export function downloadText(name, mime, text) {
    const url = URL.createObjectURL(new Blob([text], { type: mime + ';charset=utf-8' }));
    const a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
}
