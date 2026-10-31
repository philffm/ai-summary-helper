// modules/syncStores.js — the store for a place, by the service of its server. One place to add S3 and the folder later.
import { createWebdavStore } from './syncWebdav.js';
import { createFolderStore } from './syncFolder.js';
import { createHandleVault } from './syncFolderHandles.js';

/** connection = the server (url, username, ...), place = the folder on it (root), secret = the server's login. */
export async function makeStore(connection, place, secret = {}, opts = {}) {
    if (connection && connection.service === 'folder') return createFolderStore({ handle: await (opts.vault || createHandleVault()).load(connection.id), root: place ? place.root : '' });
    if (connection && connection.service === 'webdav') {
        return createWebdavStore({ url: connection.url, root: place ? place.root : '', username: connection.username, password: secret.password, allowInsecureLan: connection.allowInsecureLan }, opts);
    }
    throw new Error('This kind of place is not available yet.');
}
