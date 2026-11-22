// modules/browserBookmark.js — "Save in browser bookmarks" from the read mode page.
// `bookmarks` is an optional permission: the browser asks the first time the user picks it, never at install. The extension only
// looks for and changes its own folder; one bookmark per article, updated when saved again (e.g. with a new place).
export const BOOKMARK_FOLDER = 'AI Summary Helper';

export const browserBookmarksPossible = () => !!(globalThis.chrome && chrome.permissions && typeof chrome.permissions.request === 'function');

/** Asks for the permission when it is not granted yet (needs a user gesture: call it first in the click handler). → true when granted. */
export async function ensureBookmarksAccess() {
  try { if (chrome.bookmarks && await chrome.permissions.contains({ permissions: ['bookmarks'] })) return true; } catch (_) { /* ask below */ }
  try { return !!(await chrome.permissions.request({ permissions: ['bookmarks'] })) && !!chrome.bookmarks; } catch (_) { return false; }
}

const idOf = (url) => { try { return new URLSearchParams(new URL(url).hash.slice(1)).get('id'); } catch (_) { return null; } };

async function folder() {
  const found = (await chrome.bookmarks.search({ title: BOOKMARK_FOLDER })).find((b) => !b.url && b.title === BOOKMARK_FOLDER);
  return found || chrome.bookmarks.create({ title: BOOKMARK_FOLDER });
}

/** Adds the bookmark, or updates the one for this article. → 'created' | 'updated' */
export async function saveBrowserBookmark({ articleId, title, url }) {
  const dir = await folder();
  const mine = (await chrome.bookmarks.getChildren(dir.id)).find((b) => b.url && idOf(b.url) === articleId);
  if (mine) { await chrome.bookmarks.update(mine.id, { title, url }); return 'updated'; }
  await chrome.bookmarks.create({ parentId: dir.id, title, url });
  return 'created';
}

/** Does this article already have one? (only asked when the permission is there already) */
export async function hasBrowserBookmark(articleId) {
  try {
    if (!chrome.bookmarks || !(await chrome.permissions.contains({ permissions: ['bookmarks'] }))) return false;
    const dir = (await chrome.bookmarks.search({ title: BOOKMARK_FOLDER })).find((b) => !b.url && b.title === BOOKMARK_FOLDER);
    return !!dir && (await chrome.bookmarks.getChildren(dir.id)).some((b) => b.url && idOf(b.url) === articleId);
  } catch (_) { return false; }
}
