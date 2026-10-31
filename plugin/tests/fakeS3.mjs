// An in-memory S3 as a fetch function: path-style addressing, PUT/GET/HEAD/DELETE, ListObjectsV2 (prefix, delimiter, paging),
// If-Match / If-None-Match, and a check that every request carries a well-formed SigV4 header and a body hash that matches.
import { createHash } from 'crypto';
export function createFakeS3({ bucket = 'b', accessKeyId = 'AKIDTEST', pageSize = 3, enforceConditions = true } = {}) {
  const files = new Map(), log = []; let n = 0;
  const reply = (status, body = '', headers = {}) => new Response(status === 204 || status === 304 ? null : body, { status, headers });
  const fetchFn = async (url, init = {}) => {
    const u = new URL(url), method = (init.method || 'GET').toUpperCase();
    const h = Object.fromEntries(Object.entries(init.headers || {}).map(([k, v]) => [k.toLowerCase(), v]));
    const auth = h.authorization || '';
    if (!new RegExp(`^AWS4-HMAC-SHA256 Credential=${accessKeyId}/\\d{8}/[\\w-]+/s3/aws4_request, SignedHeaders=(content-type;)?host;x-amz-content-sha256;x-amz-date, Signature=[0-9a-f]{64}$`).test(auth)) return reply(403, '<Error><Code>AccessDenied</Code></Error>');
    const body = init.body == null ? new Uint8Array(0) : typeof init.body === 'string' ? new TextEncoder().encode(init.body) : new Uint8Array(init.body);
    if (h['x-amz-content-sha256'] !== createHash('sha256').update(body).digest('hex')) return reply(400, '<Error><Code>XAmzContentSHA256Mismatch</Code></Error>');
    const parts = decodeURIComponent(u.pathname).split('/').filter(Boolean);
    if (parts[0] !== bucket) return reply(404, '<Error><Code>NoSuchBucket</Code></Error>');
    const key = parts.slice(1).join('/');
    log.push(`${method} ${key || '(bucket)'}`);
    if (!key) {   // list
      const prefix = u.searchParams.get('prefix') || '', delim = u.searchParams.get('delimiter'), token = Number(u.searchParams.get('continuation-token') || 0);
      const keys = [...files.keys()].filter((k) => k.startsWith(prefix) && (!delim || !k.slice(prefix.length).includes(delim))).sort();
      const page = keys.slice(token, token + pageSize), more = token + pageSize < keys.length;
      const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
      return reply(200, `<?xml version="1.0"?><ListBucketResult><IsTruncated>${more}</IsTruncated>${more ? `<NextContinuationToken>${token + pageSize}</NextContinuationToken>` : ''}${page.map((k) => `<Contents><Key>${esc(k)}</Key><ETag>&quot;${files.get(k).etag}&quot;</ETag><Size>${files.get(k).body.length}</Size></Contents>`).join('')}</ListBucketResult>`, { 'content-type': 'application/xml' });
    }
    const cur = files.get(key);
    if (method === 'PUT') {
      if (enforceConditions) {
        if (h['if-none-match'] === '*' && cur) return reply(412, '<Error><Code>PreconditionFailed</Code></Error>');
        if (h['if-match'] && (!cur || `"${cur.etag}"` !== h['if-match'])) return reply(412, '<Error><Code>PreconditionFailed</Code></Error>');
      }
      const etag = 'e' + (++n); files.set(key, { body, etag });
      return reply(200, '', { etag: `"${etag}"` });
    }
    if (method === 'GET' || method === 'HEAD') { if (!cur) return reply(404, '<Error><Code>NoSuchKey</Code></Error>'); return reply(200, method === 'HEAD' ? '' : cur.body, { etag: `"${cur.etag}"`, 'content-length': String(cur.body.length) }); }
    if (method === 'DELETE') { files.delete(key); return reply(204); }
    return reply(405);
  };
  return { fetchFn, files, log };
}
