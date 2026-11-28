// nativeLibrary.js — Safari on iOS only: what is saved here also appears in the Kaivo app.
//
// A web extension's storage is invisible to the app that carries it. So the background sends every saved article, with its
// summary and highlights, to the app's native handler (mobile/ios/Extension/SafariWebExtensionHandler.swift), which puts it
// into the folder the app and the extension share. One way only: iOS does not let the app talk to the extension.
// It also tells the app which model connection is active here (toModel), so that the app can summarize with it.
// It runs only with the `nativeMessaging` permission, which only platforms/ios/manifest.json declares.
// Classic script (background.scripts). What was sent is remembered per device in `native:sent`.
/* global aiTokenExpired */
(function () {
    const KEY_INDEX = 'articles:index', KEY_REC = 'articles:rec:', KEY_HL_INDEX = 'hl:index', KEY_HL_PAGE = 'hl:page:', KEY_SENT = 'native:sent', KEY_FEEDS = 'feeds:subs';
    const MAX_FEEDS = 500, RESUME_ALARM = 'kaivo-handoff';
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
        const answers = (record && record.suggestedAnswers) || {};
        const questions = (record && Array.isArray(record.suggested) ? record.suggested : []).filter((q) => typeof q === 'string' && q.trim()).slice(0, 8)
            .map((q) => ({ q: q.slice(0, 200), a: str(answers[q], 500) }));
        return {
            // the questions prepared with the summary, with their short answers
            ...(questions.length ? { questions } : {}),
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

    /** What the app gets of the subscriptions: address, name, and the categories of every web feed (the reader's tags and the AI's topics). */
    function toFeeds(subs) {
        return (Array.isArray(subs) ? subs : []).filter((f) => f && /^https?:/i.test(f.url || '')).slice(0, MAX_FEEDS)
            .map((f) => {
                const all = [...(Array.isArray(f.tags) ? f.tags : []), ...(Array.isArray(f.topics) ? f.topics : [])].filter((t) => typeof t === 'string' && t.trim());
                const tags = all.filter((t, i) => all.findIndex((x) => x.trim().toLowerCase() === t.trim().toLowerCase()) === i).slice(0, 12);
                return { url: str(f.url, 2048), title: str(f.customTitle || f.title, 500), tags };
            });
    }

    /**
     * The model connection that is active in this extension, and nothing else of the settings: only the one key or token
     * that is in use leaves the storage, for the app on this device. The same choices as aiComplete (bg/aiComplete.js).
     * null when no model is usable.
     */
    function toModel(sync, local, services, expired) {
        const s = sync || {}, all = local || {};
        const installId = str(all['account:installId'], 200);
        if ((s.connectionMode || 'cloud') === 'cloud') {
            const token = all['account:token'];
            const key = (token && !(expired && expired(token)) && token) || all['account:licenseKey'] || '';
            return {
                mode: 'cloud', service: 'cloud', name: 'byPhil Cloud', format: 'openai',
                url: 'https://api.byphil.eu/v1/projects/ai_summary_helper/chat',
                model: str(s.preferredCloudModel, 200) || 'google/gemini-3.8-flash',
                key: str(key, 8000), installId, region: s.cloudRegionPref === 'prefer-eu' ? 'prefer-eu' : '',
            };
        }
        const service = str(s.activeService, 40) || 'openai';
        const cfg = (all['config:services'] || {})[service] || {};
        const meta = (services || []).find((x) => String(x.id || '').toLowerCase() === service.toLowerCase()) || {};
        const idOf = (m) => (!m ? '' : typeof m === 'string' ? m : (m.id || ''));
        const model = str(cfg.modelIdentifier || idOf(cfg.activeModelId) || idOf(Array.isArray(cfg.customModel) ? cfg.customModel[0] : cfg.customModel) || cfg.model || meta.defaultModel, 200);
        const key = str(cfg.apiKey, 8000);
        const gemini = service === 'gemini';
        const url = gemini
            ? 'https://generativelanguage.googleapis.com/v1beta/models/' + encodeURIComponent(model) + ':generateContent'
            : str(cfg.endpointUrl || cfg.endpoint || meta.endpointUrl, 2048);
        if (!model || !/^https?:/i.test(url) || (!key && !meta.apiKeyOptional)) return null;
        return { mode: 'own', service, name: str(meta.name, 80) || service, format: gemini ? 'gemini' : 'openai', url, model, key, installId: '', region: '' };
    }

    /**
     * Sends what changed since the last run. `send(message)` resolves with the handler's answer. The app answers every
     * "hello" with an id of its shared folder; a different id (the app was installed anew) sends everything again.
     */
    function createSender({ storage, send, connection }) {
        const get = (keys) => new Promise((resolve) => storage.get(keys, resolve));
        const set = (values) => new Promise((resolve) => storage.set(values, () => resolve()));
        let running = null, again = false;
        const touched = new Set();   // ids whose saved text changed since they were last looked at
        // kept in memory only: a restarted background tells the app again, so a connection that got lost there comes back
        let modelMark = null;

        async function once() {
            const hello = await send({ type: 'hello' });
            if (!hello || !hello.ok) return { sent: 0, ok: false };
            const base = await get([KEY_INDEX, KEY_HL_INDEX, KEY_SENT, KEY_FEEDS]);
            // newest first: a large library takes a while, and what was saved last is what someone looks for
            const index = (Array.isArray(base[KEY_INDEX]) ? base[KEY_INDEX].slice() : [])
                .sort((a, b) => String((b && b.timestamp) || '').localeCompare(String((a && a.timestamp) || '')));
            const known = base[KEY_SENT] && base[KEY_SENT].folder === hello.folder ? base[KEY_SENT] : null;
            const ledger = known ? { ...known.items } : {};
            let feedMark = (known && known.feeds) || '';
            const remember = () => set({ [KEY_SENT]: { folder: hello.folder, items: ledger, feeds: feedMark } });
            // first, because a large library takes a while
            const model = connection ? await connection().catch((e) => { send({ type: 'model-error', error: str(String(e && e.message || e), 200) }); }) : undefined;
            const mark = model === undefined ? null : hello.folder + hash(JSON.stringify(model));
            if (mark !== null && mark !== modelMark) {
                const reply = await send({ type: 'model', connection: model });
                if (reply && reply.ok) modelMark = mark;
            }
            const feeds = toFeeds(base[KEY_FEEDS]);
            if (feeds.length && hash(JSON.stringify(feeds)) !== feedMark) {
                const reply = await send({ type: 'feeds', feeds });
                if (reply && reply.ok) { feedMark = hash(JSON.stringify(feeds)); await remember(); }
            }
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
            let sent = 0, ok = true, noted = false;
            for (const entry of index) {
                if (!entry || typeof entry.id !== 'string') continue;
                const marks = byPage.get(pageOf(entry.url)) || [];
                // the list entry and the highlights say whether anything moved: a library's texts are not read again for nothing
                const light = hash(JSON.stringify([entry, marks]));
                const seen = ledger[entry.id];
                const changed = touched.delete(entry.id);
                if (!changed && Array.isArray(seen) && seen[0] === light) continue;
                const rec = (await get([KEY_REC + entry.id]))[KEY_REC + entry.id];
                const article = toPackage(entry, rec, marks);
                if (!article) continue;
                const sig = hash(JSON.stringify(article));
                if ((Array.isArray(seen) ? seen[1] : seen) === sig) { ledger[article.id] = [light, sig]; noted = true; continue; }
                const { images, ...rest } = article;
                let taken = true;
                for (const image of images) {   // before the article, so that the app finds them when it reads it
                    const reply = await send({ type: 'image', id: article.id, name: image.name, data: image.data });
                    if (!reply || !reply.ok) { taken = false; break; }
                }
                const answer = taken && await send({ type: 'article', article: rest });
                if (!answer || !answer.ok) { ok = false; if (changed) touched.add(article.id); continue; }
                ledger[article.id] = [light, sig];
                sent += 1;
                await remember();   // after each one: the background may be put to sleep
            }
            if (noted) await remember();
            return { sent, ok };
        }

        function run() {
            if (running) { again = true; return running; }
            running = (async () => {
                let result;
                do { again = false; result = await once(); } while (again);
                return result;
            })().catch((e) => ({ sent: 0, ok: false, error: String(e && e.message || e) })).finally(() => { running = null; });
            return running;
        }
        run.touch = (ids) => ids.forEach((id) => touched.add(id));
        return run;
    }

    self.AISH_NATIVE = { toPackage, toFeeds, toModel, createSender };

    const api = typeof browser !== 'undefined' ? browser : (typeof chrome !== 'undefined' ? chrome : null);
    const permissions = api && api.runtime && api.runtime.getManifest ? api.runtime.getManifest().permissions || [] : [];
    if (!permissions.includes('nativeMessaging') || !api.runtime.sendNativeMessage) return;

    async function connection() {
        const sync = await api.storage.sync.get(['activeService', 'connectionMode', 'preferredCloudModel', 'cloudRegionPref']);
        const local = await new Promise((resolve) => api.storage.local.get(['config:services', 'account:token', 'account:licenseKey', 'account:installId'], resolve));
        const services = await (await fetch(api.runtime.getURL('services.json'))).json();
        return toModel(sync, local, services, typeof aiTokenExpired === 'function' ? aiTokenExpired : null);
    }
    const run = createSender({ storage: api.storage.local, send: (message) => Promise.resolve(api.runtime.sendNativeMessage(APP, message)), connection });
    let timer = null, urgent = false;
    // a few seconds of quiet first: a sync or an import writes many times in a row
    // iOS puts the background to sleep in the middle of a long hand-over: an alarm wakes it to go on, and goes when it is done
    const alarm = (on) => { try { if (on) api.alarms.create(RESUME_ALARM, { periodInMinutes: 1 }); else api.alarms.clear(RESUME_ALARM); } catch (_) { /* no alarms */ } };
    // a run that returns has ended, whatever it says: only one that was cut off leaves the alarm behind
    const start = () => { alarm(true); return run().then((r) => { alarm(false); if (!r.ok) console.warn('[Kaivo] the app did not take the library', r.error || ''); }); };
    // A page that was just saved goes at once: the reader may switch to the app right away, and iOS then puts this
    // background to sleep. What is written after it does not push that moment back.
    const soon = (now) => {
        if (urgent && !now) return;
        clearTimeout(timer);
        urgent = now === true;
        timer = setTimeout(() => { urgent = false; return start(); }, urgent ? 300 : 4000);
    };
    if (api.alarms && api.alarms.onAlarm) api.alarms.onAlarm.addListener((a) => { if (a && a.name === RESUME_ALARM) soon(); });
    // one or a few entries more in the list: someone saved a page (an import or a restore brings many)
    const justSaved = (change) => {
        if (!change || !Array.isArray(change.newValue)) return false;
        const before = new Set((Array.isArray(change.oldValue) ? change.oldValue : []).map((e) => e && e.id));
        const added = change.newValue.filter((e) => e && !before.has(e.id)).length;
        return added > 0 && added <= 3;
    };
    api.storage.onChanged.addListener((changes, area) => {
        const keys = Object.keys(changes);
        if (area === 'sync' && keys.some((k) => k === 'activeService' || k === 'connectionMode' || k === 'preferredCloudModel' || k === 'cloudRegionPref')) soon();
        if (area !== 'local') return;
        if (keys.some((k) => k === 'config:services' || k === 'account:token' || k === 'account:licenseKey')) soon();
        run.touch(keys.filter((k) => k.startsWith(KEY_REC)).map((k) => k.slice(KEY_REC.length)));
        if (keys.some((k) => k === KEY_INDEX || k === KEY_HL_INDEX || k === KEY_FEEDS || k.startsWith(KEY_REC) || k.startsWith(KEY_HL_PAGE))) soon(justSaved(changes[KEY_INDEX]));
    });
    soon();   // whatever was saved while this was not running
}());
