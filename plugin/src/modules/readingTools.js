// Long texts (saved article → summary + original content): a "Scroll to top" pill and a progress ring that opens the
// contents (headings found in the text). Shown only after ~2 screens and only while scrolling back up.
import { T } from './feedI18n.js';
import { getReader, speechUnits, qaUnits, pickVoice, detectLang } from './reader.js';
import { ttsLang, langBase } from './languages.js';

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

export function mountReadingTools({ scroller, content, article = null, doc = document }) {
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
  // ── Read aloud (Listen pill → options popover → mini player) ──
  const reader = getReader();
  const meta = (article && article.meta) || {};
  const summaryEl = () => content.querySelector('.summary-box > div:not(#qaMount)');
  const originalEl = () => content.querySelector('details > div');
  const langName = (c) => { try { return new Intl.DisplayNames([doc.documentElement.lang || 'en'], { type: 'language' }).of(langBase(c)) || c; } catch (_) { return c; } };
  let listen = null, player = null, opts = null, src = 'summary', units = [], nowEl = null, optsOpen = false, ready = false, langs = { summary: '', original: '' };
  const detectFor = async (which) => {
    if (langs[which]) return langs[which];
    const el = which === 'summary' ? summaryEl() : originalEl();
    const stored = which === 'summary' ? meta.summaryLang : meta.contentLang;
    langs[which] = stored || (await detectLang(el ? el.textContent : '')) || (which === 'original' ? langBase(meta.lang || '') : '') || langBase(doc.documentElement.lang || '') || 'en';
    return langs[which];
  };
  const mark = (el) => { if (nowEl === el) return; if (nowEl) nowEl.classList.remove('tts-now'); nowEl = el; if (el) { el.classList.add('tts-now'); try { el.scrollIntoView({ block: 'center', behavior: reduce() ? 'auto' : 'smooth' }); } catch (_) { /* cosmetic */ } } };
  const isMine = (st) => st && st.meta && st.meta.tool === 'detail' && st.meta.id === (article && article.id);
  const active = () => ready && isMine(reader.state) && ['playing', 'paused', 'waiting'].includes(reader.state.state);
  function paintPlayer() {
    if (!player) return;
    const st = reader.state, on = active();
    root.classList.toggle('is-reading', on);
    player.hidden = !on; if (listen) listen.hidden = on;
    if (!on) { mark(null); return; }
    player.querySelector('.rt-pp').textContent = st.state === 'paused' ? '▶' : '❚❚';
    player.querySelector('.rt-pp').setAttribute('aria-label', st.state === 'paused' ? T('Play') : T('Pause'));
    player.querySelector('.rt-rate').textContent = String(st.rate || 1).replace(/^0\./, '0.') + '×';
    player.querySelector('.rt-lang').textContent = langBase(st.meta.lang || '').toUpperCase();
    if (st.state !== 'waiting' && units[st.index]) mark(units[st.index].el);
    update();
  }
  async function startReading(which) {
    const lang = await detectFor(which);
    const el = which === 'summary' ? summaryEl() : originalEl();
    if (!el) return;
    for (let d = el.closest('details'); d; d = d.parentElement && d.parentElement.closest('details')) d.open = true;
    units = speechUnits(el);
    if (which === 'summary') {   // the "Your questions" section is part of the summary view
      const qa = content.querySelector('#qaMount');
      if (qa) { qa.querySelectorAll('details').forEach(d => { d.open = true; }); units = units.concat(qaUnits(qa)); }
    }
    if (!units.length) return;
    src = which; optsOpen = false; if (opts) opts.hidden = true;
    await reader.start(units, ttsLang(lang), { meta: { tool: 'detail', id: article && article.id, lang: ttsLang(lang), source: which } });
    paintPlayer();
  }
  async function paintOpts() {
    const [ls, lo] = await Promise.all([detectFor('summary'), detectFor('original')]);
    const prefs = await reader.prefs();
    opts.textContent = '';
    const mkx = (tag, cls, text) => { const e = doc.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; };
    opts.append(mkx('div', 'rt-pop-t', T('Read aloud')));
    const seg = mkx('div', 'rt-seg'); seg.setAttribute('role', 'group');
    [['summary', T('Summary'), ls], ['original', T('Original'), lo]].forEach(([k, label, l]) => {
      const b = mkx('button', 'rt-seg-b' + (src === k ? ' is-on' : ''));
      b.type = 'button'; b.dataset.src = k; b.setAttribute('aria-pressed', String(src === k));
      b.append(mkx('span', 'rt-seg-t', label), mkx('span', 'rt-seg-s', langName(l)));
      b.addEventListener('click', () => { src = k; paintOpts(); });
      seg.append(b);
    });
    opts.append(seg);
    const lang = ttsLang(src === 'summary' ? ls : lo);
    const v = pickVoice(reader.voices, lang, prefs.voices && prefs.voices[langBase(lang)]);
    const vr = mkx('div', 'rt-voice');
    vr.append(mkx('div', 'rt-voice-k', T('Voice · auto')), mkx('div', 'rt-voice-v', v ? `${v.name} · ${langName(lang)}` : T('No voice for {lang} is installed on this device.', { lang: langName(lang) })));
    opts.append(vr);
    const rates = mkx('div', 'rt-rates');
    [0.8, 1, 1.25, 1.5].forEach((r) => { const b = mkx('button', 'rt-rate-b' + ((prefs.rate || 1) === r ? ' is-on' : ''), r + '×'); b.type = 'button'; b.addEventListener('click', async () => { await reader.setRate(r); paintOpts(); }); rates.append(b); });
    opts.append(rates);
    opts.append(mkx('p', 'rt-note', T('The voice follows the language of the text: an English summary of a German article is read in English, the original in German.')));
    const go = mkx('button', 'rt-start'); go.type = 'button'; go.disabled = !v;
    go.append(mkx('span', '', '▶'), mkx('span', '', T('Start')));
    go.addEventListener('click', () => startReading(src));
    opts.append(go);
  }
  function toggleOpts(force) {
    if (!opts) return;
    optsOpen = force === undefined ? !optsOpen : force;
    opts.hidden = !optsOpen;
    if (optsOpen) { if (open) close(false); paintOpts(); }
    update();
  }
  reader.ready.then((ok) => {
    if (!ok || !root.isConnected) return;
    ready = true;
    listen = mk('button', 'rt-pill rt-listen'); listen.type = 'button';
    listen.append(mk('span', 'rt-pill-ic', '🔊'), mk('span', '', T('Listen')));
    listen.addEventListener('click', () => toggleOpts());
    pill.after(listen);
    player = mk('div', 'rt-player'); player.hidden = true; player.setAttribute('role', 'group'); player.setAttribute('aria-label', T('Read aloud'));
    const pb = (cls, txt, label, fn) => { const b = mk('button', 'rt-pb ' + cls, txt); b.type = 'button'; b.setAttribute('aria-label', label); b.title = label; b.addEventListener('click', fn); return b; };
    player.append(pb('rt-prev', '|◀', T('Previous sentence'), () => reader.prev()), pb('rt-pp', '❚❚', T('Pause'), () => reader.toggle()), pb('rt-next', '▶|', T('Next sentence'), () => reader.next()),
      pb('rt-rate', '1×', T('Reading speed'), async () => { const cur = (reader.state.rate || 1); const steps = [1, 1.25, 1.5, 0.8]; await reader.setRate(steps[(steps.indexOf(cur) + 1) % steps.length] || 1); }),
      mk('span', 'rt-lang'), pb('rt-stop', '✕', T('Stop reading'), () => reader.stop()));
    root.insertBefore(player, ring || null);
    opts = mk('div', 'rt-opts'); opts.hidden = true; opts.setAttribute('role', 'dialog'); opts.setAttribute('aria-label', T('Read aloud')); root.append(opts);
    const topBtn = doc.getElementById('detailListenBtn'); if (topBtn) { topBtn.hidden = false; topBtn.title = T('Read aloud'); topBtn.setAttribute('aria-label', T('Read aloud')); topBtn.onclick = () => toggleOpts(); }
    unsub = reader.onState(paintPlayer); paintPlayer();
  });
  let unsub = null;
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
    const show = onScreen() && (open || optsOpen || root.classList.contains('is-reading') ? true : (long && top > h * 0.8 && up));
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
    if (optsOpen && e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); toggleOpts(false); return; }
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
  const onDown = (e) => {
    if (open && !pop.contains(e.target) && !ring.contains(e.target)) close(false);
    if (optsOpen && opts && !opts.contains(e.target) && !(listen && listen.contains(e.target)) && e.target.id !== 'detailListenBtn') toggleOpts(false);
  };

  pill.addEventListener('click', toTop);
  if (ring) ring.addEventListener('click', () => (open ? close(true) : openPop()));
  scroller.addEventListener('scroll', update, { passive: true });
  doc.addEventListener('keydown', onKey, true);
  doc.addEventListener('pointerdown', onDown, true);
  update();

  current = {
    root, update, openPop, close, hasToc, heads, listen: () => toggleOpts(),
    destroy() {
      if (unsub) unsub(); mark(null);
      const tb = doc.getElementById('detailListenBtn'); if (tb) { tb.hidden = true; tb.onclick = null; }
      scroller.removeEventListener('scroll', update); doc.removeEventListener('keydown', onKey, true); doc.removeEventListener('pointerdown', onDown, true);
      root.remove();
    }
  };
  return current;
}
