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
    const title = clip(article && article.title, 140);
    const q = [question && clip(question, 140), title].filter(Boolean).join(' ');
    return 'https://duckduckgo.com/?q=' + encodeURIComponent(q);
}

/** Markdown of a collection: question, then each source with profile, summary and the check answers. Pure. */
export function collectionMarkdown(coll, articles, { label = (k) => k } = {}) {
    const lines = [`# ${coll.name || label('Collection')}`, ''];
    if (coll.question) lines.push(`> ${coll.question}`, '');
    lines.push(`*${new Date().toISOString().split('T')[0]} · ${articles.length} ${label('sources')}*`, '');
    articles.forEach((a, i) => {
        const p = effectiveProfile(a);
        const title = a.title || a.url || label('Untitled');
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

async function patchArticle(articleId, patch) {
    const k = articleRecKey(articleId);
    const cur = (await getL(k))[k];
    if (!cur) return null;
    const next = { ...cur, ...patch };
    await setL({ [k]: next });
    return next;
}

export function saveSourceProfile(articleId, profile) {
    return serial(() => patchArticle(articleId, {
        sourceProfile: {
            type: SOURCE_TYPES.includes(profile.type) ? profile.type : '',
            author: clip(profile.author, 120), date: clip(profile.date, 10), publisher: clip(profile.publisher, 120),
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
