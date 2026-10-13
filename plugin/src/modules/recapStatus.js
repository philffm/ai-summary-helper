/**
 * recapStatus.js — live status card for recap generation (same idea as the summarize-mode status bubble).
 * Stages: collect → send → wait (elapsed timer) → write/parse → done. Driven by feedAi's `onStage` callback.
 */
import { el } from './dom.js';
import { T } from './feedI18n.js';
import StorageManager from './storageManager.js';
import { briefingText, createBriefingSpeaker, readingState, speechAvailable } from './recapSpeech.js';
import { getReader } from './reader.js';

export async function activeModelLabel(forceLocal = false) {
    try {
        if (forceLocal) { const m = await StorageManager.getActiveModel('ollama'); return `Ollama${m && m.id ? ' · ' + m.id : ''}`; }
        const s = await chrome.storage.sync.get(['connectionMode', 'activeService', 'preferredCloudModel']);
        if (s.connectionMode !== 'local') {
            const cloud = String(s.preferredCloudModel || '').split('/').pop();   // "google/gemini-3.6-flash" → "gemini-3.6-flash"
            return cloud ? `${T('AISH cloud')} · ${cloud}` : T('AISH cloud');
        }
        const m = await StorageManager.getActiveModel(s.activeService);
        return m && m.id ? m.id : s.activeService;
    } catch (e) { return ''; }
}

const STAGES = ['prepare', 'send', 'wait', 'write', 'parse'];

/**
 * @param {{title:string, detail?:string, items?:number}} o  title = headline ("✨ Updating recap…"), detail = what is sent
 * @returns {{node, onStage, stop, signal}}  signal aborts when the user presses Cancel; onCancel runs afterwards
 */
export function createRecapStatus({ title, detail = '', onCancel, preview = true, local = false, speakId = '' }) {
    const node = el('div', 'recap-status');
    node.setAttribute('role', 'status');
    node.setAttribute('aria-live', 'polite');
    const head = el('p', 'feed-recap-loading', title);
    const list = el('ul', 'recap-steps');
    const rows = {};
    const labels = {
        prepare: T('Collected the items'),
        send: T('Sent to your AI connection'),
        wait: T('Waiting for the model'),
        write: T('Model is writing'),
        parse: T('Reading the answer'),
    };
    STAGES.forEach(k => { rows[k] = el('li', 'recap-step', labels[k]); list.append(rows[k]); });
    const meta = el('p', 'feed-muted recap-meta', detail);
    const ac = new AbortController();
    const cancel = el('button', 'btn-sm recap-cancel', T('Cancel'));
    cancel.type = 'button';
    cancel.addEventListener('click', () => { cancel.disabled = true; if (speaker) speaker.stop(); ac.abort(); clearInterval(timer); if (onCancel) onCancel(); });
    const previewEl = el('p', 'recap-preview');
    previewEl.hidden = true;
    // Read aloud while it is being written: finished sentences are spoken as they arrive.
    const speaker = speakId ? createBriefingSpeaker(speakId) : null;
    const speak = el('button', 'btn-sm recap-speak', '🔊 ' + T('Read aloud'));
    speak.type = 'button'; speak.hidden = true;
    const paintSpeak = () => {
        const st = readingState(speakId);
        speak.textContent = st === 'paused' ? '▶ ' + T('Play') : st ? '⏸ ' + T('Pause') : '🔊 ' + T('Read aloud');
    };
    speak.addEventListener('click', async () => {
        if (readingState(speakId)) { getReader().toggle(); return; }
        await speaker.arm(lastText);
        paintSpeak();
    });
    if (speaker) {
        speechAvailable().then(ok => { speak.hidden = !ok; });
        try { getReader().onState(paintSpeak); } catch (_) { /* no engine */ }
    }
    node.append(head, list, ...(preview ? [previewEl] : []), meta, ...(speaker ? [speak] : []), cancel);

    const t0 = Date.now();
    let prog = null, lastMove = Date.now();
    let model = '', cur = '', lastText = '';
    const paint = () => {
        const secs = Math.floor((Date.now() - t0) / 1000);
        const at = STAGES.indexOf(cur);
        STAGES.forEach((k, i) => {
            const r = rows[k];
            r.className = 'recap-step' + (i < at ? ' done' : i === at ? ' active' : '');
        });
        rows.wait.textContent = labels.wait + (cur === 'wait' ? ` · ${secs}s` : '');
        if (prog) {
            const bits = [];
            if (prog.chars) bits.push(T('{n} characters', { n: prog.chars }));
            if (prog.think) bits.push(T('thinking: {n} characters', { n: prog.think }));
            rows.write.textContent = (prog.think && !prog.chars ? T('Model is thinking') : labels.write) + (bits.length ? ' · ' + bits.join(' · ') : '') + (cur === 'write' && prog.tail ? ` — “…${prog.tail.replace(/\s+/g, ' ')}”` : '');
        }
        const idle = Math.floor((Date.now() - lastMove) / 1000);
        rows.send.textContent = labels.send + (model ? ` · ${model}` : '');
        if ((cur === 'wait' || cur === 'write') && idle >= 20) meta.textContent = (detail ? detail + ' ' : '') + T('Nothing received for {s}s. There is no time limit — Cancel if it looks stuck.', { s: idle });
        else meta.textContent = detail;
    };
    const timer = setInterval(paint, 1000);
    activeModelLabel(local).then(m => { model = m; paint(); });
    const showPreview = (m) => {
        if (!m || typeof m.text !== 'string') return;
        lastText = m.text;
        if (speaker) speaker.feed(m.text);
        if (!preview) return;
        const t = briefingText(m.text);
        const stick = previewEl.scrollHeight - previewEl.scrollTop - previewEl.clientHeight < 24;   // follow the text only while the reader is at the bottom
        previewEl.textContent = t;
        previewEl.hidden = !t;
        if (stick) previewEl.scrollTop = previewEl.scrollHeight;
    };
    const onProgress = (m) => { showPreview(m); if (m.chars !== prog?.chars || m.think !== prog?.think || m.phase !== prog?.phase) lastMove = Date.now(); prog = m; paint(); };
    const onStage = (s) => { if (STAGES.includes(s) && STAGES.indexOf(s) >= STAGES.indexOf(cur)) { cur = s; paint(); } };
    onStage('prepare');
    return { node, onStage, onProgress, stop: () => clearInterval(timer), signal: ac.signal, complete: () => { if (speaker) speaker.complete(lastText); } };
}
