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
import { SK } from '../../../plugin/src/modules/storageKeys.js';
import { signV4 } from '../../../plugin/src/modules/syncS3.js';
import { pageKeyForUrl } from '../../../plugin/src/modules/pageKey.js';

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

    return { service, stampStore, highlights: createHighlightStore({ storage }), join, run, state, leave };
}

export const API = {
    createSync, cleanPlace, parsePhoneCode, pageKeyForUrl,
    // for the shared test vectors
    hashValue, mergeRecord, deriveMaster, subKeys, nameOf, encryptJson, decryptJson, openMeta, toHex, toB64, fromB64, canonicalPassphrase, signV4,
};
