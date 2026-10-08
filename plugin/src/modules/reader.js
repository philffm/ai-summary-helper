// Read aloud (client side): sentence units from a piece of the page, voice choice by language, and the link to the
// background speech engine (ttsEngine.js). The engine keeps going when the popup closes (Chrome).
import { langBase } from './languages.js';

const BLOCKS = 'h1, h2, h3, h4, p, li, blockquote, dd, figcaption';

/** Split a block of text into sentences no longer than `max` characters (long ones are cut at spaces). */
export function sentences(text, max = 280) {
  const out = [];
  String(text || '').replace(/\s+/g, ' ').trim().split(/(?<=[.!?。！？…])\s+/).forEach((s) => {
    let rest = s.trim();
    while (rest.length > max) {
      let cut = rest.lastIndexOf(' ', max); if (cut < max * 0.5) cut = max;
      out.push(rest.slice(0, cut).trim()); rest = rest.slice(cut).trim();
    }
    if (rest) out.push(rest);
  });
  return out;
}

/** Units to speak: one per sentence, remembering the block element it belongs to (for highlighting). */
export function speechUnits(container) {
  if (!container) return [];
  const units = [];
  const blocks = [...container.querySelectorAll(BLOCKS)].filter(el => !el.closest('#qaMount, script, style, [hidden]') && !el.querySelector(BLOCKS));
  const list = blocks.length ? blocks : [container];
  list.forEach((el) => sentences(el.textContent).forEach((text) => units.push({ text, el })));
  return units;
}

/** The "Your questions" section: its title, each question and its answer (no pin / source buttons). */
export function qaUnits(mount) {
  if (!mount) return [];
  const units = [];
  mount.querySelectorAll('.qa-title, .chat-q, .chat-a-body').forEach((el) => {
    const text = (el.textContent || '').replace(/\p{Extended_Pictographic}\uFE0F?/gu, '');
    sentences(text).forEach((t) => units.push({ text: t, el }));
  });
  return units;
}

/** Best installed voice for a language (BCP-47 or base code): the saved one, then an exact region match, then any. */
export function pickVoice(voices, lang, saved) {
  const want = String(lang || '').replace('_', '-').toLowerCase(), base = langBase(want);
  const cands = (voices || []).filter(v => langBase(String(v.lang || '').replace('_', '-')) === base);
  if (!cands.length) return null;
  const keep = saved && cands.find(v => v.name === saved); if (keep) return keep;
  const score = (v) => (String(v.lang).replace('_', '-').toLowerCase() === want ? 2 : 0) - (/compact|novelty|eloquence/i.test(v.name) ? 3 : 0) + (/premium|enhanced|natural/i.test(v.name) ? 1 : 0);
  return cands.slice().sort((a, b) => score(b) - score(a))[0];
}

/** Language of a text, detected on the device (chrome.i18n.detectLanguage); '' when unsure or unavailable. */
export function detectLang(text) {
  return new Promise((resolve) => {
    try {
      const api = (typeof browser !== 'undefined' && browser.i18n) ? browser : chrome;
      const done = (r) => { const l = r && r.languages && r.languages[0]; resolve(l && (r.isReliable !== false || l.percentage >= 60) ? langBase(l.language) : ''); };
      const p = api.i18n.detectLanguage(String(text || '').slice(0, 1500), done);
      if (p && p.then) p.then(done).catch(() => resolve(''));
    } catch (_) { resolve(''); }
  });
}

const send = (msg) => new Promise((resolve) => {
  try {
    const api = (typeof browser !== 'undefined' && browser.runtime) ? browser : chrome;
    const p = api.runtime.sendMessage({ action: 'ttsCmd', ...msg }, (r) => { void api.runtime.lastError; resolve(r || { ok: false }); });
    if (p && p.then) p.then(r => resolve(r || { ok: false })).catch(() => resolve({ ok: false }));
  } catch (_) { resolve({ ok: false }); }
});

const PREFS = 'tts:prefs';
const loadPrefs = async () => { try { return (await chrome.storage.local.get(PREFS))[PREFS] || {}; } catch (_) { return {}; } };
const savePrefs = async (p) => { try { await chrome.storage.local.set({ [PREFS]: p }); } catch (_) { /* optional */ } };

/** Client for the speech engine. `onState(cb)` fires on every change (also when the popup was closed meanwhile). */
export function createReader() {
  let caps = null, listeners = [], last = { state: 'idle', index: 0, total: 0, rate: 1 };
  const onMsg = (m) => { if (m && m.action === 'ttsState') { last = m; listeners.forEach(f => f(last)); } };
  try { chrome.runtime.onMessage.addListener(onMsg); } catch (_) { /* no runtime */ }
  return {
    get state() { return last; },
    onState(f) { listeners.push(f); return () => { listeners = listeners.filter(x => x !== f); }; },
    async init() { caps = await send({ cmd: 'caps' }); if (caps && caps.ok) last = caps; return !!(caps && caps.ok && caps.available); },
    get voices() { return (caps && caps.voices) || []; },
    prefs: loadPrefs,
    async setVoice(lang, name) { const p = await loadPrefs(); p.voices = { ...(p.voices || {}), [langBase(lang)]: name }; await savePrefs(p); },
    async setRate(rate) { const p = await loadPrefs(); p.rate = rate; await savePrefs(p); return send({ cmd: 'rate', rate }); },
    /** Speak the units; resolves with {voice} (null when no voice for the language is installed). */
    async start(units, lang, { meta, start = 0, open = false } = {}) {
      const p = await loadPrefs();
      const items = units.map(u => { const l = u.lang || lang; const v = pickVoice(this.voices, l, p.voices && p.voices[langBase(l)]); return { text: u.text, lang: l, voice: v ? v.name : '' }; });
      await send({ cmd: 'speak', items, rate: p.rate || 1, meta, start, open });
      if (p.volume >= 0 && p.volume < 1) send({ cmd: 'volume', volume: p.volume });
      return { voice: pickVoice(this.voices, lang, p.voices && p.voices[langBase(lang)]) };
    },
    /** Streaming: queue more sentences for the running session (`finish()` when the text is complete). */
    async append(units, lang) {
      const p = await loadPrefs();
      const items = units.map(u => { const l = u.lang || lang; const v = pickVoice(this.voices, l, p.voices && p.voices[langBase(l)]); return { text: u.text, lang: l, voice: v ? v.name : '' }; });
      await send({ cmd: 'append', items, rate: p.rate || 1 });
    },
    open: () => send({ cmd: 'open', open: true }), finish: () => send({ cmd: 'finish' }),
    mute: (muted) => send({ cmd: 'mute', muted }),
    async setVolume(v) { const p = await loadPrefs(); p.volume = v; await savePrefs(p); return send({ cmd: 'volume', volume: v }); },
    async setInstant(on) { const p = await loadPrefs(); p.instant = !!on; await savePrefs(p); },
    pause: () => send({ cmd: 'pause' }), resume: () => send({ cmd: 'resume' }), toggle: () => send({ cmd: 'toggle' }),
    next: () => send({ cmd: 'next' }), prev: () => send({ cmd: 'prev' }), stop: () => send({ cmd: 'stop' }),
    destroy() { try { chrome.runtime.onMessage.removeListener(onMsg); } catch (_) { /* ignore */ } listeners = []; }
  };
}

let shared = null;
/** One reader per popup (Read aloud player and Instant read share voice, speed and the engine). */
export function getReader() {
  if (!shared) { shared = createReader(); shared.ready = shared.init(); }
  return shared;
}

/** Visible text of a streaming model answer: thinking, HTML comments, tags and half-written tags removed; block ends become \n. */
export function streamText(html) {
  return String(html || '')
    .replace(/<think(?:ing)?>[\s\S]*?(?:<\/think(?:ing)?>|$)/gi, '')
    .replace(/<!--[\s\S]*?(?:-->|$)/g, '')
    .replace(/<\/(?:p|h[1-6]|li|div|blockquote|ul|ol)>|<br\s*\/?>/gi, '\n')
    .replace(/<[^>]*$/, '').replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&')
    .replace(/[ \t]+/g, ' ');
}

/** Sentences that are certainly finished (followed by more text); `all` also returns the unfinished tail. */
export function finishedSentences(text, all = false) {
  const parts = String(text || '').split(/\n+|(?<=[.!?。！？…])\s+/).map(x => x.trim());
  const done = all ? parts : parts.slice(0, -1);
  return done.filter(x => /[\p{L}\p{N}]/u.test(x)).flatMap(x => sentences(x));
}

const wordCount = (s) => { const w = s.trim().split(/\s+/).filter(Boolean).length; return w <= 1 ? Math.round(s.length / 3) : w; };
/**
 * Units for streaming speech: finished sentences, and — to start sooner — clauses cut at , ; : – once at least `minWords`
 * words are collected. Prefix-stable: more text never changes units that were already returned, so a running stream can
 * simply skip the first N. The unfinished tail is held back unless `all`.
 */
export function speakable(text, all = false, minWords = 6) {
  const parts = String(text || '').split(/\n+|(?<=[.!?。！？…])\s+/).map(x => x.trim()).filter(Boolean);
  const out = [];
  parts.forEach((part, i) => {
    const tail = i === parts.length - 1 && !all && !/[.!?。！？…]$/.test(part) ;
    if (!/[\p{L}\p{N}]/u.test(part)) return;
    const raw = part.split(/(?<=[,;:，；：、–—])\s+/);
    if (tail) raw.pop();            // the last piece may still be growing
    let buf = '';
    for (const p of raw) { buf = buf ? buf + ' ' + p : p; if (wordCount(buf) >= minWords) { out.push(...sentences(buf)); buf = ''; } }
    if (!tail && buf) out.push(...sentences(buf));
  });
  return out;
}
