// collections.js — a collection bundles saved articles under one question ("Sammlung").
//
// Sources are REFERENCES (article ids), never copies. The per-source facts that belong to the article itself, not to a
// collection (profile: type/author/date/publisher; the lateral-reading answers), live on the article record
// (articles:rec:<id> → sourceProfile / sourceCheck), so an answer given in the article detail shows in every collection
// holding it, and the other way round.
//
// Storage: coll:index = [{id, name, question, n, updated}] for lists; coll:rec:<id> = {id, name, question, created, updated,
// sources:[{articleId, addedAt}]}. Writes go through one queue: two quick adds never overwrite each other.
import { SK, collRecKey, articleRecKey } from './storageKeys.js';
import { paperState, paperType } from './paperInfo.js';
import { withArticleLock } from './articleLock.js';

export const MAX_SOURCES = 15;
export const MAX_NAME = 80;
export const MAX_QUESTION = 300;

// ── pure helpers ────────────────────────────────────────────────────────────

/** Source kinds the reader can assign. Order is the order in the picker. */
export const SOURCE_TYPES = ['primary', 'secondary', 'peer', 'preprint', 'news', 'opinion', 'official', 'other'];

/** The four questions of the lateral-reading check (SIFT-style). */
export const CHECK_QUESTIONS = ['who', 'others', 'origin', 'missing'];

const clip = (v, n) => String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, n);

/** Collection name/question normalised: trimmed, single-spaced, capped. */
export function cleanCollection({ name, question } = {}) {
    return { name: clip(name, MAX_NAME), question: clip(question, MAX_QUESTION) };
}

const hostOf = (url) => { try { return new URL(url).hostname.replace(/^www\./, ''); } catch (_) { return ''; } };

/** First guess for a source's profile from what the archive knows; the reader can change every field. */
export function deriveProfile(article) {
    const a = article || {};
    const meta = a.meta || {};
    const pt = paperState(a) ? paperType(a) : '';
    let type = '';
    if (pt === 'preprint') type = 'preprint';
    else if (pt) type = 'peer';
    const date = String(meta.published || meta.date || a.published || a.timestamp || '').slice(0, 10);
    return {
        type,
        author: clip(meta.author || (meta.paper && meta.paper.authors) || a.author || '', 120),
        date: /^\d{4}(-\d{2}(-\d{2})?)?$/.test(date) ? date : '',
        publisher: clip(meta.siteName || meta.publisher || hostOf(a.url), 120),
    };
}

/** Title to show for a source: the original title the reader (or the DOI lookup) saved, else the article's own title. Pure. */
export function displayTitle(article) {
    const a = article || {};
    const t = a.sourceProfile && String(a.sourceProfile.title || '').trim();
    return t || a.title || a.url || '';
}

/**
 * Merges a DOI-derived profile into the saved one: only fields the reader has not filled are taken. Returns the new saved profile
 * (with fromDoi: true) or null when there is nothing to add. Pure.
 */
export function mergeDoiProfile(saved, fromCsl) {
    const mine = saved || {};
    const out = { type: mine.type || '', author: mine.author || '', date: mine.date || '', publisher: mine.publisher || '', title: mine.title || '', fromDoi: true };
    let changed = !mine.fromDoi;
    for (const k of ['type', 'author', 'date', 'publisher', 'title']) if (!out[k] && fromCsl && fromCsl[k]) { out[k] = fromCsl[k]; changed = true; }
    return changed ? out : null;
}

/** Profile fields from a CSL record (doi.org). Journal articles count as peer-reviewed, 'posted-content' as preprint; other types stay open. Pure. */
export function profileFromCsl(csl) {
    const c = csl || {};
    const names = (Array.isArray(c.author) ? c.author : []).map(a => a.literal || [a.given, a.family].filter(Boolean).join(' ')).filter(Boolean);
    const author = names.length > 3 ? names.slice(0, 3).join(', ') + ' et al.' : names.join(', ');
    const type = c.type === 'journal-article' || c.type === 'paper-conference' ? 'peer' : c.type === 'posted-content' ? 'preprint' : '';
    return { title: c.title || '', author, date: /^\d{4}$/.test(c.year || '') ? c.year : '', publisher: c.container || c.publisher || '', type };
}

/** The saved profile (reader's edits win) over the derived one. */
export function effectiveProfile(article) {
    const base = deriveProfile(article);
    const mine = (article && article.sourceProfile) || {};
    const out = { ...base };
    for (const k of ['type', 'author', 'date', 'publisher']) if (mine[k] !== undefined && mine[k] !== null && String(mine[k]) !== '') out[k] = String(mine[k]);
    if (mine.type === '') out.type = '';
    return out;
}

/**
 * Hints, not ratings: facts the reader may want to weigh. Returns ids; the UI words them.
 * 'no_author' · 'old' (older than 5 years) · 'preprint' (not peer reviewed) · 'no_date'
 */
export function profileHints(profile, now = Date.now()) {
    const p = profile || {};
    const out = [];
    if (!p.author) out.push('no_author');
    if (!p.date) out.push('no_date');
    else {
        const y = Number(String(p.date).slice(0, 4));
        const nowY = new Date(now).getUTCFullYear();
        if (y && nowY - y >= 5) out.push('old');
    }
    if (p.type === 'preprint') out.push('preprint');
    return out;
}

/** Answered questions of a check (blank answers do not count). */
export function checkProgress(check) {
    const c = check || {};
    const n = CHECK_QUESTIONS.filter(q => clip(c[q], 2000)).length;
    return { answered: n, total: CHECK_QUESTIONS.length, done: n === CHECK_QUESTIONS.length };
}

/** Plain text search address for "find other sources about this" — the reader opens it; nothing is sent from here. */
export function otherSourcesQuery(article, question = '') {
    const title = clip(displayTitle(article).replace(/^[^\p{L}\p{N}]+/u, ''), 140);   // the source's own title (not the AI headline), without a leading emoji
    const q = [question && clip(question, 140), title].filter(Boolean).join(' ');
    return 'https://duckduckgo.com/?q=' + encodeURIComponent(q);
}

/** Markdown of a collection: question, then each source with profile, summary and the check answers. Pure. */
export function collectionMarkdown(coll, articles, { label = (k) => k } = {}) {
    const lines = [`# ${coll.name || label('Collection')}`, ''];
    if (coll.question) lines.push(`> ${coll.question}`, '');
    lines.push(`*${new Date().toISOString().split('T')[0]} · ${articles.length} ${label('sources')}*`, '');
    if (coll.overview && coll.overview.text) {
        lines.push(`## ${label('Overview')}`, '');
        parseOverview(coll.overview.text).forEach(s => {
            if (s.key) lines.push(`**${label('ov_' + s.key)}**`, '');
            lines.push(s.body, '');
        });
        lines.push(`*${label('From summaries, not checked against the full texts.')}*`, '');
    }
    articles.forEach((a, i) => {
        const p = effectiveProfile(a);
        const title = displayTitle(a) || label('Untitled');
        lines.push(`## ${i + 1}. ${a.url ? `[${title}](${a.url})` : title}`, '');
        const facts = [p.type && `${label('Type')}: ${label('type_' + p.type)}`, p.author && `${label('Author')}: ${p.author}`, p.date && `${label('Date')}: ${p.date}`, p.publisher && `${label('Publisher')}: ${p.publisher}`].filter(Boolean);
        if (facts.length) lines.push(facts.join(' · '), '');
        const hints = profileHints(p).map(h => label('hint_' + h));
        if (hints.length) lines.push(`*${hints.join(' · ')}*`, '');
        const base = a.summaryBase !== undefined ? a.summaryBase : a.summary;
        const sum = String(base || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
        if (sum) lines.push(sum, '');
        const c = a.sourceCheck || {};
        const answered = CHECK_QUESTIONS.filter(q => clip(c[q], 2000));
        if (answered.length) {
            lines.push(`**${label('Source check')}**`, '');
            answered.forEach(q => lines.push(`- ${label('q_' + q)}: ${clip(c[q], 2000)}`));
            lines.push('');
        }
    });
    return lines.join('\n').trimEnd() + '\n';
}

// ── storage (local) ─────────────────────────────────────────────────────────

const local = () => chrome.storage.local;
const getL = (keys) => new Promise(r => local().get(keys, r));
const setL = (obj) => new Promise(r => local().set(obj, r));
const removeL = (keys) => new Promise(r => local().remove(keys, r));

let queue = Promise.resolve();
/** Runs `fn` after every earlier write has finished; a failing write does not block the next. */
const serial = (fn) => { const run = queue.then(fn, fn); queue = run.catch(() => {}); return run; };

const newId = () => 'c_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const indexEntry = (rec) => ({ id: rec.id, name: rec.name, question: rec.question, n: rec.sources.length, updated: rec.updated });

/** Stores the AI overview on the collection: { text, at, ids (item [n] = ids[n-1]), used }. Cleared with `null`. */
export function saveOverview(collId, overview) {
    return serial(async () => {
        const rec = await getCollection(collId);
        if (!rec) return null;
        if (overview) rec.overview = { text: String(overview.text || '').slice(0, 6000), at: overview.at || new Date().toISOString(), ids: (overview.ids || []).slice(0, MAX_SOURCES), used: Number(overview.used) || 0 };
        else delete rec.overview;
        return save(rec);
    });
}

/** The three sections of an overview text: [{ key: 'agree'|'disagree'|'missing', body }]. Unparsable text → one section with key ''. Pure. */
export function parseOverview(text) {
    const out = [];
    const re = /^\s*#{1,3}\s*(agree|disagree|missing)\b[^\n]*$/gim;
    const marks = [...String(text || '').matchAll(re)];
    marks.forEach((m, i) => {
        const end = i + 1 < marks.length ? marks[i + 1].index : String(text).length;
        out.push({ key: m[1].toLowerCase(), body: String(text).slice(m.index + m[0].length, end).trim() });
    });
    return out.length ? out : [{ key: '', body: String(text || '').trim() }];
}

const STOP = new Set('about after also and are been before between both but can could did does for from had has have into its more most not only other over some such than that the their then there these they this those through very was were what when which while who will with would your und der die das ein eine ist nicht mit von zu den dem des auf für als auch sich wie'.split(' '));
const words = (s) => String(s || '').toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(w => w.length >= 4 && !STOP.has(w));

/**
 * Orders saved articles by how well they fit a collection: words shared with the FIRST source's title weigh most, then the
 * collection's name and question, the other sources' titles, and shared tags. Returns [{ a, score }] best first; ties keep the
 * given order (newest first). `sources` = the collection's articles in their order. Pure.
 */
export function rankCandidates(candidates, coll, sources = []) {
    const first = new Set(words(sources[0] && displayTitle(sources[0])));
    const own = new Set([...words(coll && coll.name), ...words(coll && coll.question)]);
    const rest = new Set(sources.slice(1).flatMap(s => words(displayTitle(s))));
    const tags = new Set(sources.flatMap(s => (Array.isArray(s.tags) ? s.tags : [])).map(t => String(t).toLowerCase()));
    return (candidates || []).map((a, i) => {
        const w = new Set(words(a.title));
        let score = 0;
        w.forEach(x => { if (first.has(x)) score += 3; if (own.has(x)) score += 2; if (rest.has(x)) score += 1.5; });
        (Array.isArray(a.tags) ? a.tags : []).forEach(t => { if (tags.has(String(t).toLowerCase())) score += 2; });
        return { a, score, i };
    }).sort((x, y) => y.score - x.score || x.i - y.i).map(({ a, score }) => ({ a, score }));
}

/** Local counters (no content, never sent): how the feature is used. `bumpStat('overview')` adds 1. */
export function bumpStat(name) {
    return serial(async () => {
        const d = await getL({ [SK.collStats]: {} });
        const s = d[SK.collStats] && typeof d[SK.collStats] === 'object' ? d[SK.collStats] : {};
        s[name] = (Number(s[name]) || 0) + 1;
        await setL({ [SK.collStats]: s });
        return s[name];
    });
}
export async function getStats() {
    const d = await getL({ [SK.collStats]: {} });
    return d[SK.collStats] && typeof d[SK.collStats] === 'object' ? { ...d[SK.collStats] } : {};
}

/**
 * Worksheet for teaching (lateral reading): the question, the method in three lines, then per source empty fields for the
 * profile and the four questions. Markdown, no answers filled in. `label(key)` translates. Pure.
 */
export function collectionWorksheet(coll, articles, { label = (k) => k } = {}) {
    const L = [`# ${label('Worksheet')}: ${coll.name || label('Collection')}`, ''];
    if (coll.question) L.push(`> ${coll.question}`, '');
    L.push(`**${label('Task')}:** ${label('Check each source before you trust it. Do not stay on the page: search for who is behind it and what others say.')}`, '');
    L.push(`1. ${label('q_who')}`, `2. ${label('q_others')}`, `3. ${label('q_origin')}`, `4. ${label('q_missing')}`, '');
    articles.forEach((a, i) => {
        L.push(`## ${i + 1}. ${displayTitle(a) || label('Untitled')}`, '');
        if (a.url) L.push(a.url, '');
        L.push(`- ${label('Type')}: ______  ${label('Author')}: ______  ${label('Date')}: ______  ${label('Publisher')}: ______`, '');
        CHECK_QUESTIONS.forEach(q => L.push(`**${label('q_' + q)}**`, '', '______________________________________________', ''));
    });
    L.push(`*${label('Hints, not ratings: you decide how far to trust this source.')}*`);
    return L.join('\n') + '\n';
}

export async function listCollections() {
    const d = await getL({ [SK.collIndex]: [] });
    const list = Array.isArray(d[SK.collIndex]) ? d[SK.collIndex] : [];
    return list.slice().sort((a, b) => String(b.updated).localeCompare(String(a.updated)));
}

export async function getCollection(id) {
    const k = collRecKey(id);
    const d = await getL(k);
    const r = d[k];
    return r && Array.isArray(r.sources) ? r : null;
}

async function save(rec) {
    rec.updated = new Date().toISOString();
    const d = await getL({ [SK.collIndex]: [] });
    const idx = (Array.isArray(d[SK.collIndex]) ? d[SK.collIndex] : []).filter(e => e.id !== rec.id);
    idx.push(indexEntry(rec));
    await setL({ [collRecKey(rec.id)]: rec, [SK.collIndex]: idx });
    return rec;
}

export function createCollection(input) {
    return serial(async () => {
        const c = cleanCollection(input);
        if (!c.name) throw new Error('A collection needs a name.');
        const now = new Date().toISOString();
        return save({ id: newId(), name: c.name, question: c.question, created: now, updated: now, sources: [] });
    });
}

export function updateCollection(id, patch) {
    return serial(async () => {
        const rec = await getCollection(id);
        if (!rec) return null;
        const c = cleanCollection({ name: patch.name !== undefined ? patch.name : rec.name, question: patch.question !== undefined ? patch.question : rec.question });
        if (!c.name) throw new Error('A collection needs a name.');
        rec.name = c.name; rec.question = c.question;
        return save(rec);
    });
}

export function deleteCollection(id) {
    return serial(async () => {
        const d = await getL({ [SK.collIndex]: [], [SK.lastCollection]: '' });
        await setL({ [SK.collIndex]: (d[SK.collIndex] || []).filter(e => e.id !== id) });
        await removeL(collRecKey(id));
        if (d[SK.lastCollection] === id) await removeL(SK.lastCollection);
    });
}

/** Adds an article to a collection. Returns { ok, reason?: 'full'|'missing' , added: boolean }. Also remembers it as the last used. */
export function addSource(collId, articleId) {
    return serial(async () => {
        const rec = await getCollection(collId);
        if (!rec) return { ok: false, reason: 'missing' };
        if (rec.sources.some(s => s.articleId === articleId)) { await setL({ [SK.lastCollection]: collId }); return { ok: true, added: false }; }
        if (rec.sources.length >= MAX_SOURCES) return { ok: false, reason: 'full' };
        rec.sources.push({ articleId, addedAt: new Date().toISOString() });
        await save(rec);
        await setL({ [SK.lastCollection]: collId });
        return { ok: true, added: true };
    });
}

export function removeSource(collId, articleId) {
    return serial(async () => {
        const rec = await getCollection(collId);
        if (!rec) return false;
        rec.sources = rec.sources.filter(s => s.articleId !== articleId);
        await save(rec);
        return true;
    });
}

/** An article was deleted: it leaves every collection (no dead references). */
export function removeArticleFromCollections(articleId) {
    return serial(async () => {
        const d = await getL({ [SK.collIndex]: [] });
        const idx = Array.isArray(d[SK.collIndex]) ? d[SK.collIndex] : [];
        for (const e of idx) {
            const k = collRecKey(e.id);
            const r = (await getL(k))[k];
            if (r && Array.isArray(r.sources) && r.sources.some(s => s.articleId === articleId)) {
                r.sources = r.sources.filter(s => s.articleId !== articleId);
                await save(r);
            }
        }
    });
}

/** All articles were deleted: collections stay (name and question), their source lists empty. */
export function clearCollectionSources() {
    return serial(async () => {
        const d = await getL({ [SK.collIndex]: [] });
        for (const e of (d[SK.collIndex] || [])) {
            const r = (await getL(collRecKey(e.id)))[collRecKey(e.id)];
            if (r && r.sources && r.sources.length) { r.sources = []; await save(r); }
        }
    });
}

/** Collections that hold this article: [{id, name}] (reads the records, so the index cannot be stale). */
export async function collectionsOfArticle(articleId) {
    const idx = await listCollections();
    if (!idx.length) return [];
    const recs = await getL(idx.map(e => collRecKey(e.id)));
    return idx.filter(e => { const r = recs[collRecKey(e.id)]; return r && r.sources && r.sources.some(s => s.articleId === articleId); }).map(e => ({ id: e.id, name: e.name }));
}

export async function lastCollectionId() {
    const d = await getL({ [SK.lastCollection]: '' });
    return String(d[SK.lastCollection] || '');
}

// ── per-article source facts (stored on the article record) ──

function patchArticle(articleId, patch) {
    // the record is also rewritten by StorageManager (conversation, paper info): take the same lock
    return withArticleLock(async () => {
        const k = articleRecKey(articleId);
        const cur = (await getL(k))[k];
        if (!cur) return null;
        const next = { ...cur, ...patch };
        await setL({ [k]: next });
        return next;
    });
}

export function saveSourceProfile(articleId, profile) {
    return serial(() => patchArticle(articleId, {
        sourceProfile: {
            type: SOURCE_TYPES.includes(profile.type) ? profile.type : '',
            author: clip(profile.author, 120), date: clip(profile.date, 10), publisher: clip(profile.publisher, 120),
            fromDoi: !!profile.fromDoi,        // filled from the DOI record once; later fills never overwrite what the reader wrote
            title: clip(profile.title, 300),   // the ORIGINAL title of the source (an article's own title is often the AI summary's headline)
        },
    }));
}

export function saveSourceCheck(articleId, answers) {
    const check = {};
    for (const q of CHECK_QUESTIONS) check[q] = String((answers && answers[q]) || '').slice(0, 2000);
    return serial(() => patchArticle(articleId, { sourceCheck: { ...check, at: new Date().toISOString() } }));
}

/** Full records of the articles in a collection, in collection order (missing ones are skipped). */
export async function collectionArticles(rec) {
    const keys = rec.sources.map(s => articleRecKey(s.articleId));
    const d = await getL({ ...Object.fromEntries(keys.map(k => [k, null])), [SK.articlesIndex]: [] });
    const idx = new Map((d[SK.articlesIndex] || []).map(a => [a.id, a]));
    return rec.sources.map(s => {
        const meta = idx.get(s.articleId);
        if (!meta) return null;
        return { ...meta, ...(d[articleRecKey(s.articleId)] || {}) };
    }).filter(Boolean);
}
