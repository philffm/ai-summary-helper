// modules/syncPhoneCode.js
// The code a phone scans to join an encrypted place: server, login, folder and, when the browser kept them, the suggested words.
//   aish-library://v1?k=webdav&u=<address>&n=<user>&p=<app password>&r=<folder>[&w=<words>]
//   aish-library://v1?k=s3&u=<endpoint>&n=<access key id>&p=<secret key>&g=<region>&b=<bucket>&r=<folder>[&w=<words>]
// Pure (no chrome.*, no DOM), the same format the Android app reads (LibraryCode.kt, checked against a shared vector).
// The code holds secrets: it is made on request, shown for a short time and never stored.

const enc = (v) => encodeURIComponent(String(v == null ? '' : v));

/** { connection, secret: { password }, place, words? } → the code, or throws a sentence for the screen. */
export function buildPhoneCode({ connection, secret, place, words = '' }) {
    if (!connection || !place || place.mode !== 'encrypted') throw new Error('Only an encrypted place can be shared with a phone.');
    if (connection.service === 'folder') throw new Error('A folder on this computer cannot be reached from a phone. Use a Nextcloud/WebDAV server or an S3 bucket.');
    const password = String((secret && secret.password) || '');
    if (!password) throw new Error('The login of this server is not saved in this browser.');
    const q = connection.service === 's3'
        ? [['k', 's3'], ['u', connection.url], ['n', connection.username], ['p', password], ['g', connection.region || 'us-east-1'], ['b', connection.bucket || ''], ['r', place.root]]
        : [['k', 'webdav'], ['u', connection.url], ['n', connection.username || ''], ['p', password], ['r', place.root]];
    if (words) q.push(['w', words]);
    return 'aish-library://v1?' + q.map(([k, v]) => `${k}=${enc(v)}`).join('&');
}

/** The other direction, for tests and the vector: { kind, url, username, password, root, region?, bucket?, words? } or null. */
export function parsePhoneCode(text) {
    const m = /^aish-library:\/\/v1\?(.+)$/.exec(String(text || '').trim()); if (!m) return null;
    const q = {}; for (const part of m[1].split('&')) { const i = part.indexOf('='); if (i > 0) { try { q[part.slice(0, i)] = decodeURIComponent(part.slice(i + 1)); } catch (_) { return null; } } }
    if (q.k !== 'webdav' && q.k !== 's3') return null;
    return { kind: q.k, url: q.u || '', username: q.n || '', password: q.p || '', root: q.r || 'aish-sync', ...(q.k === 's3' ? { region: q.g || 'us-east-1', bucket: q.b || '' } : {}), ...(q.w ? { words: q.w } : {}) };
}
