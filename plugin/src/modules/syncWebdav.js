// modules/syncWebdav.js
// The WebDAV store for sync places (Nextcloud, ownCloud, Synology and most NAS boxes). Pure of chrome.*; all network access
// goes through targets/safeFetch.js (own origin only, HTTPS, no redirects, no cookies, bounded time and size).
//
// Store interface (the same for S3 and the folder later):
//   ping()                            → true; throws a TargetError for a wrong address or login
//   put(path, body, { contentType, ifMatch, ifNoneMatch }) → { etag }     creates folders as needed; a failed condition throws status 412
//   get(path)                         → { bytes, etag } or null when it does not exist
//   remove(path)                      → true, or false when it was already gone
//   list(prefix)                      → [{ path, etag, size }] of the files directly in that folder (no recursion)
// Paths are relative to the place's root folder and never start with a slash.
import { createSafeFetch } from './targets/safeFetch.js';
import { TargetError } from './targets/targetError.js';

const enc = new TextEncoder();
const b64 = (s) => { const bytes = enc.encode(s); let bin = ''; for (const b of bytes) bin += String.fromCharCode(b); return btoa(bin); };
const segs = (p) => String(p || '').split('/').filter(Boolean);
const encPath = (p) => segs(p).map(encodeURIComponent).join('/');

/** The `<d:response>` entries of a PROPFIND answer, without an XML parser (the worker has no DOMParser). */
export function parseMultistatus(xml) {
    const out = [];
    const text = String(xml || '');
    const rx = /<(?:[\w-]+:)?response[\s>][\s\S]*?<\/(?:[\w-]+:)?response>/gi;
    for (const block of text.match(rx) || []) {
        const pick = (tag) => { const m = new RegExp(`<(?:[\\w-]+:)?${tag}[^>]*>([\\s\\S]*?)</(?:[\\w-]+:)?${tag}>`, 'i').exec(block); return m ? m[1].trim() : ''; };
        let href = pick('href');
        try { href = decodeURIComponent(href); } catch (_) { /* keep as sent */ }
        const etag = pick('getetag').replace(/&quot;/g, '"').replace(/^W\//, '').replace(/^"|"$/g, '');
        out.push({ href, etag, size: Number(pick('getcontentlength')) || 0, isDir: /<(?:[\w-]+:)?collection\b/i.test(block) });
    }
    return out;
}

/**
 * @param {{ url: string, root?: string, username?: string, password?: string, allowInsecureLan?: boolean }} cfg
 *   url = the WebDAV address of the account's files (Nextcloud: https://host/remote.php/dav/files/<user>/), root = folder inside it
 */
export function createWebdavStore(cfg, { fetchFn, timeoutMs, log } = {}) {
    const base = String(cfg.url || '').replace(/\/+$/, '') + '/';
    const rootSegs = segs(cfg.root || 'aish-sync');
    const safe = createSafeFetch({ baseUrl: base, allowInsecureLan: !!cfg.allowInsecureLan }, { fetchFn, timeoutMs, log, maxBytes: 20 * 1024 * 1024 });
    const auth = cfg.username || cfg.password ? { authorization: 'Basic ' + b64(`${cfg.username || ''}:${cfg.password || ''}`) } : {};
    const made = new Set();
    const urlOf = (path) => base + [...rootSegs.map(encodeURIComponent), ...(path ? [encPath(path)] : [])].join('/');
    const status = (e) => (e instanceof TargetError ? e.status : 0);

    async function mkcol(url) {
        try { await safe(url, { method: 'MKCOL', headers: auth }); } catch (e) {
            if (status(e) === 405) return;   // it already exists
            if (status(e) === 409) throw new TargetError({ kind: 'permanent', status: 409, message: `The server could not create the folder because the folder above it does not exist (${new URL(url).pathname}). Check the address: it must be an existing folder, for Nextcloud https://host/remote.php/dav/files/<your user>/` });
            throw e;
        }
    }
    async function ensureDir(dirSegs) {
        const all = [...rootSegs, ...dirSegs];
        for (let k = 1; k <= all.length; k++) {   // every level, parents first
            const parts = all.slice(0, k);
            const key = parts.join('/');
            if (made.has(key)) continue;
            await mkcol(base + parts.map(encodeURIComponent).join('/'));
            made.add(key);
        }
    }

    return {
        async ping() {
            // the address itself first, so a wrong address or login is reported as that and not as a failed MKCOL later
            try { await safe(base, { method: 'PROPFIND', headers: { ...auth, depth: '0' } }); }
            catch (e) {
                if (status(e) === 404) throw new TargetError({ kind: 'permanent', status: 404, message: `Nothing was found at ${new URL(base).pathname}. Check the address (Nextcloud: https://host/remote.php/dav/files/<your user>/).` });
                throw e;
            }
            try { await safe(urlOf(''), { method: 'PROPFIND', headers: { ...auth, depth: '0' } }); }
            catch (e) { if (status(e) !== 404) throw e; await ensureDir([]); }
            return true;
        },
        async put(path, body, { contentType = 'application/octet-stream', ifMatch, ifNoneMatch } = {}) {
            const parts = segs(path);
            await ensureDir(parts.slice(0, -1));
            const headers = { ...auth, 'content-type': contentType };
            if (ifMatch) headers['if-match'] = `"${ifMatch}"`;
            if (ifNoneMatch) headers['if-none-match'] = ifNoneMatch;
            const res = await safe(urlOf(path), { method: 'PUT', headers, body });
            return { etag: (res.headers && res.headers.get && res.headers.get('etag') || '').replace(/^W\//, '').replace(/^"|"$/g, '') };
        },
        async get(path) {
            try {
                const res = await safe(urlOf(path), { method: 'GET', headers: auth });
                return { bytes: res.bytes, etag: (res.headers && res.headers.get && res.headers.get('etag') || '').replace(/^W\//, '').replace(/^"|"$/g, '') };
            } catch (e) { if (status(e) === 404) return null; throw e; }
        },
        async remove(path) {
            try { await safe(urlOf(path), { method: 'DELETE', headers: auth }); return true; }
            catch (e) { if (status(e) === 404) return false; throw e; }
        },
        async list(prefix = '') {
            let res;
            try { res = await safe(urlOf(prefix), { method: 'PROPFIND', headers: { ...auth, depth: '1', 'content-type': 'application/xml' }, body: '<?xml version="1.0"?><d:propfind xmlns:d="DAV:"><d:prop><d:getetag/><d:getcontentlength/><d:resourcetype/></d:prop></d:propfind>' }); }
            catch (e) { if (status(e) === 404) return []; throw e; }
            const dir = '/' + [...rootSegs, ...segs(prefix)].join('/') + '/';
            const files = [];
            for (const r of parseMultistatus(res.text())) {
                if (r.isDir) continue;
                let p = r.href.replace(/^https?:\/\/[^/]+/, '');
                const at = p.indexOf(dir);
                if (at < 0) continue;
                p = p.slice(at + dir.length);
                if (!p || p.includes('/')) continue;
                files.push({ path: [...segs(prefix), p].join('/'), etag: r.etag, size: r.size });
            }
            return files;
        }
    };
}
