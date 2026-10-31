// modules/syncViewer.js
// The optional viewer page of a readable place: index.html + aish-viewer.js (plugin/src/viewer/), plain files that read library.json.
// Pure of chrome.*: the templates are passed in (the worker fetches them from the extension).
//
// What is written, and when:
//   • first time: both files, unless an index.html is already there that is not ours (then nothing is touched: status 'blocked');
//   • a newer viewer (or a new place name) replaces the files only while index.html is unchanged since we wrote it;
//   • a changed index.html is the user's own: left alone (status 'customized').
import { hashValue } from './syncStamps.js';

export const VIEWER_VERSION = 1;
export const VIEWER_FILES = { 'index.html': 'text/html; charset=utf-8', 'aish-viewer.js': 'text/javascript; charset=utf-8' };
const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ESC[c]);

/** Fills the template: the place name (escaped) and the viewer version. → { version, files } */
export function renderViewer(templates, { title } = {}) {
    const html = String(templates['index.html'] || '').split('{{TITLE}}').join(esc(title || 'Reading list')).split('{{VERSION}}').join(String(VIEWER_VERSION));
    return { version: VIEWER_VERSION, files: { 'index.html': html, 'aish-viewer.js': String(templates['aish-viewer.js'] || '') } };
}

export const isOurs = (text) => /<meta name="aish-viewer"/.test(String(text || ''));

/** The templates from the extension package. getUrl = chrome.runtime.getURL. */
export async function loadViewerTemplates({ getUrl, fetchFn = globalThis.fetch } = {}) {
    const out = {};
    for (const name of Object.keys(VIEWER_FILES)) {
        const res = await fetchFn(getUrl('viewer/' + name));
        if (!res.ok) throw new Error('The viewer files are missing from the extension.');
        out[name] = await res.text();
    }
    return out;
}

/**
 * Makes sure the place folder holds the current viewer. `state` = what the ledger remembers ({ hash, etag, skipped }).
 * → { state, status: 'written' | 'current' | 'customized' | 'blocked' }
 */
export async function ensureViewer({ store, state, viewer }) {
    const hash = hashValue(viewer.files);
    if (state && state.hash === hash) return { state, status: 'current' };
    if (state && state.skipped === hash) return { state, status: 'customized' };
    const write = async () => {
        let etag = '';
        for (const [name, body] of Object.entries(viewer.files)) { const r = await store.put(name, body, { contentType: VIEWER_FILES[name] }); if (name === 'index.html') etag = r.etag; }
        return { hash, etag, version: viewer.version };
    };
    const remote = await store.get('index.html');
    if (!remote) return { state: await write(), status: 'written' };
    if (!state) return isOurs(new TextDecoder().decode(remote.bytes)) ? { state: await write(), status: 'written' } : { state: undefined, status: 'blocked' };
    if (remote.etag === state.etag) return { state: await write(), status: 'written' };
    return { state: { ...state, skipped: hash }, status: 'customized' };
}
