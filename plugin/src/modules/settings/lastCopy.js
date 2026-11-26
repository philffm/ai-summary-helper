// settings/lastCopy.js — when a full copy of the library last left this browser: a file saved with the articles, or a
// place that only receives (backup). Two-way sync is not counted (deletions travel with it), nor is a published list.
import { T } from '../feedI18n.js';
import { SK } from '../storageKeys.js';
import { timeAgo } from '../feedUtil.js';
import { iconEl } from '../icons.js';

const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };

/** { at, name } of the newest full copy, or null. `name` is '' for a file. */
export async function latestCopy(store = chrome.storage.local) {
    const d = await store.get([SK.syncPlaces, SK.syncStatus, SK.lastFileBackup]);
    const found = [];
    if (d[SK.lastFileBackup]) found.push({ at: Date.parse(d[SK.lastFileBackup]), name: '' });
    for (const p of d[SK.syncPlaces] || []) {
        const s = (d[SK.syncStatus] || {})[p.id];
        if (p.direction === 'push' && s && s.ok && s.at) found.push({ at: Date.parse(s.at), name: p.name });
    }
    return found.filter((c) => c.at).sort((a, b) => b.at - a.at)[0] || null;
}

const words = (copy) => (copy
    ? { title: T('Last full copy: {when}', { when: T('{t} ago', { t: timeAgo(copy.at) }) }), sub: copy.name || T('Saved as a file') }
    : { title: T('No full copy yet'), sub: T('Save a file or add a place that keeps a copy.') });

/** Fills the status card on Backup & sync, and the line above the delete buttons (which leads there). */
export async function paintLastCopy(doc = document, open = null) {
    const { title, sub } = words(await latestCopy());
    const card = doc.getElementById('lastCopy');
    if (card) card.replaceChildren(el('strong', '', title), el('span', 'setting-note', sub));
    const link = doc.getElementById('lastCopyLink');
    if (!link) return;
    const text = el('span', 'settings-row-text');
    text.append(el('span', 'settings-row-title', title), el('span', 'settings-row-sub', T('Backup & sync')));
    const chevron = el('span', 'settings-row-chev'); chevron.append(iconEl('chevron-right'));
    link.replaceChildren(text, chevron);
    if (open) link.onclick = open;
}

let watching = false;
export function initLastCopy(open, doc = document) {
    paintLastCopy(doc, open);
    if (watching) return;
    watching = true;
    chrome.storage.onChanged?.addListener((changes) => { if ([SK.syncPlaces, SK.syncStatus, SK.lastFileBackup].some((k) => k in changes)) paintLastCopy(doc, open); });
}
