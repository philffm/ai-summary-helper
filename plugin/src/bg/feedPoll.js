// bg/feedPoll.js — feeds: background polling and Ollama processing.
// A classic script of the background worker, loaded where background.js says importScripts('bg/feedPoll.js')
// (Chrome/Android) or listed after background.js in the manifest (Firefox/iOS). Same global scope as background.js:
// it uses names from there and background.js uses its functions, only ever from inside listeners and functions.
/* global FEED_WORKER, SK, localGet, updateSumBadge, sumJobsReady */
/* exported FEED_ALARM, applyFeedPollConfig, clearFeedBadge, pollFeeds */

// ── Feeds: background polling + Ollama processing ────────────────────────────
const FEED_ALARM = 'feedPoll';

async function pruneBackgroundFeedData(settings) {
    if (FEED_WORKER) FEED_WORKER.pruneFeedBodies(Date.now() - Math.max(1, Number(settings && settings.keepDays) || 30) * 86400000).catch(() => {});
    const raw = await localGet({ [SK.feedBackground]: {}, [SK.feedItems]: [], [SK.articlesIndex]: [] });
    const state = raw[SK.feedBackground];
    if (!state || !Object.keys(state).length) return;
    const items = raw[SK.feedItems] || [];
    const articles = raw[SK.articlesIndex] || [];
    const cutoff = Date.now() - Math.max(1, Number(settings && settings.keepDays) || 30) * 86400000;
    const mainIds = new Set(items.map(item => item.id));
    const mainNonFav = items.filter(item => item.published >= cutoff && !backgroundItemFav(item, articles)).length;
    const retained = (state.items || []).map(item => ({ ...item, favorite: backgroundItemFav(item, articles) }))
        .filter(item => !mainIds.has(item.id) && (item.published >= cutoff || item.favorite));
    const keptItems = FEED_WORKER
        ? FEED_WORKER.mergeWorkerItems([], retained, settings && settings.keepDays, Date.now(), Math.max(0, FEED_MAX_ITEMS_TOTAL - mainNonFav))
        : retained;
    const storedItems = keptItems.map(({ favorite: _favorite, ...item }) => item);
    const ids = new Set([...mainIds, ...storedItems.map(item => item.id)]);
    const ratings = Object.fromEntries(Object.entries(state.ratings || {}).filter(([id]) => ids.has(id)));
    const firstDay = FEED_WORKER ? FEED_WORKER.startOfDay(cutoff) : new Date(cutoff).setHours(0, 0, 0, 0);
    const recaps = Object.fromEntries(Object.entries(state.recaps || {}).filter(([key]) => {
        const day = Number(String(key).split('|')[0]);
        return !Number.isFinite(day) || day >= firstDay;
    }));
    if (storedItems.length !== (state.items || []).length || Object.keys(ratings).length !== Object.keys(state.ratings || {}).length
        || Object.keys(recaps).length !== Object.keys(state.recaps || {}).length) {
        state.items = storedItems;
        state.ratings = ratings;
        state.recaps = recaps;
        await chrome.storage.local.set({ [SK.feedBackground]: state });
    }
}

async function applyFeedPollConfig() {
    if (!chrome.alarms) return;
    const { [SK.feedSettings]: feedSettings } = await localGet(SK.feedSettings);
    await pruneBackgroundFeedData(feedSettings || {});
    if (!feedSettings || !feedSettings.autoProcess) {
        if (feedRunController) feedRunController.abort();
    }
    await chrome.alarms.clear(FEED_ALARM);
    if (feedSettings && (feedSettings.backgroundPoll || feedSettings.autoProcess)) {
        const intervals = [];
        if (feedSettings.backgroundPoll) intervals.push(Number(feedSettings.refreshMinutes) || 30);
        if (feedSettings.autoProcess) intervals.push(Number(feedSettings.autoProcessMinutes) || 30);
        chrome.alarms.create(FEED_ALARM, { delayInMinutes: 1, periodInMinutes: Math.max(15, Math.min(...intervals)) });
    } else {
        await clearFeedBadge();
    }
}

async function clearFeedBadge() {
    await chrome.storage.local.set({ [SK.feedPending]: 0 });
    await updateSumBadge();
}

let feedPollRunning = false;
let feedRunController = null;
const FEED_MAX_REQUESTS_PER_TICK = 3;
const FEED_AI_TIMEOUT_MS = 4 * 60 * 1000;
const FEED_MAX_ITEMS_TOTAL = 6000;

async function backgroundOllamaConfigured() {
    try {
        const sync = await chrome.storage.sync.get(['connectionMode', 'activeService']);
        const cfg = ((await localGet(SK.servicesConfig))[SK.servicesConfig] || {}).ollama || {};
        const active = sync.connectionMode === 'local' && sync.activeService === 'ollama';
        const saved = !!(cfg.endpoint || cfg.endpointUrl || cfg.activeModelId || (Array.isArray(cfg.customModel) ? cfg.customModel.length : cfg.customModel));
        return active || saved;
    } catch (_) { return false; }
}

function backgroundItemFav(item, articles) {
    const key = (value) => {
        try {
            const u = new URL(value);
            for (const name of ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'fbclid', 'gclid', 'ref', 'source']) u.searchParams.delete(name);
            return `${u.hostname.replace(/^www\./, '')}${u.pathname.replace(/\/+$/, '')}${u.search}`.toLowerCase();
        } catch (_) { return String(value || '').toLowerCase().trim(); }
    };
    const url = key(item.link);
    return articles.some(article => article.favorite && [article.url, article.feedUrl].some(candidate => candidate && key(candidate) === url));
}

async function fetchBackgroundFeed(sub) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), sub.slow || sub.errorCount ? 5000 : 15000);
    try {
        const res = await fetch(sub.url, {
            credentials: 'omit', redirect: 'follow', signal: ctrl.signal,
            headers: {
                Accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml, */*;q=0.5',
                ...(sub.etag && (sub.validatorFailures || 0) < 10 ? { 'If-None-Match': sub.etag } : {}),
                ...(sub.lastModified && (sub.validatorFailures || 0) < 10 ? { 'If-Modified-Since': sub.lastModified } : {})
            }
        });
        return {
            status: res.status, ok: res.ok, url: res.url || sub.url,
            etag: res.headers.get('etag') || '', lastModified: res.headers.get('last-modified') || '',
            cacheControl: res.headers.get('cache-control') || '', retryAfter: res.headers.get('retry-after') || '',
            xml: res.status === 304 || !res.ok ? '' : (await res.text()).slice(0, 3 * 1024 * 1024)
        };
    } finally { clearTimeout(timer); }
}

function withFeedAiTimeout(signal) {
    const controller = new AbortController();
    let expired = false;
    const abort = () => controller.abort();
    if (signal) {
        if (signal.aborted) controller.abort();
        else signal.addEventListener('abort', abort, { once: true });
    }
    const timer = setTimeout(() => { expired = true; controller.abort(); }, FEED_AI_TIMEOUT_MS);
    return {
        signal: controller.signal,
        close() { clearTimeout(timer); if (signal) signal.removeEventListener('abort', abort); },
        timedOut() { return expired; }
    };
}

async function pollFeeds() {
    if (feedPollRunning || !FEED_WORKER) return;
    feedPollRunning = true;
    try {
        const raw = await localGet({ [SK.feedSubs]: [], [SK.feedItems]: [], [SK.feedRecaps]: {}, [SK.feedBackground]: {}, [SK.feedBgSeen]: {}, [SK.feedPending]: 0, [SK.feedSettings]: {}, [SK.articlesIndex]: [] });
        const d = {
            feedSubs: raw[SK.feedSubs] || [], feedItems: raw[SK.feedItems] || [], feedRecaps: raw[SK.feedRecaps] || {},
            background: raw[SK.feedBackground] || {}, seen: raw[SK.feedBgSeen] || {},
            feedPending: raw[SK.feedPending] || 0, feedSettings: raw[SK.feedSettings] || {}, articles: raw[SK.articlesIndex] || []
        };
        await pruneBackgroundFeedData(d.feedSettings);
        d.background = (await localGet(SK.feedBackground))[SK.feedBackground] || d.background;
        const configured = d.feedSettings.autoProcess && await backgroundOllamaConfigured();
        if (!d.feedSettings.backgroundPoll && !configured) return;
        const state = { items: [], ratings: {}, recaps: {}, ...(d.background || {}) };
        state.items = Array.isArray(state.items) ? state.items : [];
        state.ratings = state.ratings || {}; state.recaps = state.recaps || {};
        const existing = [...d.feedItems, ...state.items];
        const knownIds = new Set(existing.map(i => i.id));
        const knownLinks = new Set(existing.map(i => i.link));
        const seen = d.seen;
        let fresh = 0;
        const now = Date.now();
        const minimumInterval = Math.max(15, Number(d.feedSettings.refreshMinutes) || 30) * 60000;
        const dueSubs = d.feedSubs.filter(sub => {
            if (sub.muted || (Number(sub.nextFetchAt) || 0) > now) return false;
            const interval = d.feedSettings.smartRefreshOrder === false ? minimumInterval
                : FEED_WORKER.estimateFeedInterval(existing, sub.id, minimumInterval, now);
            return !sub.lastFetched || now - sub.lastFetched >= interval;
        });
        const priorityItems = existing.map(item => ({
            ...item,
            favorite: item.favorite || backgroundItemFav(item, d.articles),
            summarized: d.articles.some(article => !article.feedStub && !article.savedOnly &&
                [article.url, article.feedUrl].some(url => url && url === item.link))
        }));
        const queue = d.feedSettings.smartRefreshOrder === false ? [...dueSubs] : dueSubs.sort((a, b) => {
            const risk = sub => Math.max(Number(sub.errorCount) || 0, sub.slow ? 2 : 0);
            return risk(a) - risk(b) ||
                FEED_WORKER.feedPriority(b, priorityItems, FEED_WORKER.feedQualityWeight(priorityItems, b.id, now), now) -
                FEED_WORKER.feedPriority(a, priorityItems, FEED_WORKER.feedQualityWeight(priorityItems, a.id, now), now) ||
                (Number(a.lastFetched) || 0) - (Number(b.lastFetched) || 0);
        });
        let stateWrite = Promise.resolve();
        const saveBackground = () => {
            stateWrite = stateWrite.then(() => chrome.storage.local.set({ [SK.feedBackground]: state }));
            return stateWrite;
        };
        const worker = async () => {
            while (queue.length) {
                const sub = queue.shift();
                const started = Date.now();
                try {
                    const fetched = await fetchBackgroundFeed(sub);
                    const fetchedAt = Date.now();
                    sub.lastFetched = fetchedAt;
                    sub.fetchDurationMs = fetchedAt - started;
                    sub.slow = sub.fetchDurationMs >= 8000;
                    if (fetched.etag) sub.etag = fetched.etag;
                    if (fetched.lastModified) sub.lastModified = fetched.lastModified;
                    const maxAge = Number((fetched.cacheControl.match(/(?:^|,)\s*max-age=(\d+)/i) || [])[1]) * 1000;
                    const retrySeconds = Number(fetched.retryAfter);
                    const retryDate = Date.parse(fetched.retryAfter);
                    sub.nextFetchAt = maxAge ? fetchedAt + maxAge : 0;
                    if (fetched.retryAfter && Number.isFinite(retrySeconds)) sub.nextFetchAt = fetchedAt + retrySeconds * 1000;
                    else if (fetched.retryAfter && Number.isFinite(retryDate)) sub.nextFetchAt = Math.max(fetchedAt, retryDate);
                    if (fetched.status === 304) {
                        sub.validatorFailures = (sub.validatorFailures || 0) + 1;
                        sub.error = ''; sub.errorCount = 0;
                        console.debug('[feeds] background refresh', sub.id, `${sub.fetchDurationMs}ms`, 'newItems=0');
                        continue;
                    }
                    if (!fetched.ok) throw Object.assign(new Error('HTTP ' + fetched.status), fetched);
                    sub.validatorFailures = 0;
                    sub.error = ''; sub.errorCount = 0;
                const parsed = FEED_WORKER.parseWorkerFeed(fetched.xml, fetched.url, sub);
                // the full text goes to its own keys; the items stay small (see modules/feedBodies.js)
                FEED_WORKER.saveFeedBodies(parsed.map(i => ({ id: i.id, html: i.body, published: i.published }))).catch(() => {});
                parsed.forEach(i => { delete i.body; });
                const links = parsed.map(i => i.link);
                const prev = seen[sub.id];
                if (prev) {
                    const prevSet = new Set(prev);
                    const newLinks = links.filter(l => !prevSet.has(l) && !knownLinks.has(l));
                    fresh += newLinks.length;
                    console.debug('[feeds] background refresh', sub.id, `${sub.fetchDurationMs}ms`, `newItems=${newLinks.length}`);
                } else {
                    console.debug('[feeds] background refresh', sub.id, `${sub.fetchDurationMs}ms`, `newItems=${links.filter(l => !knownLinks.has(l)).length}`);
                }
                seen[sub.id] = [...new Set([...links, ...(prev || [])])].slice(0, 300);
                if (configured) {
                    const additions = parsed.filter(i => !knownIds.has(i.id)).map(item => ({
                        ...item, favorite: backgroundItemFav(item, d.articles)
                    }));
                    if (additions.length) {
                        const cutoff = Date.now() - Math.max(1, Number(d.feedSettings.keepDays) || 30) * 86400000;
                        const mainNonFav = d.feedItems.filter(item => item.published >= cutoff && !backgroundItemFav(item, d.articles)).length;
                        const capacity = Math.max(0, FEED_MAX_ITEMS_TOTAL - mainNonFav);
                        state.items = FEED_WORKER.mergeWorkerItems(state.items, additions, d.feedSettings.keepDays, Date.now(), capacity)
                            .map(({ favorite: _favorite, ...item }) => item);
                        additions.forEach(i => { knownIds.add(i.id); knownLinks.add(i.link); });
                        await saveBackground();
                    }
                }
                } catch (error) {
                    const failedAt = Date.now();
                    sub.lastFetched = failedAt;
                    sub.error = error.message || 'Request failed';
                    sub.errorCount = (sub.errorCount || 0) + 1;
                    const retrySeconds = Number(error.retryAfter);
                    const retryDate = Date.parse(error.retryAfter);
                    const maxAge = Number((String(error.cacheControl || '').match(/(?:^|,)\s*max-age=(\d+)/i) || [])[1]) * 1000;
                    sub.nextFetchAt = error.retryAfter && Number.isFinite(retrySeconds) ? failedAt + retrySeconds * 1000
                        : error.retryAfter && Number.isFinite(retryDate) ? Math.max(failedAt, retryDate)
                            : maxAge ? failedAt + maxAge
                                : failedAt + Math.min(15 * 60 * 1000, 30000 * (2 ** Math.min(sub.errorCount - 1, 5)));
                    console.debug('[feeds] background refresh', sub.id, `${sub.fetchDurationMs || failedAt - started}ms`, 'newItems=0', sub.error);
                }
            }
        };
        await Promise.all(Array.from({ length: Math.min(4, queue.length) }, worker));
        const pending = (d.feedPending || 0) + fresh;
        const latestSubs = (await localGet(SK.feedSubs))[SK.feedSubs] || [];
        const fetchedById = new Map(d.feedSubs.map(sub => [sub.id, sub]));
        const feedSubs = latestSubs.map(sub => {
            const fetched = fetchedById.get(sub.id);
            if (!fetched || fetched.url !== sub.url) return sub;
            const updated = { ...sub };
            for (const key of ['lastFetched', 'etag', 'lastModified', 'nextFetchAt', 'validatorFailures', 'error', 'errorCount', 'fetchDurationMs', 'slow']) {
                if (key in fetched) updated[key] = fetched[key];
            }
            return updated;
        });
        await chrome.storage.local.set({ [SK.feedBgSeen]: seen, [SK.feedPending]: pending, [SK.feedSubs]: feedSubs });
        await sumJobsReady();
        await updateSumBadge();
        if (!configured) return;

        const latestSettings = (await localGet(SK.feedSettings))[SK.feedSettings] || {};
        if (!latestSettings.autoProcess || !(await backgroundOllamaConfigured())) return;
        d.feedSettings = latestSettings;
        const interval = Math.max(15, Number(d.feedSettings.autoProcessMinutes) || 30) * 60000;
        if (Date.now() - Math.max(Number(d.feedSettings.autoProcessAt) || 0, Number(state.status && state.status.at) || 0) < interval) return;
        const runController = new AbortController();
        feedRunController = runController;
        const articleFavs = d.articles;
        const favoriteItems = list => list.map(item => ({ ...item, favorite: backgroundItemFav(item, articleFavs) }));
        const mergedItems = FEED_WORKER.mergeWorkerItems(
            favoriteItems(d.feedItems), favoriteItems(state.items), d.feedSettings.keepDays, Date.now(), FEED_MAX_ITEMS_TOTAL
        )
            .map(item => {
                const rating = state.ratings[item.id];
                return { ...item, ...(rating || {}), favorite: backgroundItemFav(item, articleFavs) };
            })
            .filter(item => item.published >= Date.now() - (Math.max(1, Number(d.feedSettings.keepDays) || 30) * 86400000) || item.favorite);
        const recaps = { ...d.feedRecaps };
        Object.entries(state.recaps).forEach(([key, recap]) => {
            if (!recaps[key] || (Number(recap.at) || 0) >= (Number(recaps[key].at) || 0)) recaps[key] = recap;
        });
        const topicLang = (await FEED_WORKER.uiLanguage()).code;
        FEED_WORKER.setAiDetail(d.feedSettings.aiDetail);   // titles only, or titles + descriptions
        await FEED_WORKER.loadLexicon();
        const plan = FEED_WORKER.planLibrary({
            items: mergedItems, recaps, source: 'all', inSource: () => true,
            startOfDay: FEED_WORKER.startOfDay, itemSig: FEED_WORKER.itemSig, includeToday: true, rateWithRecap: d.feedSettings.rateWithRecap !== false,
            subs: d.feedSubs, topicLang, articleTags: d.articles.flatMap(a => a.tags || [])
        });
        // A timeout lowers the batch size for this machine (state.batchSize); a new batch size in the settings (e.g. another profile) wins again.
        const settingBatch = [10, 20, 40].includes(Number(d.feedSettings.libraryBatch)) ? Number(d.feedSettings.libraryBatch) : 20;
        const fallbackBatch = state.batchSize && state.batchBase === settingBatch ? Number(state.batchSize) : 0;
        const configuredBatch = [10, 20, 40].includes(fallbackBatch) ? fallbackBatch : settingBatch;
        const requestsPerTick = [1, 2, 3, 4, 6, 8].includes(Number(d.feedSettings.requestsPerTick)) ? Number(d.feedSettings.requestsPerTick) : FEED_MAX_REQUESTS_PER_TICK;
        const work = FEED_WORKER.boundedLibraryPlan(plan, configuredBatch, requestsPerTick);
        if (!work.rate.length && !work.days.length && !(work.tag && work.tag.length) && !(work.lex && work.lex.length)) return;

        const subscriptions = new Map(d.feedSubs.map(sub => [sub.id, sub]));
        let timedOut = false;
        const saveRatings = (items) => {
            for (const item of items) {
                const { ai, sent, cat, catTried } = item;
                if (ai || sent !== undefined || cat) state.ratings[item.id] = { ...(ai ? { ai } : {}), ...(sent !== undefined ? { sent } : {}), ...(cat ? { cat } : {}), ...(catTried && !cat ? { catTried } : {}) };
            }
        };
        const aiCall = async (fn, signal) => {
            const timeout = withFeedAiTimeout(signal);
            try { return await fn(timeout.signal); }
            catch (e) {
                if (timeout.timedOut()) { timedOut = true; throw Object.assign(new Error('Ollama request timed out'), { timeout: true }); }
                throw e;
            } finally { timeout.close(); }
        };
        // Categories already given to items in this library, most used first: the category request picks from these (plus defaults).
        const knownCats = () => { const m = new Map(); for (const r of Object.values(state.ratings || {})) if (r && r.cat) m.set(r.cat, (m.get(r.cat) || 0) + 1); return [...m].sort((a, b) => b[1] - a[1]).slice(0, 12).map(x => x[0]); };
        const rateChunk = async (chunk, signal) => {
            const result = await aiCall(aiSignal => FEED_WORKER.scoreItems(chunk, i => (subscriptions.get(i.feedId) || {}).customTitle || (subscriptions.get(i.feedId) || {}).title || '', { signal: aiSignal, service: 'ollama', knownCats: knownCats() }), signal);
            chunk.forEach((item, index) => {
                if (!item.ai && result.scores[index] !== null) { item.sent = result.scores[index]; item.ai = true; }
                if (!item.cat && result.labels && result.labels[index]) item.cat = result.labels[index];
                if (item.ai && !item.cat) item.catTried = true;
            });
            saveRatings(chunk);
            await chrome.storage.local.set({ [SK.feedBackground]: state });
        };
        // Up to 3 topic tags per feed in the UI language, stored as `topics` (the user's own `tags` are never touched).
        const tagFeed = async (entry, signal) => {
            const sub = subscriptions.get(entry.id) || {};
            const result = entry.keys
                ? { ...(await aiCall(aiSignal => FEED_WORKER.translateFeedTopics(entry.keys, { signal: aiSignal, service: 'ollama' }), signal)), keys: entry.keys }
                : await aiCall(aiSignal => FEED_WORKER.generateFeedTopics(sub.customTitle || sub.title || '', entry.items, { cats: FEED_WORKER.categoryCounts(entry.all), signal: aiSignal, service: 'ollama' }), signal);
            const stored = (await localGet(SK.feedSubs))[SK.feedSubs] || [];
            const target = stored.find(x => x.id === entry.id);
            if (!target) return;
            target.topics = result.tags.slice(0, 3); target.topicKeys = result.keys; target.topicsLang = result.lang;
            await chrome.storage.local.set({ [SK.feedSubs]: stored });
            await FEED_WORKER.saveLexicon();
        };
        // Tags of saved articles that are neither built-in nor learned: named once, kept only in the lexicon.
        const nameTags = async (batch, signal) => {
            await aiCall(aiSignal => FEED_WORKER.learnTagNames(batch, { signal: aiSignal, service: 'ollama' }), signal);
            await FEED_WORKER.saveLexicon();
        };
        const recapDay = async (entry, size, signal, ctx = {}) => {
            const key = `${entry.day}|all`;
            const dayItems = mergedItems.filter(i => FEED_WORKER.startOfDay(i.published) === entry.day).sort((a, b) => b.published - a.published);
            const sigs = list => Object.fromEntries(list.map(item => [item.id, FEED_WORKER.itemSig(item)]));
            const chunks = FEED_WORKER.chunksOf(entry.todo, size);
            let current = recaps[key] || null;
            for (let index = 0; index < chunks.length; index++) {
                const chunk = chunks[index];
                if (signal && signal.aborted) throw Object.assign(new Error('Cancelled'), { cancelled: true });
                if (ctx.step) ctx.step({ batch: index + 1, batches: chunks.length, count: chunk.length });
                let recap;
                if (!current) {
                    recap = await aiCall(aiSignal => FEED_WORKER.generateRecap(chunk, i => (subscriptions.get(i.feedId) || {}).customTitle || (subscriptions.get(i.feedId) || {}).title || '', {
                        rate: d.feedSettings.rateWithRecap !== false, signal: aiSignal, service: 'ollama'
                    }), signal);
                    if (d.feedSettings.rateWithRecap !== false) chunk.forEach((item, n) => {
                        if (!item.ai && recap.scores && recap.scores[n] != null) { item.sent = recap.scores[n]; item.ai = true; }
                        if (!item.cat && recap.labels && recap.labels[n]) item.cat = recap.labels[n];
                        if (item.ai && !item.cat) item.catTried = true;
                    });
                    const { labels: _labels, scores: _scores, ...base } = recap;
                    recap = { ...base, covered: sigs(chunk) };
                } else {
                    recap = await aiCall(aiSignal => FEED_WORKER.generateRecapUpdate(current, chunk, i => (subscriptions.get(i.feedId) || {}).customTitle || (subscriptions.get(i.feedId) || {}).title || '', {
                        rate: d.feedSettings.rateWithRecap !== false, edited: item => item.id in current.covered, signal: aiSignal, service: 'ollama'
                    }), signal);
                    if (d.feedSettings.rateWithRecap !== false && recap.sent) recap.sent.forEach((item, n) => {
                        if (!item.ai && recap.scores && recap.scores[n] != null) { item.sent = recap.scores[n]; item.ai = true; }
                        if (!item.cat && recap.labels && recap.labels[n]) item.cat = recap.labels[n];
                        if (item.ai && !item.cat) item.catTried = true;
                    });
                    const { labels: _labels, scores: _scores, sent: _sent, ...base } = recap;
                    recap = { ...base, covered: { ...current.covered, ...sigs(chunk) } };
                }
                current = state.recaps[key] = { ...recap, hash: FEED_WORKER.hash(dayItems.map(i => i.id).sort().join(',')), at: Date.now(), n: dayItems.length, total: dayItems.length };
                recaps[key] = current;
                saveRatings(chunk);
                await chrome.storage.local.set({ [SK.feedBackground]: state });
                if (ctx.tick) ctx.tick();
            }
        };
        const result = await FEED_WORKER.runLibrary(work, configuredBatch, { rateChunk, tagFeed, nameTags, recapDay, signal: runController.signal });
        if (timedOut && configuredBatch > 10) { state.batchSize = 10; state.batchBase = settingBatch; }
        state.status = { at: Date.now(), rated: result.rated, recaps: result.recaps, failed: result.failed };
        await chrome.storage.local.set({ [SK.feedBackground]: state });
        if (result.rated || result.recaps) {
            const message = `${result.rated} new items rated · ${result.recaps} day recaps written`;
            try {
                await chrome.notifications.create(`feed-background-${state.status.at}`, {
                    type: 'basic', iconUrl: 'icons/icon48.png', title: 'Feed processing finished', message
                });
            } catch (_) { /* notification support varies by browser */ }
        }
    } catch (e) {
        console.warn('[feeds] poll failed', e);
    } finally { feedRunController = null; feedPollRunning = false; }
}
