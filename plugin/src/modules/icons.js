// icons.js — inline SVG icons (Lucide, ISC). The sprite lives in popup.html (scripts/build-icons.mjs);
// every icon is a <use> of it, so there is no extra request and it inherits currentColor.
// Size comes from the --icon-* tokens (.icon--sm / .icon--lg); decorative by default — the control carries the label.

const NS = 'http://www.w3.org/2000/svg';

/** Icon as an HTML string, for innerHTML templates. `cls` adds modifier classes (e.g. 'icon--lg'). */
export function icon(name, cls = '') {
    return `<svg class="icon icon-${name}${cls ? ' ' + cls : ''}" aria-hidden="true" focusable="false"><use href="#i-${name}"/></svg>`;
}

/** Icon as a DOM element. */
export function iconEl(name, cls = '') {
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('class', `icon icon-${name}${cls ? ' ' + cls : ''}`);
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('focusable', 'false');
    const use = document.createElementNS(NS, 'use');
    use.setAttribute('href', `#i-${name}`);
    svg.appendChild(use);
    return svg;
}

// Leading pictographs/arrows/flags (+ variation selectors, ZWJ, spaces) that translated labels still carry.
const LEAD = /^(?:[\p{Extended_Pictographic}\p{Regional_Indicator}←-⇿★☆✓✕️‍]|\s)+/u;
const TRAIL = /(?:[\p{Extended_Pictographic}\p{Regional_Indicator}\u2190-\u21FF\uFE0F\u200D]|\s)+$/u;
export function stripLeadingEmoji(s) { return String(s == null ? '' : s).replace(LEAD, ''); }
/** Strips pictographs from both ends ('Copy 📋' → 'Copy'): labels whose translations carry the old emoji. */
export function stripEmoji(s) { return stripLeadingEmoji(s).replace(TRAIL, ''); }

/** Replace an element's content with `[icon] label` (label loses any leading emoji so translations stay valid). */
export function setIconLabel(el, name, label, cls = '') {
    el.replaceChildren(iconEl(name, cls), document.createTextNode(' ' + stripEmoji(label)));
    return el;
}

/** Icon-only control: swap the icon, keep the accessible name on the button itself. */
export function setIcon(el, name, cls = '') {
    el.replaceChildren(iconEl(name, cls));
    return el;
}

// Emoji that older labels/translations still start with → the icon that replaces them. Only mapped emoji are
// converted (flags and user content are left alone), so a label that was never mapped keeps rendering as text.
const BY_EMOJI = {
    '✨': 'sparkles', '🪄': 'sparkles', '⏳': 'loader', '📄': 'file-text', '📝': 'file-text', '⏸': 'pause', '▶': 'play',
    '↻': 'refresh-cw', '🔄': 'refresh-cw', '🔁': 'refresh-cw', '📥': 'download', '📤': 'upload', '📅': 'calendar',
    '🎛': 'sliders-horizontal', '🎚': 'sliders-horizontal', '⚙': 'settings', '✓': 'check', '🤖': 'bot', '⏱': 'clock',
    '🕐': 'clock', '📦': 'layers', '🔕': 'bell-off', '⚠': 'circle-alert', '🏷': 'tag', '📰': 'newspaper',
    '🎧': 'headphones', '😊': 'smile', '🔖': 'bookmark', '🔗': 'link', '📚': 'book-open', '📱': 'smartphone',
    '💾': 'save', '📋': 'clipboard', '🧹': 'eraser', '🔒': 'lock', '✏': 'pencil', '🌐': 'globe', '☁': 'cloud',
    '💻': 'laptop', '🦙': 'server', '🔍': 'search', '🧠': 'brain', '💬': 'message-square', '❌': 'circle-x',
    '💡': 'lightbulb', '💙': 'heart', '📌': 'pin', '🗑': 'trash-2', '🗂': 'folders', '🕸': 'network', '📊': 'chart-column',
    '☑': 'square-check-big', '👤': 'user', '🎨': 'palette', '📤️': 'upload',
};
const LEAD_MAPPED = /^([\u2190-\u21FF\u23F3\u23F8\u2600-\u27BF\u{1F000}-\u{1FFFF}])\uFE0F?\s*/u;

const TRAIL_MAPPED = /\s([\u2190-\u21FF\u23F3\u23F8\u2600-\u27BF\u{1F000}-\u{1FFFF}])\uFE0F?$/u;

/** Icon name for a label's leading emoji, or '' when it has none (or one we do not map). */
export function leadingIconName(text) {
    const m = LEAD_MAPPED.exec(String(text == null ? '' : text));
    return (m && BY_EMOJI[m[1]]) || '';
}

/** Child nodes for a label: `[icon] text` when it starts with a mapped emoji, otherwise just the text. */
export function labelNodes(text, cls = '') {
    const s = String(text == null ? '' : text), name = leadingIconName(s);
    if (name) return [iconEl(name, cls), document.createTextNode(' ' + stripEmoji(s))];
    const tm = TRAIL_MAPPED.exec(s), tn = tm && BY_EMOJI[tm[1]];   // "Copy 📋": the emoji came last in older labels
    if (tn) return [document.createTextNode(stripEmoji(s) + ' '), iconEl(tn, cls)];
    return [document.createTextNode(s)];
}

/** Sets a control's label from a (translated) string, turning a leading emoji into the matching SVG icon. */
export function setLabel(el, text, cls = '') {
    el.replaceChildren(...labelNodes(text, cls));
    return el;
}
