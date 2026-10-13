// YouTube: video id, caption track choice, timed-text → paragraphs, and the transcript fetch (network mocked).
import { setup, imp } from './harness.mjs'; import assert from 'assert';
setup({});
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
await assert.rejects(yt.extractYoutubeTranscript({ videoId: 'jNQXAC9IVRw', deps: priv }), e => e.code === 'UNAVAILABLE');
console.log('ok');
