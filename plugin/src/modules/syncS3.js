// modules/syncS3.js
// The S3-compatible store for sync places: AWS S3, Cloudflare R2, Backblaze B2, MinIO, Wasabi, Hetzner and the like.
// Same interface as syncWebdav.js (ping, put, get, remove, list; paths relative to the place's root, no leading slash).
// Requests are signed with AWS Signature Version 4 (Web Crypto, no SDK) and go through targets/safeFetch.js, so only the
// endpoint's own origin is reachable, over HTTPS, without redirects.
//
// Addressing is path style (https://endpoint/bucket/key): every provider takes it, and it needs no DNS entry per bucket.
// Conditional writes: If-None-Match / If-Match are sent, and checked with a HEAD first, because not every provider
// enforces them (an older MinIO or Backblaze accepts the header and ignores it). A provider that answers 501 gets the
// write without the header.
import { createSafeFetch } from './targets/safeFetch.js';
import { TargetError } from './targets/targetError.js';

const enc = new TextEncoder();
const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
const sha256Hex = async (data) => hex(await crypto.subtle.digest('SHA-256', typeof data === 'string' ? enc.encode(data) : (data || new Uint8Array(0))));
async function hmac(key, data) {
    const k = await crypto.subtle.importKey('raw', typeof key === 'string' ? enc.encode(key) : key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    return new Uint8Array(await crypto.subtle.sign('HMAC', k, enc.encode(data)));
}
const rfc3986 = (s) => encodeURIComponent(s).replace(/[!'()*]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase());
const segs = (p) => String(p || '').split('/').filter(Boolean);
const unxml = (s) => String(s).replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n))).replace(/&amp;/g, '&');

/**
 * AWS Signature Version 4. `headers` are exactly the ones to sign (lower-case names, must include host and x-amz-date).
 * → { authorization, signature, canonicalRequest, stringToSign }
 */
export async function signV4({ method, url, headers, payloadHash, accessKeyId, secretAccessKey, region, service = 's3', amzDate }) {
    const u = new URL(url);
    const names = Object.keys(headers).map((h) => h.toLowerCase()).sort();
    const canonHeaders = names.map((n) => `${n}:${String(headers[n]).trim().replace(/\s+/g, ' ')}\n`).join('');
    const signedHeaders = names.join(';');
    const query = [...u.searchParams.entries()].map(([k, v]) => [rfc3986(k), rfc3986(v)]).sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] < b[1] ? -1 : 1)).map(([k, v]) => `${k}=${v}`).join('&');
    const canonicalUri = u.pathname.split('/').map((s) => rfc3986(decodeURIComponent(s))).join('/') || '/';
    const canonicalRequest = [method, canonicalUri, query, canonHeaders, signedHeaders, payloadHash].join('\n');
    const day = amzDate.slice(0, 8), scope = `${day}/${region}/${service}/aws4_request`;
    const stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope, await sha256Hex(canonicalRequest)].join('\n');
    const kDate = await hmac('AWS4' + secretAccessKey, day), kRegion = await hmac(kDate, region), kService = await hmac(kRegion, service), kSigning = await hmac(kService, 'aws4_request');
    const signature = hex(await hmac(kSigning, stringToSign));
    return { authorization: `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`, signature, canonicalRequest, stringToSign };
}

const stripEtag = (v) => String(v || '').replace(/&quot;/g, '"').replace(/^W\//, '').replace(/^"|"$/g, '');
const status = (e) => (e instanceof TargetError ? e.status : 0);

/** @param {{ endpoint: string, region?: string, bucket: string, accessKeyId: string, secretAccessKey: string, root?: string }} cfg */
export function createS3Store(cfg, { fetchFn, timeoutMs, log, now = () => new Date() } = {}) {
    const endpoint = String(cfg.endpoint || '').replace(/\/+$/, '');
    const region = cfg.region || 'us-east-1';
    const rootSegs = segs(cfg.root);
    const safe = createSafeFetch({ baseUrl: endpoint + '/' }, { fetchFn, timeoutMs, log, maxBytes: 20 * 1024 * 1024 });
    const keyOf = (path) => [...rootSegs, ...segs(path)].join('/');
    const urlOf = (key, query = '') => `${endpoint}/${rfc3986(cfg.bucket)}${key ? '/' + key.split('/').map(rfc3986).join('/') : ''}${query ? '?' + query : ''}`;

    async function call(method, url, { body, headers = {} } = {}) {
        const amzDate = now().toISOString().replace(/[:-]|\.\d{3}/g, '');
        const payload = body == null ? '' : body;
        const payloadHash = await sha256Hex(payload);
        const signed = { host: new URL(url).host, 'x-amz-content-sha256': payloadHash, 'x-amz-date': amzDate };
        if (headers['content-type']) signed['content-type'] = headers['content-type'];   // a content-type that is sent must be signed
        const { authorization } = await signV4({ method, url, headers: signed, payloadHash, accessKeyId: cfg.accessKeyId, secretAccessKey: cfg.secretAccessKey, region, amzDate });
        const sendHeaders = { ...headers, 'x-amz-content-sha256': payloadHash, 'x-amz-date': amzDate, authorization };
        return safe(url, { method, headers: sendHeaders, ...(body == null ? {} : { body }) });
    }
    const etagOf = (res) => stripEtag(res.headers && res.headers.get && res.headers.get('etag'));
    async function head(key) {
        try { return { etag: etagOf(await call('HEAD', urlOf(key))) }; } catch (e) { if (status(e) === 404) return null; throw e; }
    }
    const conflict = (m) => new TargetError({ kind: 'permanent', status: 412, message: m });

    return {
        async ping() {
            try { await call('GET', urlOf('', `list-type=2&max-keys=1&prefix=${rfc3986(keyOf('') ? keyOf('') + '/' : '')}`)); }
            catch (e) {
                if (status(e) === 404) throw new TargetError({ kind: 'permanent', status: 404, message: 'The bucket was not found. Check the bucket name, the region and the endpoint address.' });
                if (status(e) === 403) throw new TargetError({ kind: 'auth', status: 403, message: 'The access key was not accepted, or it may not use this bucket.' });
                throw e;
            }
            return true;
        },
        async put(path, body, { contentType = 'application/octet-stream', ifMatch, ifNoneMatch } = {}) {
            const key = keyOf(path);
            if (ifMatch || ifNoneMatch) {   // a HEAD first: not every provider enforces the headers
                const cur = await head(key);
                if (ifNoneMatch === '*' && cur) throw conflict('The file already exists.');
                if (ifMatch && (!cur || cur.etag !== ifMatch)) throw conflict('The file changed since it was read.');
            }
            const headers = { 'content-type': contentType };
            if (ifMatch) headers['if-match'] = `"${ifMatch}"`;
            if (ifNoneMatch) headers['if-none-match'] = ifNoneMatch;
            let res;
            try { res = await call('PUT', urlOf(key), { body: typeof body === 'string' ? enc.encode(body) : body, headers }); }
            catch (e) {
                if (status(e) === 412) throw conflict('The file changed since it was read.');
                if (status(e) !== 501 || !(ifMatch || ifNoneMatch)) throw e;
                delete headers['if-match']; delete headers['if-none-match'];   // this provider does not do conditional writes: the HEAD above had to do
                res = await call('PUT', urlOf(key), { body: typeof body === 'string' ? enc.encode(body) : body, headers });
            }
            return { etag: etagOf(res) };
        },
        async get(path) {
            try { const res = await call('GET', urlOf(keyOf(path))); return { bytes: res.bytes, etag: etagOf(res) }; }
            catch (e) { if (status(e) === 404) return null; throw e; }
        },
        async remove(path) {
            const key = keyOf(path);
            if (!(await head(key))) return false;   // S3 answers 204 for a key that is not there: ask first, so the answer is honest
            await call('DELETE', urlOf(key));
            return true;
        },
        async list(prefix = '') {
            const base = keyOf(prefix), dir = base ? base + '/' : '';
            const out = []; let token = '';
            do {
                const q = `delimiter=%2F&list-type=2${token ? '&continuation-token=' + rfc3986(token) : ''}${dir ? '&prefix=' + rfc3986(dir) : ''}`;
                const xml = (await call('GET', urlOf('', q))).text();
                for (const block of xml.match(/<Contents>[\s\S]*?<\/Contents>/g) || []) {
                    const k = unxml((/<Key>([\s\S]*?)<\/Key>/.exec(block) || [])[1] || '');
                    if (!k.startsWith(dir) || k === dir || k.slice(dir.length).includes('/')) continue;
                    out.push({ path: [...segs(prefix), k.slice(dir.length)].join('/'), etag: stripEtag(unxml((/<ETag>([\s\S]*?)<\/ETag>/.exec(block) || [])[1] || '')), size: Number((/<Size>(\d+)<\/Size>/.exec(block) || [])[1]) || 0 });
                }
                token = /<IsTruncated>true<\/IsTruncated>/.test(xml) ? unxml((/<NextContinuationToken>([\s\S]*?)<\/NextContinuationToken>/.exec(xml) || [])[1] || '') : '';
            } while (token);
            return out;
        },
    };
}
