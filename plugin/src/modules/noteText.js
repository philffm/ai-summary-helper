// modules/noteText.js — shared by the Notes tab and the page popover (kept tiny: the content-script bundle inlines it).

/** Hashtags at the end of what was typed become tags: "Ask Anna #todo #inflation" → text + ['todo','inflation']. */
export function splitTags(input) {
    let text = String(input || '').trim(); const tags = [];
    for (;;) {
        const m = /(?:^|\s)#([\p{L}\p{N}_-]{1,40})\s*$/u.exec(text);
        if (!m) break;
        tags.unshift(m[1]); text = text.slice(0, m.index).trim();
    }
    return { text, tags };
}
