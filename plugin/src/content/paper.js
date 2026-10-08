// paper.js — is this page a scientific article? Pure DOM reads (no network, no storage): runs in the content script.
// Layers: citation_* / DC / PRISM meta tags and JSON-LD ScholarlyArticle ("yes"), known publisher / preprint hosts and a DOI in
// the first part of an abstract-like text ("likely"). Returns null when there is no signal. The popup lets the user override.

const PP_DOI_RE = /10\.\d{4,9}\/[^\s"'<>]+/i;
const PP_PREPRINT_HOSTS = /(^|\.)(arxiv\.org|biorxiv\.org|medrxiv\.org|chemrxiv\.org|ssrn\.com|osf\.io|preprints\.org|researchsquare\.com|openreview\.net)$/i;
const PP_SCHOLAR_HOSTS = /(^|\.)(pubmed\.ncbi\.nlm\.nih\.gov|ncbi\.nlm\.nih\.gov|semanticscholar\.org|sciencedirect\.com|link\.springer\.com|onlinelibrary\.wiley\.com|jstor\.org|journals\.plos\.org|frontiersin\.org|mdpi\.com|cell\.com|science\.org|dl\.acm\.org|ieeexplore\.ieee\.org|tandfonline\.com|journals\.sagepub\.com|academic\.oup\.com|thelancet\.com|nejm\.org|bmj\.com|jamanetwork\.com|aclanthology\.org|proceedings\.mlr\.press|papers\.nips\.cc|doi\.org)$/i;

const ppCap = (v, n) => String(v || '').replace(/\s+/g, ' ').trim().slice(0, n);

/** "doi:10.1/x.", "https://doi.org/10.1/x" → "10.1/x" ('' when there is no DOI in the string). */
export function normalizeDoi(s) {
  const m = String(s || '').match(PP_DOI_RE);
  return m ? m[0].replace(/[.,;:)\]}>]+$/, '') : '';
}

function ppLdNodes(doc) {
  const out = [];
  const walk = (n) => {
    if (!n || typeof n !== 'object') return;
    if (Array.isArray(n)) { n.forEach(walk); return; }
    out.push(n);
    if (n['@graph']) walk(n['@graph']);
  };
  doc.querySelectorAll('script[type="application/ld+json"]').forEach((s) => {
    try { walk(JSON.parse(s.textContent || '')); } catch (_) { /* malformed JSON-LD is common */ }
  });
  return out;
}
const ppTypesOf = (n) => [].concat(n['@type'] || []).map(String);

export function detectPaper(doc = document, loc = window.location) {
  const host = String(loc.hostname || '').replace(/^www\./, '');
  const metas = {};
  doc.querySelectorAll('meta').forEach((m) => {
    const k = String(m.getAttribute('name') || m.getAttribute('property') || '').toLowerCase();
    const v = (m.getAttribute('content') || '').trim();
    if (k && v) (metas[k] = metas[k] || []).push(v);
  });
  const first = (...ks) => { for (const k of ks) if (metas[k] && metas[k][0]) return metas[k][0]; return ''; };

  const ld = ppLdNodes(doc).find(n => ppTypesOf(n).some(t => /ScholarlyArticle$/i.test(t)));
  const ldDoi = ld ? normalizeDoi([].concat(ld.identifier || [], ld.sameAs || [], ld.url || []).map(x => (x && typeof x === 'object' ? x.value || x['@id'] || '' : x)).join(' ')) : '';

  const metaDoi = normalizeDoi(first('citation_doi', 'prism.doi', 'bepress_citation_doi', 'dc.identifier.doi')) || normalizeDoi(first('dc.identifier', 'dc.identifier.uri', 'prism.url'));
  const urlDoi = /(^|\.)doi\.org$/i.test(host) ? normalizeDoi(decodeURIComponent(loc.pathname || '')) : '';
  const hasCitation = !!first('citation_title') && !!first('citation_journal_title', 'citation_conference_title', 'citation_doi', 'citation_arxiv_id', 'citation_pdf_url', 'citation_dissertation_institution', 'citation_technical_report_institution');

  const preprint = PP_PREPRINT_HOSTS.test(host);
  const scholarHost = preprint || PP_SCHOLAR_HOSTS.test(host);

  let doi = metaDoi || ldDoi || urlDoi;
  let state = null;
  if (hasCitation || ld || metaDoi || urlDoi) state = 'yes';
  else if (scholarHost) state = 'likely';
  if (!doi) {
    const a = doc.querySelector('a[href*="doi.org/10."]');
    if (a) doi = normalizeDoi(a.getAttribute('href'));
  }
  if (!state) {
    // Weakest signal: a DOI inside an abstract-like opening of the text (a blog quoting a DOI has no "Abstract").
    const head = ppCap(doc.body ? doc.body.textContent : '', 6000);
    const t = head.match(PP_DOI_RE);
    if (t && /\babstract\b/i.test(head)) { state = 'likely'; if (!doi) doi = normalizeDoi(t[0]); }
  }
  if (!state) return null;

  const authors = (metas['citation_author'] || (metas['dc.creator'] || [])).slice(0, 3);
  const ldAuthors = ld ? [].concat(ld.author || []).map(a => (a && a.name) || a).filter(x => typeof x === 'string').slice(0, 3) : [];
  const list = authors.length ? authors : ldAuthors;
  const total = (metas['citation_author'] || []).length || list.length;
  const dateStr = first('citation_publication_date', 'citation_date', 'citation_online_date', 'dc.date', 'prism.publicationdate') || (ld && ld.datePublished) || '';
  const year = (String(dateStr).match(/\b(19|20)\d{2}\b/) || [''])[0];
  const out = { state };
  if (doi) out.doi = ppCap(doi, 200);
  const journal = first('citation_journal_title', 'citation_conference_title', 'prism.publicationname') || (ld && ld.isPartOf && ld.isPartOf.name) || '';
  if (journal) out.journal = ppCap(journal, 120);
  if (year) out.year = year;
  if (list.length) out.authors = ppCap(list.join('; ') + (total > list.length ? ' et al.' : ''), 160);
  if (preprint) out.preprint = true;
  return out;
}

/** Lean fields for the articles index: lists can badge a paper without loading the record. */
export function paperIndexFields(p) {
  if (!p || !p.state) return {};
  const f = { paper: p.state };
  if (p.doi) f.doi = p.doi;
  if (p.preprint) f.preprint = true;
  if (p.type) f.paperType = p.type;
  if (p.authors) f.paperAuthors = p.authors;
  return f;
}

/** PDFs have no meta tags: look at the extracted opening text (DOI + "Abstract", or an arXiv / journal-style header). */
export function detectPaperInText(text, loc = window.location) {
  const head = ppCap(text, 6000);
  if (!head) return null;
  const host = String(loc.hostname || '').replace(/^www\./, '');
  const preprint = PP_PREPRINT_HOSTS.test(host) || /\barXiv:\d{4}\.\d{4,5}/i.test(head);
  const m = head.match(PP_DOI_RE);
  const hasAbstract = /\babstract\b/i.test(head);
  if (!(m && hasAbstract) && !preprint && !(hasAbstract && /\b(keywords?|references|introduction)\b/i.test(head))) return null;
  const out = { state: 'likely' };
  if (m) out.doi = ppCap(normalizeDoi(m[0]), 200);
  if (preprint) out.preprint = true;
  return out;
}

/** What the model said in <!-- SCHOLARLY: {...} -->, merged with the page signals. Returns the new paper object or null. */
export function applyScholarly(paper, raw) {
  let j = null;
  if (raw && typeof raw === 'object') j = raw;
  else {
    const m = String(raw || '').match(/\{[\s\S]*\}/);
    if (m) { try { j = JSON.parse(m[0]); } catch (_) { j = null; } }
  }
  if (!j || typeof j !== 'object') return paper || null;      // unparsable: keep what the page said
  if (j.scholarly !== true) return paper && paper.state === 'yes' ? paper : null;   // strong page signals win; weak ones are dropped
  const out = Object.assign({}, paper || {});
  out.state = paper ? 'yes' : 'likely';
  const t = String(j.type || '').toLowerCase();
  out.type = /review|meta-?analy/.test(t) ? 'review' : /trial|rct/.test(t) ? 'trial' : /preprint/.test(t) || out.preprint ? 'preprint' : 'study';
  if (out.type === 'preprint') out.preprint = true;
  const facts = {};
  ['design', 'sample', 'limitations'].forEach((k) => { const v = ppCap(j[k], 220); if (v) facts[k] = v; });
  if (Object.keys(facts).length) out.facts = facts;
  return out;
}

/**
 * An attached PDF + the paper page open in the tab (typically a DOI / publisher page behind a paywall): does the page describe this PDF?
 * Yes when the page looks like a paper AND its DOI appears in the PDF's opening text or at least half of the words of its title do.
 * Returns { paper, title } (the page's paper metadata) or null. Pure DOM reads.
 */
export function matchPagePaper(pdfText, doc = document, loc = window.location) {
  const p = detectPaper(doc, loc);
  if (!p) return null;
  const meta = (k) => { const m = doc.querySelector('meta[name="' + k + '" i], meta[property="' + k + '" i]'); return m ? (m.getAttribute('content') || '').trim() : ''; };
  const title = ppCap(meta('citation_title') || meta('dc.title') || meta('og:title') || (doc.title || ''), 300);
  const flat = (x) => String(x || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ');
  const head = flat(String(pdfText || '').slice(0, 12000));
  const doiHit = !!p.doi && head.replace(/ /g, '').includes(flat(p.doi).replace(/ /g, ''));
  const words = [...new Set(flat(title).split(' ').filter((w) => w.length > 3))];
  const titleHit = words.length >= 3 && words.filter((w) => head.includes(w)).length / words.length >= 0.5;
  // A page with only weak signals ('likely', e.g. a preprint host) is fine too when its title is in the PDF.
  if (!(doiHit || titleHit || (p.state === 'yes' && words.length < 3))) return null;
  return { paper: p, title };
}
