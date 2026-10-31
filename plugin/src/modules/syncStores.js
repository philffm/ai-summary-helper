// modules/syncStores.js — the store for a place, by its service. One place to add S3 and the folder later.
import { createWebdavStore } from './syncWebdav.js';

export function makeStore(place, secret = {}, opts = {}) {
    if (place && place.service === 'webdav') {
        return createWebdavStore({ url: place.url, root: place.root, username: place.username, password: secret.password, allowInsecureLan: place.allowInsecureLan }, opts);
    }
    throw new Error('This kind of place is not available yet.');
}
