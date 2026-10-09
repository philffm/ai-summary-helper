// skeleton.js
// Placeholder cards shown while a list (History, Feeds) loads from storage,
// so the screen never flashes empty. The real render replaces them.

// Fill `list` with `count` shimmering cards - only when it is empty, so a
// refresh of an already populated list never swaps real cards for placeholders.
// `cardClass` borrows the real card's box styling (article-card / feed-item).
export function showSkeleton(list, { count = 5, cardClass = 'article-card' } = {}) {
    if (!list || list.childElementCount) return;
    const frag = document.createDocumentFragment();
    for (let i = 0; i < count; i++) {
        const li = document.createElement('li');
        li.className = `${cardClass} skeleton-card`;
        li.setAttribute('aria-hidden', 'true');
        for (const cls of ['skeleton-line skeleton-title', 'skeleton-line', 'skeleton-line skeleton-short']) {
            const line = document.createElement('div');
            line.className = cls;
            li.appendChild(line);
        }
        frag.appendChild(li);
    }
    list.appendChild(frag);
    list.setAttribute('aria-busy', 'true');
}

export function clearSkeleton(list) {
    if (!list) return;
    list.querySelectorAll('.skeleton-card').forEach(n => n.remove());
    list.removeAttribute('aria-busy');
}
