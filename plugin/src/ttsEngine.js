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
    // ── Language switch inside a sentence: quoted passages (“…”, „…“, "…", «…») written in another language than the
    // sentence are spoken with that language's voice. Detection is a tiny stop-word count — enough to tell a German
    // sentence with an English quote from an all-German one; anything unclear stays in the sentence's language.
    const STOP = {
        en: 'the and of to in is that it for with as was on are this be by not or from have has but they their will would can an which more about',
        de: 'der die das und ist nicht ein eine mit von zu den für auf dem sich auch es im als aber wie oder nach wird bei noch nur über sind',
        fr: 'le la les des et est une un du de pour que qui dans pas sur au avec ce il elle sont plus par mais ou nous vous',
        es: 'el la los las de y que en un una es por con para no se su al lo como más pero sus le ya o este',
        it: 'il lo la gli le di e che un una è per con non si su da come più ma anche sono del della nel',
        pt: 'o a os as de e que em um uma é para com não se por mais mas como foi ao do da no na'
    };
    const STOPSETS = Object.keys(STOP).reduce((m, k) => { m[k] = new Set(STOP[k].split(' ')); return m; }, {});
    const TTS_LANG = { en: 'en-US', de: 'de-DE', fr: 'fr-FR', es: 'es-ES', it: 'it-IT', pt: 'pt-PT' };
    const QUOTE = /„[^“”"]{15,}?[“”"]|“[^”]{15,}?”|"[^"]{15,}?"|«[^»]{15,}?»/g;
    function guessLang(text) {
        const words = text.toLowerCase().match(/[a-zäöüßàâçéèêëîïôûùñáíóúãõ]+/g) || [];
        if (words.length < 4) return '';
        let best = '', top = 0, second = 0;
        for (const k of Object.keys(STOPSETS)) {
            const n = words.reduce((c, w) => c + (STOPSETS[k].has(w) ? 1 : 0), 0);
            if (n > top) { second = top; top = n; best = k; } else if (n > second) second = n;
        }
        return top >= 2 && top > second ? best : '';
    }
    function splitLang(it) {
        const base = String(it.lang || '').split(/[-_]/)[0].toLowerCase();
        const whole = [{ text: it.text, lang: it.lang, voice: it.voice }];
        if (!base || !STOPSETS[base]) return whole;
        const parts = []; let last = 0, switched = false, m;
        QUOTE.lastIndex = 0;
        while ((m = QUOTE.exec(it.text))) {
            const q = m[0], g = guessLang(q.slice(1, -1));
            if (!g || g === base) continue;
            if (m.index > last) parts.push({ text: it.text.slice(last, m.index), lang: it.lang, voice: it.voice });
            parts.push({ text: q, lang: TTS_LANG[g] });
            last = m.index + q.length; switched = true;
        }
        if (!switched) return whole;
        if (last < it.text.length) parts.push({ text: it.text.slice(last), lang: it.lang, voice: it.voice });
        return parts.filter(p => /\S/.test(p.text));
    }
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
            if (i >= queue.length && open) { idx = queue.length; state = 'waiting'; emit(); return; }   // streaming: more sentences are coming
            if (i < 0 || i >= queue.length) { state = 'idle'; idx = 0; queue = []; open = false; emit(); return; }
            idx = i; state = 'playing'; error = ''; emit();
            const it = queue[i];
            const next = () => { if (my === gen) speakAt(i + 1); };
            const fail = (e) => { if (my !== gen) return; error = String(e || 'error'); state = 'idle'; emit(); };
            const parts = splitLang(it);
            // A foreign-language quote inside the sentence gets its own utterance (and voice language); the queue index stays per sentence.
            const speakPart = (k) => {
                if (my !== gen) return;
                if (k >= parts.length) { next(); return; }
                const part = parts[k], done = () => speakPart(k + 1);
                try {
                    if (chromeTts) {
                        api.tts.speak(part.text, { lang: part.lang, voiceName: part.voice || undefined, rate, volume: muted ? 0 : volume, onEvent: (ev) => { if (ev.type === 'end') done(); else if (ev.type === 'error') fail(ev.errorMessage); } });
                    } else if (ss) {
                        const u = new SpeechSynthesisUtterance(part.text);
                        u.lang = part.lang || ''; u.rate = rate; u.volume = muted ? 0 : volume;
                        if (part.voice) { const v = ss.getVoices().find(x => x.name === part.voice); if (v) u.voice = v; }
                        u.onend = done;
                        u.onerror = (e) => { if (e && (e.error === 'interrupted' || e.error === 'canceled')) return; fail(e && e.error); };
                        ss.speak(u);
                    } else fail('No speech engine');
                } catch (e) { fail(e && e.message); }
            };
            speakPart(0);
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
