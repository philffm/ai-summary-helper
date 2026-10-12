// modules/feedSyncStore.js
// Connects the feed-URL vault (inboxManager.syncFeeds) to the feeds stored in chrome.storage.local. Works on storage directly,
// so it does not matter whether the Feeds tab is open; feedManager.js reloads when the list changes (storage.onChanged).
// Only the list changes: removing a feed also removes its items, adding one starts with no items and is fetched on the next refresh.
import { SK } from './storageKeys.js';
import { hash } from './feedHash.js';
import { cleanFeedUrl, cleanTagList } from './feedSync.js';

const titleOf = (s) => (s && (s.customTitle || s.title)) || '';

export function feedSyncAdapter(storage = chrome.storage.local) {
    const subsNow = async () => { const s = (await storage.get(SK.feedSubs))[SK.feedSubs]; return Array.isArray(s) ? s : []; };
    return {
        /** The live feeds as the vault sees them. */
        async getSubs() { return (await subsNow()).map((s) => ({ url: s.url, title: titleOf(s), tags: s.tags || [] })); },

        /** Makes the stored feeds match the plan: { add:[{url,title,tags}], update:[…], remove:[url] }. Every URL is checked again. */
        async applyPlan(plan) {
            const subs = await subsNow();
            let items = null;
            for (const x of plan.update || []) {
                const s = subs.find((y) => y.url === x.url); if (!s) continue;
                s.tags = cleanTagList(x.tags);
                if (x.title && x.title !== titleOf(s)) { if (x.title === s.title) delete s.customTitle; else s.customTitle = x.title; }
            }
            for (const x of plan.add || []) {
                const url = cleanFeedUrl(x.url);
                if (!url || subs.some((s) => s.url === url)) continue;
                subs.push({ id: hash(url), url, title: x.title || new URL(url).hostname, siteUrl: '', tags: cleanTagList(x.tags), addedAt: Date.now(), lastFetched: 0, error: '' });
            }
            const gone = new Set((plan.remove || []).map(cleanFeedUrl).filter(Boolean));
            let kept = subs;
            if (gone.size) {
                const ids = new Set(subs.filter((s) => gone.has(s.url)).map((s) => s.id));
                kept = subs.filter((s) => !gone.has(s.url));
                if (ids.size) items = ((await storage.get(SK.feedItems))[SK.feedItems] || []).filter((i) => !ids.has(i.feedId));
            }
            await storage.set({ [SK.feedSubs]: kept, ...(items ? { [SK.feedItems]: items } : {}) });
        },
    };
}
