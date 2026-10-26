// modules/mcp/tools.js
// Pure tool handlers for the AISH Local MCP relay (see claude/prd-local-mcp.md).
//
// Nothing here touches chrome.* directly: every handler takes an injected
// `storage.get(keys)` (same shape as chrome.storage.local.get, promisified)
// so this module runs unchanged in the background worker and in plain
// node/jsdom tests. Each handler also receives `scope`/`excludeTag` info so
// callers (client.js) can refuse a call before it reaches here, but every
// handler re-checks its own scope and the exclude tag too — the extension
// is the trust boundary (PRD S5/S6), not the relay.
import { SK, articleRecKey, collRecKey } from '../storageKeys.js';
import { buildIndex, search as rankedSearch } from '../localSearch.js';
import { toArticleJson } from '../articleFormat.js';
import { pageKeyForUrl } from '../pageKey.js';

export class ToolError extends Error {
    constructor(code, message) { super(message); this.code = code; }
}

const MAX_LIMIT = { search_library: 25, list_highlights: 200, list_feed_items: 100 };
const DEFAULT_LIMIT = { search_library: 10, list_highlights: 50, list_feed_items: 30 };

const clip = (s, n) => String(s == null ? '' : s).slice(0, n);
const snippetOf = (article) => {
    const base = article.summaryBase !== undefined ? article.summaryBase : article.summary;
    return clip(String(base || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim(), 280);
};
const inWindow = (iso, since, until) => {
    if (!since && !until) return true;
    const t = new Date(iso).getTime();
    if (isNaN(t)) return false;
    if (since && t < new Date(since).getTime()) return false;
    if (until && t > new Date(until).getTime()) return false;
    return true;
};

/** Saved page HTML → readable plain text: paragraphs kept, tags/scripts/styles and inline data: images dropped. */
export function htmlToPlainText(html) {
    const s = String(html || '');
    if (!/<[a-z!/][^>]*>/i.test(s)) return s.trim();
    return s
        .replace(/<\s*(script|style|noscript|svg)[\s\S]*?<\/\s*\1\s*>/gi, ' ')
        .replace(/<!--[\s\S]*?-->/g, ' ')
        .replace(/<(br|hr)\s*\/?>/gi, '\n')
        .replace(/<\/(p|div|li|h[1-6]|blockquote|tr|section|article|figure|figcaption|pre)>/gi, '\n\n')
        .replace(/<li[^>]*>/gi, '\n- ')
        .replace(/<[^>]+>/g, ' ')
        .replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
        .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n))).replace(/&amp;/g, '&')
        .replace(/[ \t\f\v]+/g, ' ')
        .replace(/ *\n */g, '\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}

/** Whole-word, case-insensitive match ("AI" must not match "MAILAND"). */
function hasWord(text, word) {
    const w = String(word || '').trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (!w) return true;
    return new RegExp(`(^|[^\\p{L}\\p{N}])${w}($|[^\\p{L}\\p{N}])`, 'iu').test(String(text || ''));
}

/** Articles-index entries, minus whatever carries the configured exclude tag. */
async function visibleIndex(storage, excludeTag) {
    const d = await storage.get({ [SK.articlesIndex]: [] });
    const all = Array.isArray(d[SK.articlesIndex]) ? d[SK.articlesIndex] : [];
    if (!excludeTag) return all;
    const tag = String(excludeTag).toLowerCase();
    return all.filter((a) => !(Array.isArray(a.tags) && a.tags.some((t) => String(t).toLowerCase() === tag)));
}

async function articleRecord(storage, id) {
    const k = articleRecKey(id);
    const d = await storage.get(k);
    return d[k] || null;
}

/** Highlights for one article, by page key (highlights are stored keyed by pageKeyForUrl, not article id — see markdownArchive.js). */
async function highlightsFor(storage, article) {
    if (!article || !article.url) return [];
    const d = await storage.get({ [SK.annotations]: [] });
    const all = Array.isArray(d[SK.annotations]) ? d[SK.annotations] : [];
    const key = pageKeyForUrl(article.url);
    return all.filter((h) => h && h.text && !h.dismissed && h.url === key);
}

function toResultRow(article) {
    return {
        aish_id: article.id,
        title: article.title || 'Untitled',
        url: article.url || '',
        site: (() => { try { return new URL(article.url).hostname.replace(/^www\./, ''); } catch (_) { return ''; } })(),
        savedAt: article.timestamp ? new Date(article.timestamp).toISOString() : '',
        tags: Array.isArray(article.tags) ? article.tags : [],
        snippet: snippetOf(article),
    };
}

// ── search_library ──────────────────────────────────────────────────────────
export async function search_library(args, { storage, excludeTag } = {}) {
    const query = String((args && args.query) || '').trim();
    if (!query) throw new ToolError('invalid_params', 'query is required');
    const limit = Math.min(Number(args.limit) || DEFAULT_LIMIT.search_library, MAX_LIMIT.search_library);
    let articles = await visibleIndex(storage, excludeTag);
    if (args.tags && args.tags.length) {
        const want = args.tags.map((t) => String(t).toLowerCase());
        articles = articles.filter((a) => (a.tags || []).some((t) => want.includes(String(t).toLowerCase())));
    }
    if (args.since || args.until) articles = articles.filter((a) => inWindow(a.timestamp, args.since, args.until));
    if (args.collection) {
        const k = collRecKey(args.collection);
        const d = await storage.get(k);
        const rec = d[k];
        const ids = new Set((rec && rec.sources || []).map((s) => s.articleId));
        articles = articles.filter((a) => ids.has(a.id));
    }
    const index = buildIndex(articles);
    const ranked = rankedSearch(index, articles, query, { limit });
    return ranked.map((a, i) => ({ ...toResultRow(a), score: Math.max(0, 1 - i / Math.max(1, ranked.length)) }));
}

// ── get_article ──────────────────────────────────────────────────────────────
export async function get_article(args, { storage, excludeTag } = {}) {
    const id = String((args && args.id) || '');
    if (!id) throw new ToolError('invalid_params', 'id is required');
    const index = await visibleIndex(storage, excludeTag);
    const meta = index.find((a) => a.id === id);
    if (!meta) throw new ToolError('not_found', `No article with id ${id}`);
    const rec = (await articleRecord(storage, id)) || {};
    const article = { ...meta, ...rec };
    const include = Array.isArray(args.include) && args.include.length ? args.include : ['summary', 'highlights'];
    const highlights = include.includes('highlights') ? await highlightsFor(storage, article) : [];
    const json = toArticleJson(article, { highlights, includeBlocks: false });
    if (!include.includes('summary')) delete json.summary;
    if (include.includes('fulltext')) {
        const text = htmlToPlainText(article.content || article.html || article.text || '');
        const cap = 40000;
        json.fulltext = text.slice(0, cap);
        if (text.length > cap) json.truncated = true;
    }
    return json;
}

// ── list_highlights ──────────────────────────────────────────────────────────
export async function list_highlights(args = {}, { storage, excludeTag } = {}) {
    const limit = Math.min(Number(args.limit) || DEFAULT_LIMIT.list_highlights, MAX_LIMIT.list_highlights);
    const index = await visibleIndex(storage, excludeTag);
    const byKey = new Map(index.filter((a) => a.url).map((a) => [pageKeyForUrl(a.url), a]));
    const d = await storage.get({ [SK.annotations]: [] });
    let all = Array.isArray(d[SK.annotations]) ? d[SK.annotations] : [];
    all = all.filter((h) => h && h.text && !h.dismissed && byKey.has(h.url));
    if (args.article) { const a = index.find((x) => x.id === args.article); all = all.filter((h) => a && h.url === pageKeyForUrl(a.url)); }
    if (args.since) all = all.filter((h) => inWindow(h.timestamp, args.since, null));
    if (args.tag) {
        const tag = String(args.tag).toLowerCase();
        all = all.filter((h) => { const a = byKey.get(h.url); return a && (a.tags || []).some((t) => String(t).toLowerCase() === tag); });
    }
    return all
        .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
        .slice(0, limit)
        .map((h) => {
            const a = byKey.get(h.url);
            return { text: h.text, type: h.type === 'ghost' ? 'ghost' : 'user', aish_id: a.id, title: a.title || 'Untitled', url: a.url || '', at: h.timestamp ? new Date(h.timestamp).toISOString() : '' };
        });
}

// ── list_due (saved-for-later / decisions) ──────────────────────────────────
const DECISION_DELAY_MIN = { tomorrow: 24 * 60, weekend: 2 * 24 * 60, week: 7 * 24 * 60 };
export async function list_due(args = {}, { storage, excludeTag } = {}) {
    const withinDays = Number(args.within_days) || 7;
    const horizon = Date.now() + withinDays * 86400000;
    const index = await visibleIndex(storage, excludeTag);
    return index
        .filter((a) => a.isDecision)
        .map((a) => {
            const savedAt = new Date(a.decisionSavedAt || a.timestamp).getTime();
            const delayMin = DECISION_DELAY_MIN[a.decisionTimeframe] || 0;
            const dueAt = delayMin ? savedAt + delayMin * 60000 : null;
            return { aish_id: a.id, title: a.title || 'Untitled', url: a.url || '', timeframe: a.decisionTimeframe || 'research', reason: a.decisionReason || '', dueAt: dueAt ? new Date(dueAt).toISOString() : null, _due: dueAt };
        })
        .filter((d) => d._due == null || d._due <= horizon)
        .sort((a, b) => (a._due || Infinity) - (b._due || Infinity))
        .map(({ _due, ...rest }) => rest);
}

// ── list_collections / get_collection ───────────────────────────────────────
export async function list_collections(_args, { storage } = {}) {
    const d = await storage.get({ [SK.collIndex]: [] });
    const list = Array.isArray(d[SK.collIndex]) ? d[SK.collIndex] : [];
    return list.slice().sort((a, b) => String(b.updated).localeCompare(String(a.updated)))
        .map((c) => ({ id: c.id, name: c.name, question: c.question, n: c.n, updated: c.updated }));
}

export async function get_collection(args, { storage, excludeTag } = {}) {
    const id = String((args && args.id) || '');
    if (!id) throw new ToolError('invalid_params', 'id is required');
    const k = collRecKey(id);
    const d = await storage.get(k);
    const rec = d[k];
    if (!rec || !Array.isArray(rec.sources)) throw new ToolError('not_found', `No collection with id ${id}`);
    const index = await visibleIndex(storage, excludeTag);
    const byId = new Map(index.map((a) => [a.id, a]));
    const sources = rec.sources
        .map((s) => byId.get(s.articleId))
        .filter(Boolean)
        .map((a) => ({ aish_id: a.id, title: a.title || 'Untitled', url: a.url || '', sourceProfile: a.sourceProfile }));
    const out = { name: rec.name, question: rec.question, sources };
    if (rec.overview && rec.overview.text) out.notes = rec.overview.text;
    return out;
}

// ── list_feed_items ──────────────────────────────────────────────────────────
export async function list_feed_items(args = {}, { storage } = {}) {
    const limit = Math.min(Number(args.limit) || DEFAULT_LIMIT.list_feed_items, MAX_LIMIT.list_feed_items);
    const unread = args.unread !== false;
    const d = await storage.get({ [SK.feedItems]: [], [SK.feedSubs]: [] });
    const subs = new Map((Array.isArray(d[SK.feedSubs]) ? d[SK.feedSubs] : []).map((s) => [s.id, s]));
    let items = Array.isArray(d[SK.feedItems]) ? d[SK.feedItems] : [];
    if (unread) items = items.filter((i) => !i.read);
    if (args.since) items = items.filter((i) => inWindow(i.published, args.since, null));
    if (args.topic) {
        items = items.filter((i) => hasWord(`${i.title} ${i.snippet || ''}`, args.topic));
    }
    return items
        .sort((a, b) => Number(b.published) - Number(a.published))
        .slice(0, limit)
        .map((i) => ({ title: i.title || '', url: i.link || '', feed: (subs.get(i.feedId) || {}).title || (subs.get(i.feedId) || {}).customTitle || '', published: i.published ? new Date(Number(i.published)).toISOString() : '', snippet: clip(i.snippet || '', 280) }));
}

// ── save_url (write scope) ───────────────────────────────────────────────────
const SAVE_RATE_LIMIT = 30; // per hour
export async function save_url(args, { storage, setStorage, now = Date.now() } = {}) {
    const url = String((args && args.url) || '').trim();
    if (!/^https?:\/\//i.test(url)) throw new ToolError('invalid_params', 'url must be http(s)');
    if (url.length > 2048) throw new ToolError('invalid_params', 'url too long');
    const note = clip(args.note, 500);
    if (args.remind_at && isNaN(new Date(args.remind_at).getTime())) throw new ToolError('invalid_params', 'remind_at must be an ISO date');

    const d = await storage.get({ [SK.inboxPending]: [] });
    const pending = Array.isArray(d[SK.inboxPending]) ? d[SK.inboxPending] : [];
    const hourAgo = now - 3600000;
    const recentFromAi = pending.filter((p) => p.platform === 'mcp' && new Date(p.receivedAt || 0).getTime() >= hourAgo).length;
    if (recentFromAi >= SAVE_RATE_LIMIT) throw new ToolError('rate_limited', 'Too many saves from AI apps in the last hour');

    const id = 'mcp_' + now.toString(36) + Math.random().toString(36).slice(2, 8);
    const nowIso = new Date(now).toISOString();
    const item = {
        id,
        url,
        description: note,
        tags: Array.isArray(args.tags) ? args.tags.map((t) => String(t).slice(0, 40)).slice(0, 10) : [],
        remindAt: args.remind_at || null,
        platform: 'mcp',          // shown in the UI as "Added by AI app" (PRD S7)
        sentAt: nowIso,
        receivedAt: nowIso,
    };
    pending.push(item);
    await setStorage({ [SK.inboxPending]: pending });
    return { ok: true, where: 'inbox' };
}

// ── library_stats (counts only, never article text: the raw material for a "Wrapped") ──────
const DAY = 86400000;
const dayKey = (t) => new Date(t).toISOString().slice(0, 10);
const monthKey = (t) => new Date(t).toISOString().slice(0, 7);
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const LANG_TAG = /^🌐\s*([a-z]{2,3})$/i;
function topN(counts, n, key = 'name') {
    return [...counts.entries()].sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0]))).slice(0, n).map(([k, v]) => ({ [key]: k, n: v }));
}
const bump = (m, k, by = 1) => { if (k != null && k !== '') m.set(k, (m.get(k) || 0) + by); };
const round = (x, d = 2) => Math.round(x * 10 ** d) / 10 ** d;

export async function library_stats(args = {}, { storage, excludeTag, now = Date.now() } = {}) {
    let since = args.since ? new Date(args.since).getTime() : null;
    let until = args.until ? new Date(args.until).getTime() : null;
    if (args.year) { since = Date.UTC(Number(args.year), 0, 1); until = Date.UTC(Number(args.year) + 1, 0, 1) - 1; }
    if (since != null && isNaN(since)) throw new ToolError('invalid_params', 'since must be an ISO date');
    if (until != null && isNaN(until)) throw new ToolError('invalid_params', 'until must be an ISO date');
    const inRange = (t) => { const x = new Date(t).getTime(); return !isNaN(x) && (since == null || x >= since) && (until == null || x <= until); };

    const all = await visibleIndex(storage, excludeTag);
    const arts = all.filter((a) => inRange(a.timestamp));
    const perMonth = new Map(), perDay = new Map(), weekday = new Array(7).fill(0), hours = new Array(24).fill(0);
    const tags = new Map(), langs = new Map(), sites = new Map(), models = new Map(), moodMonth = new Map();
    let words = 0, favorites = 0, reopened = 0, moodSum = 0, moodN = 0, saveLater = 0;
    for (const a of arts) {
        const t = new Date(a.timestamp).getTime();
        bump(perMonth, monthKey(t)); bump(perDay, dayKey(t));
        weekday[new Date(t).getUTCDay()]++; hours[new Date(t).getUTCHours()]++;
        for (const tag of (a.tags || [])) { const m = LANG_TAG.exec(String(tag)); if (m) bump(langs, m[1].toLowerCase()); else bump(tags, String(tag)); }
        try { bump(sites, new URL(a.url).hostname.replace(/^www\./, '')); } catch (_) { /* no url */ }
        if (a.modelId) bump(models, String(a.modelId));
        words += Number(a.contentWordCount) || 0;
        if (a.favorite) favorites++;
        if (a.isDecision) saveLater++;
        if (a.lastOpened && new Date(a.lastOpened).getTime() - t > 3600000) reopened++;
        if (typeof a.moodScore === 'number' && isFinite(a.moodScore)) {
            moodSum += a.moodScore; moodN++;
            const mk = monthKey(t); const cur = moodMonth.get(mk) || [0, 0]; moodMonth.set(mk, [cur[0] + a.moodScore, cur[1] + 1]);
        }
    }
    // longest run of consecutive days with at least one save
    const days = [...perDay.keys()].sort();
    let streak = 0, best = 0, bestEnd = null, prev = null;
    for (const d of days) { streak = prev && (Date.parse(d) - Date.parse(prev) === DAY) ? streak + 1 : 1; if (streak > best) { best = streak; bestEnd = d; } prev = d; }
    const busiestDay = topN(perDay, 1, 'date')[0] || null;
    const byTime = arts.slice().sort((x, y) => new Date(x.timestamp) - new Date(y.timestamp));
    const ref = (a) => a && { aish_id: a.id, title: a.title || 'Untitled', url: a.url || '', savedAt: new Date(a.timestamp).toISOString() };

    // highlights in range, attributed to visible articles
    const byKey = new Map(all.filter((a) => a.url).map((a) => [pageKeyForUrl(a.url), a]));
    const d = await storage.get({ [SK.annotations]: [], [SK.collIndex]: [], [SK.feedSubs]: [] });
    const hls = (Array.isArray(d[SK.annotations]) ? d[SK.annotations] : []).filter((h) => h && h.text && !h.dismissed && byKey.has(h.url) && inRange(h.timestamp));
    const hlMonth = new Map(), hlArticle = new Map();
    let userHl = 0;
    for (const h of hls) { bump(hlMonth, monthKey(h.timestamp)); bump(hlArticle, h.url); if (h.type !== 'ghost') userHl++; }
    const mostHighlighted = topN(hlArticle, 5, 'key').map(({ key, n }) => ({ ...ref(byKey.get(key)), highlights: n }));

    return {
        range: { since: since != null ? new Date(since).toISOString() : (byTime[0] ? new Date(byTime[0].timestamp).toISOString() : null), until: new Date(until != null ? Math.min(until, now) : now).toISOString() },
        articles: {
            total: arts.length,
            perMonth: Object.fromEntries([...perMonth.entries()].sort()),
            busiestMonth: topN(perMonth, 1, 'month')[0] || null,
            busiestDay,
            byWeekday: Object.fromEntries(WEEKDAYS.map((w, i) => [w, weekday[i]])),
            byHourUtc: hours,
            longestStreak: best ? { days: best, ending: bestEnd } : null,
            activeDays: perDay.size,
            favorites, savedForLater: saveLater,
            reopened, neverReopened: arts.length - reopened,
            wordsSummarized: words,
            first: ref(byTime[0]), latest: ref(byTime[byTime.length - 1]),
        },
        topTags: topN(tags, 15, 'tag'),
        languages: topN(langs, 10, 'lang'),
        topSites: topN(sites, 10, 'site'),
        models: topN(models, 5, 'model'),
        mood: moodN ? { average: round(moodSum / moodN), scale: '-1 (negative) … +1 (positive)', perMonth: Object.fromEntries([...moodMonth.entries()].sort().map(([k, [s, n]]) => [k, round(s / n)])) } : null,
        highlights: { total: hls.length, yours: userHl, ai: hls.length - userHl, perMonth: Object.fromEntries([...hlMonth.entries()].sort()), mostHighlighted },
        collections: (Array.isArray(d[SK.collIndex]) ? d[SK.collIndex] : []).length,
        feedSubscriptions: (Array.isArray(d[SK.feedSubs]) ? d[SK.feedSubs] : []).length,
    };
}

export const TOOLS = { search_library, get_article, list_highlights, list_due, list_collections, get_collection, list_feed_items, save_url, library_stats };

/** Which scope (PRD §4.1/§5 S5) a tool needs. */
export const TOOL_SCOPE = {
    search_library: 'library', get_article: 'library', list_highlights: 'library', list_due: 'library',
    list_collections: 'library', get_collection: 'library', list_feed_items: 'feeds', save_url: 'write', library_stats: 'library',
};

/** Thrown before a handler runs when its scope is off (S5: the extension enforces this, not the relay). */
export function requireScope(tool, args, scopes) {
    const need = TOOL_SCOPE[tool];
    if (!need || !(scopes && scopes[need])) throw new ToolError('scope_denied', `Scope "${need}" is not enabled`);
    if (tool === 'get_article' && Array.isArray(args && args.include) && args.include.includes('fulltext') && !(scopes && scopes.fulltext)) {
        throw new ToolError('scope_denied', 'Scope "fulltext" is not enabled');
    }
}
