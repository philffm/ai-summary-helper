// feedManager.js
// Small RSS/Atom reader. Feeds + items live in their own chrome.storage.local
// keys (feedSubs / feedItems) and are deliberately NOT mixed into the article
// archive: an item only reaches History once the user actually summarizes it
// (the content script saves summaries itself).
//
// Network access goes through the background page (`fetchFeedText`) so it works
// in every context (popup, native side panel, hybrid iframe on Firefox where
// the iframe has no privileged fetch). XML parsing happens here because
// DOMParser isn't available in the MV3 service worker.

import StorageManager from './storageManager.js';
import { normalizeUrl } from './textUtils.js';

const SUBS_KEY = 'feedSubs';
const ITEMS_KEY = 'feedItems';
const STALE_MS = 30 * 60 * 1000;      // refresh feeds older than 30 min when screen opens
const MAX_ITEMS_PER_FEED = 50;
const MAX_ITEMS_TOTAL = 500;
const MAX_RENDERED = 100;
const CONCURRENCY = 4;
const COMMON_FEED_PATHS = ['/feed', '/rss', '/atom.xml', '/feed.xml', '/rss.xml', '/index.xml'];

let subs = [];
let items = [];
let unreadOnly = false;
let refreshing = false;
let els = {};
let uiRef = null;
// normalized URL -> { fav: boolean, summarized: boolean } built from the History index
let historyByUrl = new Map();

// ── Storage ────────────────────────────────────────────────────────────────
async function load() {
    const data = await chrome.storage.local.get({ [SUBS_KEY]: [], [ITEMS_KEY]: [] });
    subs = data[SUBS_KEY] || [];
    items = data[ITEMS_KEY] || [];
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
    markRead(item).then(render);
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

    if (!isFav) {
        if (matches.length) {
            matches.forEach(a => { a.favorite = true; });
            await StorageManager.setLocal({ articlesIndex });
        } else {
            const feedName = (subs.find(x => x.id === item.feedId) || {}).title || '';
            await StorageManager.saveArticle({
                content: '',
                summary: '',
                url: item.link,
                title: item.title,
                description: item.snippet || '',
                tags: ['feed'],
                extra: { favorite: true, feedStub: true, fromFeed: feedName, lastOpened: new Date().toISOString() }
            });
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
}

function persist() {
    return chrome.storage.local.set({ [SUBS_KEY]: subs, [ITEMS_KEY]: items });
}

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

async function refreshSub(sub) {
    try {
        const res = await fetchText(sub.url);
        const parsed = parseFeed(res.text, res.url);
        if (!parsed) throw new Error('Not a valid feed');
        if (!sub.title && parsed.title) sub.title = parsed.title;
        if (parsed.siteUrl) sub.siteUrl = parsed.siteUrl;
        mergeItems(sub, parsed.items);
        sub.lastFetched = Date.now();
        sub.error = '';
    } catch (e) {
        sub.error = e.message || 'Failed';
        sub.lastFetched = Date.now();
    }
}

async function refreshAll(ui, { force = false } = {}) {
    if (refreshing) return;
    const due = subs.filter(s => force || !s.lastFetched || Date.now() - s.lastFetched > STALE_MS);
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
        items = items.slice(0, MAX_ITEMS_TOTAL);
        await persist();
    } finally {
        refreshing = false;
        setRefreshState(false);
        render();
    }
    const failed = subs.filter(s => s.error).length;
    if (force && failed) toast(ui, `${failed} feed${failed > 1 ? 's' : ''} could not be loaded`);
}

// ── Add / remove / import ──────────────────────────────────────────────────
async function addFeed(ui, rawUrl) {
    const url = normalizeInputUrl(rawUrl);
    if (!url) return toast(ui, 'Enter a valid web address');
    setBusy(true);
    try {
        const { feedUrl, parsed } = await resolveFeed(url);
        if (subs.some(s => s.url === feedUrl)) {
            toast(ui, 'Already subscribed');
            return;
        }
        const sub = {
            id: hash(feedUrl),
            url: feedUrl,
            title: parsed.title || new URL(feedUrl).hostname,
            siteUrl: parsed.siteUrl || '',
            addedAt: Date.now(),
            lastFetched: Date.now(),
            error: ''
        };
        subs.push(sub);
        mergeItems(sub, parsed.items);
        items.sort((a, b) => b.published - a.published);
        await persist();
        els.input.value = '';
        toast(ui, `Subscribed to ${sub.title}`);
        render();
    } catch (e) {
        toast(ui, e.message || 'Could not add feed');
    } finally {
        setBusy(false);
    }
}

async function removeFeed(id) {
    subs = subs.filter(s => s.id !== id);
    items = items.filter(i => i.feedId !== id);
    await persist();
    render();
}

async function importOpml(ui, file) {
    try {
        const text = await file.text();
        const doc = new DOMParser().parseFromString(text, 'text/xml');
        if (doc.querySelector('parsererror')) throw new Error('Not a valid OPML file');
        let added = 0;
        doc.querySelectorAll('outline[xmlUrl], outline[xmlurl]').forEach(o => {
            const url = safeHttpUrl(o.getAttribute('xmlUrl') || o.getAttribute('xmlurl'));
            if (!url || subs.some(s => s.url === url)) return;
            subs.push({
                id: hash(url),
                url,
                title: o.getAttribute('title') || o.getAttribute('text') || new URL(url).hostname,
                siteUrl: safeHttpUrl(o.getAttribute('htmlUrl')) || '',
                addedAt: Date.now(),
                lastFetched: 0,
                error: ''
            });
            added++;
        });
        await persist();
        toast(ui, added ? `Imported ${added} feed${added > 1 ? 's' : ''}` : 'No new feeds in that file');
        render();
        if (added) refreshAll(ui, { force: false });
    } catch (e) {
        toast(ui, e.message || 'Import failed');
    }
}

// ── Item actions ───────────────────────────────────────────────────────────
async function markRead(item, read = true) {
    if (item.read === read) return;
    item.read = read;
    await persist();
}

async function onSummarizeClick(item) {
    const art = await findSummarizedArticle(item.link);
    if (art) return viewSummary(item, art);
    openItem(item, true);
}

function openItem(item, summarize) {
    markRead(item).then(render);
    chrome.runtime.sendMessage({ action: 'openFeedItem', url: item.link, summarize }, (res) => {
        if (chrome.runtime.lastError) return;
        if (summarize && res && res.mode === 'extension') {
            toast(uiRef, res.reused
                ? 'Summarizing the open tab — it will show up under Summarize and History'
                : 'Summarizing in the background — it will show up under Summarize and History');
        }
    });
}

// ── Rendering ──────────────────────────────────────────────────────────────
function setBusy(busy) {
    if (els.addBtn) { els.addBtn.disabled = busy; els.addBtn.textContent = busy ? '…' : '＋'; }
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

function render() {
    if (!els.list) return;
    const subById = new Map(subs.map(s => [s.id, s]));
    els.subsCount.textContent = String(subs.length);

    // Subscriptions list
    els.subsList.replaceChildren();
    subs.forEach(s => {
        const row = el('li', 'feed-sub-row');
        const name = el('span', 'feed-sub-name', s.title || s.url);
        name.title = s.url;
        row.appendChild(name);
        if (s.error) row.appendChild(el('span', 'feed-sub-error', '⚠ ' + s.error));
        const rm = el('button', 'feed-icon-btn', '✕');
        rm.type = 'button';
        rm.title = 'Unsubscribe';
        rm.addEventListener('click', () => removeFeed(s.id));
        row.appendChild(rm);
        els.subsList.appendChild(row);
    });

    // Items
    els.list.replaceChildren();
    const unread = items.filter(i => !i.read).length;
    els.unreadToggle.textContent = unreadOnly ? `Unread (${unread})` : `All · ${unread} unread`;
    els.unreadToggle.classList.toggle('active', unreadOnly);

    const visible = items
        .filter(i => subById.has(i.feedId) && (!unreadOnly || !i.read))
        .sort((a, b) => b.published - a.published)
        .slice(0, MAX_RENDERED);

    els.empty.style.display = visible.length ? 'none' : 'block';
    els.empty.textContent = !subs.length
        ? 'No feeds yet. Paste a site or feed address above, use “Current site”, or import an OPML file from your old reader.'
        : (unreadOnly ? 'You’re all caught up. 🎉' : (refreshing ? 'Loading…' : 'No items yet — try Refresh.'));

    visible.forEach(item => {
        const hist = historyByUrl.get(normalizeUrl(item.link)) || { fav: false, summarized: false };
        const li = el('li', 'article-card feed-item' + (item.read ? ' is-read' : '') + (hist.fav ? ' is-favorite' : ''));
        const metaText = `${subById.get(item.feedId).title || ''} · ${timeAgo(item.published)}`;
        const meta = el('p', 'article-date', metaText);
        const title = el('h4', null, item.title);
        const head = el('div', 'article-header');
        const headText = el('div');
        headText.append(title, meta);
        if (hist.summarized) {
            const badge = el('span', 'feed-badge', '✓ Summarized');
            badge.title = 'You have a saved summary of this page';
            headText.append(badge);
        }
        const star = el('button', 'star-button', hist.fav ? '★' : '☆');
        star.type = 'button';
        star.title = 'Favorite';
        star.setAttribute('aria-label', 'Favorite');
        star.setAttribute('aria-pressed', String(hist.fav));
        star.addEventListener('click', (e) => { e.stopPropagation(); toggleFavorite(item); });
        head.append(headText, star);
        li.appendChild(head);
        if (item.snippet) li.appendChild(el('p', 'feed-snippet', item.snippet));

        const actions = el('div', 'feed-actions');
        const sum = el('button', 'button-primary feed-btn', hist.summarized ? '📄 View summary' : '✨ Summarize');
        sum.type = 'button';
        sum.addEventListener('click', (e) => { e.stopPropagation(); onSummarizeClick(item); });
        const open = el('button', 'button-secondary feed-btn', 'Open ↗');
        open.type = 'button';
        open.addEventListener('click', (e) => { e.stopPropagation(); openItem(item, false); });
        const read = el('button', 'button-secondary feed-btn', item.read ? 'Mark unread' : 'Mark read');
        read.type = 'button';
        read.addEventListener('click', async (e) => { e.stopPropagation(); await markRead(item, !item.read); render(); });
        actions.append(open, read, sum);
        li.appendChild(actions);
        li.tabIndex = 0;
        li.setAttribute('role', 'link');
        li.addEventListener('click', () => onCardClick(item));
        li.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target === li) onCardClick(item); });
        els.list.appendChild(li);
    });
}

// ── Public API ─────────────────────────────────────────────────────────────
export async function onFeedsScreenShown(ui) {
    uiRef = ui;
    await load();
    try { await reconcileStubs(); } catch (e) { console.warn('[feeds] stub reconcile failed', e); }
    await loadHistoryMap();
    render();
    refreshAll(ui);
}

export function initFeedManager(ui) {
    uiRef = ui;
    els = {
        input: document.getElementById('feedUrlInput'),
        addBtn: document.getElementById('feedAddBtn'),
        currentBtn: document.getElementById('feedCurrentSiteBtn'),
        opmlBtn: document.getElementById('feedOpmlBtn'),
        opmlInput: document.getElementById('feedOpmlInput'),
        refreshBtn: document.getElementById('feedRefreshBtn'),
        unreadToggle: document.getElementById('feedUnreadToggle'),
        markAllBtn: document.getElementById('feedMarkAllBtn'),
        subsCount: document.getElementById('feedSubsCount'),
        subsList: document.getElementById('feedSubsList'),
        list: document.getElementById('feedItemList'),
        empty: document.getElementById('feedEmpty')
    };
    if (!els.list) return;

    els.addBtn.addEventListener('click', () => addFeed(ui, els.input.value));
    els.input.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); addFeed(ui, els.input.value); } });
    els.refreshBtn.addEventListener('click', () => refreshAll(ui, { force: true }));
    els.unreadToggle.addEventListener('click', () => { unreadOnly = !unreadOnly; render(); });
    els.markAllBtn.addEventListener('click', async () => {
        items.forEach(i => { i.read = true; });
        await persist();
        render();
    });
    els.opmlBtn.addEventListener('click', () => els.opmlInput.click());
    els.opmlInput.addEventListener('change', () => {
        const f = els.opmlInput.files && els.opmlInput.files[0];
        if (f) importOpml(ui, f);
        els.opmlInput.value = '';
    });
    els.currentBtn.addEventListener('click', async () => {
        try {
            const { getActiveTab } = await import('./mainScreen.js');
            const tab = await getActiveTab();
            if (tab && /^https?:/i.test(tab.url || '')) {
                els.input.value = tab.url;
                addFeed(ui, tab.url);
            } else {
                toast(ui, 'Open a website in the current tab first');
            }
        } catch (e) {
            toast(ui, 'Could not read the current tab');
        }
    });
}
