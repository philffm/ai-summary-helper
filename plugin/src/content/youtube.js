// youtube.js — summarize a YouTube video from its captions. A watch page has almost no article text, so the transcript
// is fetched the way the player does: the innertube "player" endpoint (Android client, whose caption URLs need no
// proof-of-origin token) lists the caption tracks, the chosen track is downloaded as timed text and joined into prose.
// The return shape ({ html, text }) matches getAllTextContent(), so everything downstream keeps working unchanged.

const FALLBACK_KEY = 'AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8';   // the public web-player key, used only when the page does not expose its own
const ANDROID = { clientName: 'ANDROID', clientVersion: '20.10.38' };
const MAX_CHARS = 120000;

const esc = (t) => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
function ytError(code, message) { const e = new Error(message); e.code = code; return e; }

/** Video id of a watch / shorts / embed / youtu.be URL, '' for anything else (home, search, channel, playlist). */
export function youtubeVideoId(href) {
  let u; try { u = new URL(href); } catch (_) { return ''; }
  const host = u.hostname.replace(/^(www|m|music)\./, '');
  let id = '';
  if (host === 'youtube.com') {
    if (u.pathname === '/watch') id = u.searchParams.get('v') || '';
    else { const m = /^\/(?:shorts|embed|live)\/([\w-]{11})/.exec(u.pathname); id = m ? m[1] : ''; }
  } else if (host === 'youtu.be') id = u.pathname.slice(1, 12);
  return /^[\w-]{11}$/.test(id) ? id : '';
}

export function isYoutubeWatchPage(href = (typeof location !== 'undefined' ? location.href : '')) { return !!youtubeVideoId(href); }

/** Prefers a hand-written track over an auto-generated one (kind "asr"); within a group the page language, then the first. */
export function pickTrack(tracks, preferred = '') {
  const list = (Array.isArray(tracks) ? tracks : []).filter(t => t && t.baseUrl);
  const rank = (t) => (t.kind === 'asr' ? 2 : 0) + (preferred && String(t.languageCode || '').split('-')[0] === preferred ? 0 : 1);
  return list.slice().sort((a, b) => rank(a) - rank(b))[0] || null;
}

// YouTube escapes the caption text twice ("that&amp;#39;s"), so after the XML parse the entities are still there.
const unescapeEntities = (t) => t.replace(/&#(\d+);/g, (m, n) => String.fromCodePoint(Number(n)))
  .replace(/&#x([0-9a-f]+);/gi, (m, n) => String.fromCodePoint(parseInt(n, 16)))
  .replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

/** Timed-text XML (format 3: <p t d>…</p>, or the older <text start dur>) → paragraphs. A pause of 2.5 s or more starts a new one. */
export function parseTimedText(xml, parse = (s) => new DOMParser().parseFromString(s, 'text/xml')) {
  const doc = parse(String(xml || ''));
  const nodes = [...doc.querySelectorAll('p, text')];
  const paras = []; let cur = [], lastEnd = -1;
  for (const n of nodes) {
    const t = n.hasAttribute('t') ? Number(n.getAttribute('t')) : Number(n.getAttribute('start')) * 1000;
    const d = n.hasAttribute('d') ? Number(n.getAttribute('d')) : Number(n.getAttribute('dur')) * 1000;
    const text = unescapeEntities((n.textContent || '').replace(/\s+/g, ' ')).trim();
    if (!text) continue;
    if (cur.length && lastEnd >= 0 && t - lastEnd > 2500) { paras.push(cur.join(' ')); cur = []; }
    cur.push(text); lastEnd = t + (d || 0);
  }
  if (cur.length) paras.push(cur.join(' '));
  return paras;
}

// ── the page's own transcript panel ──────────────────────────────────────────────────────────────────────────────────
// Age-restricted and sign-in-only videos are refused by the player endpoint above (it cannot sign in), and the caption addresses of a normal page
// answer with nothing without the player's proof-of-origin token. The transcript panel of the watch page itself is neither: it works for the
// signed-in person who is looking at the video, so the panel is opened and read (what "Show transcript" shows).
const parseClock = (t) => { const p = String(t || '').trim().split(':').map(Number); return p.length && p.every((n) => Number.isFinite(n)) ? p.reduce((a, v) => a * 60 + v, 0) : -1; };

/** The segments the panel shows, as { t: seconds, text }. Handles the current panel (<transcript-segment-view-model>) and the older one. */
export function readTranscriptSegments(doc = document) {
  const out = [];
  for (const n of doc.querySelectorAll('transcript-segment-view-model, ytd-transcript-segment-renderer')) {
    const el = n.querySelector('span[role="text"], .segment-text, yt-formatted-string.segment-text');
    const text = String(el ? el.textContent : '').replace(/\s+/g, ' ').trim();
    if (!text) continue;
    const ts = n.querySelector('.ytwTranscriptSegmentViewModelTimestamp, .segment-timestamp');
    out.push({ t: parseClock(ts && ts.textContent), text });
  }
  return out;
}

/** Segments are a few seconds long: join them into paragraphs, ending one at a sentence end once it is long enough (or at any point when it gets very long). */
export function segmentsToParagraphs(segs, { soft = 500, hard = 900 } = {}) {
  const paras = []; let cur = '';
  for (const { text } of segs) {
    cur = cur ? cur + ' ' + text : text;
    if ((cur.length >= soft && /[.!?…。！？]["'”’)\]]*$/.test(cur)) || cur.length >= hard) { paras.push(cur); cur = ''; }
  }
  if (cur) paras.push(cur);
  return paras;
}

/** Opens "Show transcript" when the panel is not open yet, waits for the segments and returns their paragraphs ([] when the video has no transcript panel). */
export async function readTranscriptFromPage({ doc = (typeof document !== 'undefined' ? document : null), sleep = (ms) => new Promise((r) => setTimeout(r, ms)), timeoutMs = 8000 } = {}) {
  if (!doc) return [];
  let segs = readTranscriptSegments(doc);
  if (!segs.length) {
    const expand = doc.querySelector('#description-inline-expander #expand, #expand');
    if (expand) { try { expand.click(); } catch (_) { /* the button is optional */ } await sleep(300); }
    const btn = doc.querySelector('ytd-video-description-transcript-section-renderer button')
      || [...doc.querySelectorAll('button')].find((b) => /transcript|transkript|transcripci|transcription|transcri/i.test(b.getAttribute('aria-label') || ''));
    if (!btn) return [];
    btn.click();
    for (const t0 = Date.now(); Date.now() - t0 < timeoutMs;) {
      await sleep(300); segs = readTranscriptSegments(doc);
      if (segs.length) { await sleep(400); segs = readTranscriptSegments(doc); break; }   // let the list finish filling
    }
  }
  return segmentsToParagraphs(segs);
}

function apiKeyFromPage() {
  try { for (const s of document.scripts) { const m = /"INNERTUBE_API_KEY":"([^"]+)"/.exec(s.textContent || ''); if (m) return m[1]; } } catch (_) { /* default key */ }
  return FALLBACK_KEY;
}

/**
 * Fetches and joins the transcript. `lang` = preferred caption language (base code), `deps` is for tests.
 * Throws an Error with .code: 'NO_CAPTIONS' | 'UNAVAILABLE' | 'FETCH'.
 */
export async function extractYoutubeTranscript({ lang = '', videoId = youtubeVideoId(location.href), deps = {} } = {}) {
  const fetchFn = deps.fetch || fetch.bind(globalThis);
  // The page's own transcript panel, for when the endpoint refuses the video or its captions come back empty. Only for the video that is on screen.
  const fromPage = async () => {
    const doc = deps.doc || (typeof document !== 'undefined' ? document : null);
    if (!doc || (!deps.doc && (typeof location === 'undefined' || videoId !== youtubeVideoId(location.href)))) return null;
    let paras = [];
    try { paras = await readTranscriptFromPage({ doc, sleep: deps.sleep, timeoutMs: deps.timeoutMs }); } catch (_) { /* reported as no captions below */ }
    if (!paras.length) return null;
    const author = (doc.querySelector('ytd-video-owner-renderer #channel-name a, #owner #channel-name a') || {}).textContent;
    return transcriptResult(paras, { title: String(doc.title || '').replace(/\s*-\s*YouTube$/, ''), author: String(author || '').trim(), language: '' });
  };
  const key = deps.apiKey || apiKeyFromPage();
  let player;
  try {
    const r = await fetchFn(`https://www.youtube.com/youtubei/v1/player?key=${encodeURIComponent(key)}&prettyPrint=false`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ context: { client: { ...ANDROID, hl: 'en' } }, videoId })
    });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    player = await r.json();
  } catch (e) { throw ytError('FETCH', 'player request failed: ' + (e && e.message)); }
  const status = player && player.playabilityStatus && player.playabilityStatus.status;
  if (status && status !== 'OK') {
    const page = await fromPage();
    if (page) return page;
    throw ytError(status === 'LOGIN_REQUIRED' ? 'LOGIN' : 'UNAVAILABLE', String(player.playabilityStatus.reason || status));
  }
  const tracks = player && player.captions && player.captions.playerCaptionsTracklistRenderer && player.captions.playerCaptionsTracklistRenderer.captionTracks;
  const track = pickTrack(tracks, lang);
  if (!track) throw ytError('NO_CAPTIONS', 'no caption track');
  let xml;
  try {
    const r = await fetchFn(String(track.baseUrl).replace(/&fmt=[^&]*/, ''));
    if (!r.ok) throw new Error('HTTP ' + r.status);
    xml = await r.text();
  } catch (e) { const page = await fromPage(); if (page) return page; throw ytError('FETCH', 'caption download failed: ' + (e && e.message)); }
  const paras = parseTimedText(xml, deps.parse);
  if (!paras.length) { const page = await fromPage(); if (page) return page; throw ytError('NO_CAPTIONS', 'empty caption track'); }

  const details = (player && player.videoDetails) || {};
  const title = details.title || (typeof document !== 'undefined' ? document.title.replace(/\s*-\s*YouTube$/, '') : '');
  return transcriptResult(paras, { title, author: details.author, asr: track.kind === 'asr', language: track.languageCode || '' });
}

function transcriptResult(paras, { title, author, asr = false, language = '' }) {
  const meta = [title && `Title: ${title}`, author && `Channel: ${author}`,
    asr ? 'The transcript is auto-generated and may contain recognition errors.' : ''].filter(Boolean);
  let body = paras.join('\n\n');
  if (body.length > MAX_CHARS) body = body.slice(0, MAX_CHARS);
  const text = `YouTube video transcript\n${meta.join('\n')}\n\n${body}`;
  const html = `<article><h1>${esc(title)}</h1>${author ? `<p><em>${esc(author)}</em></p>` : ''}${paras.map(p => `<p>${esc(p)}</p>`).join('')}</article>`;
  return { html, text, title, language };
}

/** Message for a failed transcript read. */
export function youtubeErrorMessage(err) {
  switch (err && err.code) {
    case 'NO_CAPTIONS': return 'This video has no captions, so there is no text to summarize. Videos with subtitles or auto-generated captions work.';
    case 'LOGIN': return 'This video needs a signed-in YouTube account (it is age-restricted). Sign in to YouTube in this browser and check that the video has a transcript (“Show transcript” under the description), then try again.';
    case 'UNAVAILABLE': return 'This video is not available for reading (private, age-restricted or region-locked).';
    default: return 'Could not load the video transcript. Check your connection and try again.';
  }
}
