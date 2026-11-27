// Entry of the sync bundle of the iOS app (app-sync.js, global AISH_APP). The app runs the extension's own sync modules in
// JavaScriptCore: nothing about stamps, merging, encryption or the remote layout is written a second time.
// Built by `node plugin/scripts/build.js --module-bundle` (see mobile/ios/project.yml); js/host.js provides what a browser
// would, on top of the Swift side (App/Sync).
import { createStampStore } from '../../../plugin/src/modules/syncStampStore.js';
import { createSyncService, cleanPlace, cleanConnection } from '../../../plugin/src/modules/syncService.js';
import { makeStore } from '../../../plugin/src/modules/syncStores.js';
import { createHighlightStore } from '../../../plugin/src/modules/highlightStore.js';
import { countWords } from '../../../plugin/src/modules/textUtils.js';
import { withQuestions } from '../../../plugin/src/modules/conversation.js';
import { hashValue } from '../../../plugin/src/modules/syncStamps.js';
import { mergeRecord } from '../../../plugin/src/modules/syncMerge.js';
import { deriveMaster, subKeys, nameOf, encryptJson, decryptJson, openMeta, toHex, toB64, fromB64 } from '../../../plugin/src/modules/syncCrypto.js';
import { canonicalPassphrase } from '../../../plugin/src/modules/syncPassphrase.js';
import { parsePhoneCode } from '../../../plugin/src/modules/syncPhoneCode.js';
import { SK, articleRecKey, syncLedgerKey } from '../../../plugin/src/modules/storageKeys.js';
import { signV4 } from '../../../plugin/src/modules/syncS3.js';
import { pageKeyForUrl } from '../../../plugin/src/modules/pageKey.js';
import { articleKey } from '../../../plugin/src/modules/syncIdentity.js';
import { withLock } from '../../../plugin/src/modules/articleLock.js';

// as in the extension's background (modules/syncBackgroundBundle.js)
const dataHooks = { count: countWords, compose: (base, turns) => withQuestions(base, turns, { all: false }) };

/**
 * The sync of one library. `storage` behaves like the extension's local storage (host.js); its change events are stamped
 * here, as the extension's background does. Without `writeBack` runs only fetch: nothing on the server changes.
 * `engine`: further options for the runs.
 */
function createSync({ storage, log = () => {}, writeBack = false, engine = {} }) {
    const stampStore = createStampStore({ storage });
    storage.onChanged.addListener((changes) => stampStore.onChanged(changes));
    const serviceWith = (options) => createSyncService({ storage, makeStore, stampStore, dataHooks, log, engine: { ...engine, ...options } });
    const service = serviceWith({ pullOnly: true });
    const writing = serviceWith({});
    const library = createLibrary({ storage, stampStore });

    /**
     * Joins the library the browser made, from the code it shows for a phone. The app never makes one: a folder without a
     * library is refused before anything is written there. One library at a time: a new one takes the place of the old.
     */
    async function join({ code, passphrase }) {
        const given = parsePhoneCode(code);
        if (!given) throw new Error('This is not a Kaivo library code.');
        const words = passphrase || given.words || '';
        if (!words) throw new Error('Enter the passphrase of the library.');
        const connection = cleanConnection({
            service: given.kind, url: given.url, username: given.username,
            ...(given.kind === 's3' ? { bucket: given.bucket, region: given.region } : {}),
            // the browser only shows such an address when it was allowed there; safeFetch takes it for private addresses only
            allowInsecureLan: /^http:/i.test(given.url),
        });
        const secret = { password: given.password };
        // looked at before anything else: testing a place would make its folder
        const store = await makeStore(connection, { root: given.root }, secret);
        if (!(await store.get('meta.json'))) throw new Error('There is no Kaivo library in that folder yet. Set up sync in the browser first, then join it here.');
        const before = await service.placesNow();
        const place = await service.add({ connection, secret, place: { mode: 'encrypted', direction: 'twoway', root: given.root, passphrase: words, ackBackup: true } });
        for (const old of before) await service.remove(old.id);
        // what another library brought stays on this device: it must never travel into this one
        await library.enter([connection.service, connection.url, connection.bucket || '', place.root].join('|'));
        return { id: place.id, root: place.root };
    }

    async function toTheEnd(runs, id, total) {
        for (let round = 0; round < 1000; round++) {
            const result = (await runs.syncNow(id))[id];
            if (!result || result.skipped) { total.skipped = true; return false; }
            if (result.error) throw new Error(result.error.message);
            for (const k of ['pulled', 'applied', 'pushed']) total[k] += result[k] || 0;
            total.errors.push(...result.errors);
            if (!result.more) return true;
        }
        return false;
    }

    let going = null;
    /** One run at a time: a second one asked for meanwhile is the same run. */
    function run() {
        if (!going) going = once().finally(() => { going = null; });
        return going;
    }

    /**
     * One run of the joined library, to its end: first everything is fetched, then what the app keeps for itself is told
     * apart from the library, and only then, when the app writes back, what changed here goes out. Throws what went wrong.
     */
    async function once() {
        const [place] = await service.placesNow();
        if (!place) throw new Error('No library is connected.');
        const total = { pulled: 0, applied: 0, pushed: 0, moved: 0, errors: [] };
        // nothing goes out after a fetch that did not end well: what is on the server is not fully known then
        if (!(await toTheEnd(service, place.id, total)) || total.errors.length) return total;
        total.moved = await library.settle(place.id);
        if (writeBack) await toTheEnd(writing, place.id, total);
        return total;
    }

    /** The joined library and how its last run went, without any login. null when none is joined. */
    async function state() {
        const [place] = await service.placesNow();
        if (!place) return null;
        const connection = (await service.connectionsNow()).find((c) => c.id === place.connectionId) || {};
        const articles = (await storage.get({ [SK.articlesIndex]: [] }))[SK.articlesIndex];
        return { id: place.id, service: connection.service, server: connection.name, root: place.root, articles: articles.length, writesBack: writeBack, last: (await service.statusNow())[place.id] || null };
    }

    /** Forgets the library and its login. What was fetched stays. */
    async function leave() {
        for (const place of await service.placesNow()) await service.remove(place.id);
    }

    /** What a code says, to be looked at before joining. No password. */
    function look(code) {
        const given = parsePhoneCode(code);
        if (!given) return null;
        let host = given.url;
        try { host = new URL(given.url).host; } catch (_) { /* shown as written */ }
        return { service: given.kind, server: host, folder: given.kind === 's3' ? `${given.bucket}/${given.root}` : given.root, words: !!given.words, plain: /^http:/i.test(given.url) };
    }

    return { service, writing, stampStore, highlights: createHighlightStore({ storage }), join, run, state, leave, look, library };
}

/** The extension's storage under names of its own, which none of its modules reads. */
function aside(storage, prefix) {
    const own = (keys) => [].concat(keys).map((k) => prefix + k);
    return {
        async get(query) {
            const names = typeof query === 'string' ? [query] : Array.isArray(query) ? query : Object.keys(query);
            const got = await storage.get(own(names));
            const out = typeof query === 'object' && !Array.isArray(query) ? { ...query } : {};
            for (const name of names) if (prefix + name in got) out[name] = got[prefix + name];
            return out;
        },
        set: (items) => storage.set(Object.fromEntries(Object.entries(items).map(([k, v]) => [prefix + k, v]))),
        remove: (keys) => storage.remove(own(keys)),
        getKeys: async () => (await storage.getKeys()).filter((k) => k.startsWith(prefix)).map((k) => k.slice(prefix.length)),
    };
}

const words = (text) => String(text || '').replace(/\s+/g, ' ').trim();
/**
 * The same words of the same page, and surroundings that agree as far as both tell them: the browser and the app cut them
 * to different lengths (the app only within the paragraph).
 */
const sameHighlight = (a, b) => {
    if (a.url !== b.url || words(a.text) !== words(b.text)) return false;
    const side = (h, name) => words((h.quote && h.quote[name]) || '');
    const [p, q] = [side(a, 'prefix'), side(b, 'prefix')], [s, t] = [side(a, 'suffix'), side(b, 'suffix')];
    return (p.endsWith(q) || q.endsWith(p)) && (s.startsWith(t) || t.startsWith(s));
};

/** Articles and highlights in the extension's shapes, written through its modules, in one storage. */
function createArea(storage) {
    const highlights = createHighlightStore({ storage });
    const read = async (key, empty) => (await storage.get({ [key]: empty }))[key];

    /** A store that is new starts as an extension does today: highlights filed by page. */
    async function prepare() {
        const keys = await storage.getKeys();
        if (!keys.some((k) => k === SK.articlesIndex || k === SK.hlSchema)) await storage.set({ [SK.hlSchema]: 2 });
    }
    const index = async () => read(SK.articlesIndex, []);
    const record = (id) => read(articleRecKey(id), null);
    /** The entry with this id, or else of this page. */
    const find = (list, id, url) => {
        const page = articleKey(url || '');
        return list.find((e) => e.id === id) || (page ? list.find((e) => articleKey(e.url || '') === page) : undefined);
    };
    /** Replaces the index under the lock the extension's writers take. `change(copy)` → records to write with it. */
    async function edit(change) {
        await prepare();
        await withLock('aish-articles', async () => {
            const list = (await index()).slice();
            const writes = await change(list);
            if (writes && Object.keys(writes).length) await storage.set(writes);
            await storage.set({ [SK.articlesIndex]: list });
        });
    }
    return { storage, highlights, prepare, index, record, find, edit };
}

/**
 * What the app reads and writes of the library. Two areas: `shared` is the synced library, under the extension's own keys;
 * it holds what came from the server, and of a change made here only how far an article was read and its highlights go
 * back. `own` holds what is only on this device (saved, shared to the app or handed over by Safari here); the sync never
 * sees it.
 */
function createLibrary({ storage, stampStore }) {
    const shared = createArea(storage), own = createArea(aside(storage, 'local:'));
    const read = async (key, empty) => (await storage.get({ [key]: empty }))[key];
    const extraKey = (id) => 'app:article:' + id;
    const extra = (id) => read(extraKey(id), {});
    const keepExtra = async (id, fields) => storage.set({ [extraKey(id)]: { ...(await extra(id)), ...fields } });

    const plainHighlight = (page, h) => ({ id: h.id, url: page, text: h.text, type: h.ai ? 'ghost' : 'user', timestamp: h.timestamp, v: 2,
        ...(h.prefix || h.suffix ? { quote: { exact: h.text, prefix: h.prefix || '', suffix: h.suffix || '' } } : {}) });

    /** Puts highlights into an area, leaving out what is there already; what the reader decided is carried over. */
    async function bring(area, list) {
        await area.prepare();
        const here = await area.highlights.all({ dismissed: true });
        const ops = [];
        for (const hl of list) {
            const same = here.find((x) => sameHighlight(x, hl));
            if (!same) { ops.push({ op: 'add', hl }); continue; }
            if (same.dismissed) continue;
            if (hl.dismissed && same.type === 'ghost') ops.push({ op: 'dismiss', page: same.url, id: same.id });
            else if (hl.type === 'user' && same.type === 'ghost') ops.push({ op: 'patch', page: same.url, id: same.id, patch: { type: 'user' } });
        }
        // `add` refuses a second one of the same words even when turned down; `upsert` keeps a turned-down one as it is
        if (ops.length) await area.highlights.apply(ops.map((o) => (o.op === 'add' && o.hl.dismissed ? { op: 'upsert', hl: o.hl } : o)));
    }

    /** What the index and the records do not tell: every highlight, and the page each article's highlights are filed under. */
    async function marks() {
        const pages = {}, same = {};
        for (const e of [...(await shared.index()), ...(await own.index())]) { pages[e.id] = pageKeyForUrl(e.url || ''); same[e.id] = articleKey(e.url || ''); }
        return { pages, same, highlights: [...(await shared.highlights.all({ dismissed: true })), ...(await own.highlights.all({ dismissed: true }))] };
    }

    /** Finds an entry of a list by id or else by page, without walking the list each time. */
    function lookup(list) {
        const ids = new Map(), pages = new Map();
        const add = (e) => {
            ids.set(e.id, e);
            const page = articleKey(e.url || '');
            if (page && !pages.has(page)) pages.set(page, e);
        };
        list.forEach(add);
        return { add, find: (id, url) => ids.get(id) || pages.get(articleKey(url || '') || undefined) };
    }

    /**
     * Takes articles over (saved or shared in the app, handed over by Safari, or from the library the app kept before).
     * A new one stays on this device. One that is here already, by its id or its page, only gains: further read, and
     * highlights that are not here yet; text and summary too, unless it belongs to the synced library. Answers with the id
     * each one has now.
     */
    async function take({ articles }) {
        const ids = new Array(articles.length);
        const library = lookup(await shared.index());
        const theirs = [], ours = [];
        articles.forEach((a, number) => (library.find(a.entry.id, a.entry.url) ? theirs : ours).push({ a, number }));
        // one pass for each area: a large library is taken over with a handful of writes
        for (const [area, group] of [[shared, theirs], [own, ours]]) {
            if (!group.length) continue;
            const synced = area === shared, highlights = [];
            await area.edit(async (list) => {
                const here = lookup(list), writes = {}, added = [];
                const places = new Map(list.map((e, at) => [e, at]));
                for (const { a, number } of group) {
                    const found = here.find(a.entry.id, a.entry.url);
                    const entry = found ? found : { archived: false, ...a.entry };
                    const id = entry.id;
                    if (found) entry.progress = Math.max(Number(entry.progress) || 0, Number(a.entry.progress) || 0);
                    else { added.push(entry); here.add(entry); }
                    if (!synced) {
                        const old = writes[articleRecKey(id)] || (found ? await area.record(id) : null) || {}, record = { ...old };
                        // `fill`: only what is missing here (the library the app kept before holds its texts simplified)
                        for (const k of ['content', 'summary']) {
                            if (!a.record || !a.record[k] || (a.fill && record[k])) continue;
                            record[k] = a.record[k];
                            if (k === 'summary') record.summaryBase = a.record.summary;
                        }
                        if (found && a.fresher) { if (a.entry.title) entry.title = a.entry.title; if (a.entry.tags && a.entry.tags.length) entry.tags = a.entry.tags; }
                        if (a.entry.contentWordCount) entry.contentWordCount = a.entry.contentWordCount;
                        if (record.summary) entry.summary = record.summary;
                        writes[articleRecKey(id)] = record;
                    }
                    if (found && places.has(found)) list[places.get(found)] = entry;
                    ids[number] = id;
                    for (const h of a.highlights || []) highlights.push(plainHighlight(pageKeyForUrl(entry.url || ''), h));
                }
                list.unshift(...added.reverse());
                return writes;
            });
            if (highlights.length) await bring(area, highlights);
        }
        return ids;
    }

    /**
     * Fields of one article: of the list entry, and of its record (text, summary). Of a synced article only how far it was
     * read goes into the library; a summary written here is kept by the app.
     */
    async function change({ id, entry = {}, record = null }) {
        const synced = (await shared.index()).some((e) => e.id === id);
        const area = synced ? shared : own;
        if (synced && record && record.summary !== undefined) await keepExtra(id, { summary: record.summary });
        if (synced && !('progress' in entry)) return;
        await area.edit(async (list) => {
            const at = list.findIndex((e) => e.id === id);
            if (at < 0) return null;
            const next = { ...list[at], ...(synced ? {} : entry) };
            if ('progress' in entry) next.progress = Math.max(Number(list[at].progress) || 0, Number(entry.progress) || 0);   // reading only moves forward
            const writes = {};
            if (record && !synced) {
                const rec = { ...((await area.record(id)) || {}), ...record };
                if (record.summary !== undefined) { rec.summaryBase = record.summary; next.summary = record.summary; }
                writes[articleRecKey(id)] = rec;
            }
            list[at] = next;
            return writes;
        });
    }

    /** Changes to the highlights of one article's page: add, keep a suggestion, turn one down, remove. */
    async function mark({ url, add = [], keep = [], dismiss = [], remove = [] }) {
        const page = pageKeyForUrl(url || '');
        const inShared = new Set((await shared.highlights.all({ dismissed: true })).map((h) => h.id));
        for (const area of [shared, own]) {
            const theirs = (id) => inShared.has(id) === (area === shared);
            const ops = [
                ...remove.filter(theirs).map((id) => ({ op: 'removeId', id })),
                ...dismiss.filter(theirs).map((id) => ({ op: 'dismiss', page, id })),
                ...keep.filter(theirs).map((id) => ({ op: 'patch', page, id, patch: { type: 'user' } })),
            ];
            if (!ops.length) continue;
            const result = await area.highlights.apply(ops);
            // as in the extension: a removed highlight gets a deletion marker (one turned down is kept, so it is not deleted)
            if (area === shared && result.removed.length) await stampStore.markDeleted('hl', result.removed);
        }
        if (add.length) {
            const onSynced = (await shared.index()).some((e) => pageKeyForUrl(e.url || '') === page);
            const area = onSynced ? shared : own;
            await area.prepare();
            await area.highlights.apply(add.map((h) => ({ op: 'add', hl: plainHighlight(page, h) })));
        }
    }

    const REMOVED = 'app:removed';
    /** Gone from this device, or (`gone` false) back again. Nothing is marked as deleted for the other devices. */
    async function hide({ id, gone }) {
        const index = [...(await shared.index()), ...(await own.index())];
        const page = articleKey((index.find((e) => e.id === id) || {}).url || '');
        // every article of the same page goes with it
        const all = new Set([id, ...(page ? index.filter((e) => articleKey(e.url || '') === page).map((e) => e.id) : [])]);
        const rest = (await read(REMOVED, [])).filter((x) => !all.has(x));
        await storage.set({ [REMOVED]: gone ? [...rest, ...all] : rest });
    }

    /** Moves articles and highlights out of the synced keys into the app's own, without any deletion marker. */
    async function setAside(articles, marked) {
        if (articles.length) {
            const records = await shared.storage.get(articles.map((e) => articleRecKey(e.id)));
            await own.edit(async (list) => {
                const there = new Set(list.map((e) => e.id)), writes = {}, added = [];
                for (const e of articles) {
                    if (!there.has(e.id)) added.push(e);
                    writes[articleRecKey(e.id)] = { ...(records[articleRecKey(e.id)] || {}), ...(there.has(e.id) ? await own.record(e.id) : {}) };
                }
                list.unshift(...added);
                return writes;
            });
            const gone = new Set(articles.map((e) => e.id));
            await shared.edit(async (list) => { const rest = list.filter((e) => !gone.has(e.id)); list.length = 0; list.push(...rest); return null; });
            await storage.remove(articles.map((e) => articleRecKey(e.id)));
        }
        if (marked.length) {
            await bring(own, marked);
            await shared.highlights.apply(marked.map((h) => ({ op: 'removeId', id: h.id })));
        }
        return articles.length + marked.length;
    }

    /** Called on joining: what the synced keys hold of another library, or from before, becomes the app's own. */
    async function enter(place) {
        if ((await read('app:place', '')) === place) return;
        await setAside(await shared.index(), (await shared.highlights.all({ dismissed: true })).filter((h) => h.id));
        await storage.set({ 'app:place': place });
    }

    /** Folds the articles the app keeps that the library has too into the library's, all in one pass. */
    async function fold() {
        const library = lookup(await shared.index());
        const folded = [], progress = new Map(), pages = new Map();
        for (const e of await own.index()) {
            const twin = library.find(e.id, e.url);
            if (!twin) continue;
            const mine = (await own.record(e.id)) || {}, theirs = (await shared.record(twin.id)) || {};
            if (mine.content && !theirs.content) continue;   // the library has no text of it: the copy here stays
            folded.push(e);
            progress.set(twin.id, Math.max(progress.get(twin.id) || 0, Number(e.progress) || 0));
            if (mine.summary && !theirs.summary) await keepExtra(twin.id, { summary: mine.summary });
            pages.set(pageKeyForUrl(e.url || ''), pageKeyForUrl(twin.url || ''));
        }
        if (!folded.length) return 0;
        const marked = (await own.highlights.all({ dismissed: true })).filter((h) => pages.has(h.url));
        if (marked.length) {
            await bring(shared, marked.map((h) => ({ ...h, url: pages.get(h.url) })));
            await own.highlights.apply(marked.map((h) => ({ op: 'removeId', id: h.id })));
        }
        const further = (await shared.index()).some((e) => (progress.get(e.id) || 0) > (Number(e.progress) || 0));
        if (further) await shared.edit(async (list) => {
            list.forEach((e, at) => { if ((progress.get(e.id) || 0) > (Number(e.progress) || 0)) list[at] = { ...e, progress: progress.get(e.id) }; });
            return null;
        });
        const gone = new Set(folded.map((e) => e.id));
        await own.edit(async (list) => { const rest = list.filter((e) => !gone.has(e.id)); list.length = 0; list.push(...rest); return null; });
        await own.storage.remove(folded.map((e) => articleRecKey(e.id)));
        return folded.length;
    }

    /**
     * After everything has been fetched: only what the server knows stays in the synced keys (plus highlights made here on
     * its articles); an article the app keeps that the library has too is folded into the library's; and a highlight made
     * here that the library already has is dropped, so that no other device shows it twice. Answers with how many things
     * were moved, so that the screens know to look again.
     */
    async function settle(placeId) {
        const ledger = await read(syncLedgerKey(placeId), {});
        const known = new Set(Object.keys(ledger.items || {}));
        const index = await shared.index();
        const strangers = index.filter((e) => !known.has('article:' + e.id));
        const pagesKept = new Set(index.filter((e) => known.has('article:' + e.id)).map((e) => pageKeyForUrl(e.url || '')));
        const all = (await shared.highlights.all({ dismissed: true })).filter((h) => h.id);
        let moved = await setAside(strangers, all.filter((h) => !known.has('hl:' + h.id) && !pagesKept.has(h.url)));
        moved += await fold();

        const now = (await shared.highlights.all({ dismissed: true })).filter((h) => h.id);
        const theirs = now.filter((h) => known.has('hl:' + h.id));
        const doubles = [];
        for (const h of now) {
            const same = !known.has('hl:' + h.id) && theirs.find((x) => sameHighlight(x, h));
            if (same) doubles.push({ ...h, id: same.id, double: h.id });
        }
        if (doubles.length) {
            await bring(shared, doubles.map(({ double: _, ...h }) => h));
            await shared.highlights.apply(doubles.map((h) => ({ op: 'removeId', id: h.double })));
        }
        return moved + doubles.length;
    }

    /** Without a library connected, everything is this device's own (also what an earlier version of the app kept in the synced keys). */
    async function tidy() {
        const places = await read(SK.syncPlaces, []);
        if (Array.isArray(places) && places.length) return;
        await setAside(await shared.index(), (await shared.highlights.all({ dismissed: true })).filter((h) => h.id));
        await storage.set({ 'app:place': '' });
    }

    return { marks, take, change, mark, hide, enter, settle, tidy };
}

export const API = {
    createSync, cleanPlace, parsePhoneCode, pageKeyForUrl,
    // for the shared test vectors
    hashValue, mergeRecord, deriveMaster, subKeys, nameOf, encryptJson, decryptJson, openMeta, toHex, toB64, fromB64, canonicalPassphrase, signV4,
};
