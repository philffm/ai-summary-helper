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
import { SK, articleRecKey } from '../../../plugin/src/modules/storageKeys.js';
import { signV4 } from '../../../plugin/src/modules/syncS3.js';
import { pageKeyForUrl } from '../../../plugin/src/modules/pageKey.js';
import { articleKey } from '../../../plugin/src/modules/syncIdentity.js';
import { withLock } from '../../../plugin/src/modules/articleLock.js';

// as in the extension's background (modules/syncBackgroundBundle.js)
const dataHooks = { count: countWords, compose: (base, turns) => withQuestions(base, turns, { all: false }) };

/**
 * The sync of one library. `storage` behaves like the extension's local storage (host.js); its change events are stamped
 * here, as the extension's background does. `engine`: options for the runs, such as pullOnly.
 */
function createSync({ storage, log = () => {}, engine = {} }) {
    const stampStore = createStampStore({ storage });
    storage.onChanged.addListener((changes) => stampStore.onChanged(changes));
    const service = createSyncService({ storage, makeStore, stampStore, dataHooks, log, engine });

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
        return { id: place.id, root: place.root };
    }

    /** One run of the joined library, to its end. Throws what went wrong. */
    async function run() {
        const [place] = await service.placesNow();
        if (!place) throw new Error('No library is connected.');
        const total = { pulled: 0, applied: 0, pushed: 0, errors: [] };
        for (let round = 0; round < 1000; round++) {
            const result = (await service.syncNow(place.id))[place.id];
            if (!result || result.skipped) return { ...total, skipped: true };
            if (result.error) throw new Error(result.error.message);
            for (const k of ['pulled', 'applied', 'pushed']) total[k] += result[k] || 0;
            total.errors = result.errors;
            if (!result.more) return total;
        }
        return total;
    }

    /** The joined library and how its last run went, without any login. null when none is joined. */
    async function state() {
        const [place] = await service.placesNow();
        if (!place) return null;
        const connection = (await service.connectionsNow()).find((c) => c.id === place.connectionId) || {};
        const articles = (await storage.get({ [SK.articlesIndex]: [] }))[SK.articlesIndex];
        return { id: place.id, service: connection.service, server: connection.name, root: place.root, articles: articles.length, last: (await service.statusNow())[place.id] || null };
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

    return { service, stampStore, highlights: createHighlightStore({ storage }), join, run, state, leave, look, library: createLibrary({ storage }) };
}

/**
 * What the app reads and writes of the library, in the extension's shapes and through its modules, so that every change is
 * stamped like one made in the browser. Single fields only: the app never writes an article back as a whole.
 */
function createLibrary({ storage }) {
    const highlights = createHighlightStore({ storage });
    const read = async (key, empty) => (await storage.get({ [key]: empty }))[key];

    /** A store that is new starts as an extension does today: highlights filed by page. */
    async function prepare() {
        const keys = await storage.getKeys();
        if (!keys.some((k) => k === SK.articlesIndex || k === SK.hlSchema)) await storage.set({ [SK.hlSchema]: 2 });
    }

    /** What the index and the records do not tell: every highlight, and the page each article's highlights are filed under. */
    async function marks() {
        const index = await read(SK.articlesIndex, []);
        const pages = {}, same = {};
        for (const e of index) { pages[e.id] = pageKeyForUrl(e.url || ''); same[e.id] = articleKey(e.url || ''); }
        return { pages, same, highlights: await highlights.all({ dismissed: true }) };
    }

    const plainHighlight = (page, h) => ({ id: h.id, url: page, text: h.text, type: h.ai ? 'ghost' : 'user', timestamp: h.timestamp,
        ...(h.prefix || h.suffix ? { quote: { exact: h.text, prefix: h.prefix || '', suffix: h.suffix || '' } } : {}) });
    const words = (text) => String(text || '').replace(/\s+/g, ' ').trim();
    /** The same words of the same page, already here (also turned down); with surroundings given, the same place. */
    const known = (list, page, h) => list.find((x) => x.url === page && x.text === words(h.text)
        && ((!h.prefix && !h.suffix) || (((x.quote && x.quote.prefix) || '') === (h.prefix || '') && ((x.quote && x.quote.suffix) || '') === (h.suffix || ''))));

    /**
     * Takes articles over (saved or shared in the app, handed over by Safari, or from the library the app kept before).
     * One that is here already, by its id or its page, only gains: further read, text and summary that arrived, highlights
     * that are not here yet (one the reader turned down stays turned down). Answers with the id each one has now.
     */
    async function take({ articles }) {
        await prepare();
        const ids = [], wanted = [], here = await highlights.all({ dismissed: true });
        await withLock('aish-articles', async () => {
            const index = (await read(SK.articlesIndex, [])).slice();
            const writes = {};
            for (const a of articles) {
                const page = articleKey(a.entry.url || '');
                const at = index.findIndex((e) => e.id === a.entry.id || (page && articleKey(e.url || '') === page));
                const id = at < 0 ? a.entry.id : index[at].id;
                const old = writes[articleRecKey(id)] || (await read(articleRecKey(id), null)) || {};
                const record = { ...old };
                // `fill`: only what is missing here (the library the app kept before holds its texts simplified)
                for (const k of ['content', 'summary']) {
                    if (!a.record || !a.record[k] || (a.fill && record[k])) continue;
                    record[k] = a.record[k];
                    if (k === 'summary') record.summaryBase = a.record.summary;
                }
                const entry = at < 0 ? { archived: false, ...a.entry } : { ...index[at] };
                if (at >= 0) {
                    entry.progress = Math.max(Number(entry.progress) || 0, Number(a.entry.progress) || 0);
                    if (a.fresher) { if (a.entry.title) entry.title = a.entry.title; if (a.entry.tags && a.entry.tags.length) entry.tags = a.entry.tags; }
                    if (a.entry.contentWordCount) entry.contentWordCount = a.entry.contentWordCount;
                }
                if (record.summary) entry.summary = record.summary;
                if (at < 0) index.unshift(entry); else index[at] = entry;
                writes[articleRecKey(id)] = record;
                ids.push(id);
                const url = pageKeyForUrl(entry.url || '');
                for (const h of a.highlights || []) {
                    const same = known(here, url, h);
                    if (!same) wanted.push({ op: 'add', hl: plainHighlight(url, h) });
                    else if (!h.ai && same.type === 'ghost' && !same.dismissed) wanted.push({ op: 'patch', page: url, id: same.id, patch: { type: 'user' } });
                }
            }
            await storage.set(writes);
            await storage.set({ [SK.articlesIndex]: index });
        });
        if (wanted.length) await highlights.apply(wanted);
        return ids;
    }

    /** Fields of one article: of the list entry, and of its record (text, summary). */
    async function change({ id, entry = {}, record = null }) {
        await withLock('aish-articles', async () => {
            const index = (await read(SK.articlesIndex, [])).slice();
            const at = index.findIndex((e) => e.id === id);
            if (at < 0) return;
            const next = { ...index[at], ...entry };
            if ('progress' in entry) next.progress = Math.max(Number(index[at].progress) || 0, Number(entry.progress) || 0);   // reading only moves forward
            if (record) {
                const rec = { ...((await read(articleRecKey(id), null)) || {}), ...record };
                if (record.summary !== undefined) { rec.summaryBase = record.summary; next.summary = record.summary; }
                await storage.set({ [articleRecKey(id)]: rec });
            }
            index[at] = next;
            await storage.set({ [SK.articlesIndex]: index });
        });
    }

    /** Changes to the highlights of one article's page: add, keep a suggestion, turn one down, remove. */
    async function mark({ url, add = [], keep = [], dismiss = [], remove = [] }) {
        await prepare();
        const page = pageKeyForUrl(url || '');
        await highlights.apply([
            ...remove.map((id) => ({ op: 'removeId', id })),
            ...dismiss.map((id) => ({ op: 'dismiss', page, id })),
            ...keep.map((id) => ({ op: 'patch', page, id, patch: { type: 'user' } })),
            ...add.map((h) => ({ op: 'add', hl: plainHighlight(page, h) })),
        ]);
    }

    const REMOVED = 'app:removed';
    /** The ids of every article of the same page as this one. */
    async function twins(id) {
        const index = await read(SK.articlesIndex, []);
        const page = articleKey((index.find((e) => e.id === id) || {}).url || '');
        return [id, ...(page ? index.filter((e) => articleKey(e.url || '') === page).map((e) => e.id) : [])];
    }
    /** Gone from this device, or (`gone` false) back again. Nothing is marked as deleted for the other devices. */
    async function hide({ id, gone }) {
        const all = new Set(await twins(id)), removed = await read(REMOVED, []);
        const rest = removed.filter((x) => !all.has(x));
        await storage.set({ [REMOVED]: gone ? [...rest, ...all] : rest });
    }

    return { prepare, marks, take, change, mark, hide };
}

export const API = {
    createSync, cleanPlace, parsePhoneCode, pageKeyForUrl,
    // for the shared test vectors
    hashValue, mergeRecord, deriveMaster, subKeys, nameOf, encryptJson, decryptJson, openMeta, toHex, toB64, fromB64, canonicalPassphrase, signV4,
};
