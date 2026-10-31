// modules/notesMessages.js
// What the background worker does when a page's content script asks for a note or a comment. Content scripts run in the page's
// origin and must not write the notes store themselves, so they send these messages. The address always comes from the tab the
// message arrived from, never from the message: a page cannot file a note under another site.
import { pageKeyForUrl } from './pageKey.js';

const str = (v, n) => String(v == null ? '' : v).slice(0, n);
const tagList = (t) => (Array.isArray(t) ? t.slice(0, 12).map((x) => str(x, 40)) : []);

export function createNotesMessages({ store }) {
    const fromTab = (sender) => {
        const u = sender && sender.tab && sender.tab.url;
        return /^https?:\/\//i.test(u || '') ? { url: pageKeyForUrl(u), title: str(sender.tab.title, 300) } : null;
    };
    return {
        /** → { ok, id? } or { ok:false, error } */
        async handle(msg, sender) {
            if (!msg || typeof msg !== 'object') return { ok: false, error: 'bad-message' };
            const src = fromTab(sender);
            if (!src) return { ok: false, error: 'no-page' };
            if (msg.action === 'noteAdd') {
                const text = str(msg.text, 20000).trim();
                if (!text) return { ok: false, error: 'empty' };
                const rec = await store.add({ text, tags: tagList(msg.tags), url: src.url, title: src.title, quote: str(msg.quote, 2000) });
                return rec ? { ok: true, id: rec.id } : { ok: false, error: 'empty' };
            }
            if (msg.action === 'commentSet') {
                const id = str(msg.highlightId, 80);
                if (!/^[A-Za-z0-9_-]{3,80}$/.test(id)) return { ok: false, error: 'bad-id' };
                const rec = await store.setComment(id, { text: str(msg.text, 20000), tags: tagList(msg.tags), url: src.url });
                return { ok: true, id: rec ? rec.id : null };
            }
            return { ok: false, error: 'unknown-action' };
        },
    };
}
