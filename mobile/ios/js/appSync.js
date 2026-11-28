// Entry of the sync bundle of the iOS app (app-sync.js, global AISH_APP). The app runs the extension's own sync modules in
// JavaScriptCore: nothing about stamps, merging, encryption or the remote layout is written a second time.
// Built by `node plugin/scripts/build.js --module-bundle` (see mobile/ios/project.yml); js/host.js provides what a browser
// would, on top of the Swift side (App/Sync).
import { createStampStore } from '../../../plugin/src/modules/syncStampStore.js';
import { createSyncService, cleanPlace, cleanConnection } from '../../../plugin/src/modules/syncService.js';
import { makeStore } from '../../../plugin/src/modules/syncStores.js';
import { createPlaceFolderStore } from './placeFolder.js';
import { createHighlightStore } from '../../../plugin/src/modules/highlightStore.js';
import { countWords } from '../../../plugin/src/modules/textUtils.js';
import { withQuestions, buildPrompt, parseAnswer, newTurn, joinContinuation } from '../../../plugin/src/modules/conversation.js';
import { parseSuggestionList } from '../../../plugin/src/modules/suggestions.js';
import { hashValue, preparedOf, questionsOf } from '../../../plugin/src/modules/syncStamps.js';
import { mergeRecord } from '../../../plugin/src/modules/syncMerge.js';
import { deriveMaster, subKeys, nameOf, encryptJson, decryptJson, openMeta, toHex, toB64, fromB64 } from '../../../plugin/src/modules/syncCrypto.js';
import { canonicalPassphrase } from '../../../plugin/src/modules/syncPassphrase.js';
import { parsePhoneCode } from '../../../plugin/src/modules/syncPhoneCode.js';
import { SK, articleRecKey, noteRecKey, syncLedgerKey } from '../../../plugin/src/modules/storageKeys.js';
import { createNotesStore } from '../../../plugin/src/modules/notesStore.js';
import { splitTags } from '../../../plugin/src/modules/noteText.js';
import { signV4 } from '../../../plugin/src/modules/syncS3.js';
import { pageKeyForUrl } from '../../../plugin/src/modules/pageKey.js';
import { articleKey } from '../../../plugin/src/modules/syncIdentity.js';
import { withLock } from '../../../plugin/src/modules/articleLock.js';

// as in the extension's background (modules/syncBackgroundBundle.js)
const dataHooks = { count: countWords, compose: (base, turns) => withQuestions(base, turns, { all: false }) };

/**
 * The sync of one library. `storage` behaves like the extension's local storage (host.js); its change events are stamped
 * here, as the extension's background does. Runs only fetch, unless writing back is switched on: kept with the library
 * (`setWriteBack`), or forced by `writeBack` for tests. `engine`: further options for the runs.
 */
function createSync({ storage, log = () => {}, writeBack = false, engine = {}, folder = null }) {
    const stampStore = createStampStore({ storage });
    storage.onChanged.addListener((changes) => stampStore.onChanged(changes));
    // a place in a folder of Files is read by Swift; servers are reached as in the browser
    const stores = (connection, place, secret) => (connection && connection.service === 'folder'
        ? createPlaceFolderStore(folder, place ? place.root : '') : makeStore(connection, place, secret));
    const serviceWith = (options) => createSyncService({ storage, makeStore: async (...a) => stores(...a), stampStore, dataHooks, log, engine: { ...engine, ...options } });
    const service = serviceWith({ pullOnly: true });
    const writing = serviceWith({});
    const WRITE = 'app:writeBack';
    // What writing back covers has grown (summaries, the articles saved here): a yes given to less does not cover it, so
    // the number says which yes was given.
    const SCOPE = 3;
    // a folder is only read
    const inFolder = async () => (await service.connectionsNow()).some((c) => c.service === 'folder');
    const writes = async () => !(await inFolder()) && (writeBack || (await storage.get({ [WRITE]: false }))[WRITE] === SCOPE);
    const setWriteBack = ({ on }) => storage.set({ [WRITE]: on === true ? SCOPE : false });
    const library = createLibrary({ storage, stampStore, writes });

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
        // switched on for each library anew: a backup of this one comes first
        await setWriteBack({ on: false });
        // what another library brought stays on this device: it must never travel into this one
        await library.enter([connection.service, connection.url, connection.bucket || '', place.root].join('|'));
        return { id: place.id, root: place.root };
    }

    /**
     * Joins the library that lies in the chosen folder of Files, at `root` below it ('.' for the folder itself), with its
     * passphrase. The folder is only read.
     */
    async function joinFolder({ root, name, passphrase }) {
        if (!passphrase) throw new Error('Enter the passphrase of the library.');
        const connection = cleanConnection({ service: 'folder', name });
        if (!(await createPlaceFolderStore(folder, root).get('meta.json'))) throw new Error('There is no Kaivo library in that folder yet.');
        const before = await service.placesNow();
        const place = await service.add({ connection, secret: {}, place: { mode: 'encrypted', direction: 'twoway', root, passphrase, ackBackup: true } });
        for (const old of before) await service.remove(old.id);
        await setWriteBack({ on: false });
        await library.enter(['folder', name, place.root].join('|'));
        return { id: place.id, root: place.root };
    }

    /** `until`: no further round after this moment. */
    async function toTheEnd(runs, id, total, until = Infinity) {
        for (let round = 0; round < 1000; round++) {
            const result = (await runs.syncNow(id))[id];
            if (!result || result.skipped) { total.skipped = true; return false; }
            if (result.error) throw new Error(result.error.message);
            for (const k of ['pulled', 'applied', 'pushed']) total[k] += result[k] || 0;
            total.errors.push(...result.errors);
            if (!result.more) return true;
            if (Date.now() >= until || (until < Infinity && stopped)) return false;
        }
        return false;
    }

    let going = null;
    // the system asks a run in the background to end: it takes up no further step, what is under way is finished
    let stopped = false;
    const stop = () => { stopped = true; };
    /** One run at a time: a second one asked for meanwhile is the same run. */
    function run({ seconds, feeds } = {}) {
        if (!going) {
            stopped = false;
            going = once(seconds, feeds).finally(() => { going = null; });
        }
        return going;
    }

    /**
     * One run of the joined library, to its end: first everything is fetched, then what the app keeps for itself is told
     * apart from the library, and only then, when the app writes back, what changed here goes out. Throws what went wrong.
     */
    async function once(seconds, feeds = []) {
        // a run with little time (in the background) stops at a package's end and goes on the next time
        const timed = seconds !== undefined;
        const until = timed ? Date.now() + seconds * 1000 : Infinity;
        // small packages, so that the time is looked at often
        const within = (options) => serviceWith({ chunk: 10, ...options });
        const fetching = timed ? within({ pullOnly: true, budgetMs: seconds * 1000 }) : service;
        const [place] = await service.placesNow();
        if (!place) throw new Error('No library is connected.');
        const total = { pulled: 0, applied: 0, pushed: 0, moved: 0, errors: [] };
        // nothing goes out after a fetch that did not end well: what is on the server is not fully known then
        const all = await toTheEnd(fetching, place.id, total, until);
        // the feed list lies beside the records; it is written under the same yes as everything else, and only after a
        // fetch that ended well. Where it cannot be read, the rest goes on.
        try { total.feeds = await service.feedList(place.id, { local: feeds, mayWrite: all && !total.errors.length && await writes() }); } catch (e) { log('feed list: ' + e.message); }
        if (!all || total.errors.length) return total;
        total.moved = await library.settle(place.id);
        if (await writes()) {
            // what was saved here joins the library after everything of the library is known, and goes out at once
            total.moved += await library.promote(place.id);
            if (!timed) await toTheEnd(writing, place.id, total);
            else if (Date.now() < until && !stopped) await toTheEnd(within({ budgetMs: until - Date.now() }), place.id, total, until);
        }
        return total;
    }

    /** The joined library and how its last run went, without any login. null when none is joined. */
    async function state() {
        const [place] = await service.placesNow();
        if (!place) return null;
        const connection = (await service.connectionsNow()).find((c) => c.id === place.connectionId) || {};
        const articles = (await storage.get({ [SK.articlesIndex]: [] }))[SK.articlesIndex];
        return { id: place.id, service: connection.service, server: connection.name, root: place.root, articles: articles.length, writesBack: await writes(), last: (await service.statusNow())[place.id] || null };
    }

    /** Forgets the library and its login. What was fetched stays. */
    async function leave() {
        await library.disown();
        for (const place of await service.placesNow()) await service.remove(place.id);
        await setWriteBack({ on: false });
    }

    /** What a code says, to be looked at before joining. No password. */
    function look(code) {
        const given = parsePhoneCode(code);
        if (!given) return null;
        let host = given.url;
        try { host = new URL(given.url).host; } catch (_) { /* shown as written */ }
        return { service: given.kind, server: host, folder: given.kind === 's3' ? `${given.bucket}/${given.root}` : given.root, words: !!given.words, plain: /^http:/i.test(given.url) };
    }

    /** What switching on writing back would add to the library: articles saved here, and summaries written here. */
    async function waiting() {
        const [place] = await service.placesNow();
        return place ? library.waiting() : { articles: 0, summaries: 0 };
    }

    return { service, writing, stampStore, highlights: createHighlightStore({ storage }), join, joinFolder, run, stop, state, leave, look, setWriteBack, waiting, library };
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
        remove: (keys, done) => storage.remove(own(keys), done),
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

/** Articles, highlights and notes in the extension's shapes, written through its modules, in one storage. `mark` leaves
 * the deletion markers of removed notes. */
function createArea(storage, mark = async () => 0) {
    const highlights = createHighlightStore({ storage });
    const notes = createNotesStore({ storage, mark });
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
    /** Every note and comment record. */
    async function noteRecords() {
        const all = await notes.list();
        return [...all.notes, ...Object.values(all.comments)];
    }
    /** Writes note records as they are, without making them new. */
    async function putNotes(records) {
        if (!records.length) return;
        await withLock('aish-notes', async () => {
            const ids = new Set(records.map((r) => r.id));
            const index = (await read(SK.notesIndex, [])).filter((e) => !ids.has(e.id));
            for (const r of records) index.push({ id: r.id, kind: r.kind, created: r.created, updated: r.updated, ...(r.highlightId ? { hl: r.highlightId } : {}) });
            await storage.set({ ...Object.fromEntries(records.map((r) => [noteRecKey(r.id), r])), [SK.notesIndex]: index });
        });
    }
    /** Takes note records out of this storage. No deletion marker: they are only moved. */
    async function dropNotes(ids) {
        if (!ids.length) return;
        await withLock('aish-notes', async () => {
            const gone = new Set(ids);
            await storage.set({ [SK.notesIndex]: (await read(SK.notesIndex, [])).filter((e) => !gone.has(e.id)) });
            await storage.remove(ids.map(noteRecKey));
        });
    }
    return { storage, highlights, notes, noteRecords, putNotes, dropNotes, prepare, index, record, find, edit };
}

/**
 * What the app reads and writes of the library. Two areas: `shared` is the synced library, under the extension's own keys.
 * `own` holds what is only on this device (saved, shared to the app or handed over by Safari here); the sync never sees
 * it. While the app only fetches, of a change made here to a synced article just the reading progress and the highlights
 * are kept in the library. When it writes back (`writes`), summaries and their prepared questions go there too, and what
 * is this device's own moves into the library (`promote`).
 */
function createLibrary({ storage, stampStore, writes = async () => false }) {
    const shared = createArea(storage, (type, ids) => stampStore.markDeleted(type, ids)), own = createArea(aside(storage, 'local:'));
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
        const ops = [], became = new Map();
        for (const hl of list) {
            const same = here.find((x) => sameHighlight(x, hl));
            became.set(hl.id, same ? same.id : hl.id);
            if (!same) { ops.push({ op: 'add', hl }); continue; }
            if (same.dismissed) continue;
            if (hl.dismissed && same.type === 'ghost') ops.push({ op: 'dismiss', page: same.url, id: same.id });
            else if (hl.type === 'user' && same.type === 'ghost') ops.push({ op: 'patch', page: same.url, id: same.id, patch: { type: 'user' } });
        }
        // `add` refuses a second one of the same words even when turned down; `upsert` keeps a turned-down one as it is
        if (ops.length) await area.highlights.apply(ops.map((o) => (o.op === 'add' && o.hl.dismissed ? { op: 'upsert', hl: o.hl } : o)));
        return became;
    }

    /**
     * Notes go with what they belong to, from one storage to another (or the same): comments with their highlight, which
     * may be known by another id there (`became`); free notes with their page (`pages`: old address → new one). Two
     * comments that meet on one highlight are both kept, one below the other.
     */
    async function moveNotes(from, to, { became = new Map(), pages = new Map(), all = false } = {}) {
        const there = new Map((await to.noteRecords()).map((r) => [r.id, r]));
        const put = new Map(), drop = [];
        for (const r of await from.noteRecords()) {
            const comment = r.kind === 'comment';
            const follows = comment ? became.has(r.highlightId) : pages.has(r.url);
            if (!all && !follows) continue;
            const next = { ...r, ...(comment && became.has(r.highlightId) ? { id: 'c_' + became.get(r.highlightId), highlightId: became.get(r.highlightId) } : {}),
                ...(r.url && pages.has(r.url) ? { url: pages.get(r.url) } : {}) };
            if (from === to && next.id === r.id && next.url === r.url) continue;
            const met = put.get(next.id) || there.get(next.id);
            if (met && (from !== to || next.id !== r.id)) {
                const text = met.text === next.text || met.text.includes(next.text) ? met.text : [met.text, next.text].filter(Boolean).join('\n\n');
                const tags = [...new Set([...(met.tags || []), ...(next.tags || [])])];
                if (text !== met.text || tags.length !== (met.tags || []).length) put.set(next.id, { ...met, text, tags, updated: next.updated });
            } else put.set(next.id, next);
            if (from !== to || next.id !== r.id) drop.push(r.id);
        }
        await to.putNotes([...put.values()]);
        await from.dropNotes(drop);
        return drop.length;
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
        // prepared questions of a page that is in the library already: kept here, where the record has none
        for (const { a } of theirs) {
            const found = a.record && library.find(a.entry.id, a.entry.url);
            if (!found) continue;
            const record = (await shared.record(found.id)) || {};
            if ((a.record.suggested || []).length && !(record.suggested || []).length) await keepExtra(found.id, { suggested: a.record.suggested, suggestedAnswers: a.record.suggestedAnswers });
            // a summary written in Safari for an article the library has none for: shown here, and written back from there
            if (a.record.summary && !hasSummary(found, record)) await keepExtra(found.id, { summary: a.record.summary });
        }
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
                        if (a.record && (a.record.suggested || []).length && !(a.fill && record.suggested)) {
                            record.suggested = a.record.suggested;
                            record.suggestedAnswers = a.record.suggestedAnswers || {};
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

    const hasSummary = (entry, record) => !!(entry.summary || record.summary || record.summaryBase);

    /** A summary written here goes into the library as the browser writes one: with the questions shown with it after it. */
    async function writeSummary(id, summary) {
        await shared.edit(async (list) => {
            const at = list.findIndex((e) => e.id === id);
            if (at < 0) return null;
            const record = { ...((await shared.record(id)) || {}), summaryBase: summary };
            record.summary = withQuestions(summary, record.conversation || [], { all: false });
            list[at] = { ...list[at], summary: record.summary, summaryWordCount: countWords(record.summary) };
            return { [articleRecKey(id)]: record };
        });
        await keepExtra(id, { summary: undefined });
    }

    /**
     * Fields of one article: of the list entry, and of its record (text, summary). Of a synced article how far it was read
     * goes into the library, and a summary when the app writes back; else the app keeps the summary for itself.
     */
    async function change({ id, entry = {}, record = null }) {
        const synced = (await shared.index()).some((e) => e.id === id);
        const area = synced ? shared : own;
        if (synced && record && record.summary !== undefined) {
            if (await writes()) await writeSummary(id, record.summary);
            else await keepExtra(id, { summary: record.summary });
        }
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
            // its comment goes with it, as in the extension's "Notes": it would reach the other devices as an orphan
            for (const id of [...result.removed, ...dismiss.filter(theirs)]) await area.notes.setComment(id, { text: '', tags: [] });
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

    /** Moves articles, highlights and notes out of the synced keys into the app's own, without any deletion marker. */
    async function setAside(articles, marked, notes = []) {
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
        let became = new Map();
        if (marked.length) {
            became = await bring(own, marked);
            await shared.highlights.apply(marked.map((h) => ({ op: 'removeId', id: h.id })));
        }
        if (notes.length) {
            await own.putNotes(notes.map((r) => (r.kind === 'comment' && became.has(r.highlightId)
                ? { ...r, id: 'c_' + became.get(r.highlightId), highlightId: became.get(r.highlightId) } : r)));
            await shared.dropNotes(notes.map((r) => r.id));
        }
        return articles.length + marked.length + notes.length;
    }

    // ── what is this device's own joins the library ──
    const FOREIGN = 'app:foreign', PROMOTED = 'app:promoted';
    /** The articles of the library that is being left: they never travel into another one. */
    async function disown() {
        const ids = (await shared.index()).map((e) => e.id);
        if (ids.length) await storage.set({ [FOREIGN]: [...new Set([...(await read(FOREIGN, [])), ...ids])] });
    }

    /** A page of the web: not the stand-in of an article without an address, and none of the samples' made-up ones. */
    function isPage(url) {
        try { const u = new URL(url); return /^https?:$/.test(u.protocol) && !/\.(invalid|example)$/.test(u.hostname); } catch (_) { return false; }
    }

    /** The articles saved here that the library can take: with their text and an address, not deleted here, not its own already. */
    async function ownForTheLibrary() {
        const library = lookup(await shared.index());
        const removed = new Set(await read(REMOVED, [])), foreign = new Set(await read(FOREIGN, []));
        const out = [];
        for (const e of await own.index()) {
            if (removed.has(e.id) || foreign.has(e.id) || e.archived || e.feedStub || !isPage(e.url || '') || library.find(e.id, e.url)) continue;
            const record = (await own.record(e.id)) || {}, pending = (await extra(e.id)).pending;
            if (!record.content || (pending && pending.text)) continue;   // its text is still on the way
            out.push({ entry: e, record });
        }
        return out;
    }

    /** Summaries written here for articles of the library that has none for them. */
    async function summariesForTheLibrary() {
        const list = await shared.index(), out = [];
        const kept = new Set((await storage.getKeys()).filter((k) => k.startsWith('app:article:')));
        for (const e of list) {
            if (!kept.has(extraKey(e.id))) continue;
            const here = await extra(e.id);
            if (here.summary && !hasSummary(e, (await shared.record(e.id)) || {})) out.push({ id: e.id, summary: here.summary });
        }
        return out;
    }

    /** Prepared questions kept here for articles of the library that has none for them. */
    async function questionsForTheLibrary() {
        const list = await shared.index(), out = [];
        const kept = new Set((await storage.getKeys()).filter((k) => k.startsWith('app:article:')));
        for (const e of list) {
            if (!kept.has(extraKey(e.id))) continue;
            const here = preparedOf(await extra(e.id));
            if (here.length && !preparedOf(await shared.record(e.id)).length) out.push({ id: e.id, questions: questionsOf(here) });
        }
        return out;
    }

    /** Prepared questions onto the article's record, from where they reach the other devices. */
    async function writeQuestions(id, questions) {
        await shared.edit(async (list) => (list.some((e) => e.id === id)
            ? { [articleRecKey(id)]: { ...((await shared.record(id)) || {}), ...questions } } : null));
        await keepExtra(id, { suggested: undefined, suggestedAnswers: undefined });
    }

    async function waiting() {
        return { articles: (await ownForTheLibrary()).length, summaries: (await summariesForTheLibrary()).length, questions: (await questionsForTheLibrary()).length };
    }

    /**
     * The reverse of setting aside, for an app that writes back: articles saved here move into the synced keys with their
     * highlights and notes, and summaries and prepared questions kept here are written to articles that have none. The stamps see it all as
     * changes made here, so the run sends it. Call after `settle`. Answers with how many things changed.
     */
    async function promote() {
        const articles = await ownForTheLibrary();
        if (articles.length) {
            // noted first: should the run break off before they are sent, the next one must not take them for strangers
            await storage.set({ [PROMOTED]: [...new Set([...(await read(PROMOTED, [])), ...articles.map((a) => a.entry.id)])] });
            const pages = new Map(), records = {}, entries = [];
            for (const { entry, record } of articles) {
                const next = { description: '', summary: '', ...record };
                records[articleRecKey(entry.id)] = next;
                // the fields the browser's list has (content/core.js)
                entries.push({ ...entry, archived: false, summary: next.summary, summaryWordCount: countWords(next.summary),
                    contentWordCount: entry.contentWordCount || countWords(next.content), lastOpened: entry.lastOpened || entry.timestamp,
                    ...((next.conversation || []).length ? { qaCount: next.conversation.length } : {}) });
                const page = pageKeyForUrl(entry.url);
                pages.set(page, page);
            }
            await shared.edit(async (list) => { list.push(...entries.sort((a, b) => String(a.timestamp || '').localeCompare(String(b.timestamp || '')))); return records; });
            const marked = (await own.highlights.all({ dismissed: true })).filter((h) => pages.has(h.url));
            let became = new Map();
            if (marked.length) {
                became = await bring(shared, marked);
                await own.highlights.apply(marked.map((h) => ({ op: 'removeId', id: h.id })));
            }
            await moveNotes(own, shared, { became, pages });
            const gone = new Set(articles.map((a) => a.entry.id));
            await own.edit(async (list) => { const rest = list.filter((e) => !gone.has(e.id)); list.length = 0; list.push(...rest); return null; });
            await own.storage.remove([...gone].map(articleRecKey));
        }
        const summaries = await summariesForTheLibrary();
        for (const { id, summary } of summaries) await writeSummary(id, summary);
        const questions = await questionsForTheLibrary();
        for (const one of questions) await writeQuestions(one.id, one.questions);
        return articles.length + summaries.length + questions.length;
    }

    /** Called on joining: what the synced keys hold of another library, or from before, becomes the app's own. */
    async function enter(place) {
        const before = await read('app:place', '');
        if (before === place) return;
        if (before) await disown();
        await setAside(await shared.index(), (await shared.highlights.all({ dismissed: true })).filter((h) => h.id), await shared.noteRecords());
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
            const ready = prepared(await extra(e.id), mine);
            if (ready.questions.length && !preparedOf(theirs).length && !preparedOf(await extra(twin.id)).length) {
                await keepExtra(twin.id, { suggested: ready.questions, suggestedAnswers: ready.quick });
            }
            // what was asked here joins what was asked elsewhere
            const known = new Set((theirs.conversation || []).map((t) => t.id));
            const more = (mine.conversation || []).filter((t) => t && !known.has(t.id));
            if (more.length) {
                const all = [...(theirs.conversation || []), ...more].sort((a, b) => String(a.ts || '').localeCompare(String(b.ts || '')));
                await saveQuestions(shared, twin.id, all);
            }
            pages.set(pageKeyForUrl(e.url || ''), pageKeyForUrl(twin.url || ''));
        }
        if (!folded.length) return 0;
        const marked = (await own.highlights.all({ dismissed: true })).filter((h) => pages.has(h.url));
        let became = new Map();
        if (marked.length) {
            became = await bring(shared, marked.map((h) => ({ ...h, url: pages.get(h.url) })));
            await own.highlights.apply(marked.map((h) => ({ op: 'removeId', id: h.id })));
        }
        await moveNotes(own, shared, { became, pages });
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
        // moved into the library here and not sent yet: they are on their way, as long as the app writes back
        const promoted = await read(PROMOTED, []);
        const onTheWay = promoted.filter((id) => !known.has('article:' + id));
        if (onTheWay.length !== promoted.length) await storage.set({ [PROMOTED]: onTheWay });
        if (await writes()) for (const id of onTheWay) known.add('article:' + id);
        const index = await shared.index();
        const strangers = index.filter((e) => !known.has('article:' + e.id));
        const pagesKept = new Set(index.filter((e) => known.has('article:' + e.id)).map((e) => pageKeyForUrl(e.url || '')));
        const all = (await shared.highlights.all({ dismissed: true })).filter((h) => h.id);
        const leaving = all.filter((h) => !known.has('hl:' + h.id) && !pagesKept.has(h.url));
        const pagesLeaving = new Set(strangers.map((e) => pageKeyForUrl(e.url || '')).filter((p) => p && !pagesKept.has(p)));
        const idsLeaving = new Set(leaving.map((h) => h.id));
        const notesLeaving = (await shared.noteRecords()).filter((r) => !known.has('note:' + r.id)
            && (r.kind === 'comment' ? idsLeaving.has(r.highlightId) : pagesLeaving.has(r.url)));
        let moved = await setAside(strangers, leaving, notesLeaving);
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
            await moveNotes(shared, shared, { became: new Map(doubles.map((h) => [h.double, h.id])) });
        }
        return moved + doubles.length;
    }

    /** Without a library connected, everything is this device's own (also what an earlier version of the app kept in the synced keys). */
    async function tidy() {
        const places = await read(SK.syncPlaces, []);
        if (Array.isArray(places) && places.length) return;
        if (await read('app:place', '')) await disown();
        await setAside(await shared.index(), (await shared.highlights.all({ dismissed: true })).filter((h) => h.id), await shared.noteRecords());
        await storage.set({ 'app:place': '' });
    }

    const joined = async () => (await read(SK.syncPlaces, [])).length > 0;
    /** Where a note of this page is kept: with the library, unless the page is only this device's (or no library is joined). */
    async function areaOfPage(url) {
        if (!(await joined())) return own;
        if (!url) return shared;
        const on = async (area) => (await area.index()).some((e) => pageKeyForUrl(e.url || '') === pageKeyForUrl(url));
        return !(await on(shared)) && (await on(own)) ? own : shared;
    }
    const areaOfNote = async (id) => ((await shared.notes.get(id)) ? shared : own);
    async function areaOfHighlight(id) {
        return (await shared.highlights.all({ dismissed: true })).some((h) => h.id === id) ? shared : own;
    }

    /** A free note; `url` links it to a page. Hashtags at its end become its tags. */
    async function note({ text, url = '', title = '' }) {
        const parts = splitTags(text);
        const area = await areaOfPage(url);
        await area.prepare();
        return area.notes.add({ text: parts.text || text, tags: parts.tags, url: url ? pageKeyForUrl(url) : '', title });
    }
    /** New words for a note. */
    async function editNote({ id, text }) {
        const parts = splitTags(text);
        return (await areaOfNote(id)).notes.update(id, { text: parts.text || text, tags: parts.tags });
    }
    async function removeNote({ id }) { return (await areaOfNote(id)).notes.remove(id); }
    /** The comment on a highlight; empty words remove it. It is kept where its highlight is. */
    async function comment({ highlightId, text, url = '' }) {
        const parts = splitTags(text);
        const area = await areaOfHighlight(highlightId);
        return area.notes.setComment(highlightId, { text: parts.text, tags: parts.tags, url: url ? pageKeyForUrl(url) : '' });
    }

    /** Notes, own highlights and the AI's, newest first, as the extension's "Notes" lists them (notesView.js: buildStream). */
    async function stream() {
        const pages = new Map(), out = [], connected = await joined();
        for (const area of [shared, own]) {
            for (const e of await area.index()) {
                const source = { article: e.id, title: e.title || e.url || '' };
                for (const key of [pageKeyForUrl(e.url || ''), articleKey(e.url || '')]) if (key && !pages.has(key)) pages.set(key, source);
            }
        }
        const from = (url) => (url ? pages.get(pageKeyForUrl(url)) || pages.get(articleKey(url)) || {} : {});
        const comments = new Map();
        for (const area of [shared, own]) for (const r of await area.noteRecords()) if (r.kind === 'comment') comments.set(r.highlightId, r);
        for (const area of [shared, own]) {
            const here = connected && area === own;
            for (const r of await area.noteRecords()) {
                if (r.kind !== 'note') continue;
                out.push({ kind: 'note', id: r.id, text: r.text, tags: r.tags || [], when: r.created, url: r.url || '', quote: r.quote || '', here, ...from(r.url) });
            }
            for (const h of await area.highlights.all()) {
                if (!h.id || !h.text) continue;
                const c = comments.get(h.id);
                out.push({ kind: h.type === 'ghost' ? 'ghost' : 'user', id: h.id, text: h.text, tags: (c && c.tags) || [], when: h.timestamp || '', url: h.url || '',
                    comment: c ? c.text : '', here, ...from(h.url) });
            }
        }
        return out.sort((a, b) => String(b.when).localeCompare(String(a.when)));
    }

    // ── questions about an article ──
    const areaOfArticle = async (id) => ((await shared.index()).some((e) => e.id === id) ? shared : own);
    const wordsOf = (html) => String(html || '').replace(/<(script|style)\b[\s\S]*?<\/\1\s*>/gi, ' ').replace(/<img\b[^>]*>/gi, ' ')
        .replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
    async function asked(id) {
        const area = await areaOfArticle(id);
        const entry = (await area.index()).find((e) => e.id === id);
        if (!entry) throw new Error('This article is gone.');
        const record = (await area.record(id)) || {};
        return { area, entry, record, turns: Array.isArray(record.conversation) ? record.conversation : [] };
    }

    /**
     * What to ask a model for one question, in the extension's own words (conversation.js). `chars`: how much of the page goes
     * along; `earlier`: how many of the questions before. A small model takes less of both.
     */
    async function askPrompt({ id, question, turn = '', chars = 20000, earlier = 6 }) {
        const { entry, record, turns: all } = await asked(id);
        // "dig deeper": the model goes on from the short answer on screen
        const prev = turn ? all.find((t) => t.id === turn) : null;
        const turns = prev ? all.filter((t) => t !== prev) : all;
        const text = wordsOf(record.content);
        if (!text) throw new Error('The text of this article is not on this device yet.');
        const summary = (await extra(id)).summary || record.summaryBase || record.summary || '';
        const draft = prev ? prev.a : '';
        return { ...buildPrompt({ title: entry.title, content: text.slice(0, chars), summary, turns: earlier ? turns.slice(-earlier) : [], question, draft }), cut: text.length > chars };
    }

    const sameQuestion = (q) => String(q).trim().toLowerCase();
    /** Prepared questions and their short answers: what was written here first, then what the record holds. */
    function prepared(here, record) {
        const seen = new Set(), questions = [];
        for (const q of [...(here.suggested || []), ...(record.suggested || [])]) {
            if (typeof q === 'string' && q.trim() && !seen.has(sameQuestion(q))) { seen.add(sameQuestion(q)); questions.push(q); }
        }
        return { questions, quick: { ...(record.suggestedAnswers || {}), ...(here.suggestedAnswers || {}) } };
    }

    /**
     * Writes the questions of an article as the extension does (storageManager.saveConversation): the list on the record, and
     * the summary shown with the pinned ones after it. An article without a summary gets no summary field from this: an empty
     * one written here could replace the summary another device has written meanwhile.
     */
    async function saveQuestions(area, id, turns, pool = null) {
        await area.edit(async (list) => {
            const at = list.findIndex((e) => e.id === id);
            if (at < 0) return null;
            const record = (await area.record(id)) || {};
            const base = record.summaryBase !== undefined ? record.summaryBase : record.summary;
            const next = { ...record, conversation: turns };
            if (pool) {
                next.suggested = pool.questions.slice(0, 8);
                next.suggestedAnswers = Object.fromEntries(next.suggested.filter((q) => typeof pool.quick[q] === 'string').map((q) => [q, pool.quick[q]]));
            }
            list[at] = { ...list[at], qaCount: turns.length };
            if (base !== undefined) {
                next.summaryBase = base;
                next.summary = withQuestions(base, turns, { all: false });
                list[at].summary = next.summary;
                list[at].summaryWordCount = countWords(next.summary);
            }
            return { [articleRecKey(id)]: next };
        });
    }

    /** A model's reply to a question becomes the article's next one; its quotes are only kept where the page holds them. */
    async function answer({ id, question, reply, turn: continued = '' }) {
        const { area, record, turns } = await asked(id);
        const parsed = parseAnswer(reply, record.content);
        const prev = continued ? turns.find((t) => t.id === continued) : null;
        const words = prev ? joinContinuation(prev.a, parsed.a) : parsed.a;
        if (!words) throw new Error('The model gave no answer.');
        // a continued answer stays the same question, with its place and what was chosen for it
        const turn = prev ? { ...prev, a: words, sources: parsed.sources } : newTurn(turns, { q: question, a: words, sources: parsed.sources });
        // "shown with the summary" means nothing where there is none
        if (!prev && record.summaryBase === undefined && record.summary === undefined) turn.pinned = false;
        // fresh questions come with the answer: they go in front of the unused ones, as in the browser
        const old = prepared(await extra(id), record);
        const pool = parsed.questions.length ? prepared({ suggested: parsed.questions, suggestedAnswers: parsed.quick }, { suggested: old.questions, suggestedAnswers: old.quick }) : null;
        await saveQuestions(area, id, prev ? turns.map((t) => (t === prev ? turn : t)) : [...turns, turn], pool);
        if (pool) await keepExtra(id, { suggested: undefined, suggestedAnswers: undefined });   // all on the record now
        return turn.id;
    }

    /** A prepared question with its short answer: asked and answered without a model. '' where there is no answer ready. */
    async function quick({ id, question }) {
        const { area, record, turns } = await asked(id);
        const ready = prepared(await extra(id), record).quick[question];
        if (!ready) return '';
        const turn = newTurn(turns, { q: question, a: ready });
        if (record.summaryBase === undefined && record.summary === undefined) turn.pinned = false;
        await saveQuestions(area, id, [...turns, turn]);
        return turn.id;
    }

    /**
     * The questions a model wrote after a summary of this app. On an article of the library they go onto its record when
     * the app writes back; else they are kept here.
     */
    async function setSuggestions({ id, raw }) {
        const { questions, quick: answers } = parseSuggestionList(raw);
        const here = { suggested: questions, suggestedAnswers: answers };
        if (questions.length && await writes() && (await shared.index()).some((e) => e.id === id)) await writeQuestions(id, questionsOf(preparedOf(here)));
        else await keepExtra(id, here);
    }

    /** Saved to the notes (`noted`), shown with the summary (`pinned`). */
    async function setQuestion({ id, turn, noted, pinned }) {
        const { area, turns } = await asked(id);
        await saveQuestions(area, id, turns.map((t) => {
            if (t.id !== turn) return t;
            const next = { ...t };
            if (noted !== undefined) { if (noted) next.noted = true; else delete next.noted; }
            if (pinned !== undefined) next.pinned = !!pinned;
            return next;
        }));
    }

    return { marks, take, change, mark, hide, enter, settle, tidy, note, editNote, removeNote, comment, stream, askPrompt, answer, quick, setSuggestions, setQuestion, disown, waiting, promote };
}

export const API = {
    createSync, cleanPlace, parsePhoneCode, pageKeyForUrl,
    // for the shared test vectors
    hashValue, mergeRecord, deriveMaster, subKeys, nameOf, encryptJson, decryptJson, openMeta, toHex, toB64, fromB64, canonicalPassphrase, signV4,
};
