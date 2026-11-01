// YouTube: video id, caption track choice, timed-text → paragraphs, and the transcript fetch (network mocked).
import { setup, imp } from './harness.mjs'; import assert from 'assert';
const { w } = setup({});
const yt = await imp('content/youtube.js');

assert.equal(yt.youtubeVideoId('https://www.youtube.com/watch?v=jNQXAC9IVRw&t=3s'), 'jNQXAC9IVRw');
assert.equal(yt.youtubeVideoId('https://youtu.be/jNQXAC9IVRw'), 'jNQXAC9IVRw');
assert.equal(yt.youtubeVideoId('https://m.youtube.com/shorts/jNQXAC9IVRw'), 'jNQXAC9IVRw');
assert.equal(yt.youtubeVideoId('https://www.youtube.com/'), '');
assert.equal(yt.youtubeVideoId('https://www.youtube.com/results?search_query=x'), '');
assert.equal(yt.youtubeVideoId('https://example.com/watch?v=jNQXAC9IVRw'), '');

const tracks = [{ languageCode: 'en', kind: 'asr', baseUrl: 'a' }, { languageCode: 'fr', baseUrl: 'b' }, { languageCode: 'de', baseUrl: 'c' }];
assert.equal(yt.pickTrack(tracks, 'de').baseUrl, 'c', 'manual track in the page language');
assert.equal(yt.pickTrack(tracks, 'en').baseUrl, 'b', 'a manual track beats auto-generated');
assert.equal(yt.pickTrack([tracks[0]], 'de').baseUrl, 'a');
assert.equal(yt.pickTrack([], 'en'), null);

const xml = '<?xml version="1.0"?><timedtext format="3"><body><p t="0" d="2000">All right,\nso here</p><p t="2100" d="1000">we are &amp; happy that&amp;#39;s</p><p t="9000" d="1000">New thought.</p></body></timedtext>';
const paras = yt.parseTimedText(xml);
assert.deepEqual(paras, ["All right, so here we are & happy that's", 'New thought.']);

const calls = [];
const deps = { apiKey: 'k', fetch: async (url, opt) => {
    calls.push(url);
    if (url.includes('/youtubei/v1/player')) return { ok: true, json: async () => ({ playabilityStatus: { status: 'OK' }, videoDetails: { title: 'Me at the zoo', author: 'jawed' },
        captions: { playerCaptionsTracklistRenderer: { captionTracks: [{ languageCode: 'en', kind: 'asr', baseUrl: 'https://www.youtube.com/api/timedtext?v=x&fmt=srv3' }] } } }) };
    return { ok: true, text: async () => xml };
} };
const r = await yt.extractYoutubeTranscript({ videoId: 'jNQXAC9IVRw', deps });
assert.ok(r.text.startsWith('YouTube video transcript\nTitle: Me at the zoo\nChannel: jawed'));
assert.ok(r.text.includes('auto-generated') && r.text.includes('New thought.'));
assert.ok(r.html.includes('<h1>Me at the zoo</h1>'));
assert.ok(!calls[1].includes('fmt='), 'caption url requested as plain timed text');

const none = { ...deps, fetch: async () => ({ ok: true, json: async () => ({ playabilityStatus: { status: 'OK' }, captions: {} }) }) };
await assert.rejects(yt.extractYoutubeTranscript({ videoId: 'jNQXAC9IVRw', deps: none }), e => e.code === 'NO_CAPTIONS');
const priv = { ...deps, fetch: async () => ({ ok: true, json: async () => ({ playabilityStatus: { status: 'LOGIN_REQUIRED', reason: 'Private video' } }) }) };
await assert.rejects(yt.extractYoutubeTranscript({ videoId: 'jNQXAC9IVRw', deps: priv }), e => e.code === 'LOGIN', 'a sign-in wall is its own case');
const gone = { ...deps, fetch: async () => ({ ok: true, json: async () => ({ playabilityStatus: { status: 'UNPLAYABLE', reason: 'Video unavailable' } }) }) };
await assert.rejects(yt.extractYoutubeTranscript({ videoId: 'jNQXAC9IVRw', deps: gone }), e => e.code === 'UNAVAILABLE');
assert.match(yt.youtubeErrorMessage({ code: 'LOGIN' }), /age-restricted.*Show transcript/s);

// the page's own transcript panel: what an age-restricted video falls back to (the endpoint cannot sign in)
const panel = (segments, { open = true, withButton = true } = {}) => {
    const d = new w.DOMParser().parseFromString('<html><head><title>Dominion (2018) - full documentary [Official] - YouTube</title></head><body></body></html>', 'text/html');
    const add = (html) => { const t = d.createElement('div'); t.innerHTML = html; while (t.firstChild) d.body.appendChild(t.firstChild); };
    add('<div id="owner"><ytd-video-owner-renderer><div id="channel-name"><a>Dominion Movement</a></div></ytd-video-owner-renderer></div>');
    const rows = segments.map(([ts, text]) => `<transcript-segment-view-model class="ytwTranscriptSegmentViewModelHost"><div class="ytwTranscriptSegmentViewModelTimestamp">${ts}</div><div class="ytwTranscriptSegmentViewModelTimestampA11yLabel">x Sekunden</div><span class="ytAttributedStringHost" role="text">${text}</span></transcript-segment-view-model>`).join('');
    if (open) add(`<div id="panel">${rows}</div>`);
    if (withButton) {
        add('<div id="description-inline-expander"><div id="expand">more</div></div><ytd-video-description-transcript-section-renderer><button id="show">Show transcript</button></ytd-video-description-transcript-section-renderer>');
        d.getElementById('show').addEventListener('click', () => add(`<div id="panel">${rows}</div>`));   // the panel appears when the button is pressed
    }
    return d;
};
const segs = [['0:07', 'Von Tieren, die wir als seelenlos verachten,'], ['0:13', 'ersteigt von Wald, Feld und Höhle.'], ['1:02:05', 'Ein letzter Satz?']];
const fast = { sleep: async () => {}, timeoutMs: 50 };
assert.deepEqual(yt.readTranscriptSegments(panel(segs)).map((x) => [x.t, x.text]), [[7, segs[0][1]], [13, segs[1][1]], [3725, segs[2][1]]], 'timestamps in seconds, text without the label');
assert.deepEqual(yt.segmentsToParagraphs(segs.map(([, text]) => ({ text }))), [segs.map((x) => x[1]).join(' ')], 'short transcripts stay one paragraph');
const long = Array.from({ length: 60 }, (_, i) => ({ text: 'Dies ist Satz Nummer ' + i + ' des Films.' }));
const longParas = yt.segmentsToParagraphs(long); assert.ok(longParas.length > 1 && longParas.every((p) => p.length < 600) && longParas.slice(0, -1).every((p) => /\.$/.test(p)), 'long ones split at sentence ends');
assert.deepEqual(await yt.readTranscriptFromPage({ doc: panel(segs, { open: false, withButton: false }), ...fast }), [], 'no panel and no button: nothing');
const opened = await yt.readTranscriptFromPage({ doc: panel(segs, { open: false }), ...fast });
assert.equal(opened.length, 1); assert.ok(opened[0].includes('Wald, Feld und Höhle'), 'pressing Show transcript opens it and reads it');
// the whole path: the endpoint says sign in, the page panel answers
const walled = { ...deps, fetch: async () => ({ ok: true, json: async () => ({ playabilityStatus: { status: 'LOGIN_REQUIRED', reason: 'This video may be inappropriate for some users.' } }) }), doc: panel(segs, { open: false }), ...fast };
const viaPage = await yt.extractYoutubeTranscript({ videoId: 'LQRAfJyEsko', deps: walled });
assert.ok(viaPage.text.startsWith('YouTube video transcript\nTitle: Dominion (2018) - full documentary [Official]\nChannel: Dominion Movement')); assert.ok(viaPage.html.includes('Höhle'));
// no transcript on the page either: the sign-in message stays
await assert.rejects(yt.extractYoutubeTranscript({ videoId: 'LQRAfJyEsko', deps: { ...walled, doc: panel(segs, { open: false, withButton: false }) } }), e => e.code === 'LOGIN');
// captions that come back empty (the proof-of-origin token case) also fall back to the panel
const empty = { ...deps, fetch: async (url) => (url.includes('/youtubei/v1/player') ? { ok: true, json: async () => ({ playabilityStatus: { status: 'OK' }, captions: { playerCaptionsTracklistRenderer: { captionTracks: [{ languageCode: 'en', baseUrl: 'https://www.youtube.com/api/timedtext?v=x' }] } } }) } : { ok: true, text: async () => '' }), doc: panel(segs, { open: false }), ...fast };
assert.ok((await yt.extractYoutubeTranscript({ videoId: 'jNQXAC9IVRw', deps: empty })).text.includes('Höhle'));
console.log('ok');
