import { hash } from './feedHash.js';
import { normalizeUrl } from './textUtils.js';

const AUDIO_EXT = /\.(mp3|m4a|aac|ogg|oga|opus|wav|flac)(\?|#|$)/i;
const MAX_FEED_ITEMS = 100;

export function medianItemGap(items, feedId, now = Date.now()) {
    const dates = [...new Set((items || [])
        .filter(item => item.feedId === feedId && Number(item.published) > 0 && Number(item.published) <= now && Number(item.published) >= now - 90 * 86400000)
        .map(item => Number(item.published)))]
        .sort((a, b) => a - b).slice(-12);
    const gaps = dates.slice(1).map((date, i) => date - dates[i]).filter(gap => gap > 0).sort((a, b) => a - b);
    if (!gaps.length) return 0;
    const middle = Math.floor(gaps.length / 2);
    return gaps.length % 2 ? gaps[middle] : (gaps[middle - 1] + gaps[middle]) / 2;
}

export function estimateFeedInterval(items, feedId, minimumMs, now = Date.now()) {
    const gap = medianItemGap(items, feedId, now);
    return Math.max(Number(minimumMs) || 0, gap ? gap / 2 : Number(minimumMs) || 0);
}

export function feedQualityWeight(items, feedId, now = Date.now()) {
    const recent = (items || []).filter(item => item.feedId === feedId && Number(item.published) >= now - 30 * 86400000);
    if (!recent.length) return 1;
    const engaged = recent.filter(item => item.read || item.favorite || item.summarized).length;
    return 0.1 + 0.9 * engaged / recent.length;
}

export function feedPriority(sub, items, qualityWeight = 1, now = Date.now()) {
    const gap = medianItemGap(items, sub.id, now);
    const elapsed = Math.max(0, now - (Number(sub.lastFetched) || 0));
    return (gap ? elapsed / gap : 1) * (Number(qualityWeight) || 0);
}

export const feedItemId = (sub, item) => hash(sub.id + '|' + (item.guid || item.link));

// ── Stable item identity ───────────────────────────────────────────────────
// An item is identified by what it IS, never by where it sits in the feed. The id it got when first seen never changes:
// later fetches are matched back to it by (1) the id the old formula gives (guid, else raw link), then, for items whose
// guid or link was rewritten by the publisher, (2) the same page (link without tracking parameters) and (3) the same
// title and publish time. Podcast episodes often share one link, so (2) and (3) only match items with the same audio
// file and never when the link appears more than once in the fetch.
const linkKey = (u) => (u ? normalizeUrl(u) : '');
const fingerprint = (it) => (it.title && Number(it.published) > 0 ? String(it.title).trim().toLowerCase() + '|' + Math.round(Number(it.published) / 1000) : '');
const sameAudio = (a, b) => String(a.audio || '') === String(b.audio || '');

/**
 * Gives every incoming item of one feed its identity: sets `item.id` and returns the items without duplicates (order kept).
 * `existing` are the stored items of that feed.
 */
export function reconcileItemIds(sub, incoming, existing = []) {
    const byId = new Map(), byLink = new Map(), byFp = new Map();
    for (const e of existing) {
        if (!e || !e.id) continue;
        byId.set(e.id, e);
        const lk = linkKey(e.link), fp = fingerprint(e);
        if (lk && !byLink.has(lk)) byLink.set(lk, e);
        if (fp && !byFp.has(fp)) byFp.set(fp, e);
    }
    const linkCount = new Map();
    for (const it of incoming) { const lk = linkKey(it.link); if (lk) linkCount.set(lk, (linkCount.get(lk) || 0) + 1); }
    const claimed = new Set(), assigned = new Map();   // existing id → taken; incoming item → existing it matches
    // pass 1: the id the item already had (guid, else link)
    for (const it of incoming) {
        const prev = byId.get(feedItemId(sub, it));
        if (prev && !claimed.has(prev.id)) { claimed.add(prev.id); assigned.set(it, prev); }
    }
    // pass 2: items whose guid / link was rewritten
    for (const it of incoming) {
        if (assigned.has(it)) continue;
        const lk = linkKey(it.link);
        let prev = lk && linkCount.get(lk) === 1 ? byLink.get(lk) : null;
        if (!prev || claimed.has(prev.id) || !sameAudio(prev, it)) {
            const fp = fingerprint(it);
            prev = fp ? byFp.get(fp) : null;
            if (prev && (claimed.has(prev.id) || !sameAudio(prev, it))) prev = null;
        }
        if (prev) { claimed.add(prev.id); assigned.set(it, prev); }
    }
    const seen = new Set(), out = [];
    for (const it of incoming) {
        const prev = assigned.get(it);
        const id = prev ? prev.id : hash(sub.id + '|' + (it.guid || linkKey(it.link) || it.link));
        if (seen.has(id)) continue;   // the feed lists the same item twice
        seen.add(id); it.id = id; out.push(it);
    }
    return out;
}

function decodeXml(text) {
    return String(text || '').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
        .replace(/&#x([0-9a-f]+);/gi, (_, n) => { try { return String.fromCodePoint(parseInt(n, 16)); } catch (_) { return ''; } })
        .replace(/&#(\d+);/g, (_, n) => { try { return String.fromCodePoint(Number(n)); } catch (_) { return ''; } })
        .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"').replace(/&apos;/g, "'");
}

function textOf(value) {
    return decodeXml(value).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

function tagValue(block, name) {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const match = block.match(new RegExp(`<(?:[\\w.-]+:)?${escaped}\\b[^>]*>([\\s\\S]*?)<\\/(?:[\\w.-]+:)?${escaped}\\s*>`, 'i'));
    return match ? match[1].trim() : '';
}

function safeUrl(value, base) {
    try {
        const url = new URL(decodeXml(value).trim(), base);
        return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : '';
    } catch (_) {
        return '';
    }
}

function attr(tag, name) {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return (tag.match(new RegExp(`\\b${escaped}\\s*=\\s*(["'])(.*?)\\1`, 'i')) || [])[2] || '';
}

function itemLink(block, atom, feedUrl) {
    const tags = block.match(/<(?:[\w.-]+:)?link\b[^>]*>/gi) || [];
    for (const tag of tags) {
        const href = attr(tag, atom ? 'href' : 'url');
        const rel = attr(tag, 'rel');
        if (atom && href && (!rel || rel === 'alternate')) return safeUrl(href, feedUrl);
        if (!atom && !href) {
            const inner = tagValue(block, 'link');
            if (inner) return safeUrl(inner, feedUrl);
        }
    }
    return atom ? '' : safeUrl(tagValue(block, 'link'), feedUrl);
}

function audioLink(block, feedUrl) {
    const tags = block.match(/<(?:[\w.-]+:)?(?:enclosure|link)\b[^>]*>/gi) || [];
    for (const tag of tags) {
        if (/^<[^>]*\blink\b/i.test(tag) && attr(tag, 'rel') !== 'enclosure') continue;
        const href = attr(tag, 'url') || attr(tag, 'href');
        const type = attr(tag, 'type').toLowerCase();
        if (href && (type.startsWith('audio/') || (!type.startsWith('video/') && AUDIO_EXT.test(href)))) {
            const url = safeUrl(href, feedUrl);
            if (url) return url;
        }
    }
    return '';
}

function durationOf(value) {
    if (!value) return 0;
    const parts = String(value).trim().split(':').map(Number);
    if (parts.some(n => !Number.isFinite(n))) return 0;
    return parts.reduce((total, n) => total * 60 + n, 0);
}

export function parseWorkerFeed(xml, feedUrl, sub, now = Date.now()) {
    const atom = /<(?:[\w.-]+:)?feed\b/i.test(xml) && /<(?:[\w.-]+:)?entry\b/i.test(xml);
    const blocks = [...String(xml || '').matchAll(atom
        ? /<(?:[\w.-]+:)?entry\b[^>]*>[\s\S]*?<\/(?:[\w.-]+:)?entry\s*>/gi
        : /<(?:[\w.-]+:)?item\b[^>]*>[\s\S]*?<\/(?:[\w.-]+:)?item\s*>/gi)].slice(0, MAX_FEED_ITEMS);
    const result = [];
    const ids = new Set();
    for (const match of blocks) {
        const block = match[0];
        const link = itemLink(block, atom, feedUrl);
        const audio = audioLink(block, feedUrl);
        const item = {
            guid: textOf(tagValue(block, atom ? 'id' : 'guid')) || link,
            title: textOf(tagValue(block, 'title')),
            link,
            published: Date.parse(textOf(tagValue(block, atom ? 'published' : 'pubDate') || tagValue(block, atom ? 'updated' : 'date'))) || now,
            snippet: textOf(tagValue(block, atom ? 'summary' : 'description') || tagValue(block, atom ? 'content' : 'encoded')).slice(0, 220),
            audio,
            dur: durationOf(textOf(tagValue(block, 'duration'))),
            img: ''
        };
        if (!item.title || (!item.link && !item.audio)) continue;
        if (!item.link) item.link = item.audio;
        item.id = feedItemId(sub, item);
        if (ids.has(item.id)) continue;
        ids.add(item.id);
        item.feedId = sub.id;
        item.read = false;
        result.push(item);
    }
    return result;
}

export function mergeWorkerItems(existing, incoming, keepDays = 30, now = Date.now(), maxItems = 6000) {
    // identity first: a rewritten guid / link must land on the item it already is, not create a second one
    const perFeed = new Map();
    for (const item of incoming) { const k = item.feedId; if (!perFeed.has(k)) perFeed.set(k, []); perFeed.get(k).push(item); }
    incoming = [];
    for (const [feedId, list] of perFeed) {
        incoming.push(...(feedId == null ? list : reconcileItemIds({ id: feedId }, list, existing.filter(e => e.feedId === feedId))));
    }
    const byId = new Map(existing.map(item => [item.id, item]));
    for (const item of incoming) {
        const old = byId.get(item.id);
        byId.set(item.id, old ? { ...item, ...old, title: item.title, link: item.link, snippet: item.snippet, published: item.published || old.published, audio: item.audio || old.audio, dur: item.dur || old.dur, img: item.img || old.img } : item);
    }
    const cutoff = now - Math.max(1, Number(keepDays) || 30) * 86400000;
    const retained = [...byId.values()].filter(item => item.published >= cutoff || item.favorite);
    retained.sort((a, b) => b.published - a.published);
    return retained.filter((item, index) => index < maxItems || item.favorite);
}

export function boundedLibraryPlan(plan, batchSize, maxRequests = 3) {
    let slots = Math.max(0, Math.floor(maxRequests));
    // Topic tags are one tiny request per feed (a few headlines in, a few words out): at most 2 per tick, on top of the batch slots.
    const tag = (plan.tag || []).slice(0, 2);
    const rateCount = Math.min(plan.rate.length, slots * batchSize);
    slots -= Math.ceil(rateCount / batchSize);
    const days = [];
    // Newest day first: what is on screen when the Feed opens (today, yesterday) gets its recap before the backlog does.
    // `rate` is already newest first (planLibrary), and rating runs before recaps, so the top of the list looks finished soonest.
    for (const day of [...plan.days].sort((x, y) => y.day - x.day)) {
        if (!slots) break;
        const count = Math.min(day.todo.length, slots * batchSize);
        if (!count) continue;
        const todo = day.todo.slice(0, count);
        days.push({ ...day, todo });
        slots -= Math.ceil(count / batchSize);
    }
    return { rate: plan.rate.slice(0, rateCount), days, ...(plan.tag ? { tag } : {}), ...(plan.lex ? { lex: plan.lex.slice(0, 1) } : {}) };   // one lexicon batch per tick
}
