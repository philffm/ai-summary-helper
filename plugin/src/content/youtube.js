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
  if (status && status !== 'OK') throw ytError('UNAVAILABLE', String(player.playabilityStatus.reason || status));
  const tracks = player && player.captions && player.captions.playerCaptionsTracklistRenderer && player.captions.playerCaptionsTracklistRenderer.captionTracks;
  const track = pickTrack(tracks, lang);
  if (!track) throw ytError('NO_CAPTIONS', 'no caption track');
  let xml;
  try {
    const r = await fetchFn(String(track.baseUrl).replace(/&fmt=[^&]*/, ''));
    if (!r.ok) throw new Error('HTTP ' + r.status);
    xml = await r.text();
  } catch (e) { throw ytError('FETCH', 'caption download failed: ' + (e && e.message)); }
  const paras = parseTimedText(xml, deps.parse);
  if (!paras.length) throw ytError('NO_CAPTIONS', 'empty caption track');

  const details = (player && player.videoDetails) || {};
  const title = details.title || (typeof document !== 'undefined' ? document.title.replace(/\s*-\s*YouTube$/, '') : '');
  const meta = [title && `Title: ${title}`, details.author && `Channel: ${details.author}`,
    track.kind === 'asr' ? 'The transcript is auto-generated and may contain recognition errors.' : ''].filter(Boolean);
  let body = paras.join('\n\n');
  if (body.length > MAX_CHARS) body = body.slice(0, MAX_CHARS);
  const text = `YouTube video transcript\n${meta.join('\n')}\n\n${body}`;
  const html = `<article><h1>${esc(title)}</h1>${details.author ? `<p><em>${esc(details.author)}</em></p>` : ''}${paras.map(p => `<p>${esc(p)}</p>`).join('')}</article>`;
  return { html, text, title, language: track.languageCode || '' };
}

/** Message for a failed transcript read. */
export function youtubeErrorMessage(err) {
  switch (err && err.code) {
    case 'NO_CAPTIONS': return 'This video has no captions, so there is no text to summarize. Videos with subtitles or auto-generated captions work.';
    case 'UNAVAILABLE': return 'This video is not available for reading (private, age-restricted or region-locked).';
    default: return 'Could not load the video transcript. Check your connection and try again.';
  }
}
