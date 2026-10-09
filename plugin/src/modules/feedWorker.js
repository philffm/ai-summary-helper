import { hash } from './feedHash.js';

const AUDIO_EXT = /\.(mp3|m4a|aac|ogg|oga|opus|wav|flac)(\?|#|$)/i;
const MAX_FEED_ITEMS = 100;

export const feedItemId = (sub, item) => hash(sub.id + '|' + (item.guid || item.link));

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
    const rateCount = Math.min(plan.rate.length, slots * batchSize);
    slots -= Math.ceil(rateCount / batchSize);
    const days = [];
    for (const day of plan.days) {
        if (!slots) break;
        const count = Math.min(day.todo.length, slots * batchSize);
        if (!count) continue;
        const todo = day.todo.slice(0, count);
        days.push({ ...day, todo });
        slots -= Math.ceil(count / batchSize);
    }
    return { rate: plan.rate.slice(0, rateCount), days };
}
