// recapCites.js — source numbers in feed briefings. The model cites the numbered items behind a statement as [3] or [3][5]; the recap
// keeps `refs` ({ "3": item id }) next to the text, so the numbers stay valid when the recap is refreshed (new items continue the count)
// and every client that does not know about them still shows a harmless "[3]". Pure functions plus one DOM helper; no storage.

const MARK = /\[(\+?)(\d{1,3})\]/g;

/** Text with every source marker removed (what a model that must not copy them is given, e.g. the roll-up of day recaps). */
export function stripCites(text) { return String(text == null ? '' : text).replace(/\s?\[\+?\d{1,3}\]/g, ''); }

/** Highest source number in a refs map (0 when none). */
export const maxRef = (refs) => Object.keys(refs || {}).reduce((m, k) => Math.max(m, Number(k) || 0), 0);

/**
 * Turns the markers in a model reply into stored numbers and the refs that back them.
 * chunk = the items the request listed, in order. A fresh recap numbers them 1…n ([k] → k). A refresh lists only new items:
 * the model cites them as [+k], which becomes maxRef(prev) + k; plain [m] markers are earlier ones and stay when prev.refs has them.
 * Markers that point to nothing are dropped. → { overview, themes, refs }
 */
export function resolveCites(r, chunk, prevRefs = null) {
  const offset = prevRefs ? maxRef(prevRefs) : 0;
  const refs = { ...(prevRefs || {}) };
  const fix = (s) => String(s || '').replace(/(\s?)\[(\+?)(\d{1,3})\]/g, (m, sp, plus, num) => {   // a dropped marker takes its leading space with it
    const n = Number(num);
    if (prevRefs && plus) { const item = chunk[n - 1]; if (!item) return ''; refs[offset + n] = item.id; return `${sp}[${offset + n}]`; }
    if (prevRefs) return refs[n] ? m : '';                       // an earlier marker, kept only if the old refs know it
    const item = chunk[n - 1]; if (!item || plus) return ''; refs[n] = item.id; return m;
  });
  // keep only refs that are still cited
  const cited = new Set(); const note = (s) => { for (const m of String(s || '').matchAll(MARK)) cited.add(m[2]); };
  const overview = fix(r.overview), themes = (r.themes || []).map(fix);
  note(overview); themes.forEach(note);
  const kept = {}; for (const k of Object.keys(refs)) if (cited.has(k)) kept[k] = refs[k];
  return { ...r, overview, themes, refs: kept };
}

/** The distinct sources a recap cites, in the order they first appear: [{ n, item }] (items found in `byId`). */
export function citedSources(r, byId) {
  const seen = new Set(), out = [];
  for (const s of [r && r.overview, ...((r && r.themes) || [])]) for (const m of String(s || '').matchAll(MARK)) {
    const n = m[2]; if (seen.has(n)) continue; seen.add(n);
    const item = byId.get((r.refs || {})[n]); if (item) out.push({ n: Number(n), item });
  }
  return out;
}

const hostOf = (u) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch (_) { return ''; } };

/**
 * Replaces the [n] markers inside the text nodes of `root` with source chips (<a class="rc-cite">n</a>, titled with the item) —
 * a marker without a known item is removed. `byId` = Map item id → item.
 */
export function chipCites(root, r, byId, { doc = root.ownerDocument } = {}) {
  const walker = doc.createTreeWalker(root, 4 /* SHOW_TEXT */);
  const nodes = []; for (let n = walker.nextNode(); n; n = walker.nextNode()) if (/\[\+?\d{1,3}\]/.test(n.nodeValue)) nodes.push(n);
  for (const node of nodes) {
    const frag = doc.createDocumentFragment(); let last = 0; const text = node.nodeValue;
    for (const m of text.matchAll(MARK)) {
      frag.append(text.slice(last, m.index)); last = m.index + m[0].length;
      const item = byId.get((r.refs || {})[m[2]]);
      if (!item || !item.link) continue;
      const a = doc.createElement('a'); a.className = 'rc-cite'; a.textContent = m[2]; a.href = item.link; a.target = '_blank'; a.rel = 'noopener noreferrer';
      a.title = (item.title || item.link) + (hostOf(item.link) ? ' — ' + hostOf(item.link) : '');
      a.setAttribute('aria-label', a.title);
      frag.append(a);
    }
    frag.append(text.slice(last)); node.replaceWith(frag);
  }
}
