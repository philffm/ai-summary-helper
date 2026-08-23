// content.js — Orchestrator
// Entry point for the content script. Imports from ./content/* modules and
// wires them together. The build system (scripts/build.js) bundles this into
// a single self-contained file for each platform (MV3 content scripts can't
// use ES modules directly).

import {
  getAllTextContent,
  truncateToTokenLimit,
  inlineAndCompressImages,
  markdownToHtml
} from './content/extractor.js';

import {
  ensureHighlightUiStyles,
  showDecisionDialog,
  createStreamingOverlay,
  updateStreamingOverlay,
  waitForSpeedReadingComplete,
  toggleHybridSidebar,
  showPlaceholder,
  insertSummary,
  selectTargetElement,
  updateDebugPanel
} from './content/ui.js';

import {
  setHighlightingEnabled,
  isAnyHighlightingEnabled,
  saveAnnotationToStorage,
  removeAnnotationFromStorage,
  restoreAnnotations,
  scheduleRestoreAnnotations,
  clearHighlightElements,
  clearHighlightElementsByType,
  startAnnotationWatchers,
  handleTextSelection,
  highlightTextOnPage,
  handleHighlightClick,
  applyGhostHighlights,
  handleGhostHighlightClick
} from './content/highlighter.js';

import {
  getGhostHighlightConfig,
  normalizeGhostQuotes,
  ensureGeneralTag,
  saveToLocalStorage
} from './content/core.js';

(() => {
  // ── Cross-browser shim ────────────────────────────────────────────────
  if (typeof chrome === 'undefined' && typeof browser !== 'undefined') {
    globalThis.chrome = browser;
  }

  // Smart injection guard: If the extension context is alive AND this page
  // already has our content script initialized, skip re-initialization.
  try {
    if (window.aishContentScriptInitialized && chrome.runtime.id) {
      return;
    }
  } catch (e) {
    // Context orphaned (extension reloaded) — re-initialize below.
  }

  window.aishContentScriptInitialized = true;

  const API_BASE = 'https://api.byphil.eu';
  // const API_BASE = 'http://localhost:3000'; // for local testing

  // Define the donation messages
  const donationMessages = [
    "Help me brew new ideas with a soothing cup of tea! 🍵",
    "Help me upgrade my workspace with a new plant! 🌿",
    "Help me fund a tiny house to code in peace! 🏡",
    "Get me closer to my goal of relocating into a sailboat! 🚤",
    "Feeling generous? A pizza would definitely boost my brainstorming sessions! 🍕",
    "Help me turn my remote work into a van life adventure! 🚐",
    "Your support can help me build my tiny home! 🏠",
    "Help me get a kayak to paddle through my creative process! 🛶",
    "Get me a smoothie to recharge my problem-solving skills! 🥤"
  ];

  function getRandomDonationMessage() {
    const randomIndex = Math.floor(Math.random() * donationMessages.length);
    return donationMessages[randomIndex];
  }

  let servicesData = [];
  let modelConfig = {};

  // Cache the setting so sync reads don't block event handlers
  let userHighlightingEnabled = true;
  let aiHighlightingEnabled = true;

  chrome.storage.sync.get(['highlightingEnabled', 'userHighlightingEnabled', 'aiHighlightingEnabled'], (data) => {
    const legacy = data.highlightingEnabled !== false;
    userHighlightingEnabled = data.userHighlightingEnabled !== undefined ? data.userHighlightingEnabled !== false : legacy;
    aiHighlightingEnabled = data.aiHighlightingEnabled !== undefined ? data.aiHighlightingEnabled !== false : legacy;
    setHighlightingEnabled(userHighlightingEnabled, aiHighlightingEnabled);

    if (!isAnyHighlightingEnabled()) {
      clearHighlightElements();
    } else {
      scheduleRestoreAnnotations(80);
    }
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'sync') return;

    let shouldRestore = false;

    if ('userHighlightingEnabled' in changes) {
      userHighlightingEnabled = changes.userHighlightingEnabled.newValue !== false;
      setHighlightingEnabled(userHighlightingEnabled, aiHighlightingEnabled);
      if (!userHighlightingEnabled) {
        clearHighlightElementsByType('user');
      } else {
        shouldRestore = true;
      }
    }

    if ('aiHighlightingEnabled' in changes) {
      aiHighlightingEnabled = changes.aiHighlightingEnabled.newValue !== false;
      setHighlightingEnabled(userHighlightingEnabled, aiHighlightingEnabled);
      if (!aiHighlightingEnabled) {
        clearHighlightElementsByType('ghost');
      } else {
        shouldRestore = true;
      }
    }

    if ('highlightingEnabled' in changes && !('userHighlightingEnabled' in changes) && !('aiHighlightingEnabled' in changes)) {
      const legacyEnabled = changes.highlightingEnabled.newValue !== false;
      userHighlightingEnabled = legacyEnabled;
      aiHighlightingEnabled = legacyEnabled;
      setHighlightingEnabled(userHighlightingEnabled, aiHighlightingEnabled);
      if (!legacyEnabled) {
        clearHighlightElements();
      } else {
        shouldRestore = true;
      }
    }

    if (shouldRestore && isAnyHighlightingEnabled()) {
      scheduleRestoreAnnotations(80);
    }
  });

  // Restore persisted highlights as soon as the DOM is ready
  document.addEventListener('mouseup', handleTextSelection);
  document.addEventListener('click', handleHighlightClick);
  document.addEventListener('click', handleGhostHighlightClick);

  if (document.readyState === 'interactive' || document.readyState === 'complete') {
    scheduleRestoreAnnotations(80);
  } else {
    document.addEventListener('DOMContentLoaded', () => scheduleRestoreAnnotations(80));
  }

  ensureHighlightUiStyles();
  startAnnotationWatchers();

  // ── Extension Message Handlers ───────────────────────────────────────────────

  // Registry for in-flight streaming fetches. Background pushes chunks via
  // chrome.tabs.sendMessage({action:'streamChunk', requestId, payload}),
  // which we route to the matching handler here. This replaced an earlier
  // runtime.connect()-based approach that was unreliable on Safari — see
  // the note in background.js.
  const streamHandlers = new Map();

  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    // Normalize casing so both 'PING' and 'ping' work.
    const action = (request.action || '').toLowerCase();
    if (action === 'ping') {
      sendResponse({ status: 'pong' });
      return true;
    }

    if (request.action === 'streamChunk' && request.requestId) {
      const handler = streamHandlers.get(request.requestId);
      if (handler) handler(request.payload);
      sendResponse({ status: 'ok' });
      return true;
    }

    if (request.action === 'contextMenuHighlight') {
      const text = request.text?.trim();
      if (text && userHighlightingEnabled) {
        highlightTextOnPage(document.body, text, false);
        saveAnnotationToStorage(text, 'user');
      }
      sendResponse({ status: 'ok' });
      return true;
    }

    if (request.action === 'contextMenuClearHighlights') {
      clearHighlightElements();

      // Clear only for the current URL using the new array structure
      chrome.storage.local.get(['annotations'], (res) => {
        let annotations = res.annotations;
        if (Array.isArray(annotations)) {
          const currentUrl = window.location.href.split('#')[0];
          annotations = annotations.filter(a => a.url !== currentUrl);
          chrome.storage.local.set({ annotations }, () => {
            sendResponse({ status: 'ok' });
          });
        } else {
          sendResponse({ status: 'ok' });
        }
      });
      return true;
    }

    if (request.action === 'toggleHybridSidebar') {
      toggleHybridSidebar();
      sendResponse({ status: 'Sidebar toggled' });
      return true;
    }

    if (request.action === 'fetchSummaryAndClose') {
      sendResponse({ success: true });

      showDecisionDialog((decision) => {
        const streamOverlay = createStreamingOverlay();
        document.body.appendChild(streamOverlay);

        const decisionDialog = document.getElementById('aish-decision-overlay');
        if (decisionDialog) decisionDialog.remove();

        chrome.storage.sync.get(['debugEnabled', 'prompt'], async (data) => {
          const promptToUse = data.prompt || 'Summarize the following content:';
          if (!document.body) {
            updateStreamingOverlay(streamOverlay, '❌ Cannot summarize this page type.', true);
            return;
          }
          const hiddenTarget = document.createElement('div');
          hiddenTarget.style.cssText = 'position:fixed;left:-9999px;top:0;width:1px;height:1px;overflow:hidden;';
          document.body.appendChild(hiddenTarget);
          try {
            const result = await fetchSummary('', 'en-US', promptToUse, 200, hiddenTarget, data.debugEnabled || false, 'extension');
            const article = result.article;

            if (article) {
              article.decisionTimeframe = decision.timeframe;
              article.decisionReason = decision.reason;
              article.decisionSavedAt = decision.savedAt;
              article.isDecision = true;

              chrome.storage.local.get({ articles: [] }, (data) => {
                const articles = data.articles || [];
                const idx = articles.findIndex(a => a.timestamp === article.timestamp);
                if (idx >= 0) {
                  articles[idx] = article;
                  chrome.storage.local.set({ articles }, () => {
                    chrome.runtime.sendMessage({ action: 'scheduleDecisionAlarm', article });
                    waitForSpeedReadingComplete(streamOverlay, () => {
                      chrome.runtime.sendMessage({ action: 'closeTabSelf' });
                    });
                  });
                }
              });
            } else {
              updateStreamingOverlay(streamOverlay, 'No summary generated', true);
            }
          } catch (e) {
            updateStreamingOverlay(streamOverlay, `❌ Summary failed: ${e.message || 'Unknown error'}`, true);
          }
        });
      });
      return false;
    }

    if (request.action === 'fetchSummary') {
      const { additionalQuestions: popupQuestions, selectedLanguage, prompt: popupPrompt, summaryMode, summaryLength: msgSummaryLength } = request;
      sendResponse({ success: true, message: summaryMode === 'extension' ? 'Fetching summary...' : 'Selection started' });

      (async () => {
        if (summaryMode === 'extension') {
          chrome.storage.sync.get(['debugEnabled', 'prompt'], (data) => {
            const promptToUse = popupPrompt || data.prompt || 'Summarize the following content:';
            const length = msgSummaryLength || 200;
            if (!document.body) {
              sendResponse({ success: false, error: 'Cannot summarize this page type.' });
              return;
            }
            const hiddenTarget = document.createElement('div');
            hiddenTarget.style.cssText = 'position:fixed;left:-9999px;top:0;width:1px;height:1px;overflow:hidden;';
            document.body.appendChild(hiddenTarget);
            fetchSummary(
              popupQuestions,
              selectedLanguage,
              promptToUse,
              length,
              hiddenTarget,
              data.debugEnabled || false,
              summaryMode
            );
          });
          return;
        }

        const targetElement = await selectTargetElement();
        if (targetElement) {
          chrome.storage.sync.get(['debugEnabled', 'prompt'], (data) => {
            const promptToUse = popupPrompt || data.prompt || 'Summarize the following content:';
            const length = msgSummaryLength || 200;
            fetchSummary(
              popupQuestions,
              selectedLanguage,
              promptToUse,
              length,
              targetElement,
              data.debugEnabled || false,
              summaryMode
            );
          });
        }
      })();
      return false;
    } else if (request.action === 'setServices') {
      servicesData = request.services;
    } else if (request.action === 'setModelConfig') {
      modelConfig = request.modelConfig;
    }
  });

  // ── Summary fetch + streaming ───────────────────────────────────────────────

  async function fetchSummary(additionalQuestions, selectedLanguage, prompt, summaryLength, targetElement, debugEnabled, summaryMode = 'extension') {
    const tokenLimit = 20000;

    const { html: contentHtml, text: contentText } = getAllTextContent();
    const truncatedContent = truncateToTokenLimit(contentText, tokenLimit);

    // Start image compression immediately and let it run while AI is streaming.
    const imageCompressionPromise = inlineAndCompressImages(contentHtml);

    const donationMessage = getRandomDonationMessage();
    showPlaceholder(targetElement, donationMessage);

    return new Promise((resolve, reject) => {
      // Sensitive keys (servicesConfig, licenseKey) now live in LOCAL storage;
      // harmless prefs stay in sync.
      Promise.all([
        chrome.storage.sync.get(['activeService', 'connectionMode', 'preferredCloudModel', 'ghostHighlightAmount']),
        chrome.storage.local.get(['servicesConfig', 'licenseKey'])
      ]).then(async ([syncData, localData]) => {
        const data = { ...syncData, ...localData };
        // ── Define relay FIRST so it's available to every code path ──
        const relay = (action, payload = {}) => {
          if (summaryMode !== 'extension') return;
          const msg = { action, ...payload };

          // Broadcast to all extension pages (native popup, native side
          // panel). On Firefox this does NOT reach a popup embedded in a
          // hybrid-sidebar <iframe>, but it's the reliable path for every
          // other context.
          chrome.runtime.sendMessage(msg).catch(() => {});

          // ALSO push directly into the hybrid-sidebar iframe we created.
          // Firefox downgrades an extension page embedded in a regular web
          // page to content-script privileges, so runtime.sendMessage
          // broadcasts never arrive there. A plain postMessage between the
          // content script and the iframe's own document needs no extension
          // privileges, so this is the reliable return path in pop-out mode.
          const sidebar = document.getElementById('ai-summary-hybrid-sidebar');
          if (sidebar && sidebar.contentWindow) {
            try { sidebar.contentWindow.postMessage(msg, '*'); } catch (_) {}
          }
        };

        const localAuth = await chrome.storage.local.get(['pb_token']).catch(() => ({}));
        const sessionToken = localAuth?.pb_token || '';
        const connectionMode = data.connectionMode || 'cloud';
        let activeService = data.activeService || 'openai';
        let cfg = (data.servicesConfig || {})[activeService] || {};
        let apiKey = cfg.apiKey || '';

        let apiUrl = cfg.endpoint;
        // Resolve the active model. It may be a legacy string or a
        // provider-bound object ({ id, provider }). Normalize to the id.
        const resolveModelId = (m) => {
          if (!m) return '';
          return typeof m === 'string' ? m : (m.id || '');
        };
        let modelIdentifier = resolveModelId(cfg.activeModelId)
          || (Array.isArray(cfg.customModel) ? resolveModelId(cfg.customModel[0]) : resolveModelId(cfg.customModel))
          || cfg.model;
        const ghostCfg = getGhostHighlightConfig(data.ghostHighlightAmount);

        if (connectionMode === 'cloud') {
          activeService = 'cloud';
          apiUrl = `${API_BASE}/v1/projects/ai_summary_helper/chat`;
          modelIdentifier = data.preferredCloudModel || 'google/gemini-2.5-flash';
          apiKey = sessionToken || data.licenseKey || '';
        } else if (cfg) {
          apiUrl = cfg.endpointUrl || apiUrl;
          modelIdentifier = cfg.modelIdentifier || modelIdentifier;
        }

        let apiKeyOptional = false;
        if (connectionMode !== 'cloud') {
          try {
            const servicesUrl = chrome.runtime.getURL('services.json');
            const servicesResp = await fetch(servicesUrl);
            if (servicesResp && servicesResp.ok) {
              const servicesList = await servicesResp.json();
              const svcMeta = servicesList.find(s => (s.id || '').toLowerCase() === (activeService || '').toLowerCase());
              apiKeyOptional = svcMeta?.apiKeyOptional || false;
            }
          } catch (e) {}
        } else {
          apiKeyOptional = true;
        }

        if (activeService === 'ollama') apiKeyOptional = true;

        if (!apiKey && !apiKeyOptional) {
          alert('Please set your API key in the extension popup.');
          relay('summaryError', { error: 'API key not set' });
          reject(new Error('API key not set'));
          return;
        }

        try {
          if (!modelIdentifier && connectionMode !== 'cloud') {
            try {
              const servicesUrl = chrome.runtime.getURL('services.json');
              const servicesResp = await fetch(servicesUrl);
              if (servicesResp && servicesResp.ok) {
                const servicesList = await servicesResp.json();
                const svcMeta = servicesList.find(s => (s.id || '').toLowerCase() === (activeService || '').toLowerCase());
                modelIdentifier = svcMeta?.defaultModel || '';
              }
            } catch (e) {}
          }

          if (!apiUrl) throw new Error('Model endpoint is not configured.');
          try { new URL(apiUrl); } catch (urlErr) { throw new Error(`Configured endpoint is not a valid URL: ${apiUrl}`); }

          const headers = { 'Content-Type': 'application/json' };
          let requestBody;
          let finalApiUrl = apiUrl;

          // 🔥 IMPORTANT: This tells the AI to return EXACT verbatim quotes so `indexOf()` never fails
          const systemPrompt = `You are a summarizer returning HTML <div> with <h2> and <p> tags. At the end include two HTML comments: one with 3-5 broad topic tags strictly based on the core subject matter of the source article (ignore user style preferences, tone, or your persona when generating tags): <!-- TAGS: tag1, tag2, tag3 --> and one with ${ghostCfg.promptRange} short, EXACT verbatim string snippets representing the most critical key insights, core facts, or main arguments from the source text (avoid conversational quotes or dialogue unless they state a core thesis): <!-- GHOST_HIGHLIGHTS: ["exact key passage 1", "exact key passage 2"] -->.`;

          // ── Route based on API format ──
          if (activeService === 'gemini') {
            finalApiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(modelIdentifier)}:streamGenerateContent?alt=sse`;
            headers['x-goog-api-key'] = apiKey;
            const parts = [
              { text: `Please produce ONLY valid HTML. Return a single <div> containing <h2> and <p> tags. At the end include two HTML comments: one with 3-5 broad topic tags strictly derived from the core subject matter of the source text (ignore user personas or styling prompts): <!-- TAGS: tag1, tag2, tag3 --> and one with ${ghostCfg.promptRange} short, EXACT verbatim string snippets representing the most critical key insights, core facts, or main arguments from the source text (avoid conversational quotes or dialogue unless they state a core thesis): <!-- GHOST_HIGHLIGHTS: ["exact key passage 1", "exact key passage 2"] -->. Output Language: ${selectedLanguage}. Limit: ${summaryLength} words.` },
              { text: `Additional Questions/Instructions: ${additionalQuestions}` },
              { text: truncatedContent }
            ];
            requestBody = JSON.stringify({ contents: [{ role: 'user', parts }] });
          } else {
            // Default OpenAI / Cloud / Custom format
            if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;
            const { installId } = await chrome.storage.local.get('installId');
            if (installId) headers['X-Install-ID'] = installId;

            requestBody = JSON.stringify({
              model: modelIdentifier,
              messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: `Language: ${selectedLanguage}. Limit: ${summaryLength} words. Instruction: ${prompt}. Additional Context/Questions: ${additionalQuestions}. Content: ${truncatedContent}` }
              ],
              stream: true
            });
          }

          if (debugEnabled) {
            updateDebugPanel(`Requesting ${modelIdentifier}...\n\nURL: ${finalApiUrl}\n\nPayload: ${requestBody}`, finalApiUrl);
          }

          let summary = "";
          const streamContainer = targetElement.querySelector('.placeholder');
          const outputArea = document.createElement('div');
          outputArea.style.marginTop = '15px';
          outputArea.style.borderTop = '1px solid #ccc';
          outputArea.style.paddingTop = '10px';
          streamContainer.appendChild(outputArea);

          relay('summaryProgress', { chunk: 'Connected to API, waiting for response…' });

          const streamStart = Date.now();
          const requestId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
          let buffer = '';

          // Message-based streaming (not runtime.connect/ports) — see the
          // comment on streamHandlers above for why. We still send the
          // initial request via a plain sendMessage (which reliably wakes a
          // suspended Safari background page), then background pushes
          // chunks back to this tab individually.
          //
          // IMPORTANT: register the handler BEFORE sending anything to
          // background. If we send first and register after awaiting the
          // ack, there's a race: background can start pushing
          // 'request-started'/'response'/chunk messages the instant it
          // receives startFetch — often before our sendMessage ack
          // round-trip even completes — and any message that arrives before
          // streamHandlers.set() runs is silently dropped (streamHandlers.get()
          // returns undefined, so it's a no-op). On a fast API response this
          // can mean the 'done' message itself is lost, which is exactly why
          // this got stuck forever on "Connected to API, waiting for
          // response…" — nothing was left to resolve it.
          streamHandlers.set(requestId, async (msg) => {
            if (msg.error) {
              console.error('❌ Error:', msg.error);
              relay('summaryError', { error: msg.error });
              targetElement.querySelector('.placeholder').innerHTML = `<b>Error:</b> ${msg.error}`;
              reject(new Error(msg.error));
              streamHandlers.delete(requestId);
              return;
            }

            if (msg.done) {
              streamContainer.remove();

              // 🔥 EXTRACT METADATA FROM RAW TEXT BEFORE HTML CONVERSION TO PREVENT BREAKING JSON
              let tags = [];
              const tagMatch = summary.match(/<!--\s*TAGS:\s*([^>]+)\s*-->/i);
              if (tagMatch) {
                const seen = new Set();
                tags = tagMatch[1]
                  .split(',')
                  .map(t => t.trim().replace(/^#/, ''))
                  .filter(Boolean)
                  .filter(t => {
                    const key = t.toLowerCase();
                    if (seen.has(key)) return false;
                    seen.add(key);
                    return true;
                  });
              }
              tags = await ensureGeneralTag(tags, contentText, document.title);
              let ghostQuotes = [];
              const ghostMatch = summary.match(/<!--\s*GHOST_HIGHLIGHTS:\s*([\s\S]*?)\s*-->/i);
              if (ghostMatch) {
                try {
                  let rawJson = ghostMatch[1].trim();
                  rawJson = rawJson.replace(/^```json/i, '').replace(/^```/, '').replace(/```$/, '').trim();
                  ghostQuotes = JSON.parse(rawJson);
                } catch (e) {
                  console.warn('[AI Summary Helper] Failed to parse ghost quotes:', e);
                }
              }
              ghostQuotes = normalizeGhostQuotes(ghostQuotes, ghostCfg.max);

              // Strip tags and ghost comments from the raw summary string
              let cleanRawText = summary
                .replace(/<!--\s*GHOST_HIGHLIGHTS:\s*([\s\S]*?)\s*-->/gi, '')
                .replace(/<!--\s*TAGS:\s*[^>]+\s*-->/gi, '')
                .trim();

              // Finally, convert the cleaned text to HTML
              const cleanHtml = markdownToHtml(cleanRawText);

              // Apply ghost highlights to the page now that it's safe to do so
              if (ghostQuotes.length > 0) applyGhostHighlights(ghostQuotes);

              // WAIT FOR IMAGE COMPRESSION TO FINISH BEFORE SAVING
              let finalContentHtml = contentHtml;
              try {
                finalContentHtml = await imageCompressionPromise;
              } catch (compressionError) {
                console.warn('[AI Summary Helper] Background image compression failed. Falling back to original HTML.', compressionError);
              }

              if (summaryMode === 'inline') {
                const summaryContainer = document.createElement('blockquote');
                summaryContainer.style.cssText = "border-left: 4px solid #007bff; padding: 15px; margin: 20px 0; background: rgba(0,123,255,0.05);";
                summaryContainer.innerHTML = `<div><h2 style="margin-top:0">AI Summary 🧙</h2>${cleanHtml}</div>`;
                insertSummary(targetElement, summaryContainer);
              } else {
                targetElement.remove();
                relay('summaryComplete', {
                  summary: cleanHtml,
                  title: document.title,
                  url: window.location.href,
                  timestamp: new Date().toISOString(),
                  tags: tags,
                  modelId: modelIdentifier,
                  content: finalContentHtml
                });
              }

              saveToLocalStorage(finalContentHtml, cleanHtml, window.location.href, document.title, '', tags, modelIdentifier, summaryLength)
                .then(savedArticle => resolve({ success: true, article: savedArticle }))
                .catch(err => {
                  console.error('Failed to save article:', err);
                  resolve({ success: true, article: null });
                });

              streamHandlers.delete(requestId);
              return;
            }

            if (msg.chunk) {
              relay('summaryProgress', { chunk: 'Receiving data…' });
              buffer += msg.chunk;
              const lines = buffer.split('\n');
              buffer = lines.pop();

              for (let line of lines) {
                line = line.trim();
                if (!line || line === 'data: [DONE]') continue;

                try {
                  let contentPiece = '';
                  const cleanLine = line.startsWith('data: ') ? line.substring(6) : line;
                  const json = JSON.parse(cleanLine);

                  if (activeService === 'gemini') {
                    contentPiece = json.candidates?.[0]?.content?.parts?.[0]?.text || '';
                  } else if (activeService === 'ollama') {
                    // Ollama: content may be in message.content OR message.thinking
                    contentPiece = json.message?.content || json.message?.thinking || json.response || '';
                  } else {
                    contentPiece = json.choices?.[0]?.delta?.content || json.message?.content || json.response || '';
                  }

                  if (contentPiece) {
                    summary += contentPiece;

                    outputArea.innerHTML = `<small style="opacity:0.7; color: #666;">Drafting summary...</small><br>${markdownToHtml(summary)}`;
                    if (debugEnabled) updateDebugPanel(summary, finalApiUrl);

                    const streamingOverlay = document.getElementById('aish-streaming-overlay');
                    if (streamingOverlay) {
                      updateStreamingOverlay(streamingOverlay, summary, false);
                    }

                    const wordCount = summary.split(/\s+/).filter(Boolean).length;
                    if (summaryMode === 'extension' && wordCount % 10 < 2) {
                      const elapsed = Math.floor((Date.now() - streamStart) / 1000);

                      // Estimate output progress from received words vs. the
                      // target summary length. Clamp to [0, 99] until done.
                      const targetWords = Number(summaryLength) || 200;
                      const estimatedPct = Math.min(99, Math.round((wordCount / targetWords) * 100));

                      relay('summaryProgress', {
                        chunk: `${wordCount} words · ${elapsed}s · ${estimatedPct}%`,
                        preview: summary,
                        progress: estimatedPct
                      });
                    }
                  }
                } catch (e) { /* Ignore partial JSON chunks */ }
              }
            }
          });

          // Safari wake-up ping: iOS/macOS aggressively suspends the
          // background worker. The first message-pass through can take
          // 100-300ms to spin the worker up, so fire a no-op wakeup first
          // to warm it before the actual startFetch handshake. The stream
          // handler above is already registered by this point, so even if
          // background responds unexpectedly fast, nothing gets dropped.
          try {
            await new Promise((res) => {
              chrome.runtime.sendMessage({ action: 'wakeup' }, () => {
                // Ignore errors — this only serves to wake the worker.
                if (chrome.runtime.lastError) {}
                res();
              });
            });
          } catch (_) {}

          try {
            await new Promise((res, rej) => {
              chrome.runtime.sendMessage({
                action: 'startFetch',
                requestId,
                apiUrl: finalApiUrl,
                headers: headers,
                body: requestBody
              }, (ack) => {
                if (chrome.runtime.lastError) {
                  rej(new Error(chrome.runtime.lastError.message));
                } else if (ack && ack.started === false) {
                  rej(new Error(ack.error || 'Failed to start stream'));
                } else {
                  res();
                }
              });
            });
          } catch (connectErr) {
            console.error('❌ Failed to start streaming fetch:', connectErr);
            streamHandlers.delete(requestId);
            relay('summaryError', { error: 'Could not connect to the background service. Please try again.' });
            targetElement.querySelector('.placeholder').innerHTML = '<b>Error:</b> Could not connect to the background service. Please try again.';
            reject(new Error(connectErr.message || 'Connection failed'));
            return;
          }

        } catch (error) {
          console.error('❌ Error:', error);
          relay('summaryError', { error: error.message });
          targetElement.querySelector('.placeholder').innerHTML = `<b>Error:</b> ${error.message}`;
          reject(error);
        }
      });
    });
  }
})();