// feedStacks.js — group near-identical feed items (the same story from several sources, or re-posts) into one stack.
//
// Pure and local: titles are compared as Unicode word sets, nothing is stored on the items and nothing is sent anywhere.
// The comparison is deliberately conservative — a missed stack is a minor annoyance, a wrongly merged story hides news.
//
//   stackItems(list, { exclude, prefer }) → [{ lead, others }]   in the order of `list` (newest first)

export const STACK_WINDOW_MS = 48 * 3600 * 1000;   // the same story is published within about two days
export const DICE_MIN = 0.6;                       // share of title words two titles have in common
export const SHARED_MIN = 3;                       // …and at least this many words (CJK: bigrams)
export const SHARED_MIN_CJK = 4;

// Words that carry no topic in the languages the extension ships in (kept short on purpose).
const STOP = new Set(('the a an of to in on for and or at by with is are as from over after new says ' +
    'der die das und im zu von mit für ein eine nach über neu ' +
    'el la los las de del y en un una por con ' +
    'le les un une et du des pour dans ' +
    'il lo gli di da per con ' +
    'o os as um uma do da dos das ' +
    'и в на с по для').split(/\s+/));
const CJK = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;

/** { words, nums, cjk } for a title: lowercase, accents folded, CJK as character bigrams, digits kept separately. */
export function titleTokens(title) {
    const s = String(title || '').normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase();
    const words = new Set(), nums = new Set();
    let cjk = false;
    for (const w of s.split(/[^\p{L}\p{N}]+/u)) {
        if (!w) continue;
        if (/^\p{N}+$/u.test(w)) { nums.add(w); words.add(w); continue; }
        if (CJK.test(w)) {
            cjk = true;
            if (w.length === 1) words.add(w);
            for (let k = 0; k < w.length - 1; k++) words.add(w.slice(k, k + 2));
            continue;
        }
        if (w.length < 3 || STOP.has(w)) continue;
        words.add(w);
    }
    return { words, nums, cjk };
}

const sameSet = (a, b) => a.size === b.size && [...a].every((x) => b.has(x));

/** Do two token sets describe the same story? */
export function similar(a, b) {
    if (!a.words.size || !b.words.size) return false;
    // "Matchday 3" vs "Matchday 4": when both titles carry numbers they must carry the same ones.
    if (a.nums.size && b.nums.size && !sameSet(a.nums, b.nums)) return false;
    let shared = 0;
    for (const w of a.words) if (b.words.has(w)) shared++;
    if (shared < (a.cjk || b.cjk ? SHARED_MIN_CJK : SHARED_MIN)) return false;
    return (2 * shared) / (a.words.size + b.words.size) >= DICE_MIN;
}

/**
 * @param {Array<{id:string,title:string,published:number}>} list  display order (newest first)
 * @param {{exclude?: Set<string>, prefer?: (item) => number, windowMs?: number}} [opts]
 *   exclude: ids that never join a stack; prefer: higher score = shown as the stack's lead (default: the newest)
 */
export function stackItems(list, { exclude = new Set(), prefer = () => 0, windowMs = STACK_WINDOW_MS } = {}) {
    const tok = list.map((i) => titleTokens(i.title));
    const clusters = [];            // arrays of indices, [0] = the newest (first in list order) = what later items are compared with
    const clusterOf = new Array(list.length).fill(-1);
    const index = new Map();        // word -> indices of items already placed
    list.forEach((item, i) => {
        let joined = -1;
        if (!exclude.has(item.id) && tok[i].words.size) {
            const hits = new Map();
            for (const w of tok[i].words) {
                const posting = index.get(w) || [];
                // list is newest first, so the posting list runs from newer to older: scan back from the closest in time and
                // stop once an entry is further away than the window (everything before it is even newer).
                for (let q = posting.length - 1; q >= 0; q--) {
                    const j = posting[q];
                    if (list[j].published - item.published > windowMs) break;
                    hits.set(j, (hits.get(j) || 0) + 1);
                }
            }
            const cands = [...hits].sort((x, y) => y[1] - x[1]).map(([j]) => j);
            const tried = new Set();
            for (const j of cands) {
                const c = clusterOf[j];
                if (c < 0 || tried.has(c)) continue;
                tried.add(c);
                const lead = clusters[c][0];
                if (Math.abs(list[lead].published - item.published) > windowMs) continue;
                if (similar(tok[i], tok[lead])) { joined = c; break; }   // compared with the stack's lead, so chains of "almost" cannot grow it
            }
        }
        if (joined < 0) { clusters.push([i]); joined = clusters.length - 1; } else clusters[joined].push(i);
        clusterOf[i] = joined;
        if (!exclude.has(item.id)) for (const w of tok[i].words) { if (!index.has(w)) index.set(w, []); index.get(w).push(i); }
    });
    return clusters.map((idx) => {
        let best = idx[0], bestScore = prefer(list[idx[0]]);
        for (const k of idx.slice(1)) { const sc = prefer(list[k]); if (sc > bestScore) { best = k; bestScore = sc; } }
        return { lead: list[best], others: idx.filter((k) => k !== best).map((k) => list[k]) };
    });
}
