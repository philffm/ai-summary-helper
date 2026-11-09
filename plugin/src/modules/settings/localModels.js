// settings/localModels.js — split out of settingsManager.js (R4 phase 1).
import { SK } from '../storageKeys.js';
import StorageManager from '../storageManager.js';
import { escapeHtml } from '../textUtils.js';
import { T } from '../feedI18n.js';
import { checkOllama } from '../ollamaCheck.js';

// ── Ollama per-platform setup tutorial ─────────────────────────────────────
// Shows only when the Ollama provider is selected. Modern Ollama rejects
// cross-origin requests from web pages / extensions unless OLLAMA_ORIGINS
// is configured — this walks the user through fixing that on their platform.
const ollamaTutorials = () => ({
    macos: {
        title: T('Set up Ollama on macOS'),
        steps: [
            { title: T('Quit Ollama'), body: T('Click the Ollama icon in the menu bar (top-right) and choose <b>Quit Ollama</b>.') },
            { title: T('Open Terminal'), body: T('Open the <b>Terminal</b> app on your Mac.') },
            { title: T('Allow browser extensions'), body: T('Run this command. It lets extensions, and only extensions, talk to Ollama:'),
              code: 'launchctl setenv OLLAMA_ORIGINS "chrome-extension://*,moz-extension://*,safari-web-extension://*"' },
            { title: T('Restart Ollama'), body: T('Launch Ollama again from your Applications folder or Spotlight.') },
            { title: T('Make it permanent'), body: T('<code>launchctl setenv</code> is forgotten after a restart of your Mac. This login item sets it again every time:'),
              code: 'cat > ~/Library/LaunchAgents/com.ollama.origins.plist <<\'EOF\'\n<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0"><dict>\n<key>Label</key><string>com.ollama.origins</string>\n<key>ProgramArguments</key><array><string>/bin/sh</string><string>-c</string>\n<string>launchctl setenv OLLAMA_ORIGINS "chrome-extension://*,moz-extension://*,safari-web-extension://*"</string></array>\n<key>RunAtLoad</key><true/>\n</dict></plist>\nEOF\nlaunchctl load ~/Library/LaunchAgents/com.ollama.origins.plist' },
            { title: T('Check it'), body: T('You should see <code>200</code>. A <code>403</code> means Ollama has not picked up the setting yet: quit it and start it again.'),
              code: 'curl -s -o /dev/null -w "%{http_code}\\n" http://localhost:11434/api/tags -H "Origin: chrome-extension://test"' },
            { title: T('Quick test (terminal)'), body: T('Only if the Ollama app is quit (otherwise you get “address already in use”; check with <code>lsof -i :11434</code> and stop it with <code>pkill -x ollama</code>). Runs Ollama in a foreground window:'),
              code: 'OLLAMA_ORIGINS="chrome-extension://*,moz-extension://*,safari-web-extension://*" ollama serve' }
        ],
        note: T('Once Ollama restarts, the 403 Forbidden error from this extension is resolved.')
    },
    windows: {
        title: T('Set up Ollama on Windows'),
        steps: [
            { title: T('Quit Ollama'), body: T('Right-click the Ollama tray icon (bottom-right) and choose <b>Quit</b>.') },
            { title: T('Open Command Prompt'), body: T('Press <b>Win + R</b>, type <code>cmd</code> and press Enter.') },
            { title: T('Allow browser extensions'), body: T('Run this so Ollama accepts requests from browser extensions (permanent for your user account):'),
              code: 'setx OLLAMA_ORIGINS "chrome-extension://*,moz-extension://*,safari-web-extension://*"' },
            { title: T('Start Ollama'), body: T('Start Ollama again from the Start menu, or run it as a foreground server from a new Command Prompt window:'),
              code: 'ollama serve' }
        ],
        note: T('Once Ollama restarts, the 403 Forbidden error from your extension is fixed.')
    },
    linux: {
        title: T('Set up Ollama on Linux'),
        steps: [
            { title: T('Stop Ollama'), body: T('If running as a systemd service, stop it with <code>sudo systemctl stop ollama</code>.') },
            { title: T('Allow browser extensions (permanent)'), body: T('Open the service override with <code>sudo systemctl edit ollama.service</code> and add:'),
              code: '[Service]\nEnvironment="OLLAMA_ORIGINS=chrome-extension://*,moz-extension://*,safari-web-extension://*"' },
            { title: T('Restart the service'), body: T('Apply it:'),
              code: 'sudo systemctl daemon-reload && sudo systemctl restart ollama' },
            { title: T('Quick test (terminal)'), body: T('Without systemd, run Ollama in a foreground window:'),
              code: 'OLLAMA_ORIGINS="chrome-extension://*,moz-extension://*,safari-web-extension://*" ollama serve' }
        ],
        note: T('Once Ollama restarts, the 403 Forbidden error from your extension is fixed.')
    }
});


function detectOS() {
    const ua = navigator.userAgent.toLowerCase();
    if (/mac os|macintosh|iphone|ipad|ipod/.test(ua)) return 'macos';
    if (/windows|win64|win32/.test(ua)) return 'windows';
    return 'linux';
}

/**
 * The recommendation at the top of Settings › Models › Local (AISH-033, decided: A + parts of D).
 * Detects all local models, ranks them (localModels.js), saves the ready ones as the fallback order, and offers:
 * use it / download and use it / compare first (the 20-headline test, per model, no fallback while testing).
 */
export async function renderRecommendation(box, endpoint, onPickModel) {
    const L = await import('../localModels.js');
    const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; };
    const ua = navigator.userAgent || '';
    const browserName = /\bEdg\//.test(ua) ? 'Edge' : /\bOPR\//.test(ua) ? 'Opera' : 'Chrome';
    box.replaceChildren(el('div', 'local-source-head', T('Recommended for this computer')), el('p', 'setting-note', T('Looking for local models… nothing is installed or sent.')));
    const [{ cands }, store, cfgAll] = await Promise.all([
        L.detectLocalModels({ ollamaEndpoint: endpoint || undefined, browserName }),
        chrome.storage.sync.get(['localModelBench', 'localFallback']).catch(() => ({})),
        StorageManager.getAll().catch(() => ({})),
    ]);
    if (!box.isConnected) return;
    const bench = (store && store.localModelBench) || {};
    const ranked = L.rankLocalModels(cands, bench);
    try { await chrome.storage.sync.set({ localFallbackOrder: L.fallbackOrder(ranked) }); } catch (_) { /* fallback just stays off */ }
    const active = ((cfgAll[SK.servicesConfig] || {}).ollama || {}).activeModelId;
    const activeId = active && (typeof active === 'string' ? active : active.id);
    box.replaceChildren();
    box.append(el('div', 'local-source-head', T('Recommended for this computer')));
    const pick = ranked[0];
    if (!pick) {
        box.append(el('p', 'setting-note', T('No local model on this computer yet. Download the browser’s built-in model below if it is offered, or set up Ollama (steps below).')));
        return 0;
    }
    const card = el('div', 'local-reco-card');
    card.append(el('div', 'local-reco-title', pick.label));
    const why = L.reasonFor(pick, bench);
    const reason = why.kind === 'measured' ? T('Fastest here in the quick test: {s} s for {n} headlines, all rated.', { s: Math.round(why.sec), n: why.total })
        : why.kind === 'download' ? T('Runs inside the browser on this computer. One-time download, then it works offline.')
        : why.kind === 'builtin' ? T('Built into the browser, ready now. Nothing to install.')
        : why.kind === 'apple' ? T('Apple’s model on this Mac, ready now.')
        : T('Installed and ready. Usually the strongest local option.');
    card.append(el('p', 'setting-note', reason));
    const acts = el('div', 'local-reco-actions');
    const msg = el('p', 'setting-note'); msg.setAttribute('aria-live', 'polite');
    const bar = el('progress', 'builtin-model-progress'); bar.max = 1; bar.value = 0; bar.hidden = true;
    const use = async (c) => { await onPickModel(c.model, c.source === 'ollama' ? {} : { endpoint: c.endpoint, source: c.source }); await renderRecommendation(box, endpoint, onPickModel); };
    if (activeId && activeId === pick.model) card.append(el('p', 'local-reco-inuse', '✓ ' + T('In use')));
    else if (pick.state === 'ready') { const b = el('button', 'button-primary btn-sm', T('Use it')); b.type = 'button'; b.addEventListener('click', () => use(pick)); acts.append(b); }
    else if (pick.state === 'download') {
        const b = el('button', 'button-primary btn-sm', pick.downloading ? T('Continue the download') : T('Download and use')); b.type = 'button';
        b.addEventListener('click', async () => {
            b.disabled = true; bar.hidden = false; msg.textContent = T('Downloading… Chrome keeps going if you close this panel.');
            try { const { nanoDownload } = await import('../nanoModel.js'); await nanoDownload('en', (p) => { bar.value = p; }); await use({ ...pick, state: 'ready' }); }
            catch (e) { msg.textContent = T('Download failed: {e}', { e: (e && e.message) || '' }); b.disabled = false; }
        });
        acts.append(b);
    }
    const testable = ranked.filter(c => c.state === 'ready' && c.model !== 'firefox-ml').slice(0, 4);
    if (testable.length >= 2 || (testable.length === 1 && pick.state !== 'ready')) {
        const cmp = el('button', 'button-secondary btn-sm', T('Compare first')); cmp.type = 'button';
        cmp.addEventListener('click', () => runQuickTest(testable, box, endpoint, onPickModel));
        acts.append(cmp);
    }
    card.append(acts, bar, msg);
    box.append(card);
    const others = ranked.slice(1).map(c => c.label + (c.state === 'download' ? ' (' + T('download first') + ')' : ''));
    if (others.length) box.append(el('p', 'setting-note', T('Also found: {list}', { list: others.join(' · ') })));
    // parts of D: the next ready model steps in
    const row = el('label', 'local-fallback');
    const cb = el('input'); cb.type = 'checkbox'; cb.checked = !(store && store.localFallback === false);
    cb.addEventListener('change', () => { chrome.storage.sync.set({ localFallback: cb.checked }).catch(() => {}); });
    const tx = el('span', null, T('When the chosen model is not ready, let the next local model answer'));
    row.append(cb, tx); card.append(row);
    return ranked.length;
}

/** “Compare first”: the same 20 headlines to each ready local model, one after the other; the fastest complete one wins. */
export async function runQuickTest(models, box, endpoint, onPickModel) {
    const { benchItems, BENCH_COUNT } = await import('../libraryPresets.js');
    const { scoreItems } = await import('../feedAi.js');
    const L = await import('../localModels.js');
    const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; };
    box.replaceChildren(el('div', 'local-source-head', T('Quick test on this computer')), el('p', 'setting-note', T('The same {n} headlines go to each model, one after the other. Nothing leaves this computer.', { n: BENCH_COUNT })));
    let bench = {}; try { bench = (await chrome.storage.sync.get('localModelBench')).localModelBench || {}; } catch (_) { bench = {}; }
    for (const c of models) {
        const line = el('p', 'local-test-row', c.label + ': ' + T('testing…')); box.append(line);
        const t0 = Date.now();
        try {
            const r = await scoreItems(benchItems(), () => '', { labels: false, target: { model: c.model, endpoint: c.endpoint } });
            const rated = (r.scores || []).filter(v => v !== null && v !== undefined).length;
            const sec = (Date.now() - t0) / 1000;
            bench[L.keyOf(c)] = { sec, rated, total: BENCH_COUNT, at: Date.now() };
            line.textContent = c.label + ': ' + T('{s} s · {a} of {n} rated', { s: Math.round(sec), a: rated, n: BENCH_COUNT });
        } catch (e) {
            bench[L.keyOf(c)] = { sec: 0, rated: 0, total: BENCH_COUNT, at: Date.now() };
            line.textContent = c.label + ': ' + T('did not answer ({e})', { e: (e && e.message) || '' });
        }
    }
    try { await chrome.storage.sync.set({ localModelBench: bench }); } catch (_) { /* shown, not kept */ }
    const done = el('button', 'button-primary btn-sm', T('See the recommendation')); done.type = 'button';
    done.addEventListener('click', () => renderRecommendation(box, endpoint, onPickModel));
    box.append(done);
}

/** One source row of “All local models”: name on the left, a state pill on the right (same look for every source). */
function sourceHead(box, name, state, label) {
    const head = document.createElement('div'); head.className = 'local-src-head';
    const n = document.createElement('span'); n.className = 'local-src-name'; n.textContent = name;
    const pill = document.createElement('span'); pill.className = 'local-src-state'; pill.dataset.state = state; pill.textContent = label;
    head.append(n, pill); box.append(head);
    return pill;
}

/**
 * “In Chrome” block of the local model panel: Chrome's built-in model as a model you can pick (id `chrome-builtin`).
 * Ready → a model chip like Ollama's; not downloaded yet → a download button (needs this click); offered but blocked →
 * one line pointing to chrome://on-device-internals (disk space, hardware). Browsers without the API show nothing.
 */
export async function renderBuiltinModel(box, onPickModel) {
    if (/\bFirefox\//.test(navigator.userAgent || '') && typeof browser !== 'undefined') return renderFirefoxModel(box, onPickModel);
    const { nanoAvailability, nanoDownload } = await import('../nanoModel.js');
    const state = await nanoAvailability();
    if (!box.isConnected || state === 'unsupported') { box.remove(); return; }
    box.replaceChildren();
    // Edge (Phi-4-mini) and Opera (Gemma / Apple's model) expose the same LanguageModel API as Chrome: name the browser you are in.
    const ua = navigator.userAgent || '';
    const browser = /\bEdg\//.test(ua) ? 'Edge' : /\bOPR\//.test(ua) ? 'Opera' : 'Chrome';
    sourceHead(box, T('In {browser}: built-in model', { browser }),
        state === 'available' ? 'ok' : state === 'unavailable' ? 'off' : 'todo',
        state === 'available' ? T('Ready') : state === 'unavailable' ? T('Not ready') : T('Download'));
    const note = document.createElement('p'); note.className = 'setting-note';
    if (state === 'available') {
        const list = document.createElement('div'); list.className = 'model-id-list';
        const b = document.createElement('button'); b.type = 'button'; b.className = 'model-id-tag';
        b.textContent = T('{browser} · built-in', { browser }); b.title = T('Runs inside {browser} on this computer. No install, nothing leaves the computer.', { browser });
        b.addEventListener('click', () => onPickModel && onPickModel('chrome-builtin'));
        list.append(b); box.append(list);
        note.textContent = T('Small model, fast to start. For better summaries pick a larger Ollama model.');
    } else if (state === 'downloadable' || state === 'downloading') {
        const bar = document.createElement('progress'); bar.max = 1; bar.value = 0; bar.hidden = state !== 'downloading'; bar.className = 'builtin-model-progress';
        const dl = document.createElement('button'); dl.type = 'button'; dl.className = 'button-secondary btn-sm';
        dl.textContent = state === 'downloading' ? T('Continue the download') : T('Download the built-in model');
        dl.addEventListener('click', async () => {
            dl.disabled = true; bar.hidden = false; note.textContent = T('Downloading… {browser} keeps going if you close this panel.', { browser });
            try { await nanoDownload('en', (p) => { bar.value = p; }); await renderBuiltinModel(box, onPickModel); }
            catch (e) { note.textContent = T('Download failed: {e}', { e: (e && e.message) || '' }); dl.disabled = false; }
        });
        box.append(dl, bar);
        note.textContent = T('{browser} can download a small model once and run it on this computer. For better summaries use a larger Ollama model.', { browser });
    } else {
        note.textContent = browser === 'Opera'
            ? T('Opera’s built-in model is not ready yet. Turn on Settings › Opera AI › Enable Web AI API, wait until the model is downloaded (Opera sidebar), then check again. Not on Intel Macs, Linux or Windows on Arm yet.')
            : T('{browser} has a built-in model, but not on this computer right now (often: not enough free disk space). Details: {url}', { browser, url: browser === 'Edge' ? 'edge://on-device-internals' : 'chrome://on-device-internals' });
        box.append(note); return;
    }
    box.append(note);
}

/** Local servers besides Ollama that answer right now, each with its models as chips (picking one also switches the endpoint). */
async function renderOtherServers(box, onPickModel) {
    const { findLocalServers } = await import('../localServers.js');
    const found = await findLocalServers();
    if (!box.isConnected) return;
    box.replaceChildren();
    found.forEach((srv) => {
        const row = document.createElement('section'); row.className = 'local-src'; box.append(row);
        sourceHead(row, srv.name, srv.blocked ? 'warn' : 'ok', srv.blocked ? T('Blocked') : T('Ready'));
        if (srv.blocked) {
            // It runs, but only accepts requests from localhost pages: the extension's requests are refused.
            const note = document.createElement('p'); note.className = 'setting-note';
            note.textContent = srv.fix === 'apfel'
                ? T('Found on {origin}, but it does not accept this extension yet. Start it with: apfel --serve --allowed-origins {ext}', { origin: srv.origin, ext: (() => { try { return 'chrome-extension://' + chrome.runtime.id; } catch (_) { return 'chrome-extension://…'; } })() })
                : T('Found on {origin}, but it refuses requests from this extension. Allow other origins (CORS) in its settings, then look again.', { origin: srv.origin });
            row.append(note);
            return;
        }
        const list = document.createElement('div'); list.className = 'model-id-list';
        srv.models.forEach((name) => {
            const b = document.createElement('button'); b.type = 'button'; b.className = 'model-id-tag';
            b.textContent = name.length > 28 ? `${name.slice(0, 18)}…${name.slice(-8)}` : name; b.title = `${name} · ${srv.name}`;
            b.addEventListener('click', () => onPickModel && onPickModel(name, { endpoint: srv.endpoint, source: srv.id }));
            list.append(b);
        });
        row.append(list);
    });
}

/**
 * Firefox: its AI runtime (browser.trial.ml, optional permission `trialML`) as a local model with id `firefox-ml`.
 * Experimental and summaries only (a summarization model, not a chat model): the block says so and points to better options.
 * No permission yet → a button asks for it (needs this click); permission but no API → the about:config switches.
 */
export async function renderFirefoxModel(box, onPickModel) {
    const perms = browser.permissions;
    let granted = false;
    try { granted = await perms.contains({ permissions: ['trialML'] }); } catch (_) { granted = false; }
    if (!box.isConnected) return;
    box.replaceChildren();
    const note = document.createElement('p'); note.className = 'setting-note';
    const api = browser.trial && browser.trial.ml;
    sourceHead(box, T('In Firefox: built-in AI (experimental)'), granted && api ? 'ok' : 'todo', granted && api ? T('Ready') : T('Not set up'));
    if (!granted) {
        const ask = document.createElement('button'); ask.type = 'button'; ask.className = 'button-secondary btn-sm';
        ask.textContent = T('Allow Firefox AI');
        ask.addEventListener('click', async () => {
            try { if (await perms.request({ permissions: ['trialML'] })) await renderFirefoxModel(box, onPickModel); }
            catch (e) { note.textContent = String((e && e.message) || e); }
        });
        box.append(ask);
        note.textContent = T('Firefox can summarize pages with a small model on this computer. It only summarizes (no feeds, questions or tags) and works best with English text.');
    } else if (!api) {
        note.textContent = T('Firefox AI is turned off. In Firefox Beta or Release open about:config and set browser.ml.enable and extensions.ml.enabled to true, then reload the extension.');
    } else {
        const list = document.createElement('div'); list.className = 'model-id-list';
        const b = document.createElement('button'); b.type = 'button'; b.className = 'model-id-tag';
        b.textContent = T('Firefox · built-in'); b.title = T('Summaries only, best with English text. The first summary downloads the model.');
        b.addEventListener('click', () => onPickModel && onPickModel('firefox-ml'));
        list.append(b); box.append(list);
        note.textContent = T('Summaries only, best with English text. For feeds, questions and better summaries pick Ollama or another local model.');
    }
    box.append(note);
}

// Probes Ollama first: reachable → list installed models (click to use one);
// not reachable / refused / no models → prompt the user with the matching setup steps.
export async function renderOllamaTutorial(serviceId, endpoint, onPickModel) {
    const container = document.getElementById('ollamaTutorialContainer');
    if (!container) return;
    const isOllama = (serviceId || '').toLowerCase() === 'ollama';
    // The manual fields (model names, endpoint) live in a fold at the end while “Local” is shown: put them back first.
    restoreManualFields();
    container.style.display = isOllama ? 'block' : 'none';
    container.innerHTML = '';

    if (!isOllama) return;
    const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; };

    // AISH-033 (A): detect everything, one recommendation with its reason, set up in place, quick test.
    const reco = el('div', 'local-reco');
    container.appendChild(reco);

    // “All local models”: one row per source, same head (name + state), one “Check again” for all of them.
    const allHead = el('div', 'local-all-head');
    allHead.append(el('span', 'local-source-head', T('All local models')));
    const again = el('button', 'button-secondary btn-sm', '↻ ' + T('Check again')); again.type = 'button';
    again.addEventListener('click', () => renderOllamaTutorial(serviceId, endpoint, onPickModel));
    allHead.append(again);
    container.appendChild(allHead);

    const builtin = el('section', 'local-src builtin-model');
    container.appendChild(builtin);
    renderBuiltinModel(builtin, onPickModel).catch(() => { builtin.remove(); });

    const ollama = el('section', 'local-src');
    const pill = sourceHead(ollama, '🦙 Ollama', 'wait', T('Checking…'));
    const status = el('div', 'ollama-status'); status.setAttribute('role', 'status');
    ollama.append(status);
    container.appendChild(ollama);

    // Other local servers (LM Studio, llama.cpp, Jan, apfel …): shown only when one answers.
    const others = el('div', 'local-others');
    container.appendChild(others);
    renderOtherServers(others, onPickModel).catch(() => {});

    // Manual setup (model names, endpoint URL): folded, for people who know what they want.
    const manual = el('details', 'local-manual');
    manual.append(el('summary', null, T('Manual setup: endpoint and model names')));
    container.appendChild(manual);
    moveManualFields(manual);

    let guide = null, nothingFound = false;
    renderRecommendation(reco, endpoint, onPickModel).then((n) => { nothingFound = n === 0; if (guide && nothingFound) guide.open = true; }).catch(() => { reco.remove(); });

    const result = await checkOllama(endpoint);
    if (!container.isConnected) return;
    if (result.ok && result.models.length) {
        pill.dataset.state = 'ok'; pill.textContent = T('Ready');
        const list = el('div', 'model-id-list');
        result.models.forEach(name => {
            const b = el('button', 'model-id-tag');
            b.type = 'button';
            // Long names (e.g. llamacpp:<sha256>) keep their start and end so they stay recognisable.
            b.textContent = name.length > 28 ? `${name.slice(0, 18)}…${name.slice(-8)}` : name;
            b.title = name;
            b.addEventListener('click', () => onPickModel && onPickModel(name));
            list.appendChild(b);
        });
        status.appendChild(list);
        return;
    }
    if (result.ok) {
        pill.dataset.state = 'todo'; pill.textContent = T('No model yet');
        status.append(el('p', 'setting-note', T('Ollama is running, but no model is installed yet. Download one in a terminal:')));
        const pre = el('pre', 'ollama-code', 'ollama pull llama3.2'); status.appendChild(pre);
        return;
    }
    const forbidden = result.reason === 'forbidden';
    pill.dataset.state = forbidden ? 'warn' : 'off'; pill.textContent = forbidden ? T('Blocked') : T('Not running');
    status.append(el('p', 'setting-note', forbidden
        ? T('Ollama refused the request. A 403 usually means it must be told to accept requests from this extension (OLLAMA_ORIGINS).')
        : T('Not found on this computer. Usually the strongest local option: free, many models.')));
    guide = el('details', 'local-guide');
    const t = ollamaTutorials()[detectOS()] || ollamaTutorials().macos;
    guide.append(el('summary', null, t.title));
    const inner = el('div'); guide.append(inner); renderGuide(inner);
    guide.open = forbidden || nothingFound;
    ollama.append(guide);
}

const MANUAL_IDS = ['modelIdentifierContainer', 'customEndpointContainer'];
function moveManualFields(into) {
    MANUAL_IDS.forEach((id) => {
        const node = document.getElementById(id);
        if (!node || node.parentNode === into) return;
        const mark = document.createComment('manual:' + id);
        node.parentNode.insertBefore(mark, node);
        into.appendChild(node);
    });
}
function restoreManualFields() {
    MANUAL_IDS.forEach((id) => {
        const node = document.getElementById(id);
        const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_COMMENT);
        let mark = null;
        for (let c = walker.nextNode(); c; c = walker.nextNode()) if (c.nodeValue === 'manual:' + id) { mark = c; break; }
        if (node && mark) { mark.parentNode.insertBefore(node, mark); mark.remove(); }
    });
}

function renderGuide(container) {
    const platform = detectOS();
    const t = ollamaTutorials()[platform] || ollamaTutorials().macos;

    const stepsHtml = t.steps.map((step, i) => `
        <div class="ollama-step">
            <span class="ollama-step-num">${i + 1}</span>
            <div class="ollama-step-body">
                <div class="ollama-step-title">${step.title}</div>
                ${step.body ? `<div class="ollama-step-desc">${step.body}</div>` : ''}
                ${step.code ? `
                <div class="ollama-code-wrap">
                    <pre class="ollama-code">${escapeHtml(step.code)}</pre>
                    <button type="button" class="button-secondary ollama-copy-btn" data-copy="${escapeHtml(step.code)}">📋 ${T('Copy')}</button>
                </div>` : ''}
            </div>
        </div>
    `).join('');

    // eslint-disable-next-line no-unsanitized/property -- reviewed: Ollama setup steps are constants in this file; commands are escaped
    container.innerHTML = `
        <div class="ollama-tutorial-header">🦙 ${t.title}</div>
        ${stepsHtml}
        <div class="ollama-tutorial-note">💡 ${t.note}</div>
    `;

    container.querySelectorAll('.ollama-copy-btn').forEach(copyBtn => {
        copyBtn.addEventListener('click', () => {
            const command = copyBtn.dataset.copy;
            navigator.clipboard.writeText(command).then(() => {
                copyBtn.textContent = T('Copied! ✓');
                setTimeout(() => { copyBtn.textContent = '📋 ' + T('Copy'); }, 1500);
            }).catch(() => {});
        });
    });
}

