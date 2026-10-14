// detailToolbar.js — which actions the article view's joined toolbar offers, and in which order.
// Catalog + preference helpers only (the handlers live in articleManager.js, the editor in settingsManager.js).
import { T } from './feedI18n.js';
import { stripEmoji } from './icons.js';

export const TOOLBAR_PREF = 'detailToolbarItems';

/** id → icon + labels. `existing` = an element of the top bar that moves into the toolbar (it keeps its own state and handler). `short` is the label next to the icon, `label` the full name (tooltip, settings). */
export const TOOLBAR_CATALOG = {
  read: { icon: 'book-open', label: () => stripEmoji(T('Read 👓')), short: () => stripEmoji(T('Read 👓')) },   // the reader page — not the read/unread status
  copy: { icon: 'copy', label: () => T('Copy'), short: () => T('Copy') },
  favorite: { icon: 'star', label: () => T('Favorite'), short: () => T('Favorite'), existing: '#detailStarBtn' },
  listen: { icon: 'volume-2', label: () => T('Read aloud'), short: () => T('Listen'), existing: '#detailListenBtn' },
  send: { icon: 'send', label: () => T('Send to…'), short: () => T('Send'), split: true },   // split button: last used target + ▾ with all targets (Kindle, LocalSend, phone, share, copy link)
  markdown: { icon: 'download', label: () => T('Export as Markdown'), short: () => T('Markdown') },
  obsidian: { icon: 'folders', label: () => T('Send to Obsidian'), short: () => T('Obsidian') },
  pdf: { icon: 'newspaper', label: () => T('Export as PDF'), short: () => T('PDF') },
  collection: { icon: 'layers', label: () => T('Add to collection'), short: () => T('Collection') },
};

/** Read / Copy come first; more items appear as the pane gets wider. */
export const DEFAULT_TOOLBAR = ['read', 'copy', 'favorite', 'listen', 'send', 'markdown'];

/** Saved list → known ids only, no duplicates; falls back to the default when nothing usable is stored. */
export function normalizeToolbar(v) {
  if (!Array.isArray(v)) return DEFAULT_TOOLBAR.slice();
  const out = [];
  v.forEach(id => { if (id === 'share' || id === 'phone' || id === 'kindle' || id === 'localsend') id = 'send'; if (TOOLBAR_CATALOG[id] && !out.includes(id)) out.push(id); });   // Share / E-Reader / Phone became one Send split button
  return out.length ? out : DEFAULT_TOOLBAR.slice();
}
