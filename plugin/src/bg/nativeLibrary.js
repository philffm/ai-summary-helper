// nativeLibrary.js — Safari on iOS only: what is saved here also appears in the Kaivo app.
//
// A web extension's storage is invisible to the app that carries it. So the background sends every saved article, with its
// summary and highlights, to the app's native handler (mobile/ios/Extension/SafariWebExtensionHandler.swift), which puts it
// into the folder the app and the extension share. One way only: iOS does not let the app talk to the extension.
// It runs only with the `nativeMessaging` permission, which only platforms/ios/manifest.json declares.
// Classic script (background.scripts). What was sent is remembered per device in `native:sent`.
(function () {
    const KEY_INDEX = 'articles:index', KEY_REC = 'articles:rec:', KEY_HL_INDEX = 'hl:index', KEY_HL_PAGE = 'hl:page:', KEY_SENT = 'native:sent';
    const MAX_CONTENT = 200000, MAX_SUMMARY = 40000, MAX_HIGHLIGHTS = 200;
    const MAX_IMAGE = 1500000, MAX_IMAGES = 30;   // base64 characters of one picture, and pictures per article
    // written as an escape: Safari does not read a background script as UTF-8, an emoji typed here would not match
    const LANGUAGE_MARK = '\u{1F310}';
    const APP = 'application.id';   // Safari ignores the name: the message goes to the app that carries the extension

    /** An article's page without query and fragment: what an article and its highlights have in common. */
    const pageOf = (url) => { try { const u = new URL(url); return u.origin + u.pathname; } catch (_) { return String(url || ''); } };
    const hash = (text) => { let h = 5381; for (let i = 0; i < text.length; i++) h = ((h << 5) + h + text.charCodeAt(i)) | 0; return (h >>> 0).toString(36); };
    const str = (v, max) => (typeof v === 'string' ? v.slice(0, max) : '');

    /**
     * Pictures are saved inside the text as base64 and make up most of it. They travel on their own: in the text each one
     * becomes "kaivo-image:<n>", so the text is never cut off because of them. Too large or other kinds are left out.
     */
    function splitImages(html) {
        const images = [];
        const text = String(typeof html === 'string' ? html : '').replace(/data:image\/([a-z0-9.+-]+);base64,([A-Za-z0-9+/=]+)/gi, (whole, kind, data) => {
            if (!/^(jpe?g|png|gif|webp)$/i.test(kind) || data.length > MAX_IMAGE || images.length >= MAX_IMAGES) return '';
            images.push({ name: String(images.length), data });
            return 'kaivo-image:' + (images.length - 1);
        });
        return { text, images };
    }

    /** What the app gets of one article (`images` is sent apart, see above). null when the entry cannot be sent. */
    function toPackage(entry, record, highlights) {
        if (!entry || typeof entry.id !== 'string' || !/^[A-Za-z0-9_-]{1,80}$/.test(entry.id) || !/^https?:/i.test(entry.url || '')) return null;
        const progress = Number(entry.progress);
        const body = splitImages(record && record.content);
        return {
            images: body.images,
            id: entry.id,
            url: str(entry.url, 2048),
            title: str(entry.title, 500) || str(entry.url, 200),
            tags: (Array.isArray(entry.tags) ? entry.tags : []).filter((t) => typeof t === 'string' && !t.startsWith(LANGUAGE_MARK)).slice(0, 12),   // without the language mark
            words: Math.max(0, Math.round(Number(entry.contentWordCount) || 0)),
            savedAt: str(entry.timestamp, 40),
            progress: Number.isFinite(progress) ? Math.min(1, Math.max(0, progress)) : 0,
            summary: str(record && record.summary, MAX_SUMMARY),
            content: str(body.text, MAX_CONTENT),
            highlights: (highlights || []).filter((h) => h && typeof h.text === 'string' && h.text.trim()).slice(0, MAX_HIGHLIGHTS)
                .map((h) => ({ text: h.text.slice(0, 4000), ai: h.type === 'ghost' })),
        };
    }

    /**
     * Sends what changed since the last run. `send(message)` resolves with the handler's answer. The app answers every
     * "hello" with an id of its shared folder; a different id (the app was installed anew) sends everything again.
     */
    function createSender({ storage, send }) {
        const get = (keys) => new Promise((resolve) => storage.get(keys, resolve));
        const set = (values) => new Promise((resolve) => storage.set(values, () => resolve()));
        let running = null, again = false;

        async function once() {
            const hello = await send({ type: 'hello' });
            if (!hello || !hello.ok) return { sent: 0, ok: false };
            const base = await get([KEY_INDEX, KEY_HL_INDEX, KEY_SENT]);
            const index = Array.isArray(base[KEY_INDEX]) ? base[KEY_INDEX] : [];
            const ledger = base[KEY_SENT] && base[KEY_SENT].folder === hello.folder ? { ...base[KEY_SENT].items } : {};
            const byPage = new Map();
            const pages = (Array.isArray(base[KEY_HL_INDEX]) ? base[KEY_HL_INDEX] : []).map((p) => p && p.k).filter(Boolean);
            for (const k of pages) {
                const list = (await get([KEY_HL_PAGE + k]))[KEY_HL_PAGE + k];
                for (const h of Array.isArray(list) ? list : []) {
                    const page = pageOf(h && (h.url || k));
                    if (!byPage.has(page)) byPage.set(page, []);
                    byPage.get(page).push(h);
                }
            }
            let sent = 0, ok = true;
            for (const entry of index) {
                const rec = entry && (await get([KEY_REC + entry.id]))[KEY_REC + entry.id];
                const article = toPackage(entry, rec, byPage.get(pageOf(entry && entry.url)));
                if (!article) continue;
                const sig = hash(JSON.stringify(article));
                if (ledger[article.id] === sig) continue;
                const { images, ...rest } = article;
                let taken = true;
                for (const image of images) {   // before the article, so that the app finds them when it reads it
                    const reply = await send({ type: 'image', id: article.id, name: image.name, data: image.data });
                    if (!reply || !reply.ok) { taken = false; break; }
                }
                const answer = taken && await send({ type: 'article', article: rest });
                if (!answer || !answer.ok) { ok = false; continue; }
                ledger[article.id] = sig;
                sent += 1;
                await set({ [KEY_SENT]: { folder: hello.folder, items: ledger } });   // after each one: the background may be put to sleep
            }
            return { sent, ok };
        }

        return function run() {
            if (running) { again = true; return running; }
            running = (async () => {
                let result;
                do { again = false; result = await once(); } while (again);
                return result;
            })().catch((e) => ({ sent: 0, ok: false, error: String(e && e.message || e) })).finally(() => { running = null; });
            return running;
        };
    }

    self.AISH_NATIVE = { toPackage, createSender };

    const api = typeof browser !== 'undefined' ? browser : (typeof chrome !== 'undefined' ? chrome : null);
    const permissions = api && api.runtime && api.runtime.getManifest ? api.runtime.getManifest().permissions || [] : [];
    if (!permissions.includes('nativeMessaging') || !api.runtime.sendNativeMessage) return;

    const run = createSender({ storage: api.storage.local, send: (message) => Promise.resolve(api.runtime.sendNativeMessage(APP, message)) });
    let timer = null;
    const soon = () => { clearTimeout(timer); timer = setTimeout(() => run().then((r) => { if (!r.ok) console.warn('[Kaivo] the app did not take the library', r.error || ''); }), 800); };
    api.storage.onChanged.addListener((changes, area) => {
        if (area === 'local' && Object.keys(changes).some((k) => k === KEY_INDEX || k === KEY_HL_INDEX || k.startsWith(KEY_REC))) soon();
    });
    soon();   // whatever was saved while this was not running
}());
