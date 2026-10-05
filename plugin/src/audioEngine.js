/**
 * audioEngine.js — tiny audio player shared by every host.
 *
 *  • Chrome: runs inside offscreen.html (kept alive by the background worker)
 *    so podcast playback survives the popup closing.
 *  • Firefox / Safari: hosted by the background page.
 *  • Fallback: the popup creates its own engine (stops when the popup closes).
 *
 * Classic script (no modules) so every host can load it with a plain tag.
 * Commands arrive as chrome.runtime messages {action:'audioCmd', cmd, ...} when hosted.
 */
(function (root) {
    function create() {
        const a = new Audio();
        a.preload = 'none';
        let cur = null;
        let error = '';
        a.addEventListener('error', () => { error = 'This episode could not be played'; });
        a.addEventListener('playing', () => { error = ''; });
        const fail = (e) => { error = (e && e.message) || 'Playback failed'; };
        const state = () => ({
            ok: true,
            playing: !a.paused && !a.ended,
            ended: a.ended,
            time: a.currentTime || 0,
            duration: isFinite(a.duration) ? a.duration : 0,
            rate: a.playbackRate,
            cur,
            error
        });
        function handle(msg) {
            switch (msg.cmd) {
                case 'load':
                    a.src = msg.src; cur = msg.meta || null; error = '';
                    a.playbackRate = msg.rate || a.playbackRate || 1;
                    if (msg.start > 0) a.addEventListener('loadedmetadata', () => { a.currentTime = msg.start; }, { once: true });
                    a.play().catch(fail);
                    break;
                case 'toggle': if (a.paused) a.play().catch(fail); else a.pause(); break;
                case 'pause': a.pause(); break;
                case 'seek': a.currentTime = Math.max(0, Number(msg.time) || 0); break;
                case 'skip': a.currentTime = Math.max(0, a.currentTime + (Number(msg.delta) || 0)); break;
                case 'rate': a.playbackRate = Number(msg.rate) || 1; break;
                case 'stop': a.pause(); a.removeAttribute('src'); a.load(); cur = null; error = ''; break;
                default: break; // 'state'
            }
            return state();
        }
        return { handle, state };
    }

    // Listen for audioCmd messages (offscreen document or Firefox background).
    function host() {
        const eng = create();
        chrome.runtime.onMessage.addListener((msg, _sender, send) => {
            if (!msg || msg.action !== 'audioCmd') return false;
            send(eng.handle(msg));
            return false;
        });
    }
    root.AishAudio = { create, host };
})(typeof globalThis !== 'undefined' ? globalThis : self);
