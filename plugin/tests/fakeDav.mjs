// An in-memory WebDAV server as a fetch function, for the sync tests: folders (MKCOL), PUT with If-Match / If-None-Match,
// GET, DELETE, PROPFIND depth 0 and 1, optional basic auth.
export function createFakeDav({ user = 'phil', pass = 'secret', prefix = '/dav/' } = {}) {
    const files = new Map();          // path (after prefix) → { body: Uint8Array, etag }
    const dirs = new Set(['']);       // folder paths without trailing slash
    let n = 0;
    const log = [];
    const reply = (status, body = '', headers = {}) => new Response(status === 204 ? null : body, { status, headers });
    const fetchFn = async (url, init = {}) => {
        const u = new URL(url); const method = (init.method || 'GET').toUpperCase();
        const h = Object.fromEntries(Object.entries(init.headers || {}).map(([k, v]) => [k.toLowerCase(), v]));
        log.push(method + ' ' + decodeURIComponent(u.pathname));
        if (user && h.authorization !== 'Basic ' + Buffer.from(`${user}:${pass}`).toString('base64')) return reply(401);
        if (!u.pathname.startsWith(prefix)) return reply(404);
        const path = decodeURIComponent(u.pathname.slice(prefix.length)).replace(/\/$/, '');
        const parent = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '';
        if (method === 'MKCOL') { if (dirs.has(path)) return reply(405); if (!dirs.has(parent)) return reply(409); dirs.add(path); return reply(201); }
        if (method === 'PUT') {
            if (!dirs.has(parent)) return reply(409);
            const cur = files.get(path);
            if (h['if-none-match'] === '*' && cur) return reply(412);
            if (h['if-match'] && (!cur || `"${cur.etag}"` !== h['if-match'])) return reply(412);
            const body = typeof init.body === 'string' ? new TextEncoder().encode(init.body) : new Uint8Array(init.body);
            const etag = 'e' + (++n); files.set(path, { body, etag });
            return reply(cur ? 204 : 201, '', { etag: `"${etag}"` });
        }
        if (method === 'GET') { const f = files.get(path); return f ? reply(200, f.body, { etag: `"${f.etag}"`, 'content-length': String(f.body.length) }) : reply(404); }
        if (method === 'DELETE') { if (!files.delete(path)) return reply(404); return reply(204); }
        if (method === 'PROPFIND') {
            if (!dirs.has(path) && !files.has(path)) return reply(404);
            const rows = [`<d:response><d:href>${prefix}${encodeURI(path)}${dirs.has(path) && path ? '/' : ''}</d:href><d:propstat><d:prop><d:resourcetype>${dirs.has(path) ? '<d:collection/>' : ''}</d:resourcetype></d:prop></d:propstat></d:response>`];
            if (h.depth === '1' && dirs.has(path)) {
                const inDir = (p) => (path ? p.startsWith(path + '/') : true) && !p.slice(path ? path.length + 1 : 0).includes('/') && p !== path && p !== '';
                for (const d of dirs) if (inDir(d)) rows.push(`<d:response><d:href>${prefix}${encodeURI(d)}/</d:href><d:propstat><d:prop><d:resourcetype><d:collection/></d:resourcetype></d:prop></d:propstat></d:response>`);
                for (const [p, f] of files) if (inDir(p)) rows.push(`<d:response><d:href>${prefix}${encodeURI(p)}</d:href><d:propstat><d:prop><d:getetag>"${f.etag}"</d:getetag><d:getcontentlength>${f.body.length}</d:getcontentlength><d:resourcetype/></d:prop></d:propstat></d:response>`);
            }
            return reply(207, `<?xml version="1.0"?><d:multistatus xmlns:d="DAV:">${rows.join('')}</d:multistatus>`, { 'content-type': 'application/xml' });
        }
        return reply(405);
    };
    return { fetchFn, files, dirs, log, text: (p) => (files.get(p) ? new TextDecoder().decode(files.get(p).body) : null) };
}
