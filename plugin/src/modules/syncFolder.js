// modules/syncFolder.js
// The folder store for sync places: a directory on this computer, through the File System Access API (Chrome and Edge on the desktop).
// The same store interface as syncWebdav.js (ping, put, get, remove, list; paths relative to the place's root, no leading slash).
// A folder that Syncthing, Nextcloud, Dropbox, iCloud Drive or a USB drive keeps in step becomes the transport.
//
// The handle comes from the user's choice in showDirectoryPicker() and is kept in IndexedDB (syncFolderHandles.js).
// Etags are `<lastModified>-<size>`: a file has no server to number its versions. Conditions (If-Match, If-None-Match) are a
// compare-then-write, so two devices writing the same file in the same instant can still race; the next run merges what is there.
import { TargetError } from './targets/targetError.js';

const segs = (p) => String(p || '').split('/').filter(Boolean);
const NOT_FOUND = (e) => e && (e.name === 'NotFoundError' || e.code === 8);
const etagOf = (file) => `${file.lastModified}-${file.size}`;
const conflict = (m) => new TargetError({ kind: 'permanent', status: 412, message: m });

/** @param {{ handle: FileSystemDirectoryHandle, root?: string }} cfg */
export function createFolderStore(cfg) {
    const rootSegs = segs(cfg.root);
    let rootHandle = null;

    async function root(create) { if (!rootHandle) { let h = cfg.handle; for (const s of rootSegs) h = await h.getDirectoryHandle(s, { create }); rootHandle = h; } return rootHandle; }
    async function parent(path, create) {
        const parts = segs(path); const name = parts.pop();
        let h = await root(create);
        for (const s of parts) h = await h.getDirectoryHandle(s, { create });
        return { h, name };
    }
    async function statOf(path) {
        try { const { h, name } = await parent(path, false); const f = await (await h.getFileHandle(name)).getFile(); return { file: f, etag: etagOf(f) }; }
        catch (e) { if (NOT_FOUND(e) || (e && e.name === 'TypeMismatchError')) return null; throw e; }
    }

    return {
        async ping() {
            if (!cfg.handle) throw new TargetError({ kind: 'auth', message: 'No folder is chosen for this place.' });
            if (cfg.handle.queryPermission) {
                const p = await cfg.handle.queryPermission({ mode: 'readwrite' });
                if (p !== 'granted') throw new TargetError({ kind: 'auth', message: 'Allow access to the folder again (open this place in Settings and press Allow access).' });
            }
            await root(true);
            return true;
        },
        async put(path, body, { ifMatch, ifNoneMatch } = {}) {
            const cur = await statOf(path);
            if (ifNoneMatch === '*' && cur) throw conflict('The file already exists.');
            if (ifMatch && (!cur || cur.etag !== ifMatch)) throw conflict('The file changed since it was read.');
            const { h, name } = await parent(path, true);
            const w = await (await h.getFileHandle(name, { create: true })).createWritable();
            try { await w.write(typeof body === 'string' ? new TextEncoder().encode(body) : body); } finally { await w.close(); }
            const now = await statOf(path);
            return { etag: now ? now.etag : '' };
        },
        async get(path) {
            const s = await statOf(path);
            return s ? { bytes: new Uint8Array(await s.file.arrayBuffer()), etag: s.etag } : null;
        },
        async remove(path) {
            try { const { h, name } = await parent(path, false); await h.removeEntry(name); return true; }
            catch (e) { if (NOT_FOUND(e)) return false; throw e; }
        },
        async list(prefix = '') {
            let h;
            try { h = await root(false); for (const s of segs(prefix)) h = await h.getDirectoryHandle(s); } catch (e) { if (NOT_FOUND(e)) return []; throw e; }
            const out = [];
            for await (const [name, entry] of h.entries()) {
                if (entry.kind !== 'file') continue;
                const f = await entry.getFile();
                out.push({ path: [...segs(prefix), name].join('/'), etag: etagOf(f), size: f.size });
            }
            return out;
        },
    };
}

/** Is this browser able to use a folder at all? (Not Firefox, Safari or Android.) */
export const folderSupported = () => typeof globalThis.showDirectoryPicker === 'function';
