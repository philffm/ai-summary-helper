import { SK, articleRecKey } from './storageKeys.js';
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
import { syncTabbar } from './tabbar.js';
import { trapFocus } from './sheet.js';
import { buildIndex, search as indexSearch } from './localSearch.js';
import { renderInsights } from './feedInsights.js';
import { snapshotMood } from './feedMood.js';
import { openRollup, coverage, weekCells, weekStart, monthStart, periodEnd, isoWeek, rangeText, rollKey, tally, isStale, moodBar, recapKeyTs, isDayRecapKey } from './feedRollup.js';
import { generateRecap, generateRecapUpdate, itemSig, scoreItems, MAX_RECAP_ITEMS, getRecapLimit, setRecapLimit } from './feedAi.js';
import { el } from './dom.js';
import { createRecapStatus } from './recapStatus.js';
import { moodEnabled, setMoodEnabled } from './moodSetting.js';
import { startOfDay } from './dateUtils.js';
import { subTitle, hash, safeHttpUrl, normalizeInputUrl, timeAgo } from './feedUtil.js';
import { parseFeed, opmlXml } from './feedParse.js';

const SUBS_KEY = SK.feedSubs;
const ITEMS_KEY = SK.feedItems;
const UI_KEY = SK.feedUi;
const SETTINGS_KEY = SK.feedSettings;
const RECAPS_KEY = SK.feedRecaps;
const MOOD_KEY = SK.feedMood;   // per-day mood counts; outlives item retention (see feedMood.js)
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
    keepDays: 30,
    recapLimit: 40
};

let subs = [];
let items = [];
let recaps = {};
let moodDaily = {};
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
const splitExtra = new Set();  // extra panes shown beside the list in the split workspace ('graph' | 'insights')
let searchCache = null;        // { ref, len, rated, idx, byStamp, stampOf }
// normalized URL -> { fav: boolean, summarized: boolean } built from the History index
let historyByUrl = new Map();

// ── Storage ────────────────────────────────────────────────────────────────
async function load() {
    const data = await chrome.storage.local.get({
        [SUBS_KEY]: [], [ITEMS_KEY]: [], [UI_KEY]: null, [SETTINGS_KEY]: null, [RECAPS_KEY]: {}, [MOOD_KEY]: {}
    });
    moodDaily = data[MOOD_KEY] || {};
    recaps = data[RECAPS_KEY] || {};
    subs = data[SUBS_KEY] || [];
    items = data[ITEMS_KEY] || [];
    settings = { ...FEED_DEFAULTS, ...(data[SETTINGS_KEY] || {}) };
    setRecapLimit(settings.recapLimit);
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
    syncMood();
}

// Count the current items' moods into the long-lived daily store (older days survive item pruning).
function syncMood() {
    if (snapshotMood(moodDaily, items, itemMood, startOfDay)) chrome.storage.local.set({ [MOOD_KEY]: moodDaily }).catch(() => {});
}

function persist() {
    syncMood();
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

// A feed item that was already AI-scored hands its mood to the History entry once it is summarized/saved.
async function carryMoodToHistory() {
    try {
        const scored = new Map(items.filter(i => i.ai && typeof i.sent === 'number' && i.link).map(i => [normalizeUrl(i.link), i.sent]));
        if (!scored.size) return;
        const { [SK.articlesIndex]: articlesIndex = [] } = await StorageManager.getLocal({ [SK.articlesIndex]: [] });
        const map = {};
        articlesIndex.forEach(a => { if (a.url && typeof a.moodScore !== 'number' && scored.has(normalizeUrl(a.url))) map[a.id] = scored.get(normalizeUrl(a.url)); });
        if (Object.keys(map).length) await StorageManager.setArticleMoods(map);
    } catch (e) { /* mood carry-over is best effort */ }
}

// An article matches a feed link by its page URL or the original feed link it was started from.
function hasUrl(a, key) {
    return [a.url, a.feedUrl].some(u => u && normalizeUrl(u) === key);
}

async function loadHistoryMap() {
    const { [SK.articlesIndex]: articlesIndex = [] } = await StorageManager.getLocal({ [SK.articlesIndex]: [] });
    const map = new Map();
    for (const a of articlesIndex) {
        for (const u of [a.url, a.feedUrl]) {
            if (!u) continue;
            const key = normalizeUrl(u);
            const cur = map.get(key) || { fav: false, summarized: false };
            if (a.favorite) cur.fav = true;
            if (!a.feedStub && !a.savedOnly) cur.summarized = true;
            map.set(key, cur);
        }
    }
    historyByUrl = map;
}
function histOf(item) { return historyByUrl.get(normalizeUrl(item.link)) || { fav: false, summarized: false }; }

// A favorited-but-never-summarized item lives in History as a "stub". Once the
// page has been summarized for real, the stub's star moves to the real entry
// and the stub is removed so History doesn't show the page twice.
export async function reconcileStubs() {
    const { [SK.articlesIndex]: articlesIndex = [] } = await StorageManager.getLocal({ [SK.articlesIndex]: [] });
    const stubs = articlesIndex.filter(a => (a.feedStub || a.savedOnly) && a.url);
    if (!stubs.length) return;
    const drop = new Set();
    for (const stub of stubs) {
        const key = normalizeUrl(stub.url);
        const real = articlesIndex.filter(a => !a.feedStub && !a.savedOnly && hasUrl(a, key));
        if (!real.length) continue;
        if (stub.favorite) real.forEach(r => { r.favorite = true; });
        drop.add(stub.id);
    }
    if (!drop.size) return;
    const next = articlesIndex.filter(a => !drop.has(a.id));
    await StorageManager.setLocal({ [SK.articlesIndex]: next });
    await new Promise(res => chrome.storage.local.remove([...drop].map(articleRecKey), res));
}

// Find the real (non-stub) History entry for a feed item's URL.
async function findSummarizedArticle(url) {
    const key = normalizeUrl(url);
    const { [SK.articlesIndex]: articlesIndex = [] } = await StorageManager.getLocal({ [SK.articlesIndex]: [] });
    const real = articlesIndex.filter(a => !a.feedStub && !a.savedOnly && hasUrl(a, key));
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
    const { [SK.articlesIndex]: articlesIndex = [] } = await StorageManager.getLocal({ [SK.articlesIndex]: [] });
    const matches = articlesIndex.filter(a => hasUrl(a, key));
    const isFav = matches.some(a => a.favorite);
    let createdStub = false;

    if (!isFav) {
        if (matches.length) {
            matches.forEach(a => { a.favorite = true; });
            await StorageManager.setLocal({ [SK.articlesIndex]: articlesIndex });
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
        await StorageManager.setLocal({ [SK.articlesIndex]: next });
        if (removeIds.length) await new Promise(res => chrome.storage.local.remove(removeIds.map(articleRecKey), res));
    }
    await loadHistoryMap();
    render();
    // Optional: favorites summarize themselves in a background tab (always
    // extension mode so nothing steals focus).
    if (createdStub && settings.autoSummarizeFavs) {
        chrome.runtime.sendMessage({ action: 'openFeedItem', url: item.link, summarize: true, forceExtension: true }, () => void chrome.runtime.lastError);
    }
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
    syncMood();   // keep the mood of days that are about to be pruned
    const cutoff = Date.now() - settings.keepDays * DAY_MS;
    items = items.filter(i => i.published >= cutoff || histOf(i).fav);
    // Recaps follow the same retention window (key starts with the day's timestamp).
    Object.keys(recaps).forEach(k => { const ts = recapKeyTs(k); if (ts != null && ts < startOfDay(cutoff)) delete recaps[k]; });
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

function exportOpml() {
    const xml = opmlXml(subs);
    const blob = new Blob([xml], { type: 'text/x-opml' });
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
// Summaries started from a feed card report progress through the same relay as the Summarize screen
// (summaryProgress / summaryComplete / summaryError). The card's button shows it as a ring.
const sumBusy = new Map();   // item.id -> { pct, key, timer }
function paintSum(id) {
    const st = sumBusy.get(id);
    const queued = !!(st && st.queued);
    document.querySelectorAll('.feed-sum-btn').forEach(b => {
        if (b.dataset.id !== id) return;
        b.classList.toggle('busy', !!st);
        b.disabled = !!st && !queued;   // a queued card can be clicked to take it out of the queue again
        b.setAttribute('aria-busy', st ? 'true' : 'false');
        if (queued) {
            b.style.removeProperty('--p'); b.removeAttribute('aria-valuenow'); b.removeAttribute('role');
            b.textContent = T('⏳ Queued'); b.title = T('Waiting for the running summary — click to remove from the queue');
            return;
        }
        b.removeAttribute('title');
        if (st) {
            b.style.setProperty('--p', String(st.pct));
            b.textContent = T('⏳ {n}%', { n: Math.round(st.pct) });
            b.setAttribute('role', 'progressbar'); b.setAttribute('aria-valuenow', String(Math.round(st.pct)));
        } else { b.style.removeProperty('--p'); b.removeAttribute('aria-valuenow'); b.removeAttribute('role'); }
    });
}
function startSumProgress(item) {
    const prev = sumBusy.get(item.id); if (prev) clearTimeout(prev.timer);
    const timer = setTimeout(() => endSumProgress(item.id), 5 * 60 * 1000);   // safety net
    sumBusy.set(item.id, { pct: 5, key: normalizeUrl(item.link), timer, queued: false, jobId: null });
    paintSum(item.id);
}
function rearmSum(id, ms) {   // a queued card may wait much longer than a running one
    const st = sumBusy.get(id); if (!st) return;
    clearTimeout(st.timer); st.timer = setTimeout(() => endSumProgress(id), ms);
}
function endSumProgress(id) {
    const st = sumBusy.get(id); if (!st) return;
    clearTimeout(st.timer); sumBusy.delete(id); paintSum(id);
}
function sumTargetFor(msg, sender) {
    if (!sumBusy.size) return null;
    const urls = [sender && sender.tab && sender.tab.url, msg && msg.url].filter(Boolean).map(u => normalizeUrl(u));
    for (const [id, st] of sumBusy) if (!st.queued && urls.includes(st.key)) return id;
    // redirected pages: a single running summary from a tab is almost certainly ours
    const live = [...sumBusy].filter(([, st]) => !st.queued);
    return live.length === 1 && sender && sender.tab ? live[0][0] : null;
}
// The background runs one summary at a time (see "Summary job queue" in background.js) and broadcasts the line.
function onQueueUpdate(msg) {
    const waiting = new Map((msg.queue || []).map(j => [j.id, j]));
    for (const [id, st] of [...sumBusy]) {
        if (st.jobId == null) continue;
        if (waiting.has(st.jobId)) { if (!st.queued) { st.queued = true; rearmSum(id, 60 * 60 * 1000); paintSum(id); } }
        else if (st.queued) {
            const running = msg.running && msg.running.id === st.jobId;
            st.queued = false; st.pct = 5; rearmSum(id, 15 * 60 * 1000);
            if (running) paintSum(id); else endSumProgress(id);   // removed from the line without ever running
        }
    }
}
function onSummaryMessage(msg, sender) {
    if (msg && msg.action === 'summaryQueue') return onQueueUpdate(msg);
    if (!msg || !['summaryProgress', 'summaryComplete', 'summaryError'].includes(msg.action)) return;
    const id = sumTargetFor(msg, sender); if (!id) return;
    const st = sumBusy.get(id);
    if (msg.action === 'summaryProgress') {
        if (typeof msg.progress === 'number' && msg.progress > st.pct) { st.pct = Math.min(99, msg.progress); paintSum(id); }
    } else if (msg.action === 'summaryComplete') {
        st.pct = 100; paintSum(id);
        // The article is written to History right around the completion message: wait until the index has it.
        const item = items.find(x => x.id === id);
        (async () => {
            for (let k = 0; k < 8; k++) {
                await new Promise(r => setTimeout(r, k ? 500 : 300));
                await loadHistoryMap();
                if (!item || histOf(item).summarized) { await carryMoodToHistory(); break; }
            }
            endSumProgress(id); render();
        })();
    } else {
        endSumProgress(id); toast(uiRef, msg.error || T('Failed'));
    }
}

async function onSummarizeClick(item) {
    const q = sumBusy.get(item.id);
    if (q && q.queued) {   // waiting in line: take it out again
        chrome.runtime.sendMessage({ action: 'cancelQueuedSummary', id: q.jobId }, () => { void chrome.runtime.lastError; });
        endSumProgress(item.id); return;
    }
    const art = await findSummarizedArticle(item.link);
    if (art) return viewSummary(item, art);
    openItem(item, true);
}

function openItem(item, summarize) {
    if (settings.markReadOnOpen) setRead([item], true, { silent: true, keep: true });
    if (summarize) startSumProgress(item);
    chrome.runtime.sendMessage({ action: 'openFeedItem', url: item.link, title: item.title, summarize }, (res) => {
        if (chrome.runtime.lastError || !res || !res.success || (summarize && res.mode !== 'extension')) { if (summarize) endSumProgress(item.id); if (chrome.runtime.lastError) return; }
        if (summarize && res && res.mode === 'extension') {
            const st = sumBusy.get(item.id);
            if (st) { st.jobId = res.id == null ? null : res.id; st.queued = !!res.queued; if (st.queued) rearmSum(item.id, 60 * 60 * 1000); paintSum(item.id); }
            if (res.queued) toast(uiRef, T('Queued — it will start when the current summary is done'));
            else toast(uiRef, T('Summarizing in the background — it will show up under Summarize and History'));
        }
    });
}

// ── Filtering ──────────────────────────────────────────────────────────────
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
    const r = scopeRange();
    if (r) return i.published >= r.from && i.published < startOfDay(r.to + DAY_MS * 1.5);
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
const filtersActive = () => ui.date !== 'any' || ui.mood === 'nonneg' || ui.sort !== 'new';

function passes(i, sm, skipDate = false) {
    if (!inSource(i, sm)) return false;
    const h = histOf(i);
    if (ui.status === 'unread' && i.read && !stickyRead.has(i.id)) return false;
    if (ui.status === 'fav' && !h.fav) return false;
    if (ui.status === 'sum' && !h.summarized) return false;
    if (ui.status === 'audio' && !i.audio) return false;
    if (!skipDate && !inDateFilter(i)) return false;
    const mood = itemMood(i) || 'neu';
    if (moodEnabled()) {
        if (ui.mood === 'pos' && mood !== 'pos') return false;
        if (ui.mood === 'nonneg' && mood === 'neg') return false;
    }
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
    if (ui.sort === 'mood' && moodEnabled()) list.sort((a, b) => (itemMood(b) ? b.sent : -2) - (itemMood(a) ? a.sent : -2) || b.published - a.published);
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
    if (ui.mood === 'nonneg') parts.push(T('No 😟'));
    if (ui.sort === 'mood') parts.push(T('Mood ↓'));
    return (parts.join(' · ') || T('🎛️ Filter')) + ' ▾';
}

// ── Rendering ──────────────────────────────────────────────────────────────
function setBusy(busy) {
    document.querySelectorAll('[data-feed-add]').forEach(b => { b.disabled = busy; });
}

function setRefreshState(on) {
    if (els.refreshBtn) { els.refreshBtn.disabled = on; els.refreshBtn.classList.toggle('spinning', on); }
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
        // The chips are one quick-filter group: 😊 replaces the status chip (incl. All).
        const on = b.dataset.status === ui.status && !(moodEnabled() && ui.mood === 'pos');
        b.classList.toggle('active', on);
        b.setAttribute('aria-pressed', String(on));
        if (b.dataset.status === 'unread') b.textContent = unread ? T('Unread · {n}', { n: unread }) : T('Unread');
    });
    if (els.moodChip) {
        const on = ui.mood === 'pos';
        els.moodChip.classList.toggle('active', on);
        els.moodChip.setAttribute('aria-pressed', String(on));
        els.moodChip.title = els.moodChip.ariaLabel = T('Good mood only');
    }
    els.filterChip.textContent = filterChipLabel();
    els.filterChip.classList.toggle('active', filtersActive());
}

// Starter suggestions (shown on first run and in the Add sheet). Feeds are only
// requested after a click.
const SUGGESTED_FEEDS = [
    { name: 'Street Phil-osophy', tags: ['Podcast', 'Design', 'Independent'], note: N_('Podcast by the author · design, life & tech'), url: 'https://philwornath.com/api/podcast.xml', icon: '🎧' },
    { name: 'BBC News', tags: ['News'], note: N_('World news'), url: 'https://feeds.bbci.co.uk/news/rss.xml', icon: '🌍' },
    { name: 'DW', tags: ['News'], note: N_('Deutsche Welle · top stories'), url: 'https://rss.dw.com/rdf/rss-en-top', icon: '📡' },
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
    const add = btn('button-primary btn-sm', T('Add'), () => addFeed(uiRef, input.value, input));
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
    box.append(btn('button-secondary btn-sm', unreadMode ? T('Show all items') : T('Clear filters'), () => {
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
        if (token !== graphToken || (view !== 'graph' && !splitExtra.has('graph'))) { graphSig = ''; return; }
        mod.initArchiveGraph(box, arts, undefined, c.idx);
    } catch (e) { graphSig = ''; box.replaceChildren(el('p', 'feed-muted feed-ins-empty', T('Failed'))); }
}

function openPeriod(sc, ts) {
    view = 'list'; searchQuery = ''; if (els.search) els.search.value = '';
    ui.date = 'any'; ui.scope = sc; ui.anchor = ts; persistUi(); render();
}

function renderInsightsView() {
    const box = els.insights; if (!box) return;
    const sm = subMap();
    renderInsights(box, {
        items: (() => { const base = items.filter(i => inSource(i, sm)); return splitExtra.has('insights') && searchQuery.trim() ? applySearch(base) : base; })(),
        scopeLabel: sourceLabel(),
        subTitle: (id) => subTitle(sm.get(id)),
        moodStore: moodDaily,
        feedIds: new Set(subs.filter(s => inSource({ feedId: s.id }, sm)).map(s => s.id)),
        unscored: (from, to) => items.filter(i => inSource(i, sm) && !i.ai && i.published >= from && i.published < startOfDay(to) + DAY_MS),
        onScore: async (list) => {
            // Keep going while batches succeed: the mood view caps its list, so pick up what is still unscored.
            for (let guard = 0; guard < 50 && list.length; guard++) {
                const ok = await scoreWithAi(list);
                if (!ok) break;
                list = items.filter(i => inSource(i, subMap()) && !i.ai).sort((a, b) => b.published - a.published).slice(0, 120);
            }
        },
        hasRecap: (sc, st) => !!recaps[sc === 'day' ? `${st}|${ui.source}` : rollKey(sc, st, ui.source)],
        onOpen: (sc, st) => openPeriod(sc, st),
        onRecap: (sc, st) => { openPeriod(sc, st); if (sc === 'day') openRecap(st, dayLabel(st)); else openRollup(sc, st, rollCtx()); },
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
// ⌘F / Ctrl+F, "/" and the placeholder hint are handled centrally in shortcuts.js.
function initSearchShortcut() {}

// Re-rendering right after the screen is shown can clamp/jump scrollTop; that must not hide the bar.
let hideSuppressUntil = 0;
function initScrollHide() {
    const sc = els.screen, bar = els.controlsBar;
    if (!sc || !bar) return;
    let last = 0;
    sc.addEventListener('scroll', () => {
        if (Date.now() < hideSuppressUntil) { last = Math.max(0, sc.scrollTop); bar.classList.remove('scroll-hidden'); return; }
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
    if (scoringIds.has(item.id)) {
        li.classList.add('is-scoring');
        const s = el('span', 'feed-scoring', ' ⏳');
        s.title = T('Scoring with AI…');
        meta.append(s);
    } else if (MOOD_EMOJI[mood]) {
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
    const sum = btn('button-primary btn-sm feed-sum-btn', hist.summarized ? T('📄 View summary') : T('✨ Summarize'), (e) => { e.stopPropagation(); onSummarizeClick(item); });
    sum.dataset.id = item.id;
    if (sumBusy.has(item.id)) queueMicrotask(() => paintSum(item.id));
    const open = btn('button-secondary btn-sm', T('Open ↗'), (e) => { e.stopPropagation(); openItem(item, false); });
    const read = btn('button-secondary btn-sm', item.read ? T('Mark unread') : T('Mark read'), (e) => { e.stopPropagation(); setRead([item], !item.read, { silent: true, keep: true }); });
    if (item.audio) {
        const playing = isPlaying(item.id);
        const pb = btn('button-primary btn-sm feed-play-btn' + (playing ? ' is-playing' : ''), playing ? T('⏸ Pause') : T('▶ Play'), (e) => { e.stopPropagation(); onPlayClick(item); }, T('Play episode in AISH'));
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

function render() { renderList(); renderSplitExtras(); renderScopeRow(); renderRecapCard(); }
function renderSplitExtras() {
    if (!els.list || !subs || !subs.length) return;
    if (els.graph && splitExtra.has('graph')) { els.graph.hidden = false; renderGraphView(); }
    if (els.insights && splitExtra.has('insights')) { els.insights.hidden = false; renderInsightsView(); }
}
document.addEventListener('aish:ws-view', (e) => {
    const d = e.detail || {};
    if (d.scope !== 'feeds') return;
    const v = d.view === 'report' ? 'insights' : d.view;
    if (v !== 'graph' && v !== 'insights') return;
    const had = splitExtra.has(v);
    if (d.open) splitExtra.add(v); else splitExtra.delete(v);
    if (had === !!d.open || !els || !els.list) return;
    if (d.open && view !== 'list') view = 'list';
    if (!d.open) { if (v === 'graph' && els.graph) els.graph.hidden = true; if (v === 'insights' && els.insights) els.insights.hidden = true; }
    else render();
});
function renderList() {
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
    if (effScope() === 'month') { renderMonthWeeks(); return; }
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
            const lab = el('span', 'feed-day-label');
            const pick = btn('feed-day-open', `📅 ${fmtDayShort(groupDay)} · ${TN(group.length, '{n} item', '{n} items')}  ▾`, () => openFilterSheet({ view: 'calendar', day: groupDay }), T('Pick a day'));
            lab.append(pb, pick, nb);
            header.append(lab);
            if (groupDay !== startOfDay(Date.now())) header.append(btn('feed-day-action feed-day-today', T('Today'), () => step(startOfDay(Date.now())), T('Jump to today')));
        } else {
            const lab = btn('feed-day-label feed-day-open', '📅 ' + labelText + '  ▾', () => openFilterSheet({ view: 'calendar', day: groupDay }), T('Pick a day'));
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
    trapSheet(layer, title);
}
// Replace the whole sheet content (custom header) — used by the two-level Date & mood sheet.
function showSheet(...nodes) {
    const layer = document.getElementById('feedSheetLayer');
    const body = document.getElementById('feedSheetBody');
    if (!layer || !body) return;
    body.replaceChildren(...nodes);
    layer.hidden = false;
    trapSheet(layer, (body.querySelector('h3') || {}).textContent);
}
let sheetTrap = null;
function trapSheet(layer, label) {
    const dlg = layer.querySelector('.feed-sheet');
    if (dlg && label) dlg.setAttribute('aria-label', label);
    if (!sheetTrap) sheetTrap = trapFocus(dlg, { label });
}
function closeSheet() {
    const layer = document.getElementById('feedSheetLayer');
    if (layer) layer.hidden = true;
    if (sheetTrap) { sheetTrap.release(); sheetTrap = null; }
}

function radioRow(label, count, selected, onClick, { muted = false, indent = false } = {}) {
    const b = el('button', 'feed-pick-row' + (selected ? ' selected' : '') + (muted ? ' is-muted' : '') + (indent ? ' indent' : ''));
    b.type = 'button';
    b.append(el('span', 'feed-pick-radio', selected ? '●' : '○'), el('span', 'feed-pick-name', label), el('span', 'feed-pick-count', count || ''));
    b.addEventListener('click', onClick);
    return b;
}

async function openFeedSettings() {
    closeSheet();
    const nav = await import('./settingsNav.js');
    uiRef.showScreen('settings');
    setTimeout(() => nav.openSettingsPanel('feeds'), 50);
}
// Section label with a small Edit link to the feed settings.
function pickHead(label) {
    const row = el('div', 'feed-pick-head');
    const e = btn('feed-pick-edit', T('Edit'), openFeedSettings, T('Edit feeds & tags in Settings'));
    row.append(el('div', 'feed-pick-label', label), e);
    return row;
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
            list.append(pickHead(TU('Tags')));
            const chips = el('div', 'feed-tag-chips');
            tags.forEach(t => {
                const on = ui.source === 'tag:' + t, n = cnt(i => hasTag(sm.get(i.feedId), t) && !sm.get(i.feedId).muted);
                const c = el('button', 'pill pill--soft feed-tag-chip' + (on ? ' selected' : ''));
                c.type = 'button'; c.setAttribute('aria-pressed', String(on));
                c.append(el('span', null, '# ' + t)); if (n) c.append(el('span', 'feed-tag-n', n));
                c.addEventListener('click', () => choose('tag:' + t));
                chips.append(c);
            });
            list.append(chips);
        }
        const matching = (s) => !q || subTitle(s).toLowerCase().includes(q) || (s.tags || []).some(t => t.toLowerCase().includes(q));
        const shown = subs.filter(matching);
        if (shown.length) {
            if (tags.length) list.append(pickHead(TU('Feeds')));
            shown.sort((a, b) => subTitle(a).localeCompare(subTitle(b))).forEach(s => {
                list.append(radioRow((s.muted ? '🔕 ' : '') + subTitle(s), cnt(i => i.feedId === s.id), ui.source === 'sub:' + s.id, () => choose('sub:' + s.id), { muted: s.muted }));
            });
        }
        if (!list.children.length) list.append(el('p', 'feed-muted', T('No sources match.')));
    };
    search.addEventListener('input', draw);
    body.append(search, list, btn('feed-manage-link', T('⚙️  Manage feeds & tags in Settings  ›'), openFeedSettings));
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
        if (moodEnabled()) section(TU('Mood'), 'mood', [['any', T('Any mood')], ['pos', T('😊  Positive only')], ['nonneg', T('Hide negative')]]);
        if (moodEnabled()) section(TU('Sort'), 'sort', [['new', T('Newest first')], ['mood', T('Most positive first')]]);
        body.append(el('div', 'feed-pick-label', TU('More')));
        body.append(btn('feed-manage-link', T('✓  Mark everything in this view read'), () => {
            const list = visibleItems().filter(i => !i.read);
            closeSheet();
            if (list.length) setRead(list, true, { label: T('Marked {n} read', { n: list.length }) });
        }));
        body.append(el('p', 'feed-muted', T('Mood comes from AI scoring only — items you haven’t scored have no mood and are never hidden by the mood filter. Scoring sends titles and short snippets to your AI connection when you click it.')));
        showSheet(head(left, T('🎛️ Filter')), body);
    };

    const drawCal = () => {
        const body = el('div', 'feed-picker feed-cal');
        const back = btn('feed-sheet-done feed-sheet-back', T('‹ Filter'), () => { view = 'main'; anchor = null; draw(); });

        // counts per day within the current source scope
        const sm = subMap(); const counts = new Map();
        items.forEach(i => {
            if (!inSource(i, sm)) return;
            const k = startOfDay(i.published); const c = counts.get(k) || { n: 0, unread: 0 };
            c.n++; if (!i.read) c.unread++; counts.set(k, c);
        });
        const recapDays = new Set(Object.keys(recaps).filter(isDayRecapKey).map(k => Number(k.split('|')[0])));
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
            if (c) { cell.dataset.lvl = String(Math.min(5, Math.max(1, Math.ceil(5 * Math.log(1 + c.n) / Math.log(1 + max))))); cell.style.setProperty('--heat', (Math.log(1 + c.n) / Math.log(1 + max)).toFixed(2)); }
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
                if (opts.onPick) { opts.onPick(ts); closeSheet(); return; }
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
    const add = btn('button-primary btn-sm', T('Add'), () => addFeed(uiRef, input.value, input));
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
        .sort((a, b) => b.published - a.published);
}
/** What one recap request covers (newest first); the rest is reported as "not in this recap". */
const recapCovered = (all) => all.slice(0, getRecapLimit());
function idsHash(list) { return hash(list.map(i => i.id).sort().join(',')); }
function aiTitleOf(sm) { return i => subTitle(sm.get(i.feedId)); }

// Rate/categorize in the same request as a recap. Existing ratings and categories are never overwritten.
// Also called while the reply streams in (live = true): only re-renders when something changed, saves at the end.
function applyRatings(arr, r, rate, live = false) {
    if (!rate || !(r.labels || r.scores)) return;
    let changed = false;
    arr.forEach((x, n) => {
        if (r.labels && !x.cat && r.labels[n]) { x.cat = r.labels[n]; changed = true; }
        if (r.scores && !x.ai && r.scores[n] != null) { x.sent = r.scores[n]; x.ai = true; changed = true; }
    });
    if (live && !changed) return;
    if (!live) persist();
    render();
}
const liveRatings = (arr, rate) => (r) => applyRatings(arr, r, rate, true);

/** Write (and store) a day recap without opening its sheet — used by week/month recaps for days that have none yet. */
async function buildDayRecap(dayStart, source) {
    const all = recapScope(dayStart, source);
    const list = recapCovered(all);
    if (!list.length) return null;
    const rate = settings.rateWithRecap !== false;
    const r = await generateRecap(list, aiTitleOf(subMap()), { rate, onRatings: liveRatings(list, rate) });
    applyRatings(list, r, rate);
    const { labels: _l, scores: _s, ...rc } = r;
    const key = `${dayStart}|${source}`;
    recaps[key] = { ...rc, hash: idsHash(list), at: Date.now(), n: list.length, total: all.length, covered: Object.fromEntries(list.map(x => [x.id, itemSig(x)])) };
    chrome.storage.local.set({ [RECAPS_KEY]: recaps }).catch(() => {});
    return recaps[key];
}

function rollCtx(source = ui.source) {
    const sm = subMap();
    return {
        source, el, btn, T, TN, startOfDay, itemMood, openSheet, closeSheet,
        getItems: () => items, getRecaps: () => recaps,
        saveRecaps: () => { chrome.storage.local.set({ [RECAPS_KEY]: recaps }).catch(() => {}); renderRecapCard(); },
        inSource: (i) => inSource(i, sm, source),
        buildDay: buildDayRecap,
        toast: (m) => toast(uiRef, m),
    };
}

// ── Scope row: Feed | Day | Week | Month ────────────────────────────────────
// Feed = plain scroll across days. Day / Week / Month show that period as a page: its recap on top, its items
// (Month: its weeks) below. A search, graph/insights view or an explicit date filter always wins over the scope.
const SCOPES = ['feed', 'day', 'week', 'month'];
const effScope = () => (searchQuery.trim() || view !== 'list' || ui.date !== 'any') ? 'feed' : (SCOPES.includes(ui.scope) ? ui.scope : 'feed');
function addDaysTs(ts, n) { const d = new Date(ts); d.setDate(d.getDate() + n); d.setHours(0, 0, 0, 0); return d.getTime(); }
const scopeAnchor = () => Number.isFinite(ui.anchor) ? ui.anchor : startOfDay(Date.now());
const scopeStart = (sc, a) => sc === 'week' ? weekStart(a) : sc === 'month' ? monthStart(a) : a;
/** Inclusive day range of a Day/Week page; null for Feed and Month (Month lists weeks instead of items). */
function scopeRange() {
    const sc = effScope();
    if (sc !== 'day' && sc !== 'week') return null;
    const ps = scopeStart(sc, scopeAnchor());
    return { from: ps, to: Math.min(addDaysTs(periodEnd(sc, ps), -1), startOfDay(Date.now())) };
}

// The day group under the top bar while scrolling the Feed.
function currentFeedDay() {
    const hs = els.list ? [...els.list.querySelectorAll('.feed-day[data-day]')] : [];
    if (!hs.length) return startOfDay(Date.now());
    const bar = els.controlsBar;
    const edge = bar && !bar.classList.contains('scroll-hidden') ? bar.getBoundingClientRect().bottom : (els.screen ? els.screen.getBoundingClientRect().top : 0);
    let cur = hs[0];
    for (const h of hs) { if (h.getBoundingClientRect().top <= edge + 24) cur = h; else break; }
    return Number(cur.dataset.day);
}

function setScope(k) {
    if (!SCOPES.includes(k)) return;
    const was = effScope();
    if (k === was && !(searchQuery.trim() || view !== 'list' || ui.date !== 'any')) return;
    if (was === 'feed' && k !== 'feed' && !(searchQuery.trim() || view !== 'list' || ui.date !== 'any')) ui.anchor = currentFeedDay();
    if (searchQuery.trim() || view !== 'list') { searchQuery = ''; view = 'list'; if (els.search) els.search.value = ''; }
    if (ui.date !== 'any' && k !== 'feed') { ui.anchor = isDayRange(ui.date) ? ui.date.from : ui.anchor; }
    if (ui.date !== 'any') ui.date = 'any';
    ui.scope = k; persistUi(); render();
    if (k === 'feed' && Number.isFinite(ui.anchor)) {
        const h = els.list && els.list.querySelector(`.feed-day[data-day="${ui.anchor}"]`);
        if (h && h.scrollIntoView) h.scrollIntoView({ block: 'start', behavior: 'auto' });
    }
}

function renderScopeRow() {
    const row = els.scopeRow;
    if (!row) return;
    row.hidden = !subs.length;
    const cur = effScope();
    // Labels are re-read on every render: the dictionary may finish loading after the row was first built.
    const labels = { feed: T('Feed'), day: T('Day'), week: T('Week'), month: T('Month') };
    if (!row.querySelector('.feed-scope-btn')) SCOPES.forEach(k => { const b = btn('feed-scope-btn tabbar-btn', labels[k], () => setScope(k)); b.dataset.scope = k; row.append(b); });
    row.querySelectorAll('.feed-scope-btn').forEach(b => { const on = b.dataset.scope === cur; b.textContent = labels[b.dataset.scope]; b.classList.toggle('active', on); b.classList.toggle('on', on); b.setAttribute('aria-pressed', on ? 'true' : 'false'); });
    row.setAttribute('aria-label', T('Recap scope'));
    syncTabbar(row);
}

function scopeLabel(sc, ps) {
    if (sc === 'day') return fmtDayShort(ps);
    if (sc === 'week') return `${T('Week {n}', { n: isoWeek(ps) })} · ${rangeText(ps, Math.min(addDaysTs(ps, 6), startOfDay(Date.now())))}`;
    return new Date(ps).toLocaleDateString(locale(), { month: 'long', year: 'numeric' });
}

// Recap on top of a Day / Week / Month page: ‹ period ›, day strip (week), recap preview, one button.
function renderRecapCard() {
    const box = els.recapCard;
    if (!box) return;
    const sc = effScope();
    if (!subs.length || sc === 'feed') { box.hidden = true; box.replaceChildren(); return; }
    box.hidden = false; box.replaceChildren();
    const ctx = rollCtx();
    const a = scopeAnchor(), ps = scopeStart(sc, a), pe = periodEnd(sc, ps);
    const stops = dayStops();
    const prev = [...stops].reverse().find(t => t < ps), next = stops.find(t => t >= pe);
    const step = (t) => { ui.anchor = t; persistUi(); render(); };
    const pb = btn('feed-rc-step', '‹', () => step(prev), T('Older')); pb.disabled = prev == null;
    const nb = btn('feed-rc-step', '›', () => step(next), T('Newer')); nb.disabled = next == null;
    const lab = btn('feed-rc-label feed-rc-open', scopeLabel(sc, ps) + '  ▾', () => openFilterSheet({ view: 'calendar', day: a, onPick: (t) => { ui.anchor = t; persistUi(); render(); } }), T('Pick a day'));
    const nav = el('div', 'feed-rc-row feed-rc-nav'); nav.append(pb, lab, nb);
    const todayTs = startOfDay(Date.now());
    if (!(ps <= todayTs && todayTs < pe)) nav.append(btn('feed-rc-today', T('Today'), () => step(todayTs), T('Jump to today')));
    box.append(nav);
    if (sc === 'week') {
        const strip = el('div', 'feed-rc-strip');
        weekCells(a, ctx).forEach(c => {
            const b = btn('feed-rc-cell ' + c.status, new Date(c.day).toLocaleDateString(locale(), { weekday: 'narrow' }), () => {
                const h = els.list && els.list.querySelector(`.feed-day[data-day="${c.day}"]`);
                if (h && h.scrollIntoView) h.scrollIntoView({ block: 'start', behavior: 'auto' });
            }, fmtDayShort(c.day));
            b.disabled = c.status === 'off' || c.status === 'none';
            strip.append(b);
        });
        box.append(strip);
    }
    const key = sc === 'day' ? `${ps}|${ui.source}` : rollKey(sc, ps, ui.source);
    const rec = recaps[key];
    let stale = false;
    if (rec && sc === 'day') stale = !!(rec.covered && recapCovered(recapScope(ps, ui.source)).some(x => rec.covered[x.id] !== itemSig(x)));
    else if (rec) stale = isStale(sc, a, ctx);
    if (rec && rec.overview) box.append(el('p', 'feed-rc-sum', rec.overview));
    if (rec && sc === 'day' && rec.total > rec.n) box.append(el('p', 'feed-muted', TN(rec.total - rec.n, '{n} older item is not in this recap.', '{n} older items are not in this recap.')));
    if (rec) {
        const tl = tally(items, ctx, ps, Math.min(addDaysTs(pe, -1), startOfDay(Date.now())), itemMood);
        if (tl.rated) box.append(moodBar(el, tl));
    }
    if (sc !== 'day') {
        const cv = coverage(sc, a, ctx);
        if (cv.of) box.append(el('p', 'feed-muted feed-rc-cov', T('{a} of {b} days have a recap', { a: cv.have, b: cv.of })));
    }
    if (stale) box.append(el('p', 'feed-recap-stale', sc === 'day' ? T('New items arrived since this recap — Refresh to include them.') : T('A source recap changed since this one was written — Refresh to include it.')));
    const act = btn('button-primary btn-sm feed-rc-act', !rec ? T('✨ Recap') : stale ? T('↻ Refresh') : T('✨ Recap') + ' ✓', () => {
        if (sc === 'day') openRecap(ps, dayLabel(ps)); else openRollup(sc, a, rollCtx());
    }, sc === 'day' ? T('AI recap of this day') : sc === 'week' ? T('AI recap of this week, built from its day recaps') : T('AI recap of this month, built from its week and day recaps'));
    box.append(act);
}

// Month page: the weeks of that month as the list. Tap a week to open its page.
function renderMonthWeeks() {
    const sm = subMap();
    const today = startOfDay(Date.now());
    const ms = monthStart(scopeAnchor()), me = periodEnd('month', ms) - DAY_MS, last = Math.min(me, today);
    els.empty.style.display = 'none';
    const counts = new Map();
    items.forEach(i => { if (!passes(i, sm, true)) return; const d = startOfDay(i.published); if (d >= ms && d <= last) counts.set(weekStart(d), (counts.get(weekStart(d)) || 0) + 1); });
    for (let w = weekStart(last); w >= weekStart(ms); w = addDaysTs(w, -7)) {
        const n = counts.get(w) || 0;
        const rec = recaps[rollKey('week', w, ui.source)];
        const row = el('li', 'feed-weekrow');
        const b = btn('feed-weekrow-btn', '', () => { ui.scope = 'week'; ui.anchor = Math.max(w, ms); persistUi(); render(); });
        const col = el('span', 'feed-weekrow-text');
        col.append(el('span', 'feed-weekrow-title', `${T('Week {n}', { n: isoWeek(w) })} · ${rangeText(Math.max(w, ms), Math.min(addDaysTs(w, 6), last))}`),
            el('span', 'feed-muted', (n ? TN(n, '{n} item', '{n} items') : T('No items')) + (n || rec ? ' · ' + (rec ? T('✨ Recap') : T('no recap yet')) : '')));
        b.append(col, el('span', 'feed-weekrow-go', '›'));
        row.append(b); els.list.appendChild(row);
    }
}

/** Two-step button: first click arms it (label changes for 4 s), second click runs `fn`. */
function confirmBtn(label, armedLabel, fn) {
    let timer = 0;
    const b = btn('btn-sm', label, () => {
        if (!timer) {
            b.textContent = armedLabel;
            timer = setTimeout(() => { timer = 0; b.textContent = label; }, 4000);
            return;
        }
        clearTimeout(timer); timer = 0; fn();
    });
    return b;
}

async function openRecap(dayStart, label, source = ui.source, autoRefresh = false) {
    const all = recapScope(dayStart, source);
    const list = recapCovered(all);
    const missing = all.slice(list.length);
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
        if (missing.length) {
            const box = el('div', 'feed-recap-missing');
            box.append(el('p', 'feed-recap-stale', TN(missing.length, '{n} older item is not in this recap (limit: {max} per recap).', '{n} older items are not in this recap (limit: {max} per recap).', { max: list.length })));
            const nxt = Math.min(Math.max(all.length, 10), 400);
            if (nxt > list.length) {
                box.append(btn('btn-sm', T('Raise limit to {n} and refresh', { n: nxt }), async () => { await setSetting('recapLimit', nxt); closeSheet(); openRecap(dayStart, label, source, true); }));
            } else {
                box.append(el('p', 'feed-muted', T('That is the maximum per recap. Use the Week or Month recap for a bigger picture, or filter by feed.')));
            }
            const det = el('details', 'feed-recap-missing-list');
            det.append(el('summary', null, T('Show them — open one by one')));
            missing.forEach(x => { const a = el('a', null, x.title || x.link); a.href = x.link; a.target = '_blank'; a.rel = 'noopener'; det.append(a); });
            box.append(det);
            body.append(box);
        }
        if (stale) body.append(el('p', 'feed-recap-stale', T('New items arrived since this recap — Refresh to include them.')));
        const row = el('div', 'feed-recap-actions');
        row.append(btn('btn-sm', T('↻ Refresh'), () => run(true)),
            confirmBtn(T('Reset'), T('Discard & rewrite?'), () => {
                delete recaps[key];
                chrome.storage.local.set({ [RECAPS_KEY]: recaps }).catch(() => {});
                renderRecapCard();
                run(false);
            }),
            btn('btn-sm', T('Copy'), async () => {
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
    const run = async (force) => {
        const cached = recaps[key];
        const hsh = idsHash(list);
        const fresh = cached && cached.covered ? changedSince(cached) : null;
        if (cached && !force) return draw(cached, fresh ? fresh.length > 0 : cached.hash !== hsh);
        const rate = settings.rateWithRecap !== false;
        // Refresh = previous recap + only the new/edited items; nothing new means no AI request at all.
        if (cached && fresh) {
            if (!fresh.length) {
                toast(uiRef, T('Nothing new since this recap'));
                draw(cached, false);
                body.prepend(el('p', 'feed-muted', T('Nothing new since this recap — Reset rewrites it from scratch.')));
                return;
            }
            const st = createRecapStatus({ title: T('✨ Updating recap…'), detail: T('Sending {n} new or edited titles and short snippets to your AI connection.', { n: Math.min(fresh.length, getRecapLimit()) }), onCancel: () => draw(cached, true) });
            body.replaceChildren(st.node);
            try {
                const r = await generateRecapUpdate(cached, fresh, aiTitleOf(sm), { rate, edited: (x) => x.id in cached.covered, onStage: st.onStage, signal: st.signal, onProgress: st.onProgress, onRatings: liveRatings(fresh.slice(0, getRecapLimit()), rate) });
                st.stop();
                applyRatings(r.sent, r, rate);
                const { labels: _l, scores: _s, sent: sentItems, ...rc } = r;
                recaps[key] = { ...rc, hash: hsh, at: Date.now(), n: list.length, total: all.length, covered: { ...cached.covered, ...sigsOf(sentItems) } };
                chrome.storage.local.set({ [RECAPS_KEY]: recaps }).catch(() => {});
                renderRecapCard();
                draw(recaps[key], changedSince(recaps[key]).length > 0);
            } catch (e) {
                st.stop();
                if (e.cancelled) return;
                body.replaceChildren(el('p', 'feed-error', e.message || T('Recap failed')),
                    btn('btn-sm', T('Try again'), () => run(true)));
            }
            return;
        }
        const st = createRecapStatus({ title: T('✨ Writing recap…'), detail: T('Sending {n} titles and short snippets to your AI connection.', { n: list.length }), onCancel: () => { body.replaceChildren(el('p', 'feed-muted', T('Cancelled')), btn('btn-sm', T('Try again'), () => run(true))); } });
        body.replaceChildren(st.node);
        try {
            const r = await generateRecap(list, aiTitleOf(sm), { rate, onStage: st.onStage, signal: st.signal, onProgress: st.onProgress, onRatings: liveRatings(list, rate) });
            st.stop();
            applyRatings(list, r, rate);
            const { labels: _l, scores: _s, ...rc } = r;
            recaps[key] = { ...rc, hash: hsh, at: Date.now(), n: list.length, total: all.length, covered: sigsOf(list) };
            chrome.storage.local.set({ [RECAPS_KEY]: recaps }).catch(() => {});
            renderRecapCard();
            draw(recaps[key], false);
        } catch (e) {
            st.stop();
            if (e.cancelled) return;
            body.replaceChildren(el('p', 'feed-error', e.message || T('Recap failed')),
                btn('btn-sm', T('Try again'), () => run(true)));
        }
    };
    run(!!autoRefresh);
}

// An item needs the AI only if it has no AI score or no category yet.
const needsAi = (i) => !i.ai || !i.cat;
let scoring = false;
// Ids of items currently queued/being scored; their cards show a small indicator.
const scoringIds = new Set();

/** Runs in the background (no sheet): the cards being scored show ⏳ and fill in as each batch finishes. */
async function scoreWithAi(list) {
    if (scoring) { toast(uiRef, T('Already scoring — one moment')); return false; }
    const all = (list || []).filter(Boolean);
    list = all.filter(needsAi);
    if (!all.length) { toast(uiRef, T('Nothing to score')); return false; }
    if (!list.length) { toast(uiRef, T('These items are already scored')); return false; }
    const sm = subMap();
    let done = 0, error = null;
    scoring = true;
    list.forEach(i => scoringIds.add(i.id));
    render();
    const batches = Math.ceil(list.length / MAX_RECAP_ITEMS);
    toast(uiRef, T('Scoring {n} items with AI in the background…', { n: list.length }));
    let failed = 0;
    try {
        for (let k = 0; k < list.length; k += MAX_RECAP_ITEMS) {
            const chunk = list.slice(k, k + MAX_RECAP_ITEMS);
            let res;
            try {
                res = await scoreItems(chunk, aiTitleOf(sm), {});
            } catch (e) {
                // one unreadable reply must not stop the remaining batches
                failed += chunk.length; error = e;
                toast(uiRef, T('Batch {a}/{b} failed: {m}', { a: k / MAX_RECAP_ITEMS + 1, b: batches, m: e.message || T('AI scoring failed') }));
                continue;
            } finally { chunk.forEach(i => scoringIds.delete(i.id)); }
            chunk.forEach((i, n) => {
                // never overwrite an existing AI score or category
                if (!i.ai && res.scores[n] !== null) { i.sent = res.scores[n]; i.ai = true; done++; }
                if (!i.cat && res.labels && res.labels[n]) { i.cat = res.labels[n]; done = Math.max(done, 1); }
            });
            await persist();
            render();
            if (batches > 1) toast(uiRef, T('Scored {a} of {b}…', { a: Math.min(k + chunk.length, list.length), b: list.length }));
        }
    } catch (e) {
        error = e;
    } finally {
        scoring = false;
        scoringIds.clear();
        render();
    }
    const summary = done ? TN(done, 'Scored {n} item with AI', 'Scored {n} items with AI') + (all.length > list.length ? ' ' + T('({n} already done)', { n: all.length - list.length }) : '') : '';
    if (error) toast(uiRef, (failed ? T('{n} items could not be scored', { n: failed }) : (error.message || T('AI scoring failed'))) + (summary ? ' — ' + summary : ''));
    else toast(uiRef, summary || T('AI scoring failed'));
    return !error && done > 0;
}

// ── Settings > Feeds panel ─────────────────────────────────────────────────
function updateSettingsSub() {
    const sub = document.querySelector('.settings-row-sub[data-sub="feeds"]');
    if (!sub) return;
    const prefSub = document.querySelector('.settings-row-sub[data-sub="feedprefs"]');
    if (prefSub) prefSub.textContent = T('Reading · AI · updates');
    const folders = allTags().length;
    sub.textContent = subs.length
        ? TN(subs.length, '{n} feed', '{n} feeds') + (folders ? ' · ' + TN(folders, '{n} tag', '{n} tags') : '')
        : T('Subscriptions · tags · OPML');
}

function sendPollConfig() {
    chrome.runtime.sendMessage({ action: 'feedPollConfig' }, () => void chrome.runtime.lastError);
}

async function setSetting(key, value) {
    settings[key] = value;
    await persistSettings();
    if (key === 'backgroundPoll' || key === 'refreshMinutes') sendPollConfig();
    if (key === 'recapLimit') setRecapLimit(value);
    if (key === 'keepDays') { pruneItems(); await persist(); render(); }
}

// Source diet: last-30-day usage and mood per subscription (mood only from rated items).
const DIET_DAYS = 30, DIET_MIN_SCORED = 5, NOISY_MOOD = -30;
let openSubId = null, subFilter = 'all', subSort = moodEnabled() ? 'mood' : 'unread', dietDismissed = false;
function dietStats(s) {
    const since = Date.now() - DIET_DAYS * 864e5;
    const mine = items.filter(i => i.feedId === s.id && i.published >= since);
    const scored = mine.filter(i => i.ai && typeof i.sent === 'number');
    const mood = scored.length >= DIET_MIN_SCORED ? Math.round(scored.reduce((a, i) => a + i.sent, 0) / scored.length * 100) : null;
    const read = mine.length ? Math.round(mine.filter(i => i.read).length / mine.length * 100) : null;
    if (!moodEnabled()) return { n: mine.length, read, mood: null, noisy: false, unread: items.filter(i => i.feedId === s.id && !i.read).length };
    return { n: mine.length, read, mood, noisy: mood !== null && mood <= NOISY_MOOD, unread: items.filter(i => i.feedId === s.id && !i.read).length };
}
function dietMoodBar(m) {
    const w = el('span', 'sd-mood');
    w.append(el('span', 'sd-mood-track'), el('span', 'sd-mood-mid'));
    if (m === null) { w.classList.add('is-empty'); w.title = T('Not enough rated items yet'); return w; }
    const f = el('span', 'sd-mood-fill ' + (m < 0 ? 'neg' : 'pos'));
    f.style.width = Math.abs(m) / 2 + '%'; f.style[m < 0 ? 'right' : 'left'] = '50%';
    w.append(f);
    return w;
}

function subRow(s) {
    const st = dietStats(s);
    const open = openSubId === s.id;
    const row = el('div', 'feed-sub-card' + (s.muted ? ' is-muted' : '') + (open ? ' is-open' : ''));
    row.dataset.subId = s.id;

    // Summary line (always visible): avatar · name · tags · mood bar · usage
    const head = el('div', 'sd-head'); head.tabIndex = 0; head.setAttribute('role', 'button'); head.setAttribute('aria-expanded', String(open));
    const av = el('span', 'sd-avatar', (subTitle(s).trim()[0] || '•').toUpperCase());
    const main = el('div', 'sd-main');
    main.append(el('div', 'sd-name', subTitle(s)));
    const meta = el('div', 'sd-tags');
    (s.tags || []).forEach(t => meta.append(el('span', 'sd-tag', t)));
    if (st.noisy) meta.append(el('span', 'sd-flag sd-flag-noisy', '⚠ ' + T('Noisy')));
    if (s.muted) meta.append(el('span', 'sd-flag', '🔕 ' + T('Muted')));
    if (s.error) meta.append(el('span', 'sd-flag sd-flag-err', '⚠ ' + s.error));
    main.append(meta);
    const diet = el('div', 'sd-diet');
    const mrow = el('div', 'sd-mood-row');
    mrow.append(dietMoodBar(st.mood), el('span', 'sd-mood-val ' + (st.mood === null ? '' : st.mood < 0 ? 'neg' : 'pos'), st.mood === null ? '–' : (st.mood > 0 ? '+' : st.mood < 0 ? '−' : '') + Math.abs(st.mood)));
    diet.append(mrow, el('div', 'sd-use', st.n ? TU('{n}/mo · {r}% read', { n: st.n, r: st.read }) : T('No items yet')));
    head.append(av, main, diet);
    const toggle = () => { openSubId = open ? null : s.id; renderFeedSettings(); };
    head.addEventListener('click', toggle);
    head.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); } });
    row.append(head);

    // Editor (rendered always so search/tests find the fields; shown when open)
    const ed = el('div', 'sd-edit');
    ed.append(el('div', 'sd-label', T('Name')));
    const name = el('input', 'feed-sub-input');
    name.type = 'text'; name.value = subTitle(s); name.setAttribute('aria-label', T('Feed name'));
    name.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); name.blur(); } });
    name.addEventListener('change', async () => {
        const v = name.value.trim();
        if (v) s.customTitle = v; else { delete s.customTitle; name.value = subTitle(s); }
        await persist(); render(); renderFeedSettings();
    });
    ed.append(name);
    ed.append(el('div', 'sd-label', T('Tags')));
    const tagBox = el('div', 'feed-tags');
    const saveTags = async (next) => {
        s.tags = cleanTags(next);
        if (!sourceExists(ui.source)) ui.source = 'all';
        await persist(); render(); renderFeedSettings();
    };
    (s.tags || []).forEach(t => {
        const chip = el('span', 'feed-sub-tag', t);
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
    ed.append(tagBox);
    ed.append(el('div', 'sd-label', TU('{n} unread', { n: st.unread })));
    const acts = el('div', 'sd-actions');
    acts.append(
        btn('button-secondary btn-sm', s.muted ? T('Unmute') : T('Mute'), async () => { s.muted = !s.muted; delete s.mutedUntil; await persist(); render(); renderFeedSettings(); },
            s.muted ? T('Unmute (include in All sources)') : T('Mute (leave out of All sources)')),
        btn('button-danger-outline btn-sm', T('Unsubscribe'), () => { removeFeed(s.id); }, T('Unsubscribe')));
    ed.append(acts);
    row.append(ed);
    return row;
}

function toggleRow(id, title, hint, key) {
    const row = el('div', 'setting-group flex justify-between align-center mb-3');
    const left = el('div', 'setting-text');
    const lab = el('label', null, title); lab.htmlFor = id; lab.className = 'setting-label';
    const p = el('p', 'setting-desc', hint);
    left.append(lab, p);
    const sw = el('label', 'switch setting-switch');
    const cb = el('input'); cb.type = 'checkbox'; cb.id = id; cb.checked = !!settings[key];
    cb.addEventListener('change', () => setSetting(key, cb.checked));
    sw.append(cb, el('span', 'slider-toggle'));
    row.append(left, sw);
    return row;
}

function moodToggleRow() {
    const row = el('div', 'setting-group flex justify-between align-center mb-3');
    const left = el('div', 'setting-text');
    const lab = el('label', null, T('😊 Mood')); lab.htmlFor = 'feedSetMood'; lab.className = 'setting-label';
    const p = el('p', null, T('Rates the tone of summaries and feed items. Powers mood filters, charts and the Source diet. Turn off to hide all mood features.')); p.className = 'setting-desc';
    left.append(lab, p);
    const sw = el('label', 'switch setting-switch');
    const cb = el('input'); cb.type = 'checkbox'; cb.id = 'feedSetMood'; cb.checked = moodEnabled();
    cb.addEventListener('change', async () => {
        await setMoodEnabled(cb.checked);
        if (!cb.checked && (ui.mood !== 'any' || ui.sort === 'mood')) { ui.mood = 'any'; if (ui.sort === 'mood') ui.sort = 'new'; persistUi(); }
        if (!cb.checked && subSort === 'mood') subSort = 'unread';
        render(); renderFeedSettings();
    });
    sw.append(cb, el('span', 'slider-toggle'));
    row.append(left, sw);
    return row;
}

function selectRow(id, title, key, opts) {
    const row = el('div', 'setting-group flex justify-between align-center mb-3');
    const lab = el('label', null, title); lab.htmlFor = id; lab.className = 'setting-label-grow';
    const sel = el('select'); sel.id = id; sel.className = 'setting-select';
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

    // Add + OPML menu
    const addRow = el('div', 'feed-add-row');
    const input = el('input'); input.type = 'text'; input.placeholder = T('Add a site or feed address…'); input.autocomplete = 'off'; input.spellcheck = false;
    const add = btn('button-secondary btn-sm', T('＋ Add'), () => addFeed(uiRef, input.value, input));
    add.setAttribute('data-feed-add', '');
    input.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); addFeed(uiRef, input.value, input); } });
    const more = el('details', 'sd-more');
    more.append(el('summary', 'feed-icon-btn', '⋯'));
    const io = el('div', 'sd-more-menu');
    io.id = 'feedOpmlActions';
    io.append(btn('button-secondary btn-sm', T('📥 Import OPML'), () => { more.open = false; els.opmlInput.click(); }),
        btn('button-secondary btn-sm', T('📤 Export OPML'), () => { more.open = false; if (!subs.length) return toast(uiRef, T('Nothing to export yet')); exportOpml(); }));
    more.append(io);
    addRow.append(input, add, more);
    root.append(addRow);

    const stats = new Map(subs.map(s => [s.id, dietStats(s)]));

    // Insight banner: only when something is actually noisy
    const noisy = subs.filter(s => !s.muted && stats.get(s.id).noisy);
    if (noisy.length && !dietDismissed) {
        const negTotal = subs.reduce((a, s) => a + items.filter(i => i.feedId === s.id && i.ai && typeof i.sent === 'number' && i.sent < -0.2 && i.published >= Date.now() - DIET_DAYS * 864e5).length, 0);
        const negNoisy = noisy.reduce((a, s) => a + items.filter(i => i.feedId === s.id && i.ai && typeof i.sent === 'number' && i.sent < -0.2 && i.published >= Date.now() - DIET_DAYS * 864e5).length, 0);
        const pct = negTotal ? Math.round(negNoisy / negTotal * 100) : 0;
        const ban = el('div', 'sd-banner');
        ban.append(el('strong', null, pct ? TN(noisy.length, '{n} source causes {p}% of your negative items', '{n} sources cause {p}% of your negative items').replace('{p}', pct) : TN(noisy.length, '{n} source is mostly negative', '{n} sources are mostly negative')),
            el('span', 'feed-muted', noisy.map(subTitle).slice(0, 3).join(', ')));
        const act = el('div', 'sd-actions');
        act.append(btn('button-secondary btn-sm', T('Review'), () => { subSort = 'mood'; subFilter = 'all'; openSubId = noisy[0].id; renderFeedSettings(); }),
            btn('button-tertiary btn-sm', T('Dismiss'), () => { dietDismissed = true; renderFeedSettings(); }));
        ban.append(act);
        root.append(ban);
    }

    // Filter chips + sort
    const bar = el('div', 'sd-toolbar');
    const chips = el('div', 'sd-chips');
    const counts = { all: subs.length, muted: subs.filter(s => s.muted).length, errors: subs.filter(s => s.error).length };
    [['all', T('All')], ['muted', T('Muted')], ['errors', T('Errors')]].forEach(([k, label]) => {
        chips.append(btn('pill' + (subFilter === k ? ' active' : ''), label + ' ' + counts[k], () => { subFilter = k; renderFeedSettings(); }));
    });
    const sort = el('select', 'sd-sort'); sort.setAttribute('aria-label', T('Sort'));
    [...(moodEnabled() ? [['mood', T('Sort: Mood')]] : []), ['unread', T('Sort: Unread')], ['read', T('Sort: Read share')], ['name', T('Sort: Name')]].forEach(([k, t]) => { const o = el('option', null, t); o.value = k; if (k === subSort) o.selected = true; sort.append(o); });
    sort.addEventListener('change', () => { subSort = sort.value; renderFeedSettings(); });
    bar.append(chips, sort);
    root.append(bar);

    const card = el('div', 'feed-set-card sd-list');
    card.id = 'feedSubsCard';
    if (!subs.length) card.append(el('p', 'feed-muted', T('No feeds yet. Add one below or import an OPML file.')));
    const num = (v, dflt) => (v === null || v === undefined ? dflt : v);
    const sorters = {
        mood: (a, b) => num(stats.get(a.id).mood, 101) - num(stats.get(b.id).mood, 101),
        unread: (a, b) => stats.get(b.id).unread - stats.get(a.id).unread,
        read: (a, b) => num(stats.get(a.id).read, 101) - num(stats.get(b.id).read, 101),
        name: (a, b) => subTitle(a).localeCompare(subTitle(b))
    };
    subs.filter(s => subFilter === 'muted' ? s.muted : subFilter === 'errors' ? s.error : true)
        .sort(sorters[subSort]).forEach(s => card.append(subRow(s)));
    if (subs.length && !card.querySelector('.feed-sub-card')) card.append(el('p', 'feed-muted', T('Nothing here.')));
    root.append(card);

    renderFeedPrefs();
}

// Feed preferences: how feeds behave (its own Settings page), grouped by intent.
function renderFeedPrefs() {
    const root = document.getElementById('feedPrefsRoot');
    if (!root) return;
    root.replaceChildren();
    const card = (id, caption, ...rows) => {
        root.append(el('p', 'settings-caption', caption));
        const c = el('div', 'feed-set-card'); c.id = id; c.append(...rows); root.append(c);
    };
    card('feedPrefsReading', TU('Reading'),
        toggleRow('feedSetMarkRead', T('✓ Mark read when opened'), T('Items you open or summarize leave your unread list'), 'markReadOnOpen'),
        toggleRow('feedSetAutoSum', T('✨ Auto-summarize favorites'), T('Starring an item summarizes it in a background tab'), 'autoSummarizeFavs'),
        el('p', 'feed-muted', T('Summarize on a feed item follows the mode chosen on the Summarize screen (extension by default). Favorites are always kept.')));
    card('feedPrefsAi', TU('AI analysis'),
        moodToggleRow(),
        selectRow('feedSetRecapLimit', T('📝 Items per recap'), 'recapLimit', [[20, '20'], [40, '40'], [80, '80'], [150, '150'], [300, '300']]),
        toggleRow('feedSetRate', T('🤖 Rate items with the recap'), T('Adds mood and category to each item in the same AI request'), 'rateWithRecap'));
    card('feedPrefsUpdates', TU('Updates & storage'),
        toggleRow('feedSetPoll', T('🔔 Check in the background'), T('Shows a badge on the toolbar icon when new items arrive'), 'backgroundPoll'),
        selectRow('feedSetRefresh', T('🔄 Refresh feeds every'), 'refreshMinutes', [[15, T('15 minutes')], [30, T('30 minutes')], [60, T('1 hour')], [180, T('3 hours')]]),
        selectRow('feedSetKeep', T('🗂️ Keep items for'), 'keepDays', [[7, T('7 days')], [30, T('30 days')], [90, T('90 days')], [180, T('6 months')], [365, T('1 year')]]));
}

// ── Public API ─────────────────────────────────────────────────────────────
export async function onFeedsScreenShown(uiObj) {
    uiRef = uiObj;
    closeSheet(); hideUndo(); stickyRead.clear(); shown = PAGE_SIZE;
    searchQuery = ''; view = 'list'; if (els.search) els.search.value = '';
    hideSuppressUntil = Date.now() + 1200;
    if (els.screen) els.screen.scrollTop = 0;
    if (els.controlsBar) els.controlsBar.classList.remove('scroll-hidden');
    await load();
    try { await reconcileStubs(); } catch (e) { console.warn('[feeds] stub reconcile failed', e); }
    await loadHistoryMap();
    carryMoodToHistory();
    render();
    renderFeedSettings();
    if (els.controlsBar) els.controlsBar.classList.remove('scroll-hidden');
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
        recapCard: document.getElementById('feedRecapCard'),
        scopeRow: document.getElementById('feedScopeRow'),
        filterChip: document.getElementById('feedFilterChip'),
        moodChip: document.getElementById('feedMoodChip'),
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
    initSearchShortcut();
    els.refreshBtn.addEventListener('click', () => refreshAll(uiObj, { force: true }));
    els.addBtn.addEventListener('click', openAddSheet);
    els.filterChip.addEventListener('click', openFilterSheet);
    document.addEventListener('aish:translationsApplied', () => { if (els && els.list && subs) { try { render(); } catch (e) { /* a failed re-render must not break the translation event */ } } });
    if (chrome.runtime.onMessage && chrome.runtime.onMessage.addListener) chrome.runtime.onMessage.addListener(onSummaryMessage);
    // Any new summary (also from the Summarize screen or a background tab) flips the matching card to "View summary".
    if (chrome.storage.onChanged && chrome.storage.onChanged.addListener) {
        let histTimer = null;
        chrome.storage.onChanged.addListener((ch) => {
            if (!ch || !ch[SK.articlesIndex]) return;
            clearTimeout(histTimer);
            histTimer = setTimeout(async () => { await loadHistoryMap(); await carryMoodToHistory(); if (els && els.list) render(); }, 250);
        });
    }
    if (els.moodChip) els.moodChip.addEventListener('click', () => {
        if (ui.mood === 'pos') ui.mood = 'any';
        else { ui.mood = 'pos'; ui.status = 'all'; }
        persistUi(); render();
    });
    els.chipRow.querySelectorAll('[data-status]').forEach(b => b.addEventListener('click', () => {
        ui.status = b.dataset.status; if (ui.mood === 'pos') ui.mood = 'any'; persistUi(); render();
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
        if (!e.detail || (e.detail.name !== 'feeds' && e.detail.name !== 'feedprefs')) return;
        renderFeedSettings();                       // immediately, so search deep-links find their target
        await load(); await loadHistoryMap();
        const root = document.getElementById('feedSettingsRoot');
        if (!(root && root.contains(document.activeElement))) renderFeedSettings();
    });

    // Warm the data so the Settings row subtitle is right, and make sure the
    // background poller matches the saved settings.
    load().then(() => { updateSettingsSub(); sendPollConfig(); }).catch(() => {});
}
