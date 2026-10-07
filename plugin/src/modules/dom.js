// dom.js — tiny DOM builders shared by popup modules (was copy-pasted in feedManager, sendSheet, feedInsights, moodView).

/** Create an element: el('div', 'cls', 'text'). `text` goes in via textContent (safe). */
export function el(tag, className, text) {
    const n = document.createElement(tag);
    if (className) n.className = className;
    if (text != null) n.textContent = text;
    return n;
}

/** Analytics/report section: <div.ar-section><h3.ar-section-title>title</h3></div> */
export function arSection(title) {
    const s = el('div', 'ar-section');
    s.append(el('h3', 'ar-section-title', title));
    return s;
}
