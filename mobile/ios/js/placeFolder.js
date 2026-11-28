// A place that lies in a folder the user chose in Files (for example in iCloud Drive), read only. The same store interface
// as the extension's (modules/syncStores.js); the reading is done by Swift (App/Sync/PlaceFolder.swift). Nothing is
// written: put and remove refuse, whatever asks.
import { TargetError } from '../../../plugin/src/modules/targets/targetError.js';

const RECORDS = 'r';
const RECORD = /^[0-9a-f]{64}$/;
const segments = (path) => String(path || '').split('/').filter((s) => s && s !== '.');

/** `folder`: { read(path) → Promise<{ bytes, modified } | null>, list(path) → Promise<[{ name, modified, size }]> }. */
export function createPlaceFolderStore(folder, root) {
    const at = (path) => [...segments(root), ...segments(path)].join('/');
    const refuse = async () => { throw new TargetError({ kind: 'permanent', message: 'This folder is only read on this device.' }); };
    const get = async (path) => {
        const file = await folder.read(at(path));
        return file ? { bytes: file.bytes, etag: `${file.modified}-${file.bytes.length}` } : null;
    };
    return {
        async ping() {
            if (!(await get('meta.json'))) throw new TargetError({ kind: 'permanent', message: 'There is no Kaivo library in that folder yet.' });
            return true;
        },
        get,
        put: refuse,
        remove: refuse,
        async list(prefix = '') {
            const files = await folder.list(at(prefix));
            // only what can be a record: iCloud keeps copies ("name 2") and the Finder its own files beside them
            return files.filter((f) => prefix !== RECORDS || RECORD.test(f.name))
                .map((f) => ({ path: [...segments(prefix), f.name].join('/'), etag: `${f.modified}-${f.size}`, size: f.size, modified: f.modified }));
        },
    };
}
