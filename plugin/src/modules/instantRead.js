// Instant read: speak the summary while the model is still writing it. Title and site are announced as soon as Fetch
// starts; then every finished sentence of the stream is queued for the voice (never half a sentence).
import { T } from './feedI18n.js';
import { getReader, streamText, speakable, detectLang, pickVoice } from './reader.js';
import { ttsLang, langBase } from './languages.js';

const mk = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; };
// The language of the extension's own texts (what T() returns) — NOT the browser's: with the browser in English and the extension in
// German, the German announcement must be spoken by a German voice.
const uiLang = () => {
  try { const l = document.documentElement.lang; if (l) return ttsLang(l); } catch (_) { /* no document */ }
  try { return ttsLang((typeof browser !== 'undefined' ? browser : chrome).i18n.getUILanguage()); } catch (_) { return 'en'; }
};

const plain = (t) => String(t || '').replace(/```[\s\S]*?(```|$)/g, '').replace(/[*_`#>]+/g, '').replace(/\[(.*?)\]\([^)]*\)/g, '$1');

export function initInstantRead({ chip, panel, barHost, button, fallback }) {
  const reader = getReader();
  let chain = Promise.resolve(), on = false, active = false, spoken = 0, sumLang = 'en', lastUnits = [], wasReading = false, ready = false, bar = null;

  const paintChip = () => {
    if (!chip) return;
    const st = reader.state;
    chip.classList.toggle('is-on', on);
    chip.classList.toggle('is-speaking', on && st.meta && st.meta.tool === 'instant' && ['playing', 'waiting'].includes(st.state));
    const ic = chip.querySelector('.chip-icon'); if (ic) ic.textContent = on ? '🔊' : '🔇';
    chip.title = T('Instant read'); chip.setAttribute('aria-label', T('Instant read') + ': ' + (on ? T('On') : T('Off')));
  };

  const fallbackUnits = async () => {
    let html = ''; try { html = (fallback && fallback()) || ''; } catch (_) { html = ''; }
    if (!html) return [];
    let code = 'en'; try { code = (await chrome.storage.sync.get('selectedLanguage')).selectedLanguage || 'en'; } catch (_) { /* default */ }
    sumLang = ttsLang(code);
    return speakable(streamText(html), true).map(text => ({ text, lang: sumLang }));
  };
  const paintButton = () => {
    if (!button) return;
    const st = reader.state, mine = st.meta && st.meta.tool === 'instant';
    const running = mine && ['playing', 'paused', 'waiting'].includes(st.state);
    button.hidden = !ready;
    const label = running ? (st.state === 'paused' ? T('Play') : T('Pause')) : T('Read again');
    button.title = label; button.setAttribute('aria-label', label);
    const ic = button.querySelector('.composer-read-ic'); if (ic) ic.textContent = running ? (st.state === 'paused' ? '▶' : '❚❚') : '🔊';
    button.classList.toggle('is-speaking', !!running);
    let has = lastUnits.length > 0; try { has = has || !!(fallback && fallback()); } catch (_) { /* none */ }
    button.disabled = !running && !has;
  };
  if (button) button.addEventListener('click', async () => {
    const st = reader.state;
    if (st.meta && st.meta.tool === 'instant' && ['playing', 'paused', 'waiting'].includes(st.state)) { reader.toggle(); return; }
    const units = lastUnits.length ? lastUnits : await fallbackUnits();
    if (!units.length) return;
    if (!lastUnits.length) lastUnits = units;
    await reader.start(units, sumLang, { meta: { tool: 'instant', lang: sumLang } });
  });

  const paintBar = () => {
    paintButton();
    const st = reader.state, mine = st.meta && st.meta.tool === 'instant';
    const running = mine && ['playing', 'paused', 'waiting'].includes(st.state);
    if (running) wasReading = true;
    // The bar shows only while reading; "finished / read again" lives in the summary card's Read again button.
    if (!running) { if (bar) bar.hidden = true; return; }
    if (!bar || !bar.isConnected) { bar = mk('div', 'sr-bar'); bar.setAttribute('role', 'group'); bar.setAttribute('aria-label', T('Instant read')); if (!barHost) return; barHost.prepend(bar); }
    bar.hidden = false; bar.textContent = '';
    const b = (cls, txt, label, fn) => { const x = mk('button', 'sr-b ' + cls, txt); x.type = 'button'; x.title = label; x.setAttribute('aria-label', label); x.addEventListener('click', fn); return x; };
    bar.append(b('sr-pp', st.state === 'paused' ? '▶' : '❚❚', st.state === 'paused' ? T('Play') : T('Pause'), () => reader.toggle()),
        mk('span', 'sr-t', T('Reading · sentence {n}', { n: Math.min(st.index + 1, st.total || 1) })),
        b('sr-mute' + (st.muted ? ' is-on' : ''), st.muted ? '🔇' : '🔊', st.muted ? T('Unmute') : T('Mute'), () => reader.mute()),
        b('sr-rate', String(st.rate || 1) + '×', T('Reading speed'), async () => { const steps = [1, 1.25, 1.5, 0.8]; await reader.setRate(steps[(steps.indexOf(st.rate || 1) + 1) % steps.length]); }));
  };
  reader.onState(() => { paintChip(); paintBar(); });

  async function paintPanel() {
    if (!panel) return;
    const prefs = await reader.prefs();
    let code = 'en'; try { code = (await chrome.storage.sync.get('selectedLanguage')).selectedLanguage || 'en'; } catch (_) { /* default */ }
    const lang = ttsLang(code);
    const v = pickVoice(reader.voices, lang, prefs.voices && prefs.voices[langBase(lang)]);
    let name = lang; try { name = new Intl.DisplayNames([document.documentElement.lang || 'en'], { type: 'language' }).of(langBase(lang)) || lang; } catch (_) { /* raw code */ }
    panel.textContent = '';
    const head = mk('div', 'sr-head'); head.append(mk('strong', '', T('Instant read')));
    const sw = mk('label', 'switch'); const cb = mk('input'); cb.type = 'checkbox'; cb.id = 'instantReadToggle'; cb.checked = on; cb.setAttribute('aria-label', T('Instant read'));
    cb.addEventListener('change', async () => { on = cb.checked; await reader.setInstant(on); if (!on) reader.stop(); paintChip(); });
    sw.append(cb, mk('span', 'slider-toggle')); head.append(sw); panel.append(head);
    panel.append(mk('p', 'sr-note', T('Speaks the title and site first, then the summary sentence by sentence while the model writes.')));
    const vol = mk('div', 'sr-vol'); const rg = mk('input'); rg.type = 'range'; rg.min = '0'; rg.max = '100'; rg.id = 'soundVolume'; rg.value = String(Math.round((prefs.volume >= 0 ? prefs.volume : 1) * 100)); rg.setAttribute('aria-label', T('Volume'));
    rg.addEventListener('change', () => reader.setVolume(Number(rg.value) / 100));
    vol.append(mk('span', '', '🔈'), rg, mk('span', '', '🔊')); panel.append(vol);
    const rates = mk('div', 'rt-rates');
    [0.8, 1, 1.25, 1.5].forEach((r) => { const x = mk('button', 'rt-rate-b' + ((prefs.rate || 1) === r ? ' is-on' : ''), r + '×'); x.type = 'button'; x.addEventListener('click', async () => { await reader.setRate(r); paintPanel(); }); rates.append(x); });
    panel.append(rates);
    panel.append(mk('p', 'sr-note', v ? T('Voice: {voice} · {lang}. It follows the summary language; title and site are announced in the app language.', { voice: v.name, lang: name }) : T('No voice for {lang} is installed on this device.', { lang: name })));
  }

  const ready_ = reader.ready.then(async (ok) => {
    ready = ok;
    paintButton();
    if (!ok) { if (chip) chip.hidden = true; return; }
    on = !!(await reader.prefs()).instant; paintChip();
    if (chip) chip.addEventListener('click', () => setTimeout(() => { if (panel && panel.style.display === 'block') paintPanel(); }, 0));
  });

  document.addEventListener('keydown', (e) => {
    if (e.key.toLowerCase() !== 'm' || e.metaKey || e.ctrlKey || e.altKey) return;
    const t = e.target; if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
    if (['playing', 'paused', 'waiting'].includes(reader.state.state)) { e.preventDefault(); reader.mute(); }
  });

  async function begin(ctx) {
    if (!on || !ready || active) return;
    active = true; spoken = 0; lastUnits = [];
    try { sumLang = ttsLang((await chrome.storage.sync.get('selectedLanguage')).selectedLanguage || 'en'); } catch (_) { sumLang = 'en'; }
    const title = ((document.getElementById('pageCard') || {}).dataset || {}).title || '';
    const ui = uiLang();
    const titleLang = title ? ((await detectLang(title)) || ui) : ui;
    const host = ctx.host || ((document.getElementById('pageCard') || {}).dataset || {}).host || '';
    const units = [];
    if (title) units.push({ text: title.replace(/\s*[|–—-]\s*[^|–—-]{0,40}$/, '') || title, lang: ttsLang(titleLang) });
    // The announcements are the extension's own texts: they follow the UI language of the extension (text and voice),
    // not the summary language. The title keeps the language it was detected in.
    if (host) units.push({ text: T('From {site}.', { site: host.replace(/^www\./, '') }), lang: ui });
    units.push({ text: T('Writing a {n}-word summary…', { n: Number(ctx.length) || 200 }), lang: ui });
    if (!active) return;   // cancelled while we were preparing
    await reader.start(units, ui, { open: true, meta: { tool: 'instant', lang: sumLang } });
  }
  function feed(preview) {
    if (!active) return;
    const list = speakable(streamText(preview));
    const more = list.slice(spoken);
    if (!more.length) return;
    spoken = list.length; lastUnits = lastUnits.concat(more.map(text => ({ text })));
    reader.append(more.map(text => ({ text, lang: sumLang })), sumLang);
  }
  function complete(summaryHtml) {
    if (!active) return;
    active = false;
    const list = speakable(streamText(summaryHtml), true);
    const more = list.slice(spoken); spoken = list.length;
    lastUnits = list.map(text => ({ text, lang: sumLang }));
    if (more.length) reader.append(more.map(text => ({ text, lang: sumLang })), sumLang);
    reader.finish();
    paintBar();
  }
  function abort() { if (!active && !wasReading) return; active = false; wasReading = false; lastUnits = []; reader.stop(); paintBar(); }

  return {
    ready: ready_,
    refresh: paintButton,
    /** Read a finished summary (card button): `id` marks whose text is playing. */
    async readHtml(html, id) {
      let code = 'en'; try { code = (await chrome.storage.sync.get('selectedLanguage')).selectedLanguage || 'en'; } catch (_) { /* default */ }
      sumLang = ttsLang(code);
      const units = speakable(streamText(html), true).map(text => ({ text, lang: sumLang }));
      if (!units.length) return false;
      active = false; lastUnits = units;
      await reader.start(units, sumLang, { meta: { tool: 'instant', lang: sumLang, id } });
      return true;
    },
    get on() { return on; },
    onMessage(msg) {
      if (!msg) return;
      setTimeout(paintButton, 0);
      // Strictly in order: begin() is async (language detection), so progress / completion wait for it.
      if (msg.action === 'summaryContext') chain = chain.then(() => begin(msg)).catch(() => {});
      else if (msg.action === 'summaryProgress' && msg.preview) chain = chain.then(() => feed(msg.preview)).catch(() => {});
      else if (msg.action === 'summaryComplete') chain = chain.then(async () => {
        if (!active && !lastUnits.length && msg.summary) {   // completed without a stream we followed (finished in the background, or very fast): keep it readable
          try { sumLang = ttsLang((await chrome.storage.sync.get('selectedLanguage')).selectedLanguage || 'en'); } catch (_) { /* keep */ }
          lastUnits = speakable(streamText(msg.summary), true).map(text => ({ text, lang: sumLang }));
          paintBar(); return;
        }
        complete(msg.summary);
      }).catch(() => {});
      else if (msg.action === 'summaryError' || msg.action === 'summaryCancelled') { chain = chain.then(() => abort()).catch(() => {}); }
    },
    abort,
    /** Follow-up answers: same stream, no title announcement. */
    async startChat(question) {
      if (!on || !ready || active) return;
      active = true; spoken = 0; lastUnits = [];
      let base = 'en'; try { base = ttsLang((await chrome.storage.sync.get('selectedLanguage')).selectedLanguage || 'en'); } catch (_) { /* default */ }
      sumLang = question ? (ttsLang((await detectLang(question)) || '') || base) : base;
      if (!active) return;
      await reader.start([], sumLang, { open: true, meta: { tool: 'instant', lang: sumLang } });
    },
    chatText(text) { feed(plain(text)); },
    chatDone(text) { complete(plain(text)); }
  };
}
