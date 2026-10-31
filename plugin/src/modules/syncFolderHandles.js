// modules/syncFolderHandles.js
// Keeps the chosen folders (FileSystemDirectoryHandle) between sessions: handles can be stored in IndexedDB but not in chrome.storage.
// One record per place id. Extension pages and the background worker share this database.
const DB = 'aish-sync-folders', STORE = 'handles';
function open(idb) {
    return new Promise((res, rej) => { const r = idb.open(DB, 1); r.onupgradeneeded = () => r.result.createObjectStore(STORE); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
}
const run = async (idb, mode, fn) => { const db = await open(idb); try { return await new Promise((res, rej) => { const tx = db.transaction(STORE, mode), q = fn(tx.objectStore(STORE)); tx.oncomplete = () => res(q && q.result); tx.onerror = () => rej(tx.error); }); } finally { db.close(); } };

export function createHandleVault(idb = globalThis.indexedDB) {
    return {
        save: (id, handle) => run(idb, 'readwrite', (s) => s.put(handle, id)),
        load: (id) => run(idb, 'readonly', (s) => s.get(id)).then((h) => h || null),
        remove: (id) => run(idb, 'readwrite', (s) => s.delete(id)),
        /** In a page, after a click: asks again if the permission lapsed. → true when readwrite is granted. */
        async allow(handle) {
            if (!handle) return false;
            if ((await handle.queryPermission({ mode: 'readwrite' })) === 'granted') return true;
            return (await handle.requestPermission({ mode: 'readwrite' })) === 'granted';
        },
    };
}
