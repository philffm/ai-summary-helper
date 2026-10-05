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
//   Settings > Feeds = subscriptions (rename / folder / mute / remove), OPML, behavior

import StorageManager from './storageManager.js';
import { normalizeUrl } from './textUtils.js';
import { scoreSentiment, moodOf, MOOD_EMOJI } from './feedSentiment.js';
import { generateRecap, scoreItems, MAX_RECAP_ITEMS } from './feedAi.js';

const SUBS_KEY = 'feedSubs';
const ITEMS_KEY = 'feedItems';
const UI_KEY = 'feedUi';
const SETTINGS_KEY = 'feedSettings';
const RECAPS_KEY = 'feedRecaps';
const MAX_ITEMS_PER_FEED = 50;
const MAX_ITEMS_TOTAL = 500;
const MAX_RENDERED = 100;
const CONCURRENCY = 4;
const COMMON_FEED_PATHS = ['/feed', '/rss', '/atom.xml', '/feed.xml', '/rss.xml', '/index.xml'];
const DAY_MS = 86400000;

export const FEED_DEFAULTS = {
    markReadOnOpen: true,
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
let ui = { source: 'all', status: 'unread', date: 'any', mood: 'any', sort: 'new' };
let refreshing = false;
let els = {};
let uiRef = null;
let undoTimer = null;
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
    // Older items were stored before mood scoring existed.
    items.forEach(i => { if (typeof i.sent !== 'number') i.sent = scoreSentiment(i.title + ' ' + (i.snippet || '')); });
    // A filter pointing at a source that no longer exists falls back to "all".
    if (!sourceExists(ui.source)) ui.source = 'all';
}

function persist() {
    return chrome.storage.local.set({ [SUBS_KEY]: subs, [ITEMS_KEY]: items });
}
function persistUi() { return chrome.storage.local.set({ [UI_KEY]: ui }).catch(() => {}); }
function persistSettings() { return chrome.storage.local.set({ [SETTINGS_KEY]: settings }).catch(() => {}); }

function sourceExists(src) {
    if (!src || src === 'all') return true;
    const [kind, val] = splitSource(src);
    if (kind === 'sub') return subs.some(s => s.id === val);
    if (kind === 'folder') return subs.some(s => s.folder === val);
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
    if (settings.markReadOnOpen) setRead([item], true, { silent: true });
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
    if (s < 3600) return `${Math.max(1, Math.round(s / 60))}m`;
    if (s < 86400) return `${Math.round(s / 3600)}h`;
    if (s < 86400 * 30) return `${Math.round(s / 86400)}d`;
    return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
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
                    ? 'Background script is outdated — reload the extension at chrome://extensions'
                    : m));
            }
            if (!res || !res.ok) return reject(new Error((res && res.error) || 'Request failed'));
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
                snippet: htmlToText(childByLocalName(e, 'summary') || childByLocalName(e, 'content')).slice(0, 220)
            });
        }
        return { title, siteUrl, items: out };
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
                snippet: htmlToText(childByLocalName(e, 'description') || childByLocalName(e, 'encoded')).slice(0, 220)
            };
        });
        return { title, siteUrl, items: out };
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
    throw new Error('No feed found at that address');
}

// ── Merge + refresh ────────────────────────────────────────────────────────
function mergeItems(sub, parsedItems) {
    const existing = new Map(items.filter(i => i.feedId === sub.id).map(i => [i.id, i]));
    const merged = [];
    for (const p of parsedItems) {
        if (!p.link || !p.title) continue;
        const id = hash(sub.id + '|' + (p.guid || p.link));
        const prev = existing.get(id);
        merged.push({
            id,
            feedId: sub.id,
            title: p.title,
            link: p.link,
            published: p.published || (prev && prev.published) || Date.now(),
            snippet: p.snippet,
            sent: prev && prev.ai && typeof prev.sent === 'number' ? prev.sent : scoreSentiment(p.title + ' ' + (p.snippet || '')),
            ai: !!(prev && prev.ai),
            read: prev ? prev.read : false
        });
    }
    // Keep newest N for this feed, plus older items we already had (so read state survives short feeds).
    const seen = new Set(merged.map(m => m.id));
    existing.forEach((v, k) => { if (!seen.has(k)) merged.push(v); });
    merged.sort((a, b) => b.published - a.published);
    const kept = merged.slice(0, MAX_ITEMS_PER_FEED);
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
        if (!parsed) throw new Error('Not a valid feed');
        if (!sub.customTitle && parsed.title) sub.title = parsed.title;
        if (parsed.siteUrl) sub.siteUrl = parsed.siteUrl;
        mergeItems(sub, parsed.items);
        sub.lastFetched = Date.now();
        sub.error = '';
    } catch (e) {
        sub.error = e.message || 'Failed';
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
        items = items.slice(0, MAX_ITEMS_TOTAL);
        await persist();
    } finally {
        refreshing = false;
        setRefreshState(false);
        render();
        renderFeedSettings();
    }
    const failed = subs.filter(s => s.error).length;
    if (force && failed) toast(uiObj, `${failed} feed${failed > 1 ? 's' : ''} could not be loaded`);
}

// ── Add / remove / import / export ─────────────────────────────────────────
async function addFeed(uiObj, rawUrl, inputEl) {
    const url = normalizeInputUrl(rawUrl);
    if (!url) return toast(uiObj, 'Enter a valid web address');
    setBusy(true);
    try {
        const { feedUrl, parsed } = await resolveFeed(url);
        if (subs.some(s => s.url === feedUrl)) {
            toast(uiObj, 'Already subscribed');
            return;
        }
        const sub = {
            id: hash(feedUrl),
            url: feedUrl,
            title: parsed.title || new URL(feedUrl).hostname,
            siteUrl: parsed.siteUrl || '',
            folder: '',
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
        toast(uiObj, `Subscribed to ${subTitle(sub)}`);
        render();
        renderFeedSettings();
    } catch (e) {
        toast(uiObj, e.message || 'Could not add feed');
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
        if (doc.querySelector('parsererror')) throw new Error('Not a valid OPML file');
        let added = 0;
        const addOutline = (o, folder) => {
            const url = safeHttpUrl(o.getAttribute('xmlUrl') || o.getAttribute('xmlurl'));
            if (!url || subs.some(s => s.url === url)) return;
            subs.push({
                id: hash(url),
                url,
                title: o.getAttribute('title') || o.getAttribute('text') || new URL(url).hostname,
                siteUrl: safeHttpUrl(o.getAttribute('htmlUrl')) || '',
                folder: folder || '',
                addedAt: Date.now(),
                lastFetched: 0,
                error: ''
            });
            added++;
        };
        // One folder level: a top-level outline without xmlUrl is a folder whose
        // (possibly nested) feed outlines all land in that folder.
        const body = doc.querySelector('body');
        const top = body ? [...body.children].filter(n => n.localName === 'outline') : [];
        for (const o of top) {
            if (o.getAttribute('xmlUrl') || o.getAttribute('xmlurl')) { addOutline(o, ''); continue; }
            const folder = (o.getAttribute('title') || o.getAttribute('text') || '').trim();
            o.querySelectorAll('outline[xmlUrl], outline[xmlurl]').forEach(c => addOutline(c, folder));
        }
        await persist();
        toast(uiObj, added ? `Imported ${added} feed${added > 1 ? 's' : ''}` : 'No new feeds in that file');
        closeSheet();
        render();
        renderFeedSettings();
        if (added) refreshAll(uiObj, { force: false });
    } catch (e) {
        toast(uiObj, e.message || 'Import failed');
    }
}

function escXml(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
function exportOpml() {
    const line = (s, ind) => `${ind}<outline type="rss" text="${escXml(subTitle(s))}" title="${escXml(subTitle(s))}" xmlUrl="${escXml(s.url)}"${s.siteUrl ? ` htmlUrl="${escXml(s.siteUrl)}"` : ''}/>`;
    const folders = [...new Set(subs.map(s => s.folder).filter(Boolean))].sort();
    const out = ['<?xml version="1.0" encoding="UTF-8"?>', '<opml version="2.0">', '  <head><title>AI Summary Helper feeds</title></head>', '  <body>'];
    subs.filter(s => !s.folder).forEach(s => out.push(line(s, '    ')));
    folders.forEach(f => {
        out.push(`    <outline text="${escXml(f)}" title="${escXml(f)}">`);
        subs.filter(s => s.folder === f).forEach(s => out.push(line(s, '      ')));
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
async function setRead(list, read, { silent = false, label = '' } = {}) {
    const prev = new Map();
    list.forEach(i => { if (i.read !== read) { prev.set(i.id, i.read); i.read = read; } });
    if (!prev.size) return;
    await persist();
    render();
    if (!silent) {
        showUndo(label || (read ? `Marked ${prev.size} read` : `Marked ${prev.size} unread`), async () => {
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
    if (settings.markReadOnOpen) setRead([item], true, { silent: true });
    chrome.runtime.sendMessage({ action: 'openFeedItem', url: item.link, summarize }, (res) => {
        if (chrome.runtime.lastError) return;
        if (summarize && res && res.mode === 'extension') {
            toast(uiRef, res.reused
                ? 'Summarizing the open tab — it will show up under Summarize and History'
                : 'Summarizing in the background — it will show up under Summarize and History');
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
    if (kind === 'folder') return s.folder === val && !s.muted;
    return !s.muted;
}

function passes(i, sm) {
    if (!inSource(i, sm)) return false;
    const h = histOf(i);
    if (ui.status === 'unread' && i.read) return false;
    if (ui.status === 'fav' && !h.fav) return false;
    if (ui.status === 'sum' && !h.summarized) return false;
    if (ui.date === 'today' && i.published < startOfDay(Date.now())) return false;
    if (ui.date === '7d' && i.published < Date.now() - 7 * DAY_MS) return false;
    const mood = moodOf(i.sent || 0);
    if (ui.mood === 'pos' && mood !== 'pos') return false;
    if (ui.mood === 'nonneg' && mood === 'neg') return false;
    return true;
}

function visibleItems() {
    const sm = subMap();
    const list = items.filter(i => passes(i, sm));
    if (ui.sort === 'mood') list.sort((a, b) => (b.sent || 0) - (a.sent || 0) || b.published - a.published);
    else list.sort((a, b) => b.published - a.published);
    return list.slice(0, MAX_RENDERED);
}

function unreadCount(pred) { return items.filter(i => !i.read && pred(i)).length; }

function dayLabel(ts) {
    const diff = Math.round((startOfDay(Date.now()) - startOfDay(ts)) / DAY_MS);
    if (diff <= 0) return 'Today';
    if (diff === 1) return 'Yesterday';
    if (diff < 7) return new Date(ts).toLocaleDateString(undefined, { weekday: 'long' });
    return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function filterChipLabel() {
    const parts = [];
    if (ui.date === 'today') parts.push('Today'); else if (ui.date === '7d') parts.push('7 days');
    if (ui.mood === 'pos') parts.push('😊'); else if (ui.mood === 'nonneg') parts.push('No 😟');
    if (ui.sort === 'mood') parts.push('Mood ↓');
    return (parts.join(' · ') || 'Any time') + ' ▾';
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
    if (kind === 'sub') { const s = subs.find(x => x.id === val); return '📰  ' + (s ? subTitle(s) : 'Source'); }
    if (kind === 'folder') return '📁  ' + val;
    return '📰  All sources';
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
        if (kind === 'folder') return s.folder === val && !s.muted;
        return !s.muted;
    };
    const unread = unreadCount(scoped);
    els.sourceCount.textContent = unread ? String(unread) : '';
    els.chipRow.querySelectorAll('[data-status]').forEach(b => {
        const on = b.dataset.status === ui.status;
        b.classList.toggle('active', on);
        b.setAttribute('aria-pressed', String(on));
        if (b.dataset.status === 'unread') b.textContent = unread ? `Unread · ${unread}` : 'Unread';
    });
    els.filterChip.textContent = filterChipLabel();
    els.filterChip.classList.toggle('active', ui.date !== 'any' || ui.mood !== 'any' || ui.sort !== 'new');
}

function renderFirstRun() {
    const box = els.empty;
    box.replaceChildren();
    box.className = 'feed-firstrun';
    box.style.display = 'flex';
    box.append(el('div', 'feed-firstrun-icon', '📰'), el('h3', null, 'Follow the sites you read'),
        el('p', null, 'New posts land here. Skim, summarize what matters, clear the rest.'));
    const row = el('div', 'feed-add-row');
    const input = el('input');
    input.type = 'text'; input.placeholder = 'Site or feed address…'; input.autocomplete = 'off'; input.spellcheck = false;
    const add = btn('button-primary feed-btn', 'Add', () => addFeed(uiRef, input.value, input));
    add.setAttribute('data-feed-add', '');
    input.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); addFeed(uiRef, input.value, input); } });
    row.append(input, add);
    box.append(row, btn('button-secondary feed-wide-btn', '＋  Use current site', useCurrentSite),
        btn('button-secondary feed-wide-btn', '📥  Import OPML file', () => els.opmlInput.click()),
        el('p', 'feed-muted', 'Your feeds stay on this device.'));
}

function renderEmptyFiltered(hasAny) {
    const box = els.empty;
    box.replaceChildren();
    box.className = 'explanatory-card feed-emptycard';
    box.style.display = 'block';
    if (refreshing && !hasAny) { box.textContent = 'Loading…'; return; }
    const unreadMode = ui.status === 'unread' && ui.source === 'all' && ui.date === 'any' && ui.mood === 'any';
    box.append(el('p', null, unreadMode ? 'You’re all caught up. 🎉' : 'Nothing matches these filters.'));
    box.append(btn('button-secondary feed-btn', unreadMode ? 'Show all items' : 'Clear filters', () => {
        ui = { source: 'all', status: unreadMode ? 'all' : 'unread', date: 'any', mood: 'any', sort: 'new' };
        persistUi(); render();
    }));
}

function renderCard(item, sm) {
    const hist = histOf(item);
    const mood = moodOf(item.sent || 0);
    const li = el('li', 'article-card feed-item' + (item.read ? ' is-read' : '') + (hist.fav ? ' is-favorite' : ''));
    const meta = el('p', 'article-date', `${subTitle(sm.get(item.feedId))} · ${timeAgo(item.published)}`);
    if (MOOD_EMOJI[mood]) {
        const m = el('span', 'feed-mood', ' ' + MOOD_EMOJI[mood]);
        m.title = (item.ai ? 'AI-rated: ' : '') + (mood === 'pos' ? 'Positive tone' : 'Heavy tone');
        meta.append(m);
    }
    const title = el('h4', null, item.title);
    const head = el('div', 'article-header');
    const headText = el('div');
    headText.append(title, meta);
    if (hist.summarized) {
        const badge = el('span', 'feed-badge', '✓ Summarized');
        badge.title = 'You have a saved summary of this page';
        headText.append(badge);
    }
    const star = btn('star-button', hist.fav ? '★' : '☆', (e) => { e.stopPropagation(); toggleFavorite(item); }, 'Favorite');
    star.setAttribute('aria-pressed', String(hist.fav));
    head.append(headText, star);
    li.appendChild(head);
    if (item.snippet) li.appendChild(el('p', 'feed-snippet', item.snippet));

    const actions = el('div', 'feed-actions');
    const sum = btn('button-primary feed-btn', hist.summarized ? '📄 View summary' : '✨ Summarize', (e) => { e.stopPropagation(); onSummarizeClick(item); });
    const open = btn('button-secondary feed-btn', 'Open ↗', (e) => { e.stopPropagation(); openItem(item, false); });
    const read = btn('button-secondary feed-btn', item.read ? 'Mark unread' : 'Mark read', (e) => { e.stopPropagation(); setRead([item], !item.read, { silent: true }); });
    actions.append(open, read, sum);
    li.appendChild(actions);
    li.tabIndex = 0;
    li.setAttribute('role', 'link');
    li.addEventListener('click', () => onCardClick(item));
    li.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target === li) onCardClick(item); });
    return li;
}

function render() {
    if (!els.list) return;
    renderControls();
    els.list.replaceChildren();

    if (!subs.length) { els.list.hidden = true; renderFirstRun(); return; }
    els.list.hidden = false;

    const sm = subMap();
    const visible = visibleItems();
    if (!visible.length) { renderEmptyFiltered(items.length > 0); return; }
    els.empty.style.display = 'none';

    let lastKey = null;
    let group = [];
    const flush = () => {
        if (!group.length) return;
        const unread = group.filter(i => !i.read);
        const header = el('li', 'feed-day');
        header.append(el('span', 'feed-day-label', `${dayLabel(group[0].published)} · ${group.length} item${group.length > 1 ? 's' : ''}`));
        if (ui.sort !== 'mood') {
            const dayStart = startOfDay(group[0].published);
            const dayName = dayLabel(group[0].published);
            header.append(btn('feed-day-action feed-day-ai', '✨ Recap', () => openRecap(dayStart, dayName), 'AI recap of this day'));
        }
        if (unread.length) {
            const snapshot = [...unread];
            header.append(btn('feed-day-action', 'Mark read', () => setRead(snapshot, true, { label: `Marked ${snapshot.length} read` }), `Mark ${snapshot.length} read`));
        }
        els.list.appendChild(header);
        group.forEach(i => els.list.appendChild(renderCard(i, sm)));
        group = [];
    };
    if (ui.sort === 'mood') {
        const header = el('li', 'feed-day');
        header.append(el('span', 'feed-day-label', `Most positive first · ${visible.length} items`));
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
}

// ── Sheets (source picker, filters, add, briefing) ─────────────────────────
function openSheet(title, bodyNode) {
    const layer = document.getElementById('feedSheetLayer');
    const body = document.getElementById('feedSheetBody');
    if (!layer || !body) return;
    body.replaceChildren();
    const head = el('div', 'feed-sheet-head');
    head.append(el('h3', null, title), btn('feed-sheet-done', 'Done', closeSheet));
    body.append(head, bodyNode);
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
    search.type = 'search'; search.placeholder = 'Search sources…'; search.autocomplete = 'off'; search.spellcheck = false;
    const list = el('div', 'feed-picker-list');
    const choose = (src) => { ui.source = src; persistUi(); closeSheet(); render(); };
    const draw = () => {
        list.replaceChildren();
        const q = search.value.trim().toLowerCase();
        const sm = subMap();
        const cnt = (pred) => { const n = unreadCount(i => sm.has(i.feedId) && pred(i)); return n ? String(n) : ''; };
        if (!q) list.append(radioRow('All sources', cnt(i => !sm.get(i.feedId).muted), ui.source === 'all', () => choose('all')));
        const folders = [...new Set(subs.map(s => s.folder).filter(Boolean))].sort((a, b) => a.localeCompare(b));
        const matching = (s) => !q || subTitle(s).toLowerCase().includes(q) || (s.folder || '').toLowerCase().includes(q);
        const addSubs = (arr, indent) => arr.filter(matching).sort((a, b) => subTitle(a).localeCompare(subTitle(b))).forEach(s => {
            list.append(radioRow((s.muted ? '🔕 ' : '') + subTitle(s), cnt(i => i.feedId === s.id), ui.source === 'sub:' + s.id, () => choose('sub:' + s.id), { muted: s.muted, indent }));
        });
        folders.forEach(f => {
            const inFolder = subs.filter(s => s.folder === f);
            if (!inFolder.some(matching)) return;
            list.append(el('div', 'feed-pick-label', f.toUpperCase()));
            if (!q) list.append(radioRow(`All in ${f}`, cnt(i => sm.get(i.feedId).folder === f && !sm.get(i.feedId).muted), ui.source === 'folder:' + f, () => choose('folder:' + f), { indent: true }));
            addSubs(inFolder, true);
        });
        const loose = subs.filter(s => !s.folder);
        if (loose.some(matching)) {
            if (folders.length) list.append(el('div', 'feed-pick-label', 'NO FOLDER'));
            addSubs(loose, false);
        }
        if (!list.children.length) list.append(el('p', 'feed-muted', 'No sources match.'));
    };
    search.addEventListener('input', draw);
    body.append(search, list, btn('feed-manage-link', '⚙️  Manage feeds & folders in Settings  ›', async () => {
        closeSheet();
        const nav = await import('./settingsNav.js');
        uiRef.showScreen('settings');
        setTimeout(() => nav.openSettingsPanel('feeds'), 50);
    }));
    openSheet('Sources', body);
    draw();
}

function openFilterSheet() {
    const body = el('div', 'feed-picker');
    const draw = () => {
        body.replaceChildren();
        const section = (title, key, opts) => {
            body.append(el('div', 'feed-pick-label', title));
            opts.forEach(([val, label]) => body.append(radioRow(label, '', ui[key] === val, () => { ui[key] = val; persistUi(); render(); draw(); })));
        };
        section('DATE', 'date', [['any', 'Any time'], ['today', 'Today'], ['7d', 'Last 7 days']]);
        section('MOOD', 'mood', [['any', 'Any mood'], ['pos', '😊  Positive only'], ['nonneg', 'Hide negative']]);
        section('SORT', 'sort', [['new', 'Newest first'], ['mood', 'Most positive first']]);
        body.append(el('div', 'feed-pick-label', 'MORE'));
        body.append(btn('feed-manage-link', '☀️  Today’s briefing', () => { closeSheet(); openBriefing(); }));
        body.append(btn('feed-manage-link', '🤖  Score visible items with AI', () => { closeSheet(); scoreWithAi(visibleItems()); }));
        body.append(btn('feed-manage-link', '✓  Mark everything in this view read', () => {
            const list = visibleItems().filter(i => !i.read);
            closeSheet();
            if (list.length) setRead(list, true, { label: `Marked ${list.length} read` });
        }));
        body.append(el('p', 'feed-muted', 'Mood is estimated on your device from headlines and snippets — a rough guide, not a verdict. “Score with AI” sends titles and short snippets to your AI connection.'));
    };
    openSheet('Date & mood', body);
    draw();
}

async function useCurrentSite() {
    try {
        const { getActiveTab } = await import('./mainScreen.js');
        const tab = await getActiveTab();
        if (tab && /^https?:/i.test(tab.url || '')) {
            addFeed(uiRef, tab.url, null);
        } else {
            toast(uiRef, 'Open a website in the current tab first');
        }
    } catch (e) {
        toast(uiRef, 'Could not read the current tab');
    }
}

function openAddSheet() {
    const body = el('div', 'feed-picker');
    const row = el('div', 'feed-add-row');
    const input = el('input');
    input.type = 'text'; input.placeholder = 'Site or feed address…'; input.autocomplete = 'off'; input.spellcheck = false;
    const add = btn('button-primary feed-btn', 'Add', () => addFeed(uiRef, input.value, input));
    add.setAttribute('data-feed-add', '');
    input.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); addFeed(uiRef, input.value, input); } });
    row.append(input, add);
    body.append(row, el('p', 'feed-muted', 'Paste any site address. We find its feed for you.'),
        btn('feed-option-card', '＋  Use current site', useCurrentSite),
        btn('feed-option-card', '📥  Import OPML file…', () => els.opmlInput.click()));
    openSheet('Add a feed', body);
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
    openSheet(`${label} recap`, body);
    if (!list.length) { body.append(el('p', 'feed-muted', 'No items to recap here.')); return; }
    const sm = subMap();

    const draw = (r, stale) => {
        body.replaceChildren();
        const chip = { pos: '😊 Mostly positive', neu: '😐 Mixed', neg: '😟 Mostly heavy' }[r.mood] || '😐 Mixed';
        body.append(el('span', 'feed-recap-mood', chip));
        if (r.overview) body.append(el('p', 'feed-recap-overview', r.overview));
        if (r.themes.length) {
            const ul = el('ul', 'feed-recap-themes');
            r.themes.forEach(t => ul.append(el('li', null, t)));
            body.append(ul);
        }
        if (stale) body.append(el('p', 'feed-recap-stale', 'New items arrived since this recap — Refresh to include them.'));
        const row = el('div', 'feed-recap-actions');
        row.append(btn('feed-btn', '↻ Refresh', () => run(true)),
            btn('feed-btn', 'Copy', async () => {
                try { await navigator.clipboard.writeText([r.overview, ...r.themes.map(t => '- ' + t)].join('\n')); toast(uiRef, 'Recap copied'); }
                catch (e) { toast(uiRef, 'Copy failed'); }
            }));
        body.append(row,
            btn('feed-manage-link', `🤖  Score these ${list.length} items with AI`, () => { closeSheet(); scoreWithAi(list); }),
            el('p', 'feed-muted', `AI-generated from ${list.length} headlines and snippets. Generated at ${new Date(r.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}. Not a substitute for reading.`));
    };
    const run = async (force) => {
        const cached = recaps[key];
        const hsh = idsHash(list);
        if (cached && !force) return draw(cached, cached.hash !== hsh);
        body.replaceChildren(el('p', 'feed-recap-loading', '✨ Writing recap…'),
            el('p', 'feed-muted', `Sending ${list.length} titles and short snippets to your AI connection.`));
        try {
            const r = await generateRecap(list, aiTitleOf(sm));
            recaps[key] = { ...r, hash: hsh, at: Date.now(), n: list.length };
            chrome.storage.local.set({ [RECAPS_KEY]: recaps }).catch(() => {});
            draw(recaps[key], false);
        } catch (e) {
            body.replaceChildren(el('p', 'feed-error', e.message || 'Recap failed'),
                btn('feed-btn', 'Try again', () => run(true)));
        }
    };
    run(false);
}

async function scoreWithAi(list) {
    list = (list || []).filter(Boolean);
    if (!list.length) { toast(uiRef, 'Nothing to score'); return; }
    const sm = subMap();
    let done = 0;
    try {
        for (let k = 0; k < list.length; k += MAX_RECAP_ITEMS) {
            const chunk = list.slice(k, k + MAX_RECAP_ITEMS);
            toast(uiRef, `Scoring with AI… ${Math.min(k + chunk.length, list.length)}/${list.length}`);
            const scores = await scoreItems(chunk, aiTitleOf(sm));
            chunk.forEach((i, n) => { if (scores[n] !== null) { i.sent = scores[n]; i.ai = true; done++; } });
        }
    } catch (e) {
        toast(uiRef, e.message || 'AI scoring failed');
    }
    if (done) { await persist(); render(); toast(uiRef, `Scored ${done} item${done > 1 ? 's' : ''} with AI`); }
}

// ── Today's briefing ───────────────────────────────────────────────────────
function openBriefing() {
    const sm = subMap();
    const start = startOfDay(Date.now());
    const today = items.filter(i => sm.has(i.feedId) && !sm.get(i.feedId).muted && i.published >= start)
        .sort((a, b) => b.published - a.published);
    const body = el('div', 'feed-picker');
    if (!today.length) {
        body.append(el('p', 'feed-muted', 'Nothing new today yet. Try Refresh.'));
        return openSheet('Today’s briefing', body);
    }
    const bySub = new Map();
    today.forEach(i => { if (!bySub.has(i.feedId)) bySub.set(i.feedId, []); bySub.get(i.feedId).push(i); });
    const tally = { pos: 0, neu: 0, neg: 0 };
    today.forEach(i => { tally[moodOf(i.sent || 0)]++; });
    const unread = today.filter(i => !i.read);
    body.append(el('p', 'feed-brief-summary', `${today.length} new today across ${bySub.size} source${bySub.size > 1 ? 's' : ''} · ${unread.length} unread`),
        el('p', 'feed-muted', `Mood: 😊 ${tally.pos} · 😐 ${tally.neu} · 😟 ${tally.neg}`));
    bySub.forEach((list, id) => {
        body.append(el('div', 'feed-pick-label', `${subTitle(sm.get(id)).toUpperCase()} · ${list.length}`));
        list.slice(0, 2).forEach(i => {
            const emoji = MOOD_EMOJI[moodOf(i.sent || 0)];
            body.append(btn('feed-brief-item' + (i.read ? ' is-read' : ''), (emoji ? emoji + '  ' : '') + i.title, () => { closeSheet(); onCardClick(i); }));
        });
        if (list.length > 2) body.append(el('p', 'feed-muted', `+ ${list.length - 2} more`));
    });
    body.append(btn('feed-manage-link', '✨  AI recap of today', () => openRecap(start, 'Today', 'all')));
    body.append(btn('button-primary feed-wide-btn', '✨ Summarize top 5 unread', async () => {
        const { summaryMode } = await chrome.storage.local.get('summaryMode');
        if (summaryMode === 'inline') { toast(uiRef, 'Batch summarizing runs in extension mode. Switch on the Summarize screen.'); return; }
        const picks = unread.filter(i => !histOf(i).summarized).slice(0, 5);
        if (!picks.length) { toast(uiRef, 'Everything unread is already summarized'); return; }
        picks.forEach((i, k) => setTimeout(() => chrome.runtime.sendMessage({ action: 'openFeedItem', url: i.link, summarize: true, forceExtension: true }, () => void chrome.runtime.lastError), k * 1500));
        toast(uiRef, `Summarizing ${picks.length} in the background — see History`);
        closeSheet();
    }));
    openSheet('Today’s briefing', body);
}

// ── Settings > Feeds panel ─────────────────────────────────────────────────
function updateSettingsSub() {
    const sub = document.querySelector('.settings-row-sub[data-sub="feeds"]');
    if (!sub) return;
    const folders = new Set(subs.map(s => s.folder).filter(Boolean)).size;
    sub.textContent = subs.length
        ? `${subs.length} feed${subs.length > 1 ? 's' : ''}${folders ? ` · ${folders} folder${folders > 1 ? 's' : ''}` : ''}`
        : 'Subscriptions · OPML · behavior';
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
    name.type = 'text'; name.value = subTitle(s); name.setAttribute('aria-label', 'Feed name');
    name.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); name.blur(); } });
    name.addEventListener('change', async () => {
        const v = name.value.trim();
        if (v) s.customTitle = v; else { delete s.customTitle; name.value = subTitle(s); }
        await persist(); render();
    });
    const mute = btn('feed-icon-btn', s.muted ? '🔕' : '🔔', async () => {
        s.muted = !s.muted;
        await persist(); render(); renderFeedSettings();
    }, s.muted ? 'Unmute (include in All sources)' : 'Mute (leave out of All sources)');
    const rm = btn('feed-icon-btn', '✕', () => { removeFeed(s.id); }, 'Unsubscribe');
    l1.append(name, mute, rm);
    const l2 = el('div', 'feed-sub-line');
    const folder = el('input', 'feed-sub-input feed-sub-folder');
    folder.type = 'text'; folder.placeholder = 'Folder'; folder.value = s.folder || ''; folder.setAttribute('list', 'feedFolderList'); folder.setAttribute('aria-label', 'Folder');
    folder.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); folder.blur(); } });
    folder.addEventListener('change', async () => {
        s.folder = folder.value.trim();
        if (!sourceExists(ui.source)) ui.source = 'all';
        await persist(); render(); updateSettingsSub();
    });
    const n = items.filter(i => i.feedId === s.id && !i.read).length;
    l2.append(folder, el('span', s.error ? 'feed-sub-error' : 'feed-muted', s.error ? '⚠ ' + s.error : `${n} unread`));
    row.append(l1, l2);
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

    root.append(el('p', 'settings-caption', `SUBSCRIPTIONS · ${subs.length}`));
    const dl = el('datalist'); dl.id = 'feedFolderList';
    [...new Set(subs.map(s => s.folder).filter(Boolean))].sort().forEach(f => { const o = el('option'); o.value = f; dl.append(o); });
    root.append(dl);

    const card = el('div', 'feed-set-card');
    card.id = 'feedSubsCard';
    if (!subs.length) card.append(el('p', 'feed-muted', 'No feeds yet. Add one below or import an OPML file.'));
    subs.forEach(s => card.append(subRow(s)));
    const addRow = el('div', 'feed-add-row');
    const input = el('input'); input.type = 'text'; input.placeholder = 'Add a site or feed address…'; input.autocomplete = 'off'; input.spellcheck = false;
    const add = btn('button-secondary feed-btn', '＋ Add', () => addFeed(uiRef, input.value, input));
    add.setAttribute('data-feed-add', '');
    input.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); addFeed(uiRef, input.value, input); } });
    addRow.append(input, add);
    const io = el('div', 'feed-actions-row');
    io.id = 'feedOpmlActions';
    io.append(btn('button-secondary feed-btn', '📥 Import OPML', () => els.opmlInput.click()),
        btn('button-secondary feed-btn', '📤 Export OPML', () => { if (!subs.length) return toast(uiRef, 'Nothing to export yet'); exportOpml(); }));
    card.append(addRow, io);
    root.append(card);

    root.append(el('p', 'settings-caption', 'BEHAVIOR'));
    const beh = el('div', 'feed-set-card');
    beh.id = 'feedBehaviorCard';
    beh.append(
        toggleRow('feedSetMarkRead', '✓ Mark read when opened', 'Items you open or summarize leave your unread list', 'markReadOnOpen'),
        toggleRow('feedSetAutoSum', '✨ Auto-summarize favorites', 'Starring an item summarizes it in a background tab', 'autoSummarizeFavs'),
        toggleRow('feedSetPoll', '🔔 Check in the background', 'Shows a badge on the toolbar icon when new items arrive', 'backgroundPoll'),
        selectRow('feedSetRefresh', '🔄 Refresh feeds every', 'refreshMinutes', [[15, '15 minutes'], [30, '30 minutes'], [60, '1 hour'], [180, '3 hours']]),
        selectRow('feedSetKeep', '🗂️ Keep items for', 'keepDays', [[7, '7 days'], [30, '30 days'], [90, '90 days'], [365, '1 year']]),
        el('p', 'feed-muted', 'Summarize on a feed item follows the mode chosen on the Summarize screen (extension by default). Favorites are always kept.')
    );
    root.append(beh);
}

// ── Public API ─────────────────────────────────────────────────────────────
export async function onFeedsScreenShown(uiObj) {
    uiRef = uiObj;
    closeSheet(); hideUndo();
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
        empty: document.getElementById('feedEmpty')
    };
    if (!els.list) return;

    els.sourcePill.addEventListener('click', openSourcePicker);
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
