// Instant read: speak the summary while the model is still writing it. Title and site are announced as soon as Fetch
// starts; then every finished sentence of the stream is queued for the voice (never half a sentence).
import { T } from './feedI18n.js';
import { getReader, streamText, finishedSentences, detectLang, pickVoice } from './reader.js';
import { ttsLang, langBase } from './languages.js';

const mk = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; };
const uiLang = () => { try { return ttsLang((typeof browser !== 'undefined' ? browser : chrome).i18n.getUILanguage()); } catch (_) { return ttsLang(document.documentElement.lang || 'en'); } };

export function initInstantRead({ chip, panel, barHost }) {
  const reader = getReader();
  let on = false, active = false, spoken = 0, sumLang = 'en', lastUnits = [], wasReading = false, ready = false, bar = null, done = false;

  const paintChip = () => {
    if (!chip) return;
    const st = reader.state;
    chip.classList.toggle('is-on', on);
    chip.classList.toggle('is-speaking', on && st.meta && st.meta.tool === 'instant' && ['playing', 'waiting'].includes(st.state));
    const ic = chip.querySelector('.chip-icon'); if (ic) ic.textContent = on ? '🔊' : '🔇';
    chip.title = T('Instant read'); chip.setAttribute('aria-label', T('Instant read') + ': ' + (on ? T('On') : T('Off')));
  };

  const paintBar = () => {
    const st = reader.state, mine = st.meta && st.meta.tool === 'instant';
    const running = mine && ['playing', 'paused', 'waiting'].includes(st.state);
    if (running) { wasReading = true; done = false; }
    else if (wasReading && !active) { wasReading = false; done = lastUnits.length > 0; }
    if (!running && !done) { if (bar) bar.hidden = true; return; }
    if (!bar) { bar = mk('div', 'sr-bar'); bar.setAttribute('role', 'group'); bar.setAttribute('aria-label', T('Instant read')); barHost.prepend(bar); }
    bar.hidden = false; bar.textContent = '';
    const b = (cls, txt, label, fn) => { const x = mk('button', 'sr-b ' + cls, txt); x.type = 'button'; x.title = label; x.setAttribute('aria-label', label); x.addEventListener('click', fn); return x; };
    if (running) {
      bar.append(b('sr-pp', st.state === 'paused' ? '▶' : '❚❚', st.state === 'paused' ? T('Play') : T('Pause'), () => reader.toggle()),
        mk('span', 'sr-t', T('Reading · sentence {n}', { n: Math.min(st.index + 1, st.total || 1) })),
        b('sr-mute' + (st.muted ? ' is-on' : ''), st.muted ? '🔇' : '🔊', st.muted ? T('Unmute') : T('Mute'), () => reader.mute()),
        b('sr-rate', String(st.rate || 1) + '×', T('Reading speed'), async () => { const steps = [1, 1.25, 1.5, 0.8]; await reader.setRate(steps[(steps.indexOf(st.rate || 1) + 1) % steps.length]); }));
    } else {
      bar.append(mk('span', 'sr-ok', '✓'), mk('span', 'sr-t', T('Finished reading')),
        b('sr-again', '▶ ' + T('Read again'), T('Read again'), () => { done = false; wasReading = true; reader.start(lastUnits, sumLang, { meta: { tool: 'instant', lang: sumLang } }); }),
        b('sr-x', '✕', T('Close'), () => { done = false; paintBar(); }));
    }
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
    active = true; spoken = 0; done = false; lastUnits = [];
    try { sumLang = ttsLang((await chrome.storage.sync.get('selectedLanguage')).selectedLanguage || 'en'); } catch (_) { sumLang = 'en'; }
    const title = ((document.getElementById('pageCard') || {}).dataset || {}).title || '';
    const ui = uiLang();
    const titleLang = title ? ((await detectLang(title)) || ui) : ui;
    const host = ctx.host || ((document.getElementById('pageCard') || {}).dataset || {}).host || '';
    const units = [];
    if (title) units.push({ text: title.replace(/\s*[|–—-]\s*[^|–—-]{0,40}$/, '') || title, lang: ttsLang(titleLang) });
    if (host) units.push({ text: T('From {site}.', { site: host.replace(/^www\./, '') }), lang: ui });
    units.push({ text: T('Writing a {n}-word summary…', { n: Number(ctx.length) || 200 }), lang: ui });
    if (!active) return;   // cancelled while we were preparing
    await reader.start(units, ui, { open: true, meta: { tool: 'instant', lang: sumLang } });
  }
  function feed(preview) {
    if (!active) return;
    const list = finishedSentences(streamText(preview));
    const more = list.slice(spoken);
    if (!more.length) return;
    spoken = list.length; lastUnits = lastUnits.concat(more.map(text => ({ text })));
    reader.append(more.map(text => ({ text, lang: sumLang })), sumLang);
  }
  function complete(summaryHtml) {
    if (!active) return;
    active = false;
    const list = finishedSentences(streamText(summaryHtml), true);
    const more = list.slice(spoken); spoken = list.length;
    lastUnits = list.map(text => ({ text, lang: sumLang }));
    if (more.length) reader.append(more.map(text => ({ text, lang: sumLang })), sumLang);
    reader.finish();
  }
  function abort() { if (!active && !wasReading) return; active = false; wasReading = false; done = false; reader.stop(); paintBar(); }

  return {
    ready: ready_,
    get on() { return on; },
    onMessage(msg) {
      if (!msg) return;
      if (msg.action === 'summaryContext') begin(msg);
      else if (msg.action === 'summaryProgress' && msg.preview) feed(msg.preview);
      else if (msg.action === 'summaryComplete') complete(msg.summary);
      else if (msg.action === 'summaryError' || msg.action === 'summaryCancelled') abort();
    },
    abort
  };
}
