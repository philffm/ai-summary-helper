/**
 * feedPlayer.js — podcast mini-player for the Feeds screen.
 *
 * Playback is hosted outside the popup when possible (offscreen document in
 * Chrome, background page in Firefox/Safari) so it keeps going when the popup
 * closes. Otherwise it falls back to an engine inside the popup.
 */
import { SK } from './storageKeys.js';
import { T } from './feedI18n.js';
const POS_KEY = SK.feedAudioPos;
const RATES = [1, 1.25, 1.5, 2, 0.75];

let backend = null;            // 'bg' | 'local'
let local = null;              // fallback engine
let st = null;                 // last known state
let timer = null;
let tick = 0;
let positions = {};
let onChange = () => {};
let $ = {};

const fmt = (t) => {
    t = Math.max(0, Math.floor(t || 0));
    const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), s = t % 60;
    return (h ? h + ':' + String(m).padStart(2, '0') : m) + ':' + String(s).padStart(2, '0');
};
export function formatDuration(sec) { return sec ? fmt(sec) : ''; }

function send(cmd) {
    if (backend === 'local') return Promise.resolve(local.handle(cmd));
    return new Promise((resolve) => {
        chrome.runtime.sendMessage({ action: 'audioCmd', ...cmd }, (res) => {
            if (chrome.runtime.lastError || !res) return resolve(null);
            resolve(res);
        });
    });
}

async function ensureBackend() {
    if (backend) return;
    const res = await new Promise((resolve) => {
        try {
            chrome.runtime.sendMessage({ action: 'audioEnsure' }, (r) => resolve(chrome.runtime.lastError ? null : r));
        } catch (e) { resolve(null); }
    });
    if (res && res.ok) backend = 'bg';
    if (backend === 'bg') {
        // verify something is actually listening
        const probe = await send({ cmd: 'state' });
        if (!probe) backend = null;
    }
    if (!backend) {
        if (typeof AishAudio === 'undefined') throw new Error(T('Audio playback is not available here'));
        local = AishAudio.create();
        backend = 'local';
    }
}

function paint() {
    if (!$.bar) return;
    const cur = st && st.cur;
    $.bar.hidden = !cur;
    if (!cur) return;
    $.title.textContent = cur.title || T('Episode');
    $.title.title = cur.title || '';
    $.source.textContent = cur.source || '';
    if (cur.cover) { if ($.cover.dataset.src !== cur.cover) { $.cover.dataset.src = cur.cover; $.cover.src = cur.cover; } $.cover.hidden = false; $.coverWrap.classList.remove('no-cover'); }
    else { $.cover.hidden = true; $.coverWrap.classList.add('no-cover'); }
    $.toggle.dataset.state = st.playing ? 'playing' : 'paused';
    $.toggle.setAttribute('aria-label', st.playing ? T('Pause') : T('Play'));
    $.seek.max = String(Math.max(1, Math.floor(st.duration || cur.dur || 1)));
    if (!$.seek.matches(':active')) $.seek.value = String(Math.floor(st.time));
    const total = st.duration || cur.dur || 0;
    $.time.textContent = fmt(st.time);
    $.left.textContent = total ? '-' + fmt(Math.max(0, total - st.time)) : '--:--';
    $.seek.style.setProperty('--p', total ? Math.min(100, st.time / total * 100) + '%' : '0%');
    $.rate.textContent = (st.rate || 1) + '×';
    $.err.textContent = st.error || (backend === 'local' ? T('Plays only while this window is open') : '');
    $.err.hidden = !$.err.textContent;
}

async function poll() {
    const s = await send({ cmd: 'state' });
    if (s) {
        st = s;
        if (s.cur && s.time > 3 && !s.ended && ++tick % 5 === 0) {
            positions[s.cur.id] = Math.floor(s.time);
            chrome.storage.local.set({ [POS_KEY]: positions }).catch(() => {});
        }
        if (s.ended && s.cur) { delete positions[s.cur.id]; chrome.storage.local.set({ [POS_KEY]: positions }).catch(() => {}); }
    }
    paint();
    onChange(st);
    if (!st || !st.cur) stopPolling();
}
function startPolling() { if (!timer) timer = setInterval(poll, 1000); }
function stopPolling() { if (timer) { clearInterval(timer); timer = null; } }

async function run(cmd) {
    const s = await send(cmd);
    if (s) { st = s; paint(); onChange(st); }
}

export function isPlaying(id) { return !!(st && st.cur && st.cur.id === id && st.playing); }

export async function play(item, sourceName, cover) {
    await ensureBackend();
    if (st && st.cur && st.cur.id === item.id) { await run({ cmd: 'toggle' }); startPolling(); return; }
    await run({
        cmd: 'load', src: item.audio, start: positions[item.id] || 0,
        meta: { id: item.id, title: item.title, source: sourceName || '', dur: item.dur || 0, cover: cover || '' }
    });
    startPolling();
}

export async function initPlayer(changeCb) {
    onChange = changeCb || (() => {});
    $ = {
        bar: document.getElementById('feedPlayer'), title: document.getElementById('fpTitle'),
        toggle: document.getElementById('fpToggle'), back: document.getElementById('fpBack'),
        fwd: document.getElementById('fpFwd'), seek: document.getElementById('fpSeek'),
        time: document.getElementById('fpTime'), left: document.getElementById('fpLeft'), source: document.getElementById('fpSource'), cover: document.getElementById('fpCover'), coverWrap: document.getElementById('fpCoverWrap'), rate: document.getElementById('fpRate'),
        close: document.getElementById('fpClose'), err: document.getElementById('fpErr')
    };
    try { positions = (await chrome.storage.local.get(POS_KEY))[POS_KEY] || {}; } catch (e) { positions = {}; }
    if (!$.bar) return;
    $.toggle.addEventListener('click', () => run({ cmd: 'toggle' }).then(startPolling));
    $.back.addEventListener('click', () => run({ cmd: 'skip', delta: -15 }));
    $.fwd.addEventListener('click', () => run({ cmd: 'skip', delta: 30 }));
    $.cover.addEventListener('error', () => { $.cover.hidden = true; $.coverWrap.classList.add('no-cover'); });
    $.seek.addEventListener('input', () => { $.time.textContent = fmt($.seek.value); $.seek.style.setProperty('--p', (Number($.seek.value) / Number($.seek.max) * 100) + '%'); });
    $.seek.addEventListener('change', () => run({ cmd: 'seek', time: Number($.seek.value) }));
    $.rate.addEventListener('click', () => {
        const i = RATES.indexOf((st && st.rate) || 1);
        run({ cmd: 'rate', rate: RATES[(i + 1) % RATES.length] });
    });
    $.close.addEventListener('click', async () => { await run({ cmd: 'stop' }); st = null; paint(); onChange(null); stopPolling(); });
    // Reopened popup: pick up playback that is still running in the background.
    try {
        const r = await new Promise((resolve) => chrome.runtime.sendMessage({ action: 'audioCmd', cmd: 'state' }, (x) => resolve(chrome.runtime.lastError ? null : x)));
        if (r && r.cur) { backend = 'bg'; st = r; paint(); startPolling(); onChange(st); }
    } catch (e) { /* nothing playing */ }
}
