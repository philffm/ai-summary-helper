// What the extension's sync modules expect from a browser, for JavaScriptCore. Only what those modules call is here, and
// only as far as they use it. Everything that computes or talks to the outside is done by Swift (`__host`, App/Sync).
//
// Loaded before app-sync.js. Binary data crosses to Swift as a Uint8Array of its own (offset 0).
(function (g) {
    'use strict';
    const host = g.__host;
    g.self = g;

    const own = (v) => {
        if (v instanceof ArrayBuffer) return new Uint8Array(v.slice(0));
        if (ArrayBuffer.isView(v)) return new Uint8Array(v.buffer.slice(v.byteOffset, v.byteOffset + v.byteLength));
        throw new TypeError('Bytes expected.');
    };
    const buffer = (u8) => u8.buffer;   // Swift hands out arrays that own their buffer

    // ── text ──────────────────────────────────────────────────────────────
    g.TextEncoder = class TextEncoder {
        encode(input = '') {
            const s = String(input), out = new Uint8Array(s.length * 3);
            let n = 0;
            for (let i = 0; i < s.length; i++) {
                let c = s.charCodeAt(i);
                if (c >= 0xd800 && c <= 0xdfff) {
                    const low = s.charCodeAt(i + 1);
                    if (c < 0xdc00 && low >= 0xdc00 && low <= 0xdfff) { c = 0x10000 + ((c - 0xd800) << 10) + (low - 0xdc00); i++; } else c = 0xfffd;
                }
                if (c < 0x80) out[n++] = c;
                else if (c < 0x800) { out[n++] = 0xc0 | (c >> 6); out[n++] = 0x80 | (c & 63); }
                else if (c < 0x10000) { out[n++] = 0xe0 | (c >> 12); out[n++] = 0x80 | ((c >> 6) & 63); out[n++] = 0x80 | (c & 63); }
                else { out[n++] = 0xf0 | (c >> 18); out[n++] = 0x80 | ((c >> 12) & 63); out[n++] = 0x80 | ((c >> 6) & 63); out[n++] = 0x80 | (c & 63); }
            }
            return out.slice(0, n);
        }
    };
    g.TextDecoder = class TextDecoder {
        decode(input) { return input === undefined ? '' : host.utf8(own(input)); }
    };
    g.btoa = (s) => {
        const str = String(s), bytes = new Uint8Array(str.length);
        for (let i = 0; i < str.length; i++) { const c = str.charCodeAt(i); if (c > 255) throw new Error('btoa: not a byte string'); bytes[i] = c; }
        return host.base64(bytes);
    };
    g.atob = (s) => {
        const bytes = host.unbase64(String(s));
        if (!bytes) throw new Error('atob: not base64');
        let out = '';
        for (let i = 0; i < bytes.length; i += 0x8000) out += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
        return out;
    };

    // ── timers ────────────────────────────────────────────────────────────
    let nextTimer = 1;
    const timers = new Map();
    g.setTimeout = (fn, ms, ...args) => {
        const id = nextTimer++;
        timers.set(id, () => fn(...args));
        host.after(id, Math.max(0, Number(ms) || 0));
        return id;
    };
    g.clearTimeout = (id) => { if (timers.delete(id)) host.cancelTimer(id); };
    g.__timer = (id) => { const fn = timers.get(id); timers.delete(id); if (fn) fn(); };
    const say = (level) => (...args) => host.log(level, args.map((a) => (a && a.stack ? `${a}\n${a.stack}` : String(a))).join(' '));
    g.console = { log: say('log'), info: say('log'), warn: say('warn'), error: say('error'), debug: () => {} };

    // ── URL (http and https, as the sync stores and the page keys use it) ──
    const SPECIAL = { 'http:': '80', 'https:': '443', 'ftp:': '21', 'ws:': '80', 'wss:': '443' };
    const HEX = '0123456789ABCDEF';
    const encodeSet = (s, extra) => {
        let out = '';
        for (const byte of new g.TextEncoder().encode(s)) {
            const ch = String.fromCharCode(byte);
            out += byte <= 0x20 || byte >= 0x7f || extra.includes(ch) ? '%' + HEX[byte >> 4] + HEX[byte & 15] : ch;
        }
        return out;
    };
    const formDecode = (s) => {
        const plus = s.replace(/\+/g, ' ');
        try { return decodeURIComponent(plus); } catch (_) {
            return plus.replace(/(%[0-9A-Fa-f]{2})+/g, (run) => host.utf8(Uint8Array.from(run.slice(1).split('%'), (h) => parseInt(h, 16))));
        }
    };
    class SearchParams {
        constructor(query) {
            this.list = String(query || '').replace(/^\?/, '').split('&').filter(Boolean).map((part) => {
                const at = part.indexOf('=');
                return at < 0 ? [formDecode(part), ''] : [formDecode(part.slice(0, at)), formDecode(part.slice(at + 1))];
            });
        }
        get(name) { const hit = this.list.find(([k]) => k === name); return hit ? hit[1] : null; }
        has(name) { return this.list.some(([k]) => k === name); }
        entries() { return this.list.map((pair) => pair.slice())[Symbol.iterator](); }
        [Symbol.iterator]() { return this.entries(); }
    }
    const dots = (segment) => { const s = segment.toLowerCase().replace(/%2e/g, '.'); return s === '.' ? 1 : s === '..' ? 2 : 0; };
    const normalPath = (segments) => {
        const out = [];
        segments.forEach((segment, i) => {
            const kind = dots(segment), last = i === segments.length - 1;
            if (kind === 2) out.pop();
            if (kind) { if (last) out.push(''); } else out.push(encodeSet(segment, '"#<>?`{}^'));
        });
        return '/' + out.join('/');
    };
    g.URL = class URL {
        constructor(input, base) {
            let s = String(input).replace(/^[\u0000- ]+|[\u0000- ]+$/g, '').replace(/[\t\n\r]/g, '');
            const scheme = /^([A-Za-z][A-Za-z0-9+.-]*):/.exec(s);
            const from = base === undefined ? null : base instanceof g.URL ? base : new g.URL(String(base));
            if (!scheme && !from) throw new TypeError(`Invalid URL: ${input}`);
            const protocol = scheme ? scheme[1].toLowerCase() + ':' : from.protocol;
            const special = protocol in SPECIAL;
            if (!special) {
                if (!scheme) throw new TypeError(`Invalid URL: ${input}`);
                // mailto:, about:, file: and the like are only taken apart, never fetched
                const m = /^(\/\/[^/?#]*)?([^?#]*)(\?[^#]*)?(#.*)?$/.exec(s.slice(scheme[0].length));
                this.protocol = protocol; this.username = ''; this.password = ''; this.port = '';
                this.authority = m[1] || ''; this.hostname = this.authority.slice(2);
                this.pathname = m[2]; this.search = m[3] && m[3] !== '?' ? m[3] : ''; this.hash = m[4] && m[4] !== '#' ? m[4] : '';
                this.searchParams = new SearchParams(this.search);
                return;
            }
            let rest = scheme ? s.slice(scheme[0].length) : s;
            const before = /^[^?#]*/.exec(rest)[0];
            rest = before.replace(/\\/g, '/') + rest.slice(before.length);
            let authority = null;
            if (scheme && !(from && from.protocol === protocol && !rest.startsWith('/'))) { authority = /^\/*([^/?#]*)/.exec(rest); rest = rest.slice(authority[0].length); }
            else if (rest.startsWith('//')) { authority = /^\/{2,}([^/?#]*)/.exec(rest); rest = rest.slice(authority[0].length); }
            const [, path, query, hash] = /^([^?#]*)(\?[^#]*)?(#.*)?$/.exec(rest);
            this.protocol = protocol;
            if (authority) {
                const at = authority[1].lastIndexOf('@');
                const user = at < 0 ? '' : authority[1].slice(0, at), colon = user.indexOf(':');
                this.username = encodeSet(colon < 0 ? user : user.slice(0, colon), '"#<>?`{}/:;=@[\\]^|');
                this.password = encodeSet(colon < 0 ? '' : user.slice(colon + 1), '"#<>?`{}/:;=@[\\]^|');
                let name = authority[1].slice(at + 1), port = '';
                const m = /^(\[[^\]]*\]|[^:]*)(?::(.*))?$/.exec(name);
                if (!m) throw new TypeError(`Invalid URL: ${input}`);
                name = m[1]; port = m[2] || '';
                if (port && (!/^\d+$/.test(port) || Number(port) > 65535)) throw new TypeError(`Invalid URL: ${input}`);
                if (!name.startsWith('[')) {
                    try { name = decodeURIComponent(name); } catch (_) { /* refused below */ }
                    if (/[\u0000- #%/:<>?@[\\\]^|]/.test(name)) throw new TypeError(`Invalid URL: ${input}`);
                    name = /^[!-~]*$/.test(name) ? name.toLowerCase() : host.asciiHost(name);
                } else name = name.toLowerCase();
                if (!name) throw new TypeError(`Invalid URL: ${input}`);
                this.hostname = name;
                this.port = port && String(Number(port)) !== SPECIAL[protocol] ? String(Number(port)) : '';
                this.pathname = normalPath(path.replace(/^\//, '').split('/'));
            } else {
                this.username = from.username; this.password = from.password; this.hostname = from.hostname; this.port = from.port;
                if (path.startsWith('/')) this.pathname = normalPath(path.slice(1).split('/'));
                else if (path) this.pathname = normalPath(from.pathname.slice(1).split('/').slice(0, -1).concat(path.split('/')));
                else this.pathname = from.pathname;
            }
            let search = query === undefined ? (!authority && !path && from ? from.search : '') : query;
            if (search === '?') search = '';
            this.search = search ? '?' + encodeSet(search.slice(1), '"#<>\'') : '';
            this.hash = hash && hash !== '#' ? '#' + encodeSet(hash.slice(1), '"<>`') : '';
            this.searchParams = new SearchParams(this.search);
        }
        get host() { return this.port ? `${this.hostname}:${this.port}` : this.hostname; }
        get origin() { return this.protocol in SPECIAL ? `${this.protocol}//${this.host}` : 'null'; }
        get href() {
            if (!(this.protocol in SPECIAL)) return `${this.protocol}${this.authority}${this.pathname}${this.search}${this.hash}`;
            const login = this.username || this.password ? `${this.username}${this.password ? ':' + this.password : ''}@` : '';
            return `${this.protocol}//${login}${this.host}${this.pathname}${this.search}${this.hash}`;
        }
        toString() { return this.href; }
        toJSON() { return this.href; }
    };
    g.URLSearchParams = SearchParams;

    // ── Web Crypto, the calls the sync makes ──────────────────────────────
    const name = (algorithm) => (typeof algorithm === 'string' ? algorithm : algorithm.name);
    const key = (type, raw, extra = {}) => ({ type: 'secret', algorithm: { name: type, ...extra }, raw });
    const done = (value) => (value ? Promise.resolve(buffer(value)) : Promise.reject(new Error('The operation failed.')));
    const subtle = {
        importKey(format, data, algorithm) {
            if (format !== 'raw') return Promise.reject(new Error('Only raw keys.'));
            return Promise.resolve(key(name(algorithm), own(data), typeof algorithm === 'object' ? { hash: algorithm.hash } : {}));
        },
        deriveBits(algorithm, base, bits) {
            if (name(algorithm) !== 'PBKDF2' || algorithm.hash !== 'SHA-256') return Promise.reject(new Error('Only PBKDF2 with SHA-256.'));
            return done(host.pbkdf2(base.raw, own(algorithm.salt), algorithm.iterations, bits / 8));
        },
        deriveKey(algorithm, base, wanted) {
            if (name(algorithm) !== 'HKDF' || algorithm.hash !== 'SHA-256') return Promise.reject(new Error('Only HKDF with SHA-256.'));
            const raw = host.hkdf(base.raw, own(algorithm.salt), own(algorithm.info), (wanted.length || 256) / 8);
            return raw ? Promise.resolve(key(name(wanted), raw)) : Promise.reject(new Error('The key could not be derived.'));
        },
        encrypt(algorithm, k, data) {
            if (name(algorithm) !== 'AES-GCM') return Promise.reject(new Error('Only AES-GCM.'));
            return done(host.aesGcm(true, k.raw, own(algorithm.iv), own(data)));
        },
        decrypt(algorithm, k, data) {
            if (name(algorithm) !== 'AES-GCM') return Promise.reject(new Error('Only AES-GCM.'));
            return done(host.aesGcm(false, k.raw, own(algorithm.iv), own(data)));
        },
        sign(algorithm, k, data) {
            if (name(algorithm) !== 'HMAC') return Promise.reject(new Error('Only HMAC.'));
            return done(host.hmac(k.raw, own(data)));
        },
        digest(algorithm, data) {
            if (name(algorithm) !== 'SHA-256') return Promise.reject(new Error('Only SHA-256.'));
            return done(host.sha256(own(data)));
        },
    };
    g.crypto = {
        subtle,
        getRandomValues(array) {
            const bytes = host.random(array.byteLength);
            new Uint8Array(array.buffer, array.byteOffset, array.byteLength).set(bytes);
            return array;
        },
        randomUUID: () => host.uuid(),
    };

    // ── gzip, in the one way syncCrypto.js uses the streams ───────────────
    const stream = (work) => class {
        constructor(format) {
            if (format !== 'gzip') throw new TypeError('Only gzip.');
            const parts = [];
            let finish;
            const closed = new Promise((resolve) => { finish = resolve; });
            this.writable = { getWriter: () => ({
                write: (chunk) => { parts.push(own(chunk)); return Promise.resolve(); },
                close: () => { finish(); return Promise.resolve(); },
            }) };
            this.readable = { bytes: closed.then(() => {
                const all = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
                let at = 0;
                for (const p of parts) { all.set(p, at); at += p.length; }
                const out = work(all);
                if (!out) throw new Error('The compressed data is damaged.');
                return out;
            }) };
        }
    };
    g.CompressionStream = stream((bytes) => host.gzip(bytes));
    g.DecompressionStream = stream((bytes) => host.gunzip(bytes));
    g.Response = class Response {
        constructor(body) { this.body = body; }
        arrayBuffer() { return this.body.bytes.then(buffer); }
    };

    // ── fetch, as targets/safeFetch.js calls it ───────────────────────────
    g.AbortController = class AbortController {
        constructor() {
            const listeners = [];
            this.signal = { aborted: false, addEventListener: (type, fn) => { if (type === 'abort') listeners.push(fn); } };
            this.abort = () => { if (this.signal.aborted) return; this.signal.aborted = true; listeners.forEach((fn) => fn()); };
        }
    };
    let nextRequest = 1;
    g.fetch = (url, init = {}) => new Promise((resolve, reject) => {
        const id = nextRequest++;
        if (init.signal && init.signal.aborted) { reject(new Error('Aborted.')); return; }
        const headers = {};
        for (const [k, v] of Object.entries(init.headers || {})) headers[k] = String(v);
        const body = init.body === undefined || init.body === null ? null
            : typeof init.body === 'string' ? new g.TextEncoder().encode(init.body) : own(init.body);
        if (init.signal) init.signal.addEventListener('abort', () => host.abort(id));
        // never redirects, cookies or a cache: the Swift side has no other way
        host.fetch(id, String(url), String(init.method || 'GET'), headers, body, (error, status, answered, bytes) => {
            if (error) { reject(new TypeError(error)); return; }
            resolve({
                status, ok: status >= 200 && status < 300, type: 'basic',
                headers: { get: (header) => { const v = answered[String(header).toLowerCase()]; return v === undefined ? null : v; } },
                arrayBuffer: () => Promise.resolve(buffer(bytes)),
            });
        });
    });

    // ── the folder of a library in Files (App/Sync/PlaceFolder.swift) ─────
    g.__placeFolder = () => ({
        read: (path) => new Promise((resolve, reject) => host.folderRead(path, (error, modified, bytes) => {
            if (error) reject(new Error(error));
            else resolve(bytes === null || bytes === undefined ? null : { bytes: own(bytes), modified });
        })),
        list: (path) => new Promise((resolve, reject) => host.folderList(path, (error, entries) => {
            if (error) reject(new Error(error)); else resolve(entries);
        })),
    });

    // ── storage, like the extension's local storage ───────────────────────
    g.__createStorage = () => {
        const listeners = [];
        const read = (keys) => {
            const out = {};
            for (const [k, json] of Object.entries(host.storageGet(keys))) out[k] = JSON.parse(json);
            return out;
        };
        const announce = (changes) => { if (Object.keys(changes).length) listeners.forEach((fn) => Promise.resolve().then(() => fn(changes, 'local'))); };
        return {
            get(query) {
                try {
                    if (query === null || query === undefined) return Promise.resolve(read(host.storageKeys()));
                    if (typeof query === 'string') return Promise.resolve(read([query]));
                    if (Array.isArray(query)) return Promise.resolve(read(query));
                    return Promise.resolve({ ...query, ...read(Object.keys(query)) });
                } catch (e) { return Promise.reject(e); }
            },
            set(items) {
                try {
                    const names = Object.keys(items).filter((k) => items[k] !== undefined);
                    const before = read(names), write = {};
                    for (const k of names) write[k] = JSON.stringify(items[k]);
                    if (!host.storageWrite(write, [])) throw new Error('The library could not be written.');
                    const changes = {};
                    for (const k of names) if (JSON.stringify(before[k]) !== write[k]) changes[k] = { oldValue: before[k], newValue: JSON.parse(write[k]) };
                    announce(changes);
                    return Promise.resolve();
                } catch (e) { return Promise.reject(e); }
            },
            remove(query, done) {
                try {
                    const names = Array.isArray(query) ? query : [query];
                    const before = read(names);
                    if (!host.storageWrite({}, names)) throw new Error('The library could not be written.');
                    const changes = {};
                    for (const k of Object.keys(before)) changes[k] = { oldValue: before[k] };
                    announce(changes);
                    if (done) done();   // some of the extension's modules wait this way
                    return Promise.resolve();
                } catch (e) { return Promise.reject(e); }
            },
            getKeys: () => Promise.resolve(host.storageKeys()),
            onChanged: { addListener: (fn) => listeners.push(fn) },
        };
    };
})(globalThis);
