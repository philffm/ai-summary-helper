// modules/rsvp.js — speed reading (RSVP): the words of a summary in reading order, how long each stays on screen and where
// the eye anchors. Pure, no DOM. Same rules as the Android app (mobile/android/…/Rsvp.kt) so both read alike.
// Names start with `rsvp` (the content-script bundle shares one scope).

export const RSVP_MIN_WPM = 150;
export const RSVP_MAX_WPM = 600;          // above ~400 WPM comprehension drops (Di Nocera et al. 2018); the app stops at 600
export const RSVP_DEFAULT_WPM = 300;
export const RSVP_STEP_WPM = 25;
const RSVP_RAMP_WORDS = 10;              // the first words come a little slower (70 %), the eye settles in

export const rsvpClampWpm = (w) => Math.max(RSVP_MIN_WPM, Math.min(RSVP_MAX_WPM, Math.round(Number(w) || RSVP_DEFAULT_WPM)));

/**
 * Plain text blocks → sentences → words. `blocks` is [{ text, heading }] in reading order (headings and paragraphs).
 * Returns { words: [{ w, s }], sentences: [{ text, p, first, last, heading }], paragraphs: [[sentenceIndex]] }.
 */
export function rsvpBuild(blocks) {
  const words = [], sentences = [], paragraphs = [];
  (blocks || []).forEach((b) => {
    const text = String((b && b.text) || '').replace(/\s+/g, ' ').trim();
    if (!text) return;
    const parts = b.heading ? [text] : text.split(/(?<=[.!?…])\s+(?=[\p{Lu}\p{N}"„“‚(\[])/u);
    const p = paragraphs.length, inPara = [];
    for (const part of parts) {
      const ws = part.split(' ').filter(Boolean);
      if (!ws.length) continue;
      const s = sentences.length;
      sentences.push({ text: part, p, first: words.length, last: words.length + ws.length - 1, heading: !!b.heading });
      ws.forEach((w) => words.push({ w, s }));
      inPara.push(s);
    }
    if (inPara.length) paragraphs.push(inPara);
  });
  return { words, sentences, paragraphs };
}

/** Group words into chunks of up to `size` (1 = one word). A chunk never crosses a sentence and stays short. */
export function rsvpChunks(words, size = 1) {
  if (size <= 1) return words.map((x, i) => ({ text: x.w, s: x.s, from: i, to: i }));
  const out = [];
  for (let i = 0; i < words.length;) {
    let to = i, text = words[i].w;
    while (to + 1 < words.length && to - i + 1 < size && words[to + 1].s === words[i].s
      && !/[.!?…,;:—–]["”’)]*$/.test(words[to].w) && (text + ' ' + words[to + 1].w).length <= 18) {
      to++; text += ' ' + words[to].w;
    }
    out.push({ text, s: words[i].s, from: i, to });
    i = to + 1;
  }
  return out;
}

/** How long a chunk stays on screen: base pace, longer after punctuation, for long words and at the end of a heading. */
export function rsvpDelayMs(chunk, wpm, { index = 0, heading = false } = {}) {
  const words = String(chunk).split(' ').filter(Boolean);
  const last = (words[words.length - 1] || '').replace(/["”'’)\]]+$/, '');
  let base = (60000 / rsvpClampWpm(wpm)) * Math.max(1, words.length);
  if (index < RSVP_RAMP_WORDS) base /= 0.7;
  const longest = Math.max(0, ...words.map((w) => w.length));
  const factor = heading ? 2.5
    : /[.!?…]$/.test(last) ? 2
      : /[,;:—–]$/.test(last) ? 1.5
        : longest > 12 ? 1.5
          : longest > 8 ? 1.2 : 1;
  return Math.max(30, Math.round(base * factor));
}

/** Index of the letter the eye anchors on ("optimal recognition point"): about a third into the word, after leading punctuation. */
export function rsvpPivot(word) {
  const w = String(word || '');
  let lead = w.search(/[\p{L}\p{N}]/u);
  if (lead < 0) lead = 0;
  const m = w.slice(lead).match(/^[\p{L}\p{N}'’-]*/u);
  const letters = m ? m[0].length : 0;
  const p = letters <= 1 ? 0 : letters <= 5 ? 1 : letters <= 9 ? 2 : letters <= 13 ? 3 : 4;
  return lead + Math.min(p, Math.max(0, w.length - lead - 1));
}

/** Seconds left from chunk `at` to the end at this pace (rough: the base pace plus the punctuation pauses). */
export function rsvpSecondsLeft(chunks, at, wpm, sentences = []) {
  let ms = 0;
  for (let i = Math.max(0, at); i < chunks.length; i++) ms += rsvpDelayMs(chunks[i].text, wpm, { index: i, heading: !!(sentences[chunks[i].s] || {}).heading });
  return Math.round(ms / 1000);
}

/** First chunk of the sentence that holds chunk `at`, moved by `delta` sentences (−1 = the sentence before). */
export function rsvpSentenceStart(chunks, at, delta = 0) {
  if (!chunks.length) return 0;
  const cur = chunks[Math.max(0, Math.min(at, chunks.length - 1))].s;
  let target = cur + delta;
  const maxS = chunks[chunks.length - 1].s;
  target = Math.max(0, Math.min(maxS, target));
  // going back from the middle of a sentence first goes to its start
  if (delta < 0) {
    const startOfCur = chunks.findIndex((c) => c.s === cur);
    if (at > startOfCur + 1) target = cur;
  }
  const i = chunks.findIndex((c) => c.s >= target);
  return i < 0 ? chunks.length - 1 : i;
}
