// modules/syncFolderHandles.js
// Keeps the chosen folders (FileSystemDirectoryHandle) between sessions: handles can be stored in IndexedDB but not in chrome.storage.
// One record per place id. Extension pages and the background worker share this database.
const DB = 'aish-sync-folders', STORE = 'handles';
function open(idb) {
    return new Promise((res, rej) => { const r = idb.open(DB, 1); r.onupgradeneeded = () => r.result.createObjectStore(STORE); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
}
const run = async (idb, mode, fn) => { const db = await open(idb); try { return await new Promise((res, rej) => { const tx = db.transaction(STORE, mode), q = fn(tx.objectStore(STORE)); tx.oncomplete = () => res(q && q.result); tx.onerror = () => rej(tx.error); }); } finally { db.close(); } };

/**
 * The permission state of a folder handle ('granted' | 'prompt' | 'denied'), or 'unreachable' when the browser does not
 * answer in time. A handle whose folder was moved, deleted or sits on a drive that is gone can leave queryPermission
 * pending forever; nothing may wait on that (the Settings panel would stay empty, a sync run would never end).
 */
export function queryFolderAccess(handle, ms = 2500) {
    return Promise.race([
        Promise.resolve().then(() => handle.queryPermission({ mode: 'readwrite' })).catch(() => 'denied'),
        new Promise((res) => setTimeout(() => res('unreachable'), ms)),
    ]);
}

export function createHandleVault(idb = globalThis.indexedDB) {
    return {
        save: (id, handle) => run(idb, 'readwrite', (s) => s.put(handle, id)),
        load: (id) => run(idb, 'readonly', (s) => s.get(id)).then((h) => h || null),
        remove: (id) => run(idb, 'readwrite', (s) => s.delete(id)),
        /** In a page, after a click: asks again if the permission lapsed. → true when readwrite is granted. */
        async allow(handle) {
            if (!handle) return false;
            const now = await queryFolderAccess(handle);
            if (now === 'granted') return true;
            if (now === 'unreachable') return false;
            return (await handle.requestPermission({ mode: 'readwrite' })) === 'granted';
        },
    };
}
