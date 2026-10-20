// Instant read: speak the summary while the model is still writing it. Title and site are announced as soon as Fetch
// starts; then every finished sentence of the stream is queued for the voice (never half a sentence).
import { T } from './feedI18n.js';
import { setIcon } from './icons.js';
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

export function initInstantRead({ chip, barHost, button, fallback }) {
  const reader = getReader();
  let chatReady = Promise.resolve(), chain = Promise.resolve(), on = false, active = false, spoken = 0, sumLang = 'en', lastUnits = [], wasReading = false, ready = false, bar = null;

  const paintChip = () => {
    if (!chip) return;
    const st = reader.state;
    chip.classList.toggle('is-on', on);
    chip.classList.toggle('is-speaking', on && st.meta && st.meta.tool === 'instant' && ['playing', 'waiting'].includes(st.state));
    const ic = chip.querySelector('.chip-icon'); if (ic) setIcon(ic, on ? 'volume-2' : 'volume-x');
    chip.title = T('Instant read') + ': ' + (on ? T('On') : T('Off')); chip.setAttribute('aria-label', chip.title); chip.setAttribute('aria-pressed', String(on));
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

  // The bar appears once speech starts: pause/play, mute, volume, speed. It is built once and updated in place, so a
  // slider being dragged survives the state changes that arrive every sentence.
  let parts = null;
  const STEPS = [1, 1.25, 1.5, 0.8];
  const buildBar = () => {
    const x = mk('div', 'sr-bar'); x.setAttribute('role', 'group'); x.setAttribute('aria-label', T('Instant read'));
    const btn = (cls, fn) => { const e = mk('button', 'sr-b ' + cls); e.type = 'button'; e.addEventListener('click', fn); return e; };
    const pp = btn('sr-pp', () => reader.toggle());
    const t = mk('span', 'sr-t');
    const mute = btn('sr-mute', () => reader.mute());
    const vol = mk('input', 'sr-vol'); vol.type = 'range'; vol.min = '0'; vol.max = '100'; vol.setAttribute('aria-label', T('Volume'));
    // The track fill is drawn from --range-progress (see the slider rules in styles.css) — without it the bar stays half full.
    const fill = () => vol.style.setProperty('--range-progress', vol.value + '%');
    vol.value = '100'; fill();
    vol.addEventListener('input', fill);
    vol.addEventListener('change', () => reader.setVolume(Number(vol.value) / 100));
    reader.prefs().then((p) => { vol.value = String(Math.round((p.volume >= 0 ? p.volume : 1) * 100)); fill(); }).catch(() => {});
    const rate = btn('sr-rate', async () => { const cur = reader.state.rate || 1; await reader.setRate(STEPS[(STEPS.indexOf(cur) + 1) % STEPS.length]); });
    rate.title = T('Reading speed'); rate.setAttribute('aria-label', T('Reading speed'));
    x.append(pp, t, mute, vol, rate);
    return { bar: x, pp, t, mute, vol, rate };
  };
  const paintBar = () => {
    paintButton();
    const st = reader.state, mine = st.meta && st.meta.tool === 'instant';
    const running = mine && ['playing', 'paused', 'waiting'].includes(st.state);
    if (running) wasReading = true;
    // The bar shows only while reading; "finished / read again" lives in the summary card's Read again button.
    if (!running) { if (bar) bar.hidden = true; return; }
    if (!parts || !bar || !bar.isConnected) {
      if (!barHost) return;
      parts = buildBar(); bar = parts.bar; barHost.prepend(bar);
    }
    bar.hidden = false;
    const paused = st.state === 'paused';
    parts.pp.textContent = paused ? '▶' : '❚❚'; parts.pp.title = paused ? T('Play') : T('Pause'); parts.pp.setAttribute('aria-label', parts.pp.title);
    parts.t.textContent = T('Reading · sentence {n}', { n: Math.min(st.index + 1, st.total || 1) });
    parts.mute.textContent = st.muted ? '🔇' : '🔊'; parts.mute.classList.toggle('is-on', !!st.muted);
    parts.mute.title = st.muted ? T('Unmute') : T('Mute'); parts.mute.setAttribute('aria-label', parts.mute.title);
    parts.rate.textContent = String(st.rate || 1) + '×';
  };
  reader.onState(() => { paintChip(); paintBar(); });

  // One tap on the toolbar icon switches instant read on or off; the controls appear once speech starts.
  const ready_ = reader.ready.then(async (ok) => {
    ready = ok;
    paintButton();
    if (!ok) { if (chip) chip.hidden = true; return; }
    on = !!(await reader.prefs()).instant; paintChip();
    if (chip) chip.addEventListener('click', async () => {
      on = !on; await reader.setInstant(on);
      if (!on) { reader.stop(); } paintChip();
    });
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
    /** Follow-up answers: same stream, no title announcement. `heard`: the start of the answer, already read out earlier (Dig deeper). */
    startChat(question, { heard = '' } = {}) {
      if (!on || !ready || active) return Promise.resolve();
      active = true; spoken = heard ? speakable(streamText(plain(heard)), true).length : 0; lastUnits = [];
      // Text that arrives while the voice is still being prepared (language detection, opening the reading session) waits for it
      // instead of racing it: chatText()/chatDone() run after this promise.
      chatReady = (async () => {
        let base = 'en'; try { base = ttsLang((await chrome.storage.sync.get('selectedLanguage')).selectedLanguage || 'en'); } catch (_) { /* default */ }
        sumLang = question ? (ttsLang((await detectLang(question)) || '') || base) : base;
        if (!active) return;
        await reader.start([], sumLang, { open: true, meta: { tool: 'instant', lang: sumLang } });
      })().catch(() => {});
      return chatReady;
    },
    chatText(text) { const p = plain(text); chatReady = chatReady.then(() => feed(p)); },
    chatDone(text) { const p = plain(text); chatReady = chatReady.then(() => complete(p)); }
  };
}
