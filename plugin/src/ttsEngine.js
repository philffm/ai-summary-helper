/**
 * ttsEngine.js — read-aloud queue shared by every host (classic script, no modules).
 *
 *  • Chrome: lives in the background service worker and speaks with chrome.tts, so reading goes on when the popup closes.
 *  • Firefox / Safari: lives in the background page and speaks with speechSynthesis.
 *
 * The popup sends {action:'ttsCmd', cmd, …}; the engine answers with the current state and pushes
 * {action:'ttsState', state, index, total, rate, meta, error} to every extension page after each change.
 * Pausing = cancel + remember the sentence (restart it on resume): robust on every engine.
 */
(function (root) {
    const api = typeof chrome !== 'undefined' ? chrome : (typeof browser !== 'undefined' ? browser : null);
    function create(host) {
        let queue = [], idx = 0, state = 'idle', rate = 1, volume = 1, muted = false, open = false, gen = 0, meta = null, error = '';
        const chromeTts = !!(api && api.tts && api.tts.speak);
        const ss = typeof speechSynthesis !== 'undefined' ? speechSynthesis : null;
        const snapshot = () => ({ ok: true, available: chromeTts || !!ss, engine: chromeTts ? 'chrome.tts' : (ss ? 'speechSynthesis' : ''), state, index: idx, total: queue.length, rate, volume, muted, open, meta, error });
        const emit = () => { try { host.send({ action: 'ttsState', ...snapshot() }); } catch (_) { /* nobody listening */ } };
        function cancelSpeech() { gen++; try { if (chromeTts) api.tts.stop(); else if (ss) ss.cancel(); } catch (_) { /* ignore */ } }
        function speakAt(i) {
            cancelSpeech();
            const my = gen;
            if (i >= queue.length && open && queue.length) { idx = queue.length; state = 'waiting'; emit(); return; }   // streaming: more sentences are coming
            if (i < 0 || i >= queue.length) { state = 'idle'; idx = 0; queue = []; open = false; emit(); return; }
            idx = i; state = 'playing'; error = ''; emit();
            const it = queue[i];
            const next = () => { if (my === gen) speakAt(i + 1); };
            const fail = (e) => { if (my !== gen) return; error = String(e || 'error'); state = 'idle'; emit(); };
            try {
                if (chromeTts) {
                    api.tts.speak(it.text, { lang: it.lang, voiceName: it.voice || undefined, rate, volume: muted ? 0 : volume, onEvent: (ev) => { if (ev.type === 'end') next(); else if (ev.type === 'error') fail(ev.errorMessage); } });
                } else if (ss) {
                    const u = new SpeechSynthesisUtterance(it.text);
                    u.lang = it.lang || ''; u.rate = rate; u.volume = muted ? 0 : volume;
                    if (it.voice) { const v = ss.getVoices().find(x => x.name === it.voice); if (v) u.voice = v; }
                    u.onend = next;
                    u.onerror = (e) => { if (e && (e.error === 'interrupted' || e.error === 'canceled')) return; fail(e && e.error); };
                    ss.speak(u);
                } else fail('No speech engine');
            } catch (e) { fail(e && e.message); }
        }
        function voices() {
            return new Promise((resolve) => {
                const map = (list) => (list || []).map(v => ({ name: v.voiceName || v.name, lang: v.lang || '' })).filter(v => v.name);
                if (chromeTts && api.tts.getVoices) { try { api.tts.getVoices((l) => resolve(map(l))); } catch (_) { resolve([]); } return; }
                if (!ss) return resolve([]);
                const now = ss.getVoices(); if (now.length) return resolve(map(now));
                const t = setTimeout(() => resolve(map(ss.getVoices())), 400);
                ss.onvoiceschanged = () => { clearTimeout(t); resolve(map(ss.getVoices())); };
            });
        }
        async function handle(msg) {
            switch (msg.cmd) {
                case 'caps': return { ...snapshot(), voices: await voices() };
                case 'speak':
                    queue = (msg.items || []).filter(x => x && x.text); meta = msg.meta || null; open = !!msg.open;
                    if (msg.rate > 0) rate = msg.rate;
                    speakAt(Math.max(0, msg.start | 0)); break;
                case 'append': {   // streaming: more sentences for the running session
                    const more = (msg.items || []).filter(x => x && x.text);
                    if (!more.length) break;
                    const wasWaiting = state === 'waiting' || state === 'idle';
                    if (state === 'idle') { queue = []; idx = 0; }
                    const at = queue.length; queue = queue.concat(more);
                    if (msg.rate > 0) rate = msg.rate;
                    if (wasWaiting) speakAt(at); else emit();
                    break;
                }
                case 'open': open = !!msg.open; if (state === 'idle' && open) { queue = []; idx = 0; } emit(); break;
                case 'finish': open = false; if (state === 'waiting') { state = 'idle'; idx = 0; queue = []; } emit(); break;
                case 'mute': muted = msg.muted === undefined ? !muted : !!msg.muted; if (state === 'playing') speakAt(idx); else emit(); break;
                case 'volume': if (msg.volume >= 0) { volume = Math.min(1, msg.volume); if (state === 'playing') speakAt(idx); else emit(); } break;
                case 'pause': if (state === 'playing' || state === 'waiting') { cancelSpeech(); state = 'paused'; emit(); } break;
                case 'resume': if (state === 'paused') speakAt(idx); break;
                case 'toggle': if (state === 'playing' || state === 'waiting') { cancelSpeech(); state = 'paused'; emit(); } else if (state === 'paused') speakAt(idx); break;
                case 'next': if (state !== 'idle') speakAt(Math.min(idx + 1, queue.length)); break;
                case 'prev': if (state !== 'idle') speakAt(Math.max(0, idx - 1)); break;
                case 'rate': if (msg.rate > 0) { rate = msg.rate; if (state === 'playing') speakAt(idx); else emit(); } break;
                case 'stop': cancelSpeech(); state = 'idle'; queue = []; idx = 0; open = false; emit(); break;
                default: break;
            }
            return snapshot();
        }
        return { handle, snapshot };
    }
    root.AISH_TTS = { create };
})(typeof self !== 'undefined' ? self : this);
