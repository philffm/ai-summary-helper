// modules/obsidianUri.js
// The obsidian://new link for one note. Pure. The text itself goes through the clipboard (a URI is too short for long articles).
//   vault   optional vault name; empty = the vault Obsidian opened last
//   folder  optional folder inside the vault; empty = vault root. Becomes `file=<folder>/<name>`.
// `overwrite` is set only by the caller that knows the note was sent from here before (ledger, later step).
const clean = (s) => String(s == null ? '' : s).replace(/[\\:*?"<>|#^[\]\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim();
const folderPath = (f) => String(f == null ? '' : f).split('/').map(clean).filter((p) => p && p !== '.' && p !== '..').join('/');

export function obsidianUri({ name, vault = '', folder = '', overwrite = false } = {}) {
    const base = clean(name).replace(/\//g, ' ').trim().slice(0, 80) || 'Untitled';
    const dir = folderPath(folder);
    const q = [];
    const v = clean(vault);
    if (v) q.push('vault=' + encodeURIComponent(v));
    q.push((dir ? 'file=' + encodeURIComponent(dir + '/' + base) : 'name=' + encodeURIComponent(base)));
    q.push('clipboard');
    if (overwrite) q.push('overwrite');
    return 'obsidian://new?' + q.join('&');
}
