// feedManager.js
// Small RSS/Atom reader built for fast triage. Feeds + items live in their own
// chrome.storage.local keys (feedSubs / feedItems) and are deliberately NOT mixed
// into the article archive: an item only reaches History once the user actually
// summarizes (or favorites) it.
//
// Network access goes through the background page (`fetchFeedText`) so it works
// in every context (popup, native side panel, hybrid iframe on Firefox where
// the iframe has no privileged fetch). XML parsing happens here because
// DOMParser isn't available in the MV3 service worker.
//
// Screen model (see Figma "Feeds UX sprint"):
//   control bar  = source pill (opens source picker) + refresh + add (opens sheet)
//   chip row     = status (Unread / All / ★ / ✓) + date & mood sheet
//   list         = day groups with a scoped "Mark read" and an undo bar
//   Settings > Feeds = subscriptions (rename / tags / mute / remove), OPML, behavior

import StorageManager from './storageManager.js';
import { normalizeUrl } from './textUtils.js';
import { itemMood, MOOD_EMOJI } from './feedSentiment.js';
import { play as playAudio, initPlayer, isPlaying, formatDuration } from './feedPlayer.js';
import { T, TN, TU, N_, locale } from './feedI18n.js';
import { buildIndex, search as indexSearch } from './localSearch.js';
import { renderInsights } from './feedInsights.js';
import { generateRecap, generateRecapUpdate, itemSig, scoreItems, MAX_RECAP_ITEMS } from './feedAi.js';

const SUBS_KEY = 'feedSubs';
const ITEMS_KEY = 'feedItems';
const UI_KEY = 'feedUi';
const SETTINGS_KEY = 'feedSettings';
const RECAPS_KEY = 'feedRecaps';
// Items are kept until the retention window (Settings > Feeds) runs out; favorites are kept longer.
// These are only safety nets so storage can't grow without bound.
const MAX_ITEMS_PER_FEED = 1500;
const MAX_ITEMS_TOTAL = 6000;
const PAGE_SIZE = 100;          // cards rendered at once; "Show more" adds another page
const CONCURRENCY = 4;
const COMMON_FEED_PATHS = ['/feed', '/rss', '/atom.xml', '/feed.xml', '/rss.xml', '/index.xml'];
const DAY_MS = 86400000;

export const FEED_DEFAULTS = {
    markReadOnOpen: true,
    rateWithRecap: true,
    autoSummarizeFavs: false,
    backgroundPoll: false,
    refreshMinutes: 30,
    keepDays: 30
};

let subs = [];
let items = [];
let recaps = {};
let settings = { ...FEED_DEFAULTS };
// UI filter state (persisted so the screen reopens the way you left it)
let ui = { source: 'all', status: 'all', date: 'any', mood: 'any', sort: 'new' };
const DEFAULT_STATUS = 'all';
let refreshing = false;
let els = {};
let uiRef = null;
let undoTimer = null;
let shown = PAGE_SIZE;
// Items read by opening/tapping stay in the Unread view (dimmed) until the view changes,
// so the list doesn't jump under your finger.
const stickyRead = new Set();
let searchQuery = '';          // free-text search over the items (TF-IDF, same engine as History)
let view = 'list';             // 'list' | 'graph' | 'insights'
let searchCache = null;        // { ref, len, rated, idx, byStamp, stampOf }
// normalized URL -> { fav: boolean, summarized: boolean } built from the History index
let historyByUrl = new Map();

// ── Storage ────────────────────────────────────────────────────────────────
async function load() {
    const data = await chrome.storage.local.get({
        [SUBS_KEY]: [], [ITEMS_KEY]: [], [UI_KEY]: null, [SETTINGS_KEY]: null, [RECAPS_KEY]: {}
    });
    recaps = data[RECAPS_KEY] || {};
    subs = data[SUBS_KEY] || [];
    items = data[ITEMS_KEY] || [];
    settings = { ...FEED_DEFAULTS, ...(data[SETTINGS_KEY] || {}) };
    if (data[UI_KEY]) ui = { ...ui, ...data[UI_KEY] };
    // Folders became tags: each feed's folder turns into its first tag.
    subs.forEach(s => {
        if ('folder' in s) { s.tags = cleanTags([...(s.tags || []), s.folder]); delete s.folder; }
        if (!Array.isArray(s.tags)) s.tags = [];
    });
    if (typeof ui.source === 'string' && ui.source.startsWith('folder:')) ui.source = 'tag:' + ui.source.slice(7);
    // Older builds scored mood on-device; only AI scores are kept now.
    items.forEach(i => { if (!i.ai) delete i.sent; });
    // A filter pointing at a source that no longer exists falls back to "all".
    if (!sourceExists(ui.source)) ui.source = 'all';
}

function persist() {
    return chrome.storage.local.set({ [SUBS_KEY]: subs, [ITEMS_KEY]: items });
}
function persistUi() { stickyRead.clear(); shown = PAGE_SIZE; return chrome.storage.local.set({ [UI_KEY]: ui }).catch(() => {}); }
function persistSettings() { return chrome.storage.local.set({ [SETTINGS_KEY]: settings }).catch(() => {}); }

// ── Tags (a feed can have several) ─────────────────────────────────────────
const tagKey = (t) => String(t || '').trim().toLowerCase();
function cleanTags(list) {
    const seen = new Set(), out = [];
    (Array.isArray(list) ? list : String(list || '').split(',')).forEach(t => {
        const v = String(t || '').replace(/^\/+/, '').replace(/[#,]/g, '').replace(/\s+/g, ' ').trim().slice(0, 24);
        if (v && !seen.has(tagKey(v))) { seen.add(tagKey(v)); out.push(v); }
    });
    return out;
}
const hasTag = (s, t) => (s.tags || []).some(x => tagKey(x) === tagKey(t));
function allTags() {
    const m = new Map();
    subs.forEach(s => (s.tags || []).forEach(t => { if (!m.has(tagKey(t))) m.set(tagKey(t), t); }));
    return [...m.values()].sort((a, b) => a.localeCompare(b));
}

function sourceExists(src) {
    if (!src || src === 'all') return true;
    const [kind, val] = splitSource(src);
    if (kind === 'sub') return subs.some(s => s.id === val);
    if (kind === 'tag') return subs.some(s => hasTag(s, val));
    return false;
}
function splitSource(src) {
    const i = src.indexOf(':');
    return i < 0 ? [src, ''] : [src.slice(0, i), src.slice(i + 1)];
}

async function loadHistoryMap() {
    const { articlesIndex = [] } = await StorageManager.getLocal({ articlesIndex: [] });
    const map = new Map();
    for (const a of articlesIndex) {
        if (!a.url) continue;
        const key = normalizeUrl(a.url);
        const cur = map.get(key) || { fav: false, summarized: false };
        if (a.favorite) cur.fav = true;
        if (!a.feedStub) cur.summarized = true;
        map.set(key, cur);
    }
    historyByUrl = map;
}
function histOf(item) { return historyByUrl.get(normalizeUrl(item.link)) || { fav: false, summarized: false }; }

// A favorited-but-never-summarized item lives in History as a "stub". Once the
// page has been summarized for real, the stub's star moves to the real entry
// and the stub is removed so History doesn't show the page twice.
export async function reconcileStubs() {
    const { articlesIndex = [] } = await StorageManager.getLocal({ articlesIndex: [] });
    const stubs = articlesIndex.filter(a => a.feedStub && a.url);
    if (!stubs.length) return;
    const drop = new Set();
    for (const stub of stubs) {
        const key = normalizeUrl(stub.url);
        const real = articlesIndex.filter(a => !a.feedStub && a.url && normalizeUrl(a.url) === key);
        if (!real.length) continue;
        if (stub.favorite) real.forEach(r => { r.favorite = true; });
        drop.add(stub.id);
    }
    if (!drop.size) return;
    const next = articlesIndex.filter(a => !drop.has(a.id));
    await StorageManager.setLocal({ articlesIndex: next });
    await new Promise(res => chrome.storage.local.remove([...drop].map(id => `article:${id}`), res));
}

// Find the real (non-stub) History entry for a feed item's URL.
async function findSummarizedArticle(url) {
    const key = normalizeUrl(url);
    const { articlesIndex = [] } = await StorageManager.getLocal({ articlesIndex: [] });
    const real = articlesIndex.filter(a => !a.feedStub && a.url && normalizeUrl(a.url) === key);
    real.sort((a, b) => String(b.timestamp).localeCompare(String(a.timestamp)));
    return real[0] || null;
}

async function viewSummary(item, article) {
    if (settings.markReadOnOpen) setRead([item], true, { silent: true, keep: true });
    if (!uiRef) return;
    uiRef.showScreen('history');
    const mod = await import('./articleManager.js');
    setTimeout(() => mod.showArticleDetail(article), 400);
}

// Card click: summarized → its History entry, otherwise the website.
async function onCardClick(item) {
    const art = await findSummarizedArticle(item.link);
    if (art) viewSummary(item, art); else openItem(item, false);
}

async function toggleFavorite(item) {
    const key = normalizeUrl(item.link);
    const { articlesIndex = [] } = await StorageManager.getLocal({ articlesIndex: [] });
    const matches = articlesIndex.filter(a => a.url && normalizeUrl(a.url) === key);
    const isFav = matches.some(a => a.favorite);
    let createdStub = false;

    if (!isFav) {
        if (matches.length) {
            matches.forEach(a => { a.favorite = true; });
            await StorageManager.setLocal({ articlesIndex });
        } else {
            const feedName = subTitle(subs.find(x => x.id === item.feedId) || {});
            await StorageManager.saveArticle({
                content: '',
                summary: '',
                url: item.link,
                title: item.title,
                description: item.snippet || '',
                tags: ['feed'],
                extra: { favorite: true, feedStub: true, fromFeed: feedName, lastOpened: new Date().toISOString() }
            });
            createdStub = true;
        }
    } else {
        const removeIds = [];
        matches.forEach(a => { a.favorite = false; if (a.feedStub) removeIds.push(a.id); });
        const next = articlesIndex.filter(a => !removeIds.includes(a.id));
        await StorageManager.setLocal({ articlesIndex: next });
        if (removeIds.length) await new Promise(res => chrome.storage.local.remove(removeIds.map(id => `article:${id}`), res));
    }
    await loadHistoryMap();
    render();
    // Optional: favorites summarize themselves in a background tab (always
    // extension mode so nothing steals focus).
    if (createdStub && settings.autoSummarizeFavs) {
        chrome.runtime.sendMessage({ action: 'openFeedItem', url: item.link, summarize: true, forceExtension: true }, () => void chrome.runtime.lastError);
    }
}

function subTitle(s) { return (s && (s.customTitle || s.title || s.url)) || ''; }

// ── Helpers ────────────────────────────────────────────────────────────────
function hash(str) {
    let h = 5381;
    for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) | 0;
    return (h >>> 0).toString(36);
}

function safeHttpUrl(value, base) {
    try {
        const u = new URL(value, base);
        return (u.protocol === 'http:' || u.protocol === 'https:') ? u.href : null;
    } catch (e) {
        return null;
    }
}

function normalizeInputUrl(raw) {
    let v = (raw || '').trim();
    if (!v) return null;
    if (!/^[a-z][a-z0-9+.-]*:/i.test(v)) v = 'https://' + v;
    return safeHttpUrl(v);
}

function timeAgo(ts) {
    if (!ts) return '';
    const s = Math.max(0, (Date.now() - ts) / 1000);
    if (s < 3600) return T('{n}m', { n: Math.max(1, Math.round(s / 60)) });
    if (s < 86400) return T('{n}h', { n: Math.round(s / 3600) });
    if (s < 86400 * 30) return T('{n}d', { n: Math.round(s / 86400) });
    return new Date(ts).toLocaleDateString(locale(), { month: 'short', day: 'numeric' });
}

function htmlToText(html) {
    if (!html) return '';
    const doc = new DOMParser().parseFromString(html, 'text/html');
    return (doc.body.textContent || '').replace(/\s+/g, ' ').trim();
}

function toast(ui, msg) {
    if (ui && ui.showToast) ui.showToast(msg);
}

// ── Network (via background) ───────────────────────────────────────────────
function fetchText(url) {
    return new Promise((resolve, reject) => {
        chrome.runtime.sendMessage({ action: 'fetchFeedText', url }, (res) => {
            if (chrome.runtime.lastError) {
                const m = chrome.runtime.lastError.message || '';
                // Nobody answered: the background worker is an older build that
                // doesn't know about feeds yet — the extension needs a reload.
                return reject(new Error(/port closed|Receiving end/i.test(m)
                    ? T('Background script is outdated — reload the extension at chrome://extensions')
                    : m));
            }
            if (!res || !res.ok) return reject(new Error((res && res.error) || T('Request failed')));
            resolve(res);
        });
    });
}

// ── Parsing ────────────────────────────────────────────────────────────────
function textOf(parent, selector) {
    const el = parent.querySelector(selector);
    return el ? (el.textContent || '').trim() : '';
}

// Namespace-agnostic child lookup (e.g. content:encoded, dc:date).
function childByLocalName(parent, name) {
    for (const c of parent.children) {
        if (c.localName === name) return (c.textContent || '').trim();
    }
    return '';
}

const AUDIO_EXT = /\.(mp3|m4a|aac|ogg|oga|opus|wav|flac)(\?|#|$)/i;
function parseDuration(v) {
    if (!v) return 0;
    const parts = String(v).trim().split(':').map(Number);
    if (parts.some(n => !Number.isFinite(n))) return 0;
    return parts.reduce((t, n) => t * 60 + n, 0);
}
function enclosureOf(e, feedUrl) {
    for (const c of e.children) {
        if (c.localName !== 'enclosure' && !(c.localName === 'link' && c.getAttribute('rel') === 'enclosure')) continue;
        const type = (c.getAttribute('type') || '').toLowerCase();
        const href = c.getAttribute('url') || c.getAttribute('href');
        if (!href) continue;
        if (type.startsWith('audio/') || (!type.startsWith('video/') && AUDIO_EXT.test(href))) {
            const url = safeHttpUrl(href, feedUrl);
            if (url) return url;
        }
    }
    return '';
}

function imageOf(node, base) {
    for (const c of node.children) {
        const n = c.localName;
        if ((n === 'image' || n === 'thumbnail') && (c.getAttribute('href') || c.getAttribute('url'))) {
            const u = safeHttpUrl(c.getAttribute('href') || c.getAttribute('url'), base);
            if (u) return u;
        }
        if (n === 'image') {            // <image><url>…</url></image>
            const u = safeHttpUrl(childByLocalName(c, 'url'), base);
            if (u) return u;
        }
    }
    return '';
}

/** @returns {{title:string, siteUrl:string, items:Array}|null} */
function parseFeed(xmlText, feedUrl) {
    const doc = new DOMParser().parseFromString(xmlText, 'text/xml');
    if (doc.querySelector('parsererror')) return null;
    const root = doc.documentElement;
    if (!root) return null;
    const rootName = root.localName.toLowerCase();

    if (rootName === 'feed') {                       // Atom
        const title = childByLocalName(root, 'title');
        let siteUrl = '';
        for (const l of root.children) {
            if (l.localName === 'link' && (!l.getAttribute('rel') || l.getAttribute('rel') === 'alternate')) {
                siteUrl = safeHttpUrl(l.getAttribute('href'), feedUrl) || siteUrl;
            }
        }
        const out = [];
        for (const e of root.children) {
            if (e.localName !== 'entry') continue;
            let link = '';
            for (const l of e.children) {
                if (l.localName !== 'link') continue;
                const rel = l.getAttribute('rel');
                if (!rel || rel === 'alternate') { link = safeHttpUrl(l.getAttribute('href'), feedUrl) || link; }
            }
            const when = childByLocalName(e, 'published') || childByLocalName(e, 'updated');
            out.push({
                guid: childByLocalName(e, 'id') || link,
                title: htmlToText(childByLocalName(e, 'title')),
                link,
                published: Date.parse(when) || 0,
                snippet: htmlToText(childByLocalName(e, 'summary') || childByLocalName(e, 'content')).slice(0, 220),
                audio: enclosureOf(e, feedUrl),
                dur: parseDuration(childByLocalName(e, 'duration'))
            });
        }
        return { title, siteUrl, image: '', items: out };
    }

    if (rootName === 'rss' || rootName === 'rdf') {  // RSS 2.0 / RSS 1.0
        const channel = root.querySelector('channel') || root;
        const title = childByLocalName(channel, 'title');
        const siteUrl = safeHttpUrl(childByLocalName(channel, 'link'), feedUrl) || '';
        const nodes = [...doc.getElementsByTagName('item')];
        const out = nodes.map(e => {
            const link = safeHttpUrl(childByLocalName(e, 'link'), feedUrl) || '';
            const when = childByLocalName(e, 'pubDate') || childByLocalName(e, 'date');
            return {
                guid: childByLocalName(e, 'guid') || link,
                title: htmlToText(childByLocalName(e, 'title')),
                link,
                published: Date.parse(when) || 0,
                snippet: htmlToText(childByLocalName(e, 'description') || childByLocalName(e, 'encoded')).slice(0, 220),
                audio: enclosureOf(e, feedUrl),
                dur: parseDuration(childByLocalName(e, 'duration')),
                img: imageOf(e, feedUrl)
            };
        });
        return { title, siteUrl, image: imageOf(channel, feedUrl), items: out };
    }
    return null;
}

/** Given a site or feed URL, find an actual feed. */
async function resolveFeed(inputUrl) {
    const first = await fetchText(inputUrl);
    let parsed = parseFeed(first.text, first.url);
    if (parsed) return { feedUrl: first.url, parsed };

    // Not a feed — treat as HTML and look for <link rel="alternate">.
    const html = new DOMParser().parseFromString(first.text, 'text/html');
    const candidates = [];
    html.querySelectorAll('link[rel~="alternate"]').forEach(l => {
        const type = (l.getAttribute('type') || '').toLowerCase();
        if (/rss|atom|xml/.test(type)) {
            const href = safeHttpUrl(l.getAttribute('href'), first.url);
            if (href) candidates.push(href);
        }
    });
    const origin = new URL(first.url).origin;
    COMMON_FEED_PATHS.forEach(p => candidates.push(origin + p));

    for (const c of [...new Set(candidates)]) {
        try {
            const res = await fetchText(c);
            parsed = parseFeed(res.text, res.url);
            if (parsed) return { feedUrl: res.url, parsed };
        } catch (e) { /* try next */ }
    }
    throw new Error(T('No feed found at that address'));
}

// ── Merge + refresh ────────────────────────────────────────────────────────
function mergeItems(sub, parsedItems) {
    const existing = new Map(items.filter(i => i.feedId === sub.id).map(i => [i.id, i]));
    const merged = [];
    for (const p of parsedItems) {
        if (!p.title || (!p.link && !p.audio)) continue;
        if (!p.link) p.link = p.audio;
        const id = hash(sub.id + '|' + (p.guid || p.link));
        const prev = existing.get(id);
        merged.push({
            id,
            feedId: sub.id,
            title: p.title,
            link: p.link,
            published: p.published || (prev && prev.published) || Date.now(),
            snippet: p.snippet,
            audio: p.audio || '',
            dur: p.dur || 0,
            img: p.img || '',
            sent: prev && prev.ai ? prev.sent : undefined,
            ai: !!(prev && prev.ai),
            cat: prev && prev.cat ? prev.cat : undefined,
            read: prev ? prev.read : false
        });
    }
    // Keep newest N for this feed, plus older items we already had (so read state survives short feeds).
    const seen = new Set(merged.map(m => m.id));
    existing.forEach((v, k) => { if (!seen.has(k)) merged.push(v); });
    merged.sort((a, b) => b.published - a.published);
    // Keep everything we have (retention prunes by age); only favorites survive the safety cap.
    const kept = merged.length > MAX_ITEMS_PER_FEED
        ? merged.filter((i, k) => k < MAX_ITEMS_PER_FEED || histOf(i).fav)
        : merged;
    items = items.filter(i => i.feedId !== sub.id).concat(kept);
}

// Drop items older than the retention window (favorites are kept; they also
// live in History).
function pruneItems() {
    const cutoff = Date.now() - settings.keepDays * DAY_MS;
    items = items.filter(i => i.published >= cutoff || histOf(i).fav);
    // Recaps follow the same retention window (key starts with the day's timestamp).
    Object.keys(recaps).forEach(k => { if (Number(k.split('|')[0]) < startOfDay(cutoff)) delete recaps[k]; });
    chrome.storage.local.set({ [RECAPS_KEY]: recaps }).catch(() => {});
}

async function refreshSub(sub) {
    try {
        const res = await fetchText(sub.url);
        const parsed = parseFeed(res.text, res.url);
        if (!parsed) throw new Error(T('Not a valid feed'));
        if (!sub.customTitle && parsed.title) sub.title = parsed.title;
        if (parsed.siteUrl) sub.siteUrl = parsed.siteUrl;
        if (parsed.image) sub.image = parsed.image;
        mergeItems(sub, parsed.items);
        sub.lastFetched = Date.now();
        sub.error = '';
    } catch (e) {
        sub.error = e.message || T('Failed');
        sub.lastFetched = Date.now();
    }
}

async function refreshAll(uiObj, { force = false } = {}) {
    if (refreshing) return;
    const staleMs = settings.refreshMinutes * 60 * 1000;
    const due = subs.filter(s => force || !s.lastFetched || Date.now() - s.lastFetched > staleMs);
    if (!due.length) return;
    refreshing = true;
    setRefreshState(true);
    try {
        const queue = [...due];
        const worker = async () => {
            while (queue.length) await refreshSub(queue.shift());
        };
        await Promise.all(Array.from({ length: Math.min(CONCURRENCY, due.length) }, worker));
        items.sort((a, b) => b.published - a.published);
        pruneItems();
        if (items.length > MAX_ITEMS_TOTAL) items = items.filter((i, k) => k < MAX_ITEMS_TOTAL || histOf(i).fav);
        await persist();
    } finally {
        refreshing = false;
        setRefreshState(false);
        render();
        renderFeedSettings();
    }
    const failed = subs.filter(s => s.error).length;
    if (force && failed) toast(uiObj, TN(failed, '{n} feed could not be loaded', '{n} feeds could not be loaded'));
}

// ── Add / remove / import / export ─────────────────────────────────────────
async function addFeed(uiObj, rawUrl, inputEl, tags = []) {
    const url = normalizeInputUrl(rawUrl);
    if (!url) return toast(uiObj, T('Enter a valid web address'));
    setBusy(true);
    try {
        const { feedUrl, parsed } = await resolveFeed(url);
        if (subs.some(s => s.url === feedUrl)) {
            toast(uiObj, T('Already subscribed'));
            return;
        }
        const sub = {
            id: hash(feedUrl),
            url: feedUrl,
            title: parsed.title || new URL(feedUrl).hostname,
            siteUrl: parsed.siteUrl || '',
            tags: cleanTags(tags),
            addedAt: Date.now(),
            lastFetched: Date.now(),
            error: ''
        };
        subs.push(sub);
        mergeItems(sub, parsed.items);
        items.sort((a, b) => b.published - a.published);
        await persist();
        if (inputEl) inputEl.value = '';
        closeSheet();
        toast(uiObj, T('Subscribed to {name}', { name: subTitle(sub) }));
        render();
        renderFeedSettings();
    } catch (e) {
        toast(uiObj, e.message || T('Could not add feed'));
    } finally {
        setBusy(false);
    }
}

async function removeFeed(id) {
    subs = subs.filter(s => s.id !== id);
    items = items.filter(i => i.feedId !== id);
    if (ui.source === 'sub:' + id) ui.source = 'all';
    await persist();
    render();
    renderFeedSettings();
}

async function importOpml(uiObj, file) {
    try {
        const text = await file.text();
        const doc = new DOMParser().parseFromString(text, 'text/xml');
        if (doc.querySelector('parsererror')) throw new Error(T('Not a valid OPML file'));
        let added = 0;
        const addOutline = (o, folder) => {
            const own = cleanTags(String(o.getAttribute('category') || '').split(','));
            const url = safeHttpUrl(o.getAttribute('xmlUrl') || o.getAttribute('xmlurl'));
            if (!url || subs.some(s => s.url === url)) return;
            subs.push({
                id: hash(url),
                url,
                title: o.getAttribute('title') || o.getAttribute('text') || new URL(url).hostname,
                siteUrl: safeHttpUrl(o.getAttribute('htmlUrl')) || '',
                tags: cleanTags([...(folder ? [folder] : []), ...own]),
                addedAt: Date.now(),
                lastFetched: 0,
                error: ''
            });
            added++;
        };
        // A top-level outline without xmlUrl is a folder: its feeds get the folder name as a tag.
        // OPML `category` attributes (comma-separated) become tags too.
        const body = doc.querySelector('body');
        const top = body ? [...body.children].filter(n => n.localName === 'outline') : [];
        for (const o of top) {
            if (o.getAttribute('xmlUrl') || o.getAttribute('xmlurl')) { addOutline(o, ''); continue; }
            const folder = (o.getAttribute('title') || o.getAttribute('text') || '').trim();
            o.querySelectorAll('outline[xmlUrl], outline[xmlurl]').forEach(c => addOutline(c, folder));
        }
        await persist();
        toast(uiObj, added ? TN(added, 'Imported {n} feed', 'Imported {n} feeds') : T('No new feeds in that file'));
        closeSheet();
        render();
        renderFeedSettings();
        if (added) refreshAll(uiObj, { force: false });
    } catch (e) {
        toast(uiObj, e.message || T('Import failed'));
    }
}

function escXml(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
function exportOpml() {
    const line = (s, ind) => `${ind}<outline type="rss" text="${escXml(subTitle(s))}" title="${escXml(subTitle(s))}" xmlUrl="${escXml(s.url)}"${s.siteUrl ? ` htmlUrl="${escXml(s.siteUrl)}"` : ''}${(s.tags || []).length ? ` category="${escXml(s.tags.join(','))}"` : ''}/>`;
    // Readers without tags get the first tag as a folder; all tags also go in `category`.
    const first = (s) => (s.tags || [])[0] || '';
    const folders = [...new Set(subs.map(first).filter(Boolean))].sort();
    const out = ['<?xml version="1.0" encoding="UTF-8"?>', '<opml version="2.0">', '  <head><title>AI Summary Helper feeds</title></head>', '  <body>'];
    subs.filter(s => !first(s)).forEach(s => out.push(line(s, '    ')));
    folders.forEach(f => {
        out.push(`    <outline text="${escXml(f)}" title="${escXml(f)}">`);
        subs.filter(s => first(s) === f).forEach(s => out.push(line(s, '      ')));
        out.push('    </outline>');
    });
    out.push('  </body>', '</opml>');
    const blob = new Blob([out.join('\n')], { type: 'text/x-opml' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'ai-summary-helper-feeds.opml';
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
}

// ── Read state (with undo) ─────────────────────────────────────────────────
async function setRead(list, read, { silent = false, label = '', keep = false } = {}) {
    const prev = new Map();
    list.forEach(i => { if (i.read !== read) { prev.set(i.id, i.read); i.read = read; } if (keep && read) stickyRead.add(i.id); else stickyRead.delete(i.id); });
    if (!prev.size) return;
    await persist();
    render();
    if (!silent) {
        showUndo(label || (read ? T('Marked {n} read', { n: prev.size }) : T('Marked {n} unread', { n: prev.size })), async () => {
            items.forEach(i => { if (prev.has(i.id)) i.read = prev.get(i.id); });
            await persist();
            render();
        });
    }
}

function showUndo(msg, restore) {
    const bar = document.getElementById('feedUndo');
    if (!bar) return;
    document.getElementById('feedUndoMsg').textContent = msg;
    const btn = document.getElementById('feedUndoBtn');
    btn.onclick = async () => { hideUndo(); await restore(); };
    bar.hidden = false;
    clearTimeout(undoTimer);
    undoTimer = setTimeout(hideUndo, 6000);
}
function hideUndo() {
    clearTimeout(undoTimer);
    const bar = document.getElementById('feedUndo');
    if (bar) bar.hidden = true;
}

// ── Item actions ───────────────────────────────────────────────────────────
async function onSummarizeClick(item) {
    const art = await findSummarizedArticle(item.link);
    if (art) return viewSummary(item, art);
    openItem(item, true);
}

function openItem(item, summarize) {
    if (settings.markReadOnOpen) setRead([item], true, { silent: true, keep: true });
    chrome.runtime.sendMessage({ action: 'openFeedItem', url: item.link, summarize }, (res) => {
        if (chrome.runtime.lastError) return;
        if (summarize && res && res.mode === 'extension') {
            toast(uiRef, res.reused
                ? T('Summarizing the open tab — it will show up under Summarize and History')
                : T('Summarizing in the background — it will show up under Summarize and History'));
        }
    });
}

// ── Filtering ──────────────────────────────────────────────────────────────
function startOfDay(ts) { const d = new Date(ts); d.setHours(0, 0, 0, 0); return d.getTime(); }
function subMap() { return new Map(subs.map(s => [s.id, s])); }

function inSource(i, sm, source = ui.source) {
    const s = sm.get(i.feedId);
    if (!s) return false;
    const [kind, val] = splitSource(source);
    if (kind === 'sub') return i.feedId === val;
    if (kind === 'tag') return hasTag(s, val) && !s.muted;
    return !s.muted;
}

// ui.date: 'any' | 'today' | '7d' | { from, to } (start-of-day timestamps, both inclusive)
function isDayRange(d) { return d && typeof d === 'object' && Number.isFinite(d.from) && Number.isFinite(d.to); }
function isOneDay(d) { return isDayRange(d) && d.from === d.to; }
function inDateFilter(i) {
    const d = ui.date;
    if (d === 'today') return i.published >= startOfDay(Date.now());
    if (d === '7d') return i.published >= Date.now() - 7 * DAY_MS;
    if (isDayRange(d)) return i.published >= d.from && i.published < startOfDay(d.to + DAY_MS * 1.5);
    return true;
}
const fmtDayShort = (ts) => new Date(ts).toLocaleDateString(locale(), { weekday: 'short', day: 'numeric', month: 'short' });
const fmtDayNoWeek = (ts) => new Date(ts).toLocaleDateString(locale(), { day: 'numeric', month: 'short' });
function dateText(d = ui.date) {
    if (d === 'today') return T('Today');
    if (d === '7d') return T('7 days');
    if (isOneDay(d)) return fmtDayShort(d.from);
    if (isDayRange(d)) return `${fmtDayNoWeek(d.from)} – ${fmtDayNoWeek(d.to)}`;
    return '';
}
const filtersActive = () => ui.date !== 'any' || ui.mood !== 'any' || ui.sort !== 'new';

function passes(i, sm, skipDate = false) {
    if (!inSource(i, sm)) return false;
    const h = histOf(i);
    if (ui.status === 'unread' && i.read && !stickyRead.has(i.id)) return false;
    if (ui.status === 'fav' && !h.fav) return false;
    if (ui.status === 'sum' && !h.summarized) return false;
    if (ui.status === 'audio' && !i.audio) return false;
    if (!skipDate && !inDateFilter(i)) return false;
    const mood = itemMood(i) || 'neu';
    if (ui.mood === 'pos' && mood !== 'pos') return false;
    if (ui.mood === 'nonneg' && mood === 'neg') return false;
    return true;
}

// Items as "articles" so the History search index and graph can be reused (unique numeric timestamp per item).
function toArticle(item, stamp, sm) {
    const s = sm.get(item.feedId);
    const tags = [];
    if (item.cat) tags.push(item.cat);
    if (s) tags.push(subTitle(s), ...(s.tags || []));
    if (item.audio) tags.push('🎧');
    return { timestamp: stamp, title: item.title, summary: item.snippet || '', description: '', tags, url: item.link, _item: item };
}
function feedIndex() {
    const rated = items.reduce((n, i) => n + (i.cat ? 1 : 0), 0);
    if (searchCache && searchCache.ref === items && searchCache.len === items.length && searchCache.rated === rated) return searchCache;
    const sm = subMap(); const used = new Set(); const stampOf = new Map(); const arts = [];
    for (const i of items) {
        let st = Math.floor(i.published) || 0; while (used.has(st)) st++;
        used.add(st); stampOf.set(i.id, st); arts.push(toArticle(i, st, sm));
    }
    searchCache = { ref: items, len: items.length, rated, idx: buildIndex(arts), arts, stampOf };
    return searchCache;
}
function applySearch(list) {
    const q = searchQuery.trim();
    if (!q || !list.length) return list;
    const c = feedIndex();
    const byId = new Map(c.arts.map(a => [a._item.id, a]));
    const arts = list.map(i => byId.get(i.id)).filter(Boolean);
    return indexSearch(c.idx, arts, q, { limit: 1000 }).map(a => a._item);
}

function visibleItems() {
    const sm = subMap();
    const list = items.filter(i => passes(i, sm));
    if (ui.sort === 'mood') list.sort((a, b) => (itemMood(b) ? b.sent : -2) - (itemMood(a) ? a.sent : -2) || b.published - a.published);
    else list.sort((a, b) => b.published - a.published);
    return searchQuery.trim() ? applySearch(list) : list;
}

function unreadCount(pred) { return items.filter(i => !i.read && pred(i)).length; }

function dayLabel(ts) {
    const diff = Math.round((startOfDay(Date.now()) - startOfDay(ts)) / DAY_MS);
    if (diff <= 0) return T('Today');
    if (diff === 1) return T('Yesterday');
    if (diff < 7) return new Date(ts).toLocaleDateString(locale(), { weekday: 'long' });
    return new Date(ts).toLocaleDateString(locale(), { month: 'short', day: 'numeric' });
}

function filterChipLabel() {
    const parts = [];
    if (ui.date !== 'any') parts.push(dateText());
    if (ui.mood === 'pos') parts.push('😊'); else if (ui.mood === 'nonneg') parts.push(T('No 😟'));
    if (ui.sort === 'mood') parts.push(T('Mood ↓'));
    return (parts.join(' · ') || T('Date & mood')) + ' ▾';
}

// ── Rendering ──────────────────────────────────────────────────────────────
function setBusy(busy) {
    document.querySelectorAll('[data-feed-add]').forEach(b => { b.disabled = busy; });
}

function setRefreshState(on) {
    if (els.refreshBtn) { els.refreshBtn.disabled = on; els.refreshBtn.classList.toggle('spinning', on); }
}

function el(tag, className, text) {
    const n = document.createElement(tag);
    if (className) n.className = className;
    if (text != null) n.textContent = text;
    return n;
}

function btn(className, text, onClick, title) {
    const b = el('button', className, text);
    b.type = 'button';
    if (title) { b.title = title; b.setAttribute('aria-label', title); }
    if (onClick) b.addEventListener('click', onClick);
    return b;
}

function sourceLabel() {
    const [kind, val] = splitSource(ui.source);
    if (kind === 'sub') { const s = subs.find(x => x.id === val); return '📰  ' + (s ? subTitle(s) : T('Source')); }
    if (kind === 'tag') return '🏷️  ' + val;
    return T('📰  All sources');
}

function renderControls() {
    const sm = subMap();
    const hasSubs = subs.length > 0;
    if (els.controls) els.controls.hidden = !hasSubs;
    if (!hasSubs) return;
    els.sourceLabel.textContent = sourceLabel();
    const [kind, val] = splitSource(ui.source);
    const scoped = i => {
        const s = sm.get(i.feedId);
        if (!s) return false;
        if (kind === 'sub') return i.feedId === val;
        if (kind === 'tag') return hasTag(s, val) && !s.muted;
        return !s.muted;
    };
    const unread = unreadCount(scoped);
    els.sourceCount.textContent = unread ? String(unread) : '';
    els.chipRow.querySelectorAll('[data-status]').forEach(b => {
        const on = b.dataset.status === ui.status;
        b.classList.toggle('active', on);
        b.setAttribute('aria-pressed', String(on));
        if (b.dataset.status === 'unread') b.textContent = unread ? T('Unread · {n}', { n: unread }) : T('Unread');
    });
    els.filterChip.textContent = filterChipLabel();
    els.filterChip.classList.toggle('active', filtersActive());
}

// Starter suggestions (shown on first run and in the Add sheet). Feeds are only
// requested after a click.
const SUGGESTED_FEEDS = [
    { name: 'Street Phil-osophy', tags: ['Podcast', 'Design', 'Independent'], note: N_('Podcast by the author · design, life & tech'), url: 'https://philwornath.com/api/podcast.xml', icon: '🎧' },
    { name: 'BBC News', tags: ['News'], note: N_('World news'), url: 'https://feeds.bbci.co.uk/news/rss.xml', icon: '🌍' },
    { name: 'DW', tags: ['News'], note: N_('Deutsche Welle · international news'), url: 'https://rss.dw.com/rdf/rss-en-all', icon: '📡' },
    { name: 'Al Jazeera', tags: ['News'], note: N_('World news'), url: 'https://www.aljazeera.com/xml/rss/all.xml', icon: '🗞️' },
    { name: 'ProPublica', tags: ['Independent', 'News'], note: N_('Independent investigative journalism'), url: 'https://www.propublica.org/feeds/propublica/main', icon: '🔎' },
    { name: '404 Media', tags: ['Independent', 'Tech'], note: N_('Independent tech journalism'), url: 'https://www.404media.co/rss/', icon: '💾' },
    { name: 'The Markup', tags: ['Independent', 'Tech'], note: N_('Independent tech accountability'), url: 'https://themarkup.org/feeds/rss.xml', icon: '🔬' }
];

function suggestionsNode() {
    const have = new Set(subs.map(x => x.url));
    const list = SUGGESTED_FEEDS.filter(f => !have.has(f.url));
    if (!list.length) return null;
    const wrap = el('div', 'feed-suggest');
    wrap.append(el('div', 'feed-pick-label', TU('Suggested')));
    list.forEach(f => {
        const b = el('button', 'feed-suggest-row');
        b.type = 'button';
        b.append(el('span', 'feed-suggest-icon', f.icon),
            (() => { const t = el('span', 'feed-suggest-text'); t.append(el('span', 'feed-suggest-name', f.name), el('span', 'feed-suggest-note', T(f.note))); return t; })(),
            el('span', 'feed-suggest-add', '＋'));
        b.addEventListener('click', () => { closeSheet(); addFeed(uiRef, f.url, null, f.tags); });
        wrap.append(b);
    });
    return wrap;
}

function renderFirstRun() {
    const box = els.empty;
    box.replaceChildren();
    box.className = 'feed-firstrun';
    box.style.display = 'flex';
    box.append(el('div', 'feed-firstrun-icon', '📰'), el('h3', null, T('Follow the sites you read')),
        el('p', null, T('New posts land here. Skim, summarize what matters, clear the rest.')));
    const row = el('div', 'feed-add-row');
    const input = el('input');
    input.type = 'text'; input.placeholder = T('Site or feed address…'); input.autocomplete = 'off'; input.spellcheck = false;
    const add = btn('button-primary feed-btn', T('Add'), () => addFeed(uiRef, input.value, input));
    add.setAttribute('data-feed-add', '');
    input.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); addFeed(uiRef, input.value, input); } });
    row.append(input, add);
    box.append(row, btn('button-secondary feed-wide-btn', T('＋  Use current site'), useCurrentSite),
        btn('button-secondary feed-wide-btn', T('📥  Import OPML file'), () => els.opmlInput.click()),
        el('p', 'feed-muted', T('Your feeds stay on this device.')));
    const sg = suggestionsNode();
    if (sg) box.append(sg);
}

function renderEmptyFiltered(hasAny) {
    const box = els.empty;
    box.replaceChildren();
    box.className = 'explanatory-card feed-emptycard';
    box.style.display = 'block';
    if (refreshing && !hasAny) { box.textContent = T('Loading…'); return; }
    const unreadMode = ui.status === 'unread' && ui.source === 'all' && ui.date === 'any' && ui.mood === 'any';
    box.append(el('p', null, unreadMode ? T('You’re all caught up. 🎉') : T('Nothing matches these filters.')));
    box.append(btn('button-secondary feed-btn', unreadMode ? T('Show all items') : T('Clear filters'), () => {
        ui = { source: 'all', status: unreadMode ? 'all' : DEFAULT_STATUS, date: 'any', mood: 'any', sort: 'new' };
        persistUi(); render();
    }));
}

// ── Search, graph and insights ──────────────────────────────────────────────
const GRAPH_MAX = 150;
let graphSig = '', graphToken = 0;

function setSearch(term, nextView = 'list') {
    searchQuery = term || '';
    if (els.search) els.search.value = searchQuery;
    view = nextView; shown = PAGE_SIZE; render();
}
function setView(v) { view = view === v ? 'list' : v; render(); }
function syncViewButtons() {
    [[els.graphBtn, 'graph'], [els.insightsBtn, 'insights']].forEach(([b, v]) => {
        if (!b) return;
        b.classList.toggle('active', view === v);
        b.setAttribute('aria-pressed', String(view === v));
    });
}

function renderAltView() {
    els.list.hidden = true; els.empty.style.display = 'none';
    if (els.graph) els.graph.hidden = view !== 'graph';
    if (els.insights) els.insights.hidden = view !== 'insights';
    if (view === 'graph') renderGraphView(); else renderInsightsView();
}

async function renderGraphView() {
    const box = els.graph; if (!box) return;
    const all = visibleItems();
    const sig = [items.length, all.length, all[0] && all[0].id, ui.source, ui.status, JSON.stringify(ui.date), ui.mood, searchQuery].join('|');
    if (sig === graphSig && box.childElementCount) return;
    graphSig = sig;
    if (!all.length) { box.replaceChildren(el('p', 'feed-muted feed-ins-empty', T('Nothing matches these filters.'))); return; }
    const c = feedIndex(); const byId = new Map(c.arts.map(a => [a._item.id, a]));
    const arts = all.slice(0, GRAPH_MAX).map(i => byId.get(i.id)).filter(Boolean);
    const token = ++graphToken;
    box.replaceChildren(el('p', 'feed-muted feed-ins-empty', T('Loading…')));
    try {
        const mod = await import('./archiveGraph.js');
        if (token !== graphToken || view !== 'graph') { graphSig = ''; return; }
        mod.initArchiveGraph(box, arts, undefined, c.idx);
    } catch (e) { graphSig = ''; box.replaceChildren(el('p', 'feed-muted feed-ins-empty', T('Failed'))); }
}

function renderInsightsView() {
    const box = els.insights; if (!box) return;
    const sm = subMap();
    renderInsights(box, {
        items: items.filter(i => inSource(i, sm)),
        scopeLabel: sourceLabel(),
        subTitle: (id) => subTitle(sm.get(id)),
        isSummarized: (i) => histOf(i).summarized,
        onSource: (id) => { ui.source = 'sub:' + id; persistUi(); render(); },
        onSearch: (term) => setSearch(term, 'list')
    });
}

function initSearchAndViews() {
    if (els.search) {
        let t = null;
        els.search.addEventListener('input', () => {
            clearTimeout(t);
            t = setTimeout(() => { searchQuery = els.search.value; shown = PAGE_SIZE; if (view === 'insights') view = 'list'; render(); }, 150);
        });
        els.search.addEventListener('keydown', (e) => { if (e.key === 'Escape') { els.search.value = ''; searchQuery = ''; render(); } });
    }
    if (els.graphBtn) els.graphBtn.addEventListener('click', () => setView('graph'));
    if (els.insightsBtn) els.insightsBtn.addEventListener('click', () => setView('insights'));
    if (els.graph) {
        // Tag nodes → search for that tag; article nodes → open the item (the preview card's button says "Open in History").
        els.graph.addEventListener('filter-by-tag', (e) => { if (e.detail && e.detail.tag) setSearch(e.detail.tag, 'list'); });
        els.graph.addEventListener('open-article', (e) => { const it = e.detail && e.detail._item; if (it) openItem(it, false); });
        if (typeof MutationObserver !== 'undefined') new MutationObserver(() => {
            const b = els.graph.querySelector('.graph-preview-open');
            if (b && !b.dataset.feed) { b.dataset.feed = '1'; b.textContent = T('Open ↗'); }
        }).observe(els.graph, { childList: true, subtree: true });
    }
}

// Same behaviour as the History screen: scrolling down hides the top bar, scrolling up (from anywhere) brings it back.
function initScrollHide() {
    const sc = els.screen, bar = els.controlsBar;
    if (!sc || !bar) return;
    let last = 0;
    sc.addEventListener('scroll', () => {
        const top = Math.max(0, sc.scrollTop), d = top - last;
        if (top <= 8 || d < -4) bar.classList.remove('scroll-hidden');
        else if (d > 6) bar.classList.add('scroll-hidden');
        last = top;
    }, { passive: true });
}

function renderCard(item, sm) {
    const hist = histOf(item);
    const mood = itemMood(item);
    const li = el('li', 'article-card feed-item' + (item.read ? ' is-read' : '') + (hist.fav ? ' is-favorite' : ''));
    if (mood && mood !== 'neu') {
        // subtle tint: red/orange for heavy news through green for good news, stronger with the score
        const sc = item.sent, a = Math.min(1, Math.abs(sc));
        const hue = sc >= 0 ? 95 + sc * 45 : 5 + (1 + sc) * 30;
        li.classList.add('has-mood');
        li.style.setProperty('--mood-tint', `hsla(${Math.round(hue)}, 75%, 48%, ${(0.07 + 0.10 * a).toFixed(3)})`);
        li.style.setProperty('--mood-bar', `hsla(${Math.round(hue)}, 70%, 46%, ${(0.55 + 0.35 * a).toFixed(2)})`);
    }
    const meta = el('p', 'article-date', `${subTitle(sm.get(item.feedId))} · ${timeAgo(item.published)}`);
    if (item.cat) { const c = el('span', 'feed-cat', item.cat); c.title = T('AI category'); meta.append(' · ', c); }
    if (item.audio) meta.append(el('span', 'feed-dur', ` · 🎧${item.dur ? ' ' + formatDuration(item.dur) : ''}`));
    if (MOOD_EMOJI[mood]) {
        const m = el('span', 'feed-mood', ' ' + MOOD_EMOJI[mood]);
        m.title = mood === 'pos' ? T('AI-rated: positive news') : T('AI-rated: heavy news');
        meta.append(m);
    }
    const title = el('h4', null, item.title);
    const head = el('div', 'article-header');
    const headText = el('div');
    headText.append(title, meta);
    if (hist.summarized) {
        const badge = el('span', 'feed-badge', T('✓ Summarized'));
        badge.title = T('You have a saved summary of this page');
        headText.append(badge);
    }
    const star = btn('star-button', hist.fav ? '★' : '☆', (e) => { e.stopPropagation(); toggleFavorite(item); }, T('Favorite'));
    star.setAttribute('aria-pressed', String(hist.fav));
    head.append(headText, star);
    li.appendChild(head);
    if (item.snippet) li.appendChild(el('p', 'feed-snippet', item.snippet));

    const actions = el('div', 'feed-actions');
    const sum = btn('button-primary feed-btn', hist.summarized ? T('📄 View summary') : T('✨ Summarize'), (e) => { e.stopPropagation(); onSummarizeClick(item); });
    const open = btn('button-secondary feed-btn', T('Open ↗'), (e) => { e.stopPropagation(); openItem(item, false); });
    const read = btn('button-secondary feed-btn', item.read ? T('Mark unread') : T('Mark read'), (e) => { e.stopPropagation(); setRead([item], !item.read, { silent: true, keep: true }); });
    if (item.audio) {
        const playing = isPlaying(item.id);
        const pb = btn('button-primary feed-btn feed-play-btn' + (playing ? ' is-playing' : ''), playing ? T('⏸ Pause') : T('▶ Play'), (e) => { e.stopPropagation(); onPlayClick(item); }, T('Play episode in AISH'));
        pb.dataset.id = item.id;
        actions.append(pb, open, read, sum);
    } else actions.append(open, read, sum);
    li.appendChild(actions);
    li.tabIndex = 0;
    li.setAttribute('role', 'link');
    li.addEventListener('click', () => onCardClick(item));
    li.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target === li) onCardClick(item); });
    return li;
}

async function onPlayClick(item) {
    try {
        const sub = subMap().get(item.feedId);
        await playAudio(item, subTitle(sub), item.img || (sub && sub.image) || '');
    } catch (e) {
        toast(uiRef, e.message || T('Could not start playback'));
    }
}
function syncPlayButtons(st) {
    document.body.classList.toggle('has-player', !!(st && st.cur));
    document.querySelectorAll('.feed-play-btn').forEach(b => {
        const on = isPlaying(b.dataset.id);
        b.classList.toggle('is-playing', on);
        b.textContent = on ? T('⏸ Pause') : T('▶ Play');
    });
}

// Days (start-of-day timestamps, ascending) that have items under every filter except the date.
function dayStops() {
    const sm = subMap(); const set = new Set();
    items.forEach(i => { if (passes(i, sm, true)) set.add(startOfDay(i.published)); });
    return [...set].sort((a, b) => a - b);
}

function render() {
    if (!els.list) return;
    renderControls();
    els.list.replaceChildren();

    if (!subs.length) { els.list.hidden = true; renderFirstRun(); return; }
    els.list.hidden = false;
    if (els.graph) els.graph.hidden = true;
    if (els.insights) els.insights.hidden = true;
    syncViewButtons();

    const sm = subMap();
    const all = visibleItems();
    if (view !== 'list') { renderAltView(); return; }
    if (!all.length) { renderEmptyFiltered(items.length > 0); return; }
    const visible = all.slice(0, shown);
    els.empty.style.display = 'none';

    let lastKey = null;
    let group = [];
    const flush = () => {
        if (!group.length) return;
        const unread = group.filter(i => !i.read);
        const header = el('li', 'feed-day');
        const groupDay = startOfDay(group[0].published);
        header.dataset.day = String(groupDay);
        const labelText = `${dayLabel(group[0].published)} · ${TN(group.length, '{n} item', '{n} items')}`;
        if (isOneDay(ui.date)) {
            // single-day view: ‹ › step between days that have items
            const stops = dayStops();
            const prev = [...stops].reverse().find(t => t < groupDay), next = stops.find(t => t > groupDay);
            const step = (t) => { ui.date = { from: t, to: t }; persistUi(); render(); };
            const pb = btn('feed-day-step', '‹', () => step(prev), T('Previous day with items')); pb.disabled = prev == null;
            const nb = btn('feed-day-step', '›', () => step(next), T('Next day with items')); nb.disabled = next == null;
            const lab = el('span', 'feed-day-label'); lab.append(pb, document.createTextNode(` ${fmtDayShort(groupDay)} · ${TN(group.length, '{n} item', '{n} items')} `), nb);
            header.append(lab);
        } else {
            const lab = btn('feed-day-label feed-day-open', labelText + '  ▾', () => openFilterSheet({ view: 'calendar', day: groupDay }), T('Pick a day'));
            header.append(lab);
        }
        if (ui.sort !== 'mood') {
            const dayStart = startOfDay(group[0].published);
            const dayName = dayLabel(group[0].published);
            header.append(btn('feed-day-action feed-day-ai', T('✨ Recap') + (recaps[`${dayStart}|${ui.source}`] ? ' ✓' : ''), () => openRecap(dayStart, dayName), T('AI recap of this day')));
        }
        if (unread.length) {
            const snapshot = [...unread];
            header.append(btn('feed-day-action', T('Mark read'), () => setRead(snapshot, true, { label: T('Marked {n} read', { n: snapshot.length }) }), T('Mark {n} read', { n: snapshot.length })));
        }
        els.list.appendChild(header);
        group.forEach(i => els.list.appendChild(renderCard(i, sm)));
        group = [];
    };
    if (ui.sort === 'mood' || searchQuery.trim()) {
        const header = el('li', 'feed-day');
        header.append(el('span', 'feed-day-label', searchQuery.trim() ? T('Best match · {n} items', { n: all.length }) : T('Most positive first · {n} items', { n: all.length })));
        els.list.appendChild(header);
        visible.forEach(i => els.list.appendChild(renderCard(i, sm)));
    } else {
        for (const i of visible) {
            const key = startOfDay(i.published);
            if (key !== lastKey) { flush(); lastKey = key; }
            group.push(i);
        }
        flush();
    }
    if (all.length > visible.length) {
        const more = el('li', 'feed-more');
        more.append(btn('button-secondary feed-wide-btn', T('Show {n} more · {m} older', { n: Math.min(PAGE_SIZE, all.length - visible.length), m: all.length - visible.length }), () => { shown += PAGE_SIZE; render(); }));
        els.list.appendChild(more);
    }
}

// ── Sheets (source picker, filters, add, briefing) ─────────────────────────
function openSheet(title, bodyNode) {
    const layer = document.getElementById('feedSheetLayer');
    const body = document.getElementById('feedSheetBody');
    if (!layer || !body) return;
    body.replaceChildren();
    const head = el('div', 'feed-sheet-head');
    head.append(el('h3', null, title), btn('feed-sheet-done', T('Done'), closeSheet));
    body.append(head, bodyNode);
    layer.hidden = false;
}
// Replace the whole sheet content (custom header) — used by the two-level Date & mood sheet.
function showSheet(...nodes) {
    const layer = document.getElementById('feedSheetLayer');
    const body = document.getElementById('feedSheetBody');
    if (!layer || !body) return;
    body.replaceChildren(...nodes);
    layer.hidden = false;
}
function closeSheet() {
    const layer = document.getElementById('feedSheetLayer');
    if (layer) layer.hidden = true;
}

function radioRow(label, count, selected, onClick, { muted = false, indent = false } = {}) {
    const b = el('button', 'feed-pick-row' + (selected ? ' selected' : '') + (muted ? ' is-muted' : '') + (indent ? ' indent' : ''));
    b.type = 'button';
    b.append(el('span', 'feed-pick-radio', selected ? '●' : '○'), el('span', 'feed-pick-name', label), el('span', 'feed-pick-count', count || ''));
    b.addEventListener('click', onClick);
    return b;
}

function openSourcePicker() {
    const body = el('div', 'feed-picker');
    const search = el('input');
    search.type = 'search'; search.placeholder = T('Search sources…'); search.autocomplete = 'off'; search.spellcheck = false;
    const list = el('div', 'feed-picker-list');
    const choose = (src) => { ui.source = src; persistUi(); closeSheet(); render(); };
    const draw = () => {
        list.replaceChildren();
        const q = search.value.trim().toLowerCase();
        const sm = subMap();
        const cnt = (pred) => { const n = unreadCount(i => sm.has(i.feedId) && pred(i)); return n ? String(n) : ''; };
        if (!q) list.append(radioRow(T('All sources'), cnt(i => !sm.get(i.feedId).muted), ui.source === 'all', () => choose('all')));
        const tags = allTags().filter(t => !q || t.toLowerCase().includes(q));
        if (tags.length) {
            list.append(el('div', 'feed-pick-label', TU('Tags')));
            tags.forEach(t => list.append(radioRow('# ' + t, cnt(i => hasTag(sm.get(i.feedId), t) && !sm.get(i.feedId).muted), ui.source === 'tag:' + t, () => choose('tag:' + t))));
        }
        const matching = (s) => !q || subTitle(s).toLowerCase().includes(q) || (s.tags || []).some(t => t.toLowerCase().includes(q));
        const shown = subs.filter(matching);
        if (shown.length) {
            if (tags.length) list.append(el('div', 'feed-pick-label', TU('Feeds')));
            shown.sort((a, b) => subTitle(a).localeCompare(subTitle(b))).forEach(s => {
                list.append(radioRow((s.muted ? '🔕 ' : '') + subTitle(s), cnt(i => i.feedId === s.id), ui.source === 'sub:' + s.id, () => choose('sub:' + s.id), { muted: s.muted }));
            });
        }
        if (!list.children.length) list.append(el('p', 'feed-muted', T('No sources match.')));
    };
    search.addEventListener('input', draw);
    body.append(search, list, btn('feed-manage-link', T('⚙️  Manage feeds & tags in Settings  ›'), async () => {
        closeSheet();
        const nav = await import('./settingsNav.js');
        uiRef.showScreen('settings');
        setTimeout(() => nav.openSettingsPanel('feeds'), 50);
    }));
    openSheet(T('Sources'), body);
    draw();
}

function openFilterSheet(opts = {}) {
    let view = opts.view === 'calendar' ? 'cal' : 'main';
    let calSel = opts.day || null;          // tentatively highlighted day (from a day-header shortcut)
    let anchor = null;                      // first day of a range being picked
    let calPage = 0;                        // 0 = newest weeks

    const reset = () => { ui.date = 'any'; ui.mood = 'any'; ui.sort = 'new'; persistUi(); render(); draw(); };
    const head = (left, title) => {
        const h = el('div', 'feed-sheet-head feed-sheet-head3');
        h.append(left, el('h3', null, title), btn('feed-sheet-done', T('Done'), closeSheet));
        return h;
    };

    const drawMain = () => {
        const body = el('div', 'feed-picker');
        const left = btn('feed-sheet-done feed-sheet-reset', T('Reset'), reset);
        if (!filtersActive()) left.style.visibility = 'hidden';
        const section = (title, key, opts2) => {
            body.append(el('div', 'feed-pick-label', title));
            opts2.forEach(([val, label]) => body.append(radioRow(label, '', ui[key] === val, () => { ui[key] = val; persistUi(); render(); draw(); })));
        };
        section(TU('Date'), 'date', [['any', T('Any time')], ['today', T('Today')], ['7d', T('Last 7 days')]]);
        const custom = isDayRange(ui.date);
        const pick = el('button', 'feed-pick-row feed-pick-link' + (custom ? ' selected' : ''));
        pick.type = 'button';
        pick.append(el('span', 'feed-pick-name', T('📅  Pick a day or range…')), el('span', 'feed-pick-count', custom ? dateText() : ''), el('span', 'feed-pick-chevron', '›'));
        pick.addEventListener('click', () => { view = 'cal'; calSel = null; draw(); });
        body.append(pick);
        section(TU('Mood'), 'mood', [['any', T('Any mood')], ['pos', T('😊  Positive only')], ['nonneg', T('Hide negative')]]);
        section(TU('Sort'), 'sort', [['new', T('Newest first')], ['mood', T('Most positive first')]]);
        body.append(el('div', 'feed-pick-label', TU('More')));
        body.append(btn('feed-manage-link', T('☀️  Today’s briefing'), () => { closeSheet(); openBriefing(); }));
        body.append(btn('feed-manage-link', T('🤖  Score unscored visible items with AI'), () => { closeSheet(); scoreWithAi(visibleItems().slice(0, shown)); }));
        body.append(btn('feed-manage-link', T('✓  Mark everything in this view read'), () => {
            const list = visibleItems().filter(i => !i.read);
            closeSheet();
            if (list.length) setRead(list, true, { label: T('Marked {n} read', { n: list.length }) });
        }));
        body.append(el('p', 'feed-muted', T('Mood comes from AI scoring only — items you haven’t scored have no mood and are never hidden by the mood filter. Scoring sends titles and short snippets to your AI connection when you click it.')));
        showSheet(head(left, T('Date & mood')), body);
    };

    const drawCal = () => {
        const body = el('div', 'feed-picker feed-cal');
        const back = btn('feed-sheet-done feed-sheet-back', T('‹ Date & mood'), () => { view = 'main'; anchor = null; draw(); });

        // counts per day within the current source scope
        const sm = subMap(); const counts = new Map();
        items.forEach(i => {
            if (!inSource(i, sm)) return;
            const k = startOfDay(i.published); const c = counts.get(k) || { n: 0, unread: 0 };
            c.n++; if (!i.read) c.unread++; counts.set(k, c);
        });
        const recapDays = new Set(Object.keys(recaps).map(k => Number(k.split('|')[0])));
        const today = startOfDay(Date.now());
        const mondayOf = (ts) => { const d = new Date(ts); const dow = (d.getDay() + 6) % 7; d.setDate(d.getDate() - dow); d.setHours(0, 0, 0, 0); return d.getTime(); };
        const addDays = (ts, n) => { const d = new Date(ts); d.setDate(d.getDate() + n); d.setHours(0, 0, 0, 0); return d.getTime(); };
        const first = mondayOf(addDays(today, -settings.keepDays));
        const lastMon = mondayOf(today);
        const weeksTotal = Math.round((lastMon - first) / (7 * DAY_MS)) + 1;
        const perPage = 5;
        const pages = Math.max(1, Math.ceil(weeksTotal / perPage));
        calPage = Math.min(calPage, pages - 1);
        const endWeekIdx = weeksTotal - 1 - calPage * perPage;           // newest week of this page
        const startWeekIdx = Math.max(0, endWeekIdx - perPage + 1);
        const pageStart = addDays(first, startWeekIdx * 7);
        const pageEnd = addDays(first, endWeekIdx * 7 + 6);
        const max = Math.max(1, ...[...counts.values()].map(c => c.n));

        // month header with paging
        const mh = el('div', 'feed-cal-month');
        const older = btn('feed-cal-nav', '‹', () => { calPage++; draw(); }, T('Older')); older.disabled = calPage >= pages - 1;
        const newer = btn('feed-cal-nav', '›', () => { calPage--; draw(); }, T('Newer')); newer.disabled = calPage <= 0;
        const m1 = new Date(pageStart).toLocaleDateString(locale(), { month: 'short' });
        const m2 = new Date(pageEnd).toLocaleDateString(locale(), { month: 'short' });
        const yr = new Date(pageEnd).getFullYear();
        mh.append(older, el('span', 'feed-cal-title', `${m1 === m2 ? m1 : m1 + ' – ' + m2} ${yr}${pages === 1 ? ' · ' + T('last {n} days', { n: settings.keepDays }) : ''}`), newer);
        body.append(mh);

        const wd = el('div', 'feed-cal-weekdays');
        for (let k = 0; k < 7; k++) wd.append(el('span', null, new Date(addDays(first, k)).toLocaleDateString(locale(), { weekday: 'narrow' })));
        body.append(wd);

        const inSel = (ts) => {
            if (anchor != null) return ts === anchor;
            if (isDayRange(ui.date)) return ts >= ui.date.from && ts <= ui.date.to;
            return calSel === ts;
        };
        const grid = el('div', 'feed-cal-grid');
        for (let ts = pageStart; ts <= pageEnd; ts = addDays(ts, 1)) {
            const d = new Date(ts); const c = counts.get(ts);
            const future = ts > today; const outside = ts < addDays(today, -settings.keepDays);
            const cell = el('button', 'feed-cal-cell' + (inSel(ts) ? ' sel' : '') + (ts === today ? ' today' : '') + (future || outside ? ' off' : '') + (c ? ' has' : '') + (recapDays.has(ts) ? ' recap' : ''));
            cell.type = 'button'; cell.dataset.day = String(ts); cell.disabled = future || outside;
            if (c) cell.style.setProperty('--heat', (c.n / max).toFixed(2));
            const label = (d.getDate() === 1 || ts === pageStart) ? fmtDayNoWeek(ts) : String(d.getDate());
            cell.append(el('span', 'feed-cal-num' + (label.length > 2 ? ' small' : ''), label));
            if (c) cell.append(el('span', 'feed-cal-count', String(c.n)));
            if (recapDays.has(ts)) cell.append(el('span', 'feed-cal-recap', '✨'));
            cell.setAttribute('aria-label', (c ? TN(c.n, '{day}, {n} item', '{day}, {n} items', { day: fmtDayShort(ts) }) : T('{day}, no items', { day: fmtDayShort(ts) })) + (recapDays.has(ts) ? ' · ' + T('recap done') : ''));
            const choose = (shift) => {
                if (shift && anchor == null) { anchor = ts; draw(); return; }
                if (anchor != null) {
                    const a = Math.min(anchor, ts), b = Math.max(anchor, ts); anchor = null;
                    ui.date = { from: a, to: b }; persistUi(); render(); closeSheet(); return;
                }
                ui.date = { from: ts, to: ts }; persistUi(); render(); closeSheet();
            };
            let timer = null, fired = false;
            cell.addEventListener('pointerdown', () => { fired = false; timer = setTimeout(() => { fired = true; choose(true); }, 520); });
            ['pointerup', 'pointerleave', 'pointercancel'].forEach(ev => cell.addEventListener(ev, () => clearTimeout(timer)));
            cell.addEventListener('click', (e) => { if (fired) { fired = false; return; } choose(e.shiftKey); });
            grid.append(cell);
        }
        body.append(grid);

        body.append(el('p', 'feed-muted feed-cal-hint', anchor != null
            ? T('Range starts {day} — tap the last day.', { day: fmtDayNoWeek(anchor) })
            : T('Darker = more items · ✨ = recap done · long-press a day, then another, for a range')));

        // footer: clear + summary of what is selected
        const foot = el('div', 'feed-cal-foot');
        const clear = btn('feed-cal-clear', T('Clear date filter'), () => { ui.date = 'any'; persistUi(); render(); closeSheet(); });
        clear.disabled = ui.date === 'any';
        const selDays = isDayRange(ui.date) ? [ui.date.from, ui.date.to] : calSel != null ? [calSel, calSel] : null;
        let summary = '';
        if (selDays) {
            let n = 0, u = 0;
            counts.forEach((c, k) => { if (k >= selDays[0] && k <= selDays[1]) { n += c.n; u += c.unread; } });
            summary = `${selDays[0] === selDays[1] ? fmtDayShort(selDays[0]) : dateText({ from: selDays[0], to: selDays[1] })} · ${TN(n, '{n} item', '{n} items')} · ${T('{n} unread', { n: u })}`;
        }
        foot.append(clear, el('span', 'feed-muted', summary));
        body.append(foot);
        showSheet(head(back, T('Pick a day')), body);
    };

    const draw = () => (view === 'cal' ? drawCal() : drawMain());
    draw();
}

async function useCurrentSite() {
    try {
        const { getActiveTab } = await import('./mainScreen.js');
        const tab = await getActiveTab();
        if (tab && /^https?:/i.test(tab.url || '')) {
            addFeed(uiRef, tab.url, null);
        } else {
            toast(uiRef, T('Open a website in the current tab first'));
        }
    } catch (e) {
        toast(uiRef, T('Could not read the current tab'));
    }
}

function openAddSheet() {
    const body = el('div', 'feed-picker');
    const row = el('div', 'feed-add-row');
    const input = el('input');
    input.type = 'text'; input.placeholder = T('Site or feed address…'); input.autocomplete = 'off'; input.spellcheck = false;
    const add = btn('button-primary feed-btn', T('Add'), () => addFeed(uiRef, input.value, input));
    add.setAttribute('data-feed-add', '');
    input.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); addFeed(uiRef, input.value, input); } });
    row.append(input, add);
    body.append(row, el('p', 'feed-muted', T('Paste any site address. We find its feed for you.')),
        btn('feed-option-card', T('＋  Use current site'), useCurrentSite),
        btn('feed-option-card', T('📥  Import OPML file…'), () => els.opmlInput.click()));
    const sg = suggestionsNode();
    if (sg) body.append(sg);
    openSheet(T('Add a feed'), body);
    setTimeout(() => input.focus(), 50);
}

// ── AI recap + scoring (explicit clicks only) ──────────────────────────────
function recapScope(dayStart, source) {
    const sm = subMap();
    return items.filter(i => inSource(i, sm, source) && startOfDay(i.published) === dayStart)
        .sort((a, b) => b.published - a.published).slice(0, MAX_RECAP_ITEMS);
}
function idsHash(list) { return hash(list.map(i => i.id).sort().join(',')); }
function aiTitleOf(sm) { return i => subTitle(sm.get(i.feedId)); }

async function openRecap(dayStart, label, source = ui.source) {
    const list = recapScope(dayStart, source);
    const key = `${dayStart}|${source}`;
    const body = el('div', 'feed-picker feed-recap');
    openSheet(T('{label} recap', { label }), body);
    if (!list.length) { body.append(el('p', 'feed-muted', T('No items to recap here.'))); return; }
    const sm = subMap();

    const draw = (r, stale) => {
        body.replaceChildren();
        const chip = { pos: T('😊 Mostly positive'), neu: T('😐 Mixed'), neg: T('😟 Mostly heavy') }[r.mood] || T('😐 Mixed');
        body.append(el('span', 'feed-recap-mood', chip));
        if (r.overview) body.append(el('p', 'feed-recap-overview', r.overview));
        if (r.themes.length) {
            const ul = el('ul', 'feed-recap-themes');
            r.themes.forEach(t => ul.append(el('li', null, t)));
            body.append(ul);
        }
        if (stale) body.append(el('p', 'feed-recap-stale', T('New items arrived since this recap — Refresh to include them.')));
        const row = el('div', 'feed-recap-actions');
        row.append(btn('feed-btn', T('↻ Refresh'), () => run(true)),
            btn('feed-btn', T('Copy'), async () => {
                try { await navigator.clipboard.writeText([r.overview, ...r.themes.map(t => '- ' + t)].join('\n')); toast(uiRef, T('Recap copied')); }
                catch (e) { toast(uiRef, T('Copy failed')); }
            }));
        body.append(row,
            btn('feed-manage-link', list.some(needsAi) ? TN(list.filter(needsAi).length, '🤖  Score {n} unscored item with AI', '🤖  Score {n} unscored items with AI') : T('✓  All items here are scored'), () => { closeSheet(); scoreWithAi(list); }),
            el('p', 'feed-muted', T('AI-generated from {n} headlines and snippets. Generated at {time}. Not a substitute for reading.', { n: list.length, time: new Date(r.at).toLocaleTimeString(locale(), { hour: '2-digit', minute: '2-digit' }) })));
    };
    const sigsOf = (arr) => Object.fromEntries(arr.map(x => [x.id, itemSig(x)]));
    // Items the recap has not seen yet, or whose title/snippet changed since (news articles get edited).
    const changedSince = (rc) => list.filter(x => rc.covered[x.id] !== itemSig(x));
    const applyRatings = (arr, r, rate) => {
        if (!rate || !(r.labels || r.scores)) return;
        // Rate/categorize in the same request. Existing ratings and categories are never overwritten.
        arr.forEach((x, n) => {
            if (r.labels && !x.cat && r.labels[n]) x.cat = r.labels[n];
            if (r.scores && !x.ai && r.scores[n] != null) { x.sent = r.scores[n]; x.ai = true; }
        });
        persist(); render();
    };
    const run = async (force) => {
        const cached = recaps[key];
        const hsh = idsHash(list);
        const fresh = cached && cached.covered ? changedSince(cached) : null;
        if (cached && !force) return draw(cached, fresh ? fresh.length > 0 : cached.hash !== hsh);
        const rate = settings.rateWithRecap !== false;
        // Refresh = previous recap + only the new/edited items; nothing new means no AI request at all.
        if (cached && fresh) {
            if (!fresh.length) { toast(uiRef, T('Nothing new since this recap')); return draw(cached, false); }
            body.replaceChildren(el('p', 'feed-recap-loading', T('✨ Updating recap…')),
                el('p', 'feed-muted', T('Sending {n} new or edited titles and short snippets to your AI connection.', { n: Math.min(fresh.length, MAX_RECAP_ITEMS) })));
            try {
                const r = await generateRecapUpdate(cached, fresh, aiTitleOf(sm), { rate, edited: (x) => x.id in cached.covered });
                applyRatings(r.sent, r, rate);
                const { labels: _l, scores: _s, sent: sentItems, ...rc } = r;
                recaps[key] = { ...rc, hash: hsh, at: Date.now(), n: list.length, covered: { ...cached.covered, ...sigsOf(sentItems) } };
                chrome.storage.local.set({ [RECAPS_KEY]: recaps }).catch(() => {});
                draw(recaps[key], changedSince(recaps[key]).length > 0);
            } catch (e) {
                body.replaceChildren(el('p', 'feed-error', e.message || T('Recap failed')),
                    btn('feed-btn', T('Try again'), () => run(true)));
            }
            return;
        }
        body.replaceChildren(el('p', 'feed-recap-loading', T('✨ Writing recap…')),
            el('p', 'feed-muted', T('Sending {n} titles and short snippets to your AI connection.', { n: list.length })));
        try {
            const r = await generateRecap(list, aiTitleOf(sm), { rate });
            applyRatings(list, r, rate);
            const { labels: _l, scores: _s, ...rc } = r;
            recaps[key] = { ...rc, hash: hsh, at: Date.now(), n: list.length, covered: sigsOf(list) };
            chrome.storage.local.set({ [RECAPS_KEY]: recaps }).catch(() => {});
            draw(recaps[key], false);
        } catch (e) {
            body.replaceChildren(el('p', 'feed-error', e.message || T('Recap failed')),
                btn('feed-btn', T('Try again'), () => run(true)));
        }
    };
    run(false);
}

// An item needs the AI only if it has no AI score or no category yet.
const needsAi = (i) => !i.ai || !i.cat;
let scoring = false;

async function scoreWithAi(list) {
    if (scoring) { toast(uiRef, T('Already scoring — one moment')); return; }
    const all = (list || []).filter(Boolean);
    list = all.filter(needsAi);
    if (!all.length) { toast(uiRef, T('Nothing to score')); return; }
    if (!list.length) { toast(uiRef, T('These items are already scored')); return; }
    const sm = subMap();
    let done = 0;
    scoring = true;
    try {
        for (let k = 0; k < list.length; k += MAX_RECAP_ITEMS) {
            const chunk = list.slice(k, k + MAX_RECAP_ITEMS);
            toast(uiRef, T('Scoring with AI… {a}/{b}', { a: Math.min(k + chunk.length, list.length), b: list.length }));
            const { scores, labels } = await scoreItems(chunk, aiTitleOf(sm));
            chunk.forEach((i, n) => {
                // never overwrite an existing AI score or category
                if (!i.ai && scores[n] !== null) { i.sent = scores[n]; i.ai = true; done++; }
                if (!i.cat && labels && labels[n]) { i.cat = labels[n]; done = Math.max(done, 1); }
            });
            await persist();
        }
    } catch (e) {
        toast(uiRef, e.message || T('AI scoring failed'));
    } finally { scoring = false; }
    if (done) { render(); toast(uiRef, TN(list.length, 'Scored {n} item with AI', 'Scored {n} items with AI') + (all.length > list.length ? ' ' + T('({n} already done)', { n: all.length - list.length }) : '')); }
}

// ── Today's briefing ───────────────────────────────────────────────────────
function openBriefing() {
    const sm = subMap();
    const start = startOfDay(Date.now());
    const today = items.filter(i => sm.has(i.feedId) && !sm.get(i.feedId).muted && i.published >= start)
        .sort((a, b) => b.published - a.published);
    const body = el('div', 'feed-picker');
    if (!today.length) {
        body.append(el('p', 'feed-muted', T('Nothing new today yet. Try Refresh.')));
        return openSheet(T('Today’s briefing'), body);
    }
    const bySub = new Map();
    today.forEach(i => { if (!bySub.has(i.feedId)) bySub.set(i.feedId, []); bySub.get(i.feedId).push(i); });
    const tally = { pos: 0, neu: 0, neg: 0 };
    today.forEach(i => { const m = itemMood(i); if (m) tally[m]++; });
    const rated = tally.pos + tally.neu + tally.neg;
    const unread = today.filter(i => !i.read);
    body.append(el('p', 'feed-brief-summary', TN(bySub.size, '{n} new today across {s} source · {u} unread', '{n} new today across {s} sources · {u} unread', { n: today.length, s: bySub.size, u: unread.length })),
        el('p', 'feed-muted', rated ? T('Mood (AI-rated {r}/{n}): 😊 {p} · 😐 {m} · 😟 {g}', { r: rated, n: today.length, p: tally.pos, m: tally.neu, g: tally.neg }) : 'Mood: not rated yet — use “Score with AI”.'));
    bySub.forEach((list, id) => {
        body.append(el('div', 'feed-pick-label', `${subTitle(sm.get(id)).toUpperCase()} · ${list.length}`));
        list.slice(0, 2).forEach(i => {
            const emoji = MOOD_EMOJI[itemMood(i) || 'neu'];
            body.append(btn('feed-brief-item' + (i.read ? ' is-read' : ''), (emoji ? emoji + '  ' : '') + i.title, () => { closeSheet(); onCardClick(i); }));
        });
        if (list.length > 2) body.append(el('p', 'feed-muted', T('+ {n} more', { n: list.length - 2 })));
    });
    body.append(btn('feed-manage-link', T('✨  AI recap of today'), () => openRecap(start, T('Today'), 'all')));
    body.append(btn('button-primary feed-wide-btn', T('✨ Summarize top 5 unread'), async () => {
        const { summaryMode } = await chrome.storage.local.get('summaryMode');
        if (summaryMode === 'inline') { toast(uiRef, T('Batch summarizing runs in extension mode. Switch on the Summarize screen.')); return; }
        const picks = unread.filter(i => !histOf(i).summarized).slice(0, 5);
        if (!picks.length) { toast(uiRef, T('Everything unread is already summarized')); return; }
        picks.forEach((i, k) => setTimeout(() => chrome.runtime.sendMessage({ action: 'openFeedItem', url: i.link, summarize: true, forceExtension: true }, () => void chrome.runtime.lastError), k * 1500));
        toast(uiRef, T('Summarizing {n} in the background — see History', { n: picks.length }));
        closeSheet();
    }));
    openSheet(T('Today’s briefing'), body);
}

// ── Settings > Feeds panel ─────────────────────────────────────────────────
function updateSettingsSub() {
    const sub = document.querySelector('.settings-row-sub[data-sub="feeds"]');
    if (!sub) return;
    const folders = allTags().length;
    sub.textContent = subs.length
        ? TN(subs.length, '{n} feed', '{n} feeds') + (folders ? ' · ' + TN(folders, '{n} tag', '{n} tags') : '')
        : T('Subscriptions · OPML · behavior');
}

function sendPollConfig() {
    chrome.runtime.sendMessage({ action: 'feedPollConfig' }, () => void chrome.runtime.lastError);
}

async function setSetting(key, value) {
    settings[key] = value;
    await persistSettings();
    if (key === 'backgroundPoll' || key === 'refreshMinutes') sendPollConfig();
    if (key === 'keepDays') { pruneItems(); await persist(); render(); }
}

function subRow(s) {
    const row = el('div', 'feed-sub-card' + (s.muted ? ' is-muted' : ''));
    const l1 = el('div', 'feed-sub-line');
    const name = el('input', 'feed-sub-input');
    name.type = 'text'; name.value = subTitle(s); name.setAttribute('aria-label', T('Feed name'));
    name.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); name.blur(); } });
    name.addEventListener('change', async () => {
        const v = name.value.trim();
        if (v) s.customTitle = v; else { delete s.customTitle; name.value = subTitle(s); }
        await persist(); render();
    });
    const mute = btn('feed-icon-btn', s.muted ? '🔕' : '🔔', async () => {
        s.muted = !s.muted;
        await persist(); render(); renderFeedSettings();
    }, s.muted ? T('Unmute (include in All sources)') : T('Mute (leave out of All sources)'));
    const rm = btn('feed-icon-btn', '✕', () => { removeFeed(s.id); }, T('Unsubscribe'));
    l1.append(name, mute, rm);
    const l2 = el('div', 'feed-sub-line');
    const tagBox = el('div', 'feed-tags');
    const saveTags = async (next) => {
        s.tags = cleanTags(next);
        if (!sourceExists(ui.source)) ui.source = 'all';
        await persist(); render(); renderFeedSettings();
    };
    (s.tags || []).forEach(t => {
        const chip = el('span', 'feed-tag-chip', t);
        const x = btn('feed-tag-x', '×', () => saveTags(s.tags.filter(y => tagKey(y) !== tagKey(t))), T('Remove tag {tag}', { tag: t }));
        chip.append(x);
        tagBox.append(chip);
    });
    const tagIn = el('input', 'feed-tag-input');
    tagIn.type = 'text'; tagIn.placeholder = (s.tags || []).length ? T('+ tag') : T('+ Add tag'); tagIn.setAttribute('list', 'feedTagList'); tagIn.setAttribute('aria-label', T('Add tag'));
    tagIn.autocomplete = 'off'; tagIn.spellcheck = false;
    const commit = () => { const v = tagIn.value.trim(); if (v) saveTags([...(s.tags || []), v]); };
    tagIn.addEventListener('keydown', e => {
        if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); commit(); }
        else if (e.key === 'Backspace' && !tagIn.value && (s.tags || []).length) saveTags(s.tags.slice(0, -1));
    });
    tagIn.addEventListener('change', commit);
    tagBox.append(tagIn);
    const n = items.filter(i => i.feedId === s.id && !i.read).length;
    l2.className = 'feed-sub-line feed-sub-tags';
    l2.append(tagBox);
    const status = el('div', 'feed-sub-line');
    status.append(el('span', s.error ? 'feed-sub-error' : 'feed-muted', s.error ? '⚠ ' + s.error : T('{n} unread', { n })));
    row.append(l1, l2, status);
    return row;
}

function toggleRow(id, title, hint, key) {
    const row = el('div', 'setting-group flex justify-between align-center mb-3');
    const left = el('div'); left.style.cssText = 'flex:1;min-width:0;';
    const lab = el('label', null, title); lab.htmlFor = id; lab.style.cssText = 'display:block;margin:0;font-weight:normal;cursor:pointer;';
    const p = el('p', null, hint); p.style.cssText = 'font-size:11px;color:var(--text-muted);margin:2px 0 0;line-height:1.3;';
    left.append(lab, p);
    const sw = el('label', 'switch'); sw.style.cssText = 'flex-shrink:0;margin-left:12px;';
    const cb = el('input'); cb.type = 'checkbox'; cb.id = id; cb.checked = !!settings[key];
    cb.addEventListener('change', () => setSetting(key, cb.checked));
    sw.append(cb, el('span', 'slider-toggle'));
    row.append(left, sw);
    return row;
}

function selectRow(id, title, key, opts) {
    const row = el('div', 'setting-group flex justify-between align-center mb-3');
    const lab = el('label', null, title); lab.htmlFor = id; lab.style.cssText = 'margin:0;font-weight:normal;flex:1;';
    const sel = el('select'); sel.id = id; sel.style.cssText = 'width:auto;min-width:120px;margin:0;';
    opts.forEach(([v, t]) => { const o = el('option', null, t); o.value = String(v); if (Number(settings[key]) === v) o.selected = true; sel.append(o); });
    sel.addEventListener('change', () => setSetting(key, Number(sel.value)));
    row.append(lab, sel);
    return row;
}

function renderFeedSettings() {
    const root = document.getElementById('feedSettingsRoot');
    if (!root) return;
    updateSettingsSub();
    root.replaceChildren();

    root.append(el('p', 'settings-caption', TU('Subscriptions · {n}', { n: subs.length })));
    const dl = el('datalist'); dl.id = 'feedTagList';
    allTags().forEach(f => { const o = el('option'); o.value = f; dl.append(o); });
    root.append(dl);

    const card = el('div', 'feed-set-card');
    card.id = 'feedSubsCard';
    if (!subs.length) card.append(el('p', 'feed-muted', T('No feeds yet. Add one below or import an OPML file.')));
    subs.forEach(s => card.append(subRow(s)));
    const addRow = el('div', 'feed-add-row');
    const input = el('input'); input.type = 'text'; input.placeholder = T('Add a site or feed address…'); input.autocomplete = 'off'; input.spellcheck = false;
    const add = btn('button-secondary feed-btn', T('＋ Add'), () => addFeed(uiRef, input.value, input));
    add.setAttribute('data-feed-add', '');
    input.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); addFeed(uiRef, input.value, input); } });
    addRow.append(input, add);
    const io = el('div', 'feed-actions-row');
    io.id = 'feedOpmlActions';
    io.append(btn('button-secondary feed-btn', T('📥 Import OPML'), () => els.opmlInput.click()),
        btn('button-secondary feed-btn', T('📤 Export OPML'), () => { if (!subs.length) return toast(uiRef, T('Nothing to export yet')); exportOpml(); }));
    card.append(addRow, io);
    root.append(card);

    root.append(el('p', 'settings-caption', TU('Behavior')));
    const beh = el('div', 'feed-set-card');
    beh.id = 'feedBehaviorCard';
    beh.append(
        toggleRow('feedSetMarkRead', T('✓ Mark read when opened'), T('Items you open or summarize leave your unread list'), 'markReadOnOpen'),
        toggleRow('feedSetRate', T('🤖 Rate items with the recap'), T('Adds mood and category to each item in the same AI request'), 'rateWithRecap'),
        toggleRow('feedSetAutoSum', T('✨ Auto-summarize favorites'), T('Starring an item summarizes it in a background tab'), 'autoSummarizeFavs'),
        toggleRow('feedSetPoll', T('🔔 Check in the background'), T('Shows a badge on the toolbar icon when new items arrive'), 'backgroundPoll'),
        selectRow('feedSetRefresh', T('🔄 Refresh feeds every'), 'refreshMinutes', [[15, T('15 minutes')], [30, T('30 minutes')], [60, T('1 hour')], [180, T('3 hours')]]),
        selectRow('feedSetKeep', T('🗂️ Keep items for'), 'keepDays', [[7, T('7 days')], [30, T('30 days')], [90, T('90 days')], [365, T('1 year')]]),
        el('p', 'feed-muted', T('Summarize on a feed item follows the mode chosen on the Summarize screen (extension by default). Favorites are always kept.'))
    );
    root.append(beh);
}

// ── Public API ─────────────────────────────────────────────────────────────
export async function onFeedsScreenShown(uiObj) {
    uiRef = uiObj;
    closeSheet(); hideUndo(); stickyRead.clear(); shown = PAGE_SIZE;
    searchQuery = ''; view = 'list'; if (els.search) els.search.value = '';
    if (els.controlsBar) els.controlsBar.classList.remove('scroll-hidden');
    await load();
    try { await reconcileStubs(); } catch (e) { console.warn('[feeds] stub reconcile failed', e); }
    await loadHistoryMap();
    render();
    renderFeedSettings();
    chrome.runtime.sendMessage({ action: 'feedBadgeClear' }, () => void chrome.runtime.lastError);
    refreshAll(uiObj);
}

export function initFeedManager(uiObj) {
    uiRef = uiObj;
    els = {
        controls: document.getElementById('feedControls'),
        sourcePill: document.getElementById('feedSourcePill'),
        sourceLabel: document.getElementById('feedSourceLabel'),
        sourceCount: document.getElementById('feedSourceCount'),
        refreshBtn: document.getElementById('feedRefreshBtn'),
        addBtn: document.getElementById('feedAddBtn'),
        chipRow: document.getElementById('feedChipRow'),
        filterChip: document.getElementById('feedFilterChip'),
        opmlInput: document.getElementById('feedOpmlInput'),
        list: document.getElementById('feedItemList'),
        empty: document.getElementById('feedEmpty'),
        screen: document.getElementById('feedsScreen'),
        controlsBar: document.getElementById('feedControls'),
        search: document.getElementById('feedSearch'),
        graphBtn: document.getElementById('feedGraphBtn'),
        insightsBtn: document.getElementById('feedInsightsBtn'),
        graph: document.getElementById('feedGraph'),
        insights: document.getElementById('feedInsights')
    };
    if (!els.list) return;
    initPlayer(syncPlayButtons).catch(() => {});

    els.sourcePill.addEventListener('click', openSourcePicker);
    initSearchAndViews();
    initScrollHide();
    els.refreshBtn.addEventListener('click', () => refreshAll(uiObj, { force: true }));
    els.addBtn.addEventListener('click', openAddSheet);
    els.filterChip.addEventListener('click', openFilterSheet);
    els.chipRow.querySelectorAll('[data-status]').forEach(b => b.addEventListener('click', () => {
        ui.status = b.dataset.status; persistUi(); render();
    }));
    els.opmlInput.addEventListener('change', () => {
        const f = els.opmlInput.files && els.opmlInput.files[0];
        if (f) importOpml(uiObj, f);
        els.opmlInput.value = '';
    });
    const layer = document.getElementById('feedSheetLayer');
    if (layer) layer.querySelector('.feed-scrim').addEventListener('click', closeSheet);
    document.addEventListener('keydown', e => { if (e.key === 'Escape') closeSheet(); });
    // Leaving the screen dismisses transient UI.
    document.querySelectorAll('.nav-item, #settingsButton').forEach(b => b.addEventListener('click', () => { closeSheet(); hideUndo(); }));
    document.addEventListener('aish:settings-panel', async (e) => {
        if (!e.detail || e.detail.name !== 'feeds') return;
        renderFeedSettings();                       // immediately, so search deep-links find their target
        await load(); await loadHistoryMap();
        const root = document.getElementById('feedSettingsRoot');
        if (!(root && root.contains(document.activeElement))) renderFeedSettings();
    });

    // Warm the data so the Settings row subtitle is right, and make sure the
    // background poller matches the saved settings.
    load().then(() => { updateSettingsSub(); sendPollConfig(); }).catch(() => {});
}
