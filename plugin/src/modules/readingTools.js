// Long texts (saved article → summary + original content): a "Scroll to top" pill and a progress ring that opens the
// contents (headings found in the text). Shown only after ~2 screens and only while scrolling back up.
import { T } from './feedI18n.js';

let current = null;
export function destroyReadingTools() { if (current) { current.destroy(); current = null; } }

/** Headings of the article text: skips the card's own title, the Q&A and the paper row. */
export function collectHeadings(root) {
  const card = root.querySelector('.article-detail-card') || root;
  const out = [];
  card.querySelectorAll('h1, h2, h3, h4').forEach(el => {
    if (el.parentElement === card || el.closest('#qaMount, .paper-row, .sendsheet')) return;
    const text = (el.textContent || '').replace(/\s+/g, ' ').trim();
    if (text) out.push({ el, text: text.length > 70 ? text.slice(0, 69) + '…' : text, level: Number(el.tagName[1]) });
  });
  return out.slice(0, 60);
}

export function mountReadingTools({ scroller, content, doc = document }) {
  destroyReadingTools();
  if (!scroller || !content) return null;
  const win = doc.defaultView || window;
  const mk = (tag, cls, text) => { const e = doc.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; };
  const heads = collectHeadings(content);
  const hasToc = heads.length >= 3;
  const reduce = () => { try { return !!(win.matchMedia && win.matchMedia('(prefers-reduced-motion: reduce)').matches); } catch (_) { return false; } };

  const root = mk('div', 'reading-tools'); root.setAttribute('aria-hidden', 'true');
  const pill = mk('button', 'rt-pill'); pill.type = 'button';
  pill.append(mk('span', 'rt-pill-ic', '↑'), mk('span', '', T('Scroll to top')));
  root.append(pill);
  let ring = null, pop = null, list = null;
  if (hasToc) {
    ring = mk('button', 'rt-ring'); ring.type = 'button';
    ring.setAttribute('aria-label', T('Contents')); ring.setAttribute('aria-haspopup', 'dialog'); ring.setAttribute('aria-expanded', 'false');
    ring.append(mk('span', 'rt-ring-ic', '≡'));
    pop = mk('div', 'rt-pop'); pop.setAttribute('role', 'dialog'); pop.setAttribute('aria-label', T('Contents')); pop.hidden = true;
    pop.append(mk('div', 'rt-pop-t', T('Contents')));
    list = mk('ul', 'rt-list'); pop.append(list);
    root.append(ring, pop);
  }
  doc.body.append(root);

  let lastTop = scroller.scrollTop || 0, up = false, open = false, on = false;
  const onScreen = () => !!content.isConnected && doc.body.dataset.screen === 'history'
    && (content.closest('#articleDetail') || content).style.display !== 'none';
  const visibleHeads = () => heads.filter(h => h.el.getClientRects().length > 0);
  const currentIndex = () => {
    const base = scroller.getBoundingClientRect().top + 150;
    let idx = -1; visibleHeads().forEach(h => { if (h.el.getBoundingClientRect().top <= base) idx = heads.indexOf(h); });
    return idx;
  };
  const update = () => {
    const h = scroller.clientHeight || 0, top = scroller.scrollTop || 0, max = (scroller.scrollHeight || 0) - h;
    if (top < lastTop) up = true; else if (top > lastTop) up = false;
    lastTop = top;
    if (ring) ring.style.setProperty('--p', String(max > 0 ? Math.round(Math.min(1, top / max) * 100) : 0));
    const long = max > h * 1.5;
    const show = onScreen() && (open ? true : (long && top > h * 0.8 && up));
    if (show !== on) { on = show; root.classList.toggle('is-on', on); root.setAttribute('aria-hidden', on ? 'false' : 'true'); }
    if (!show && open) close(false);
  };
  const toTop = () => { try { scroller.scrollTo({ top: 0, behavior: reduce() ? 'auto' : 'smooth' }); } catch (_) { scroller.scrollTop = 0; } };
  const jump = (el) => {
    for (let d = el.closest('details'); d; d = d.parentElement && d.parentElement.closest('details')) d.open = true;
    try { el.scrollIntoView({ block: 'start', behavior: reduce() ? 'auto' : 'smooth' }); } catch (_) { el.scrollIntoView(); }
  };
  function fill() {
    list.textContent = '';
    const cur = currentIndex();
    heads.forEach((h, i) => {
      const li = mk('li'); const b = mk('button', 'rt-row' + (i === cur ? ' is-cur' : ''), h.text); b.type = 'button';
      b.style.paddingLeft = (10 + Math.max(0, h.level - Math.min(...heads.map(x => x.level))) * 12) + 'px';
      if (i === cur) b.setAttribute('aria-current', 'true');
      b.addEventListener('click', () => { close(true); jump(h.el); });
      li.append(b); list.append(li);
    });
  }
  function openPop() {
    if (!ring || !onScreen()) return;
    fill(); pop.hidden = false; open = true; ring.setAttribute('aria-expanded', 'true'); update();
    (list.querySelector('.is-cur') || list.querySelector('button')).focus({ preventScroll: true });
  }
  function close(refocus) {
    if (!open) return;
    open = false; pop.hidden = true; ring.setAttribute('aria-expanded', 'false');
    if (refocus && root.classList.contains('is-on')) ring.focus({ preventScroll: true });
  }
  const onKey = (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (open) {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(true); return; }
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        const rows = [...list.querySelectorAll('button')]; const i = rows.indexOf(doc.activeElement);
        e.preventDefault(); rows[(i + (e.key === 'ArrowDown' ? 1 : -1) + rows.length) % rows.length].focus(); return;
      }
    }
    const t = e.target, tag = t && t.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (t && t.isContentEditable)) return;
    if ((e.key === 't' || e.key === 'T') && hasToc && onScreen()) { e.preventDefault(); open ? close(true) : openPop(); }
  };
  const onDown = (e) => { if (open && !pop.contains(e.target) && !ring.contains(e.target)) close(false); };

  pill.addEventListener('click', toTop);
  if (ring) ring.addEventListener('click', () => (open ? close(true) : openPop()));
  scroller.addEventListener('scroll', update, { passive: true });
  doc.addEventListener('keydown', onKey, true);
  doc.addEventListener('pointerdown', onDown, true);
  update();

  current = {
    root, update, openPop, close, hasToc, heads,
    destroy() {
      scroller.removeEventListener('scroll', update); doc.removeEventListener('keydown', onKey, true); doc.removeEventListener('pointerdown', onDown, true);
      root.remove();
    }
  };
  return current;
}
