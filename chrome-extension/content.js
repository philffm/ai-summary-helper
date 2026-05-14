// content.js
// Mark that content script is loaded
window.contentScriptLoaded = true;

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

// Function to get a random donation message
function getRandomDonationMessage() {
  const randomIndex = Math.floor(Math.random() * donationMessages.length);
  return donationMessages[randomIndex];
}

let servicesData = [];
let modelConfig = {};

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'PING') {
    sendResponse({ status: 'PONG' });
    return true;
  }
  
  if (request.action === 'fetchSummary') {
    // 1. Acknowledge immediately to prevent port errors in the popup
    sendResponse({ success: true, message: 'Selection started' });

    // 2. Run the logic independently
    (async () => {
      const { additionalQuestions: popupQuestions, selectedLanguage, prompt: popupPrompt } = request;
      const targetElement = await selectTargetElement();
      if (targetElement) {
        // Fetch debugEnabled along with summaryLength AND prompt settings
        chrome.storage.sync.get(['summaryLength', 'debugEnabled', 'prompt'], (data) => {
          // Use the stored prompt as a fallback if the popup didn't send one 
          // (though mainScreen.js usually sends it)
          const promptToUse = popupPrompt || data.prompt || 'Summarize the following content:';
          
          fetchSummary(
            popupQuestions, 
            selectedLanguage, 
            promptToUse, 
            data.summaryLength || 500, 
            targetElement, 
            data.debugEnabled || false
          );
        });
      }
    })();
    
    return false; // Port closes after sendResponse
  } else if (request.action === 'setServices') {
    servicesData = request.services;
    console.log('Services data received:', servicesData);
  } else if (request.action === 'setModelConfig') {
    modelConfig = request.modelConfig;
    console.log('Model configuration received:', modelConfig);
  }
});

async function fetchSummary(additionalQuestions, selectedLanguage, prompt, summaryLength, targetElement, debugEnabled) {
  // Increase tokenLimit for Gemini-style providers. This is an approximate
  // token limit (measured in tokens) used to decide how much of the page to
  // include. We use character-based truncation below (chars ≈ tokens * 4).
  const tokenLimit = 20000; // generous default for larger inputs

  const content = getAllTextContent();
  const truncatedContent = truncateToTokenLimit(content, tokenLimit);

  // Show placeholder after fetching content
  const donationMessage = getRandomDonationMessage();
  showPlaceholder(targetElement, donationMessage);

  return new Promise((resolve, reject) => {
    chrome.storage.sync.get(['activeService', 'servicesConfig'], async (data) => {
      const activeService = data.activeService || 'openai';
      const cfg = (data.servicesConfig || {})[activeService] || {};
      const apiKey = cfg.apiKey || '';

      // Check if API key is optional for this service
      let apiKeyOptional = false;
      try {
        const servicesUrl = chrome.runtime.getURL('services.json');
        const servicesResp = await fetch(servicesUrl);
        if (servicesResp && servicesResp.ok) {
          const servicesList = await servicesResp.json();
          const svcMeta = servicesList.find(s => (s.id || '').toLowerCase() === (activeService || '').toLowerCase());
          apiKeyOptional = svcMeta?.apiKeyOptional || false;
        }
      } catch (e) {
        console.warn('Could not load services.json for apiKeyOptional check', e);
      }

      // Hard fallback for Ollama just in case fetch fails
      if (activeService === 'ollama') apiKeyOptional = true;

      if (!apiKey && !apiKeyOptional) {
        alert('Please set your API key in the extension popup.');
        reject(new Error('API key not set'));
        return;
      }

      try {
        // Prefer modelConfig sent from popup (endpoint + model + responseStructure)
        let apiUrl = modelConfig?.endpointUrl || cfg.endpoint;
        let modelIdentifier = modelConfig?.modelIdentifier || cfg.customModel || cfg.model;

        // Defensive fallback: if modelIdentifier is missing (migration not run),
        // attempt to read the default model from the bundled services.json so
        // we always send a `model` parameter to APIs like OpenAI.
        if (!modelIdentifier) {
          try {
            const servicesUrl = chrome.runtime.getURL('services.json');
            const servicesResp = await fetch(servicesUrl);
            if (servicesResp && servicesResp.ok) {
              const servicesList = await servicesResp.json();
              const svcMeta = servicesList.find(s => (s.id || '').toLowerCase() === (activeService || '').toLowerCase());
              modelIdentifier = svcMeta?.defaultModel || '';
            }
          } catch (e) {
            console.warn('Could not load services.json for fallback modelIdentifier', e);
          }
        }

        if (!apiUrl) {
          const msg = 'Model endpoint is not configured. Open the extension settings and set a valid endpoint.';
          const placeholderEl = targetElement.querySelector('.placeholder');
          if (placeholderEl) placeholderEl.innerHTML = msg;
          throw new Error(msg);
        }

        try {
          new URL(apiUrl);
        } catch (urlErr) {
          const msg = `Configured endpoint is not a valid URL: ${apiUrl}`;
          const placeholderEl = targetElement.querySelector('.placeholder');
          if (placeholderEl) placeholderEl.innerHTML = msg;
          throw new Error(msg);
        }

        // Prepare request and headers. Gemini requires a different shape and
        // uses the `x-goog-api-key` header instead of Bearer tokens.
        const headers = { 'Content-Type': 'application/json' };
        let requestBody;
        let finalApiUrl = apiUrl;

        if (activeService === 'gemini') {
          // Switch to streaming endpoint for Gemini
          finalApiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(modelIdentifier)}:streamGenerateContent?alt=sse`;
          headers['x-goog-api-key'] = apiKey;
          
          const parts = [
            { text: `Please produce ONLY valid HTML. Return a single <div> containing an <h2> and <p> tags. Output Language: ${selectedLanguage}. Limit: ${summaryLength} words.` },
            { text: `Prompt Context: ${prompt}` },
            { text: `Additional Questions/Instructions: ${additionalQuestions}` },
            { text: truncatedContent }
          ];

          requestBody = JSON.stringify({ contents: [{ role: 'user', parts }] });
        } else {
          // OpenAI / Ollama streaming
          headers['Authorization'] = `Bearer ${apiKey}`;
          requestBody = JSON.stringify({
            model: modelIdentifier,
            messages: [
              { role: 'system', content: 'You are a summarizer returning HTML <div> with <h2> and <p>.' },
              { role: 'user', content: `Language: ${selectedLanguage}. Limit: ${summaryLength} words. Instruction: ${prompt}. Additional Context/Questions: ${additionalQuestions}. Content: ${truncatedContent}` }
            ],
            stream: true
          });
        }

        // Generic Debug Panel Trigger
        if (debugEnabled) {
          updateDebugPanel(`Requesting ${modelIdentifier}...\n\nURL: ${finalApiUrl}\n\nPayload: ${requestBody}`, finalApiUrl);
        }

        const response = await fetch(finalApiUrl, { method: 'POST', headers, body: requestBody });

        if (!response.ok) throw new Error(`HTTP ${response.status}: ${await response.text()}`);

        // STREAMING LOGIC
        let summary = "";
        const streamContainer = targetElement.querySelector('.placeholder');
        const outputArea = document.createElement('div');
        outputArea.style.marginTop = '15px';
        outputArea.style.borderTop = '1px solid #ccc';
        outputArea.style.paddingTop = '10px';
        streamContainer.appendChild(outputArea);

        const reader = response.body.getReader();
        const decoder = new TextDecoder("utf-8");
        let buffer = '';

        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          
          buffer += decoder.decode(value, { stream: true });
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
              } else {
                contentPiece = json.choices?.[0]?.delta?.content || json.message?.content || json.response || '';
              }

              if (contentPiece) {
                summary += contentPiece;
                
                // Extremely simple markdown-to-HTML parser for LLMs that ignore the HTML prompt
                let formattedSummary = summary
                  .replace(/^```html\n?/gi, '').replace(/\n?```$/g, '') // strip markdown codeblocks if they wrap HTML
                  .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
                  .replace(/\*(.*?)\*/g, '<em>$1</em>')
                  .replace(/^### (.*$)/gim, '<h3>$1</h3>')
                  .replace(/^## (.*$)/gim, '<h2>$1</h2>')
                  .replace(/^# (.*$)/gim, '<h1>$1</h1>');
                  
                // Live update the UI
                outputArea.innerHTML = `<small style="opacity:0.7">Drafting...</small><br>${formattedSummary.replace(/\\n/g, '<br>')}`;
                if (debugEnabled) updateDebugPanel(summary, finalApiUrl);
              }
            } catch (e) { /* Ignore partial JSON chunks */ }
          }
        }

        // Finalize UI
        streamContainer.remove();
        
        // Final markdown-to-HTML pass (including clean spacing)
        let finalHtml = summary
          .replace(/^```(?:html)?\n?/gi, '').replace(/\n?```$/g, '')
          .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
          .replace(/\*(.*?)\*/g, '<em>$1</em>')
          .replace(/^### (.*$)/gim, '<h3>$1</h3>')
          .replace(/^## (.*$)/gim, '<h2>$1</h2>')
          .replace(/^# (.*$)/gim, '<h1>$1</h1>');

        const summaryContainer = document.createElement('blockquote');
        summaryContainer.innerHTML = `<div><h2>AI Summary 🧙</h2>${finalHtml.replace(/\\n/g, '<br>')}</div>`;
        insertSummary(targetElement, summaryContainer);
        
        saveToLocalStorage(truncatedContent, summary, window.location.href, document.title, '');
        resolve({ success: true });

      } catch (error) {
        console.error('❌ Error:', error);
        targetElement.querySelector('.placeholder').innerHTML = `<b>Error:</b> ${error.message}`;
        reject(error);
      }
    });
  });
}

// Function to save content, summary, URL, title, and description to local storage
function saveToLocalStorage(content, summary, url, title, description) {
  const timestamp = new Date().toISOString();
  const articleData = { content, summary, url, title, description, timestamp };

  chrome.storage.local.get({ articles: [] }, (data) => {
    const articles = data.articles;
    articles.push(articleData);
    chrome.storage.local.set({ articles }, () => {
      console.log('Article saved to local storage:', articleData);
    });
  });
}

// Function to truncate text content to fit within a token limit.
// Previous implementation sliced by UTF-8 bytes which is too aggressive for
// Gemini (and causes early truncation). Use a rough tokens -> chars
// approximation (chars ≈ tokens * 4) and slice by characters instead.
function truncateToTokenLimit(text, maxTokens) {
  if (!text) return text;
  // rough approx: 1 token ≈ 4 characters (varies by language)
  const approxTokens = Math.ceil(text.length / 4);
  if (approxTokens <= maxTokens) return text;
  const allowedChars = Math.max(1000, Math.floor(maxTokens * 4));
  return text.slice(0, allowedChars);
}

// Split a long text into chunks of up to `chunkSize` characters.
function chunkText(text, chunkSize) {
  if (!text) return [];
  const chunks = [];
  let start = 0;
  while (start < text.length) {
    chunks.push(text.slice(start, start + chunkSize));
    start += chunkSize;
  }
  return chunks;
}

// Function to extract all relevant text content from the page
function getAllTextContent() {
  console.log('Getting all text content');

  // List of selectors for elements that usually contain non-article noise
  const noiseSelectors = [
    'script', 'style', 'noscript', 'nav', 'header', 'footer', 'aside',
    '[role="navigation"]', '[role="banner"]', '[role="contentinfo"]',
    'iframe', 'embed', 'object', 'canvas', 'svg', '.ad', '.ads', '.advertisement',
    '#comments', '.comments', '.sidebar', '#sidebar'
  ];

  const blockTags = new Set([
    'p', 'div', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
    'li', 'article', 'section', 'blockquote', 'br', 'tr'
  ]);

  // Check whether an element (or any of its ancestors) matches a noise selector.
  // We work on the live DOM so getComputedStyle is available for pseudo-elements.
  function isNoise(el) {
    return noiseSelectors.some(sel => {
      try { return el.closest(sel) !== null; } catch (e) { return false; }
    });
  }

  // Extract the rendered text injected by a CSS pseudo-element (::before / ::after).
  // Many sites use pseudo-elements to insert characters as an anti-scraping measure;
  // textContent on a detached clone never sees this content, but getComputedStyle does.
  function getPseudoContent(el, pseudo) {
    try {
      const content = window.getComputedStyle(el, pseudo).getPropertyValue('content');
      if (!content || content === 'none' || content === 'normal') return '';
      // Strip the surrounding CSS quotes from the string value.
      const stripped = content.replace(/^["']|["']$/g, '');
      // Discard likely icon-font characters (Unicode Private Use Area).
      return stripped.replace(/[\uE000-\uF8FF]/g, '');
    } catch (e) {
      return '';
    }
  }

  // Recursively build plain text from a live DOM element, capturing both text
  // nodes and CSS pseudo-element content that textContent would normally miss.
  function extractText(el) {
    let result = '';
    result += getPseudoContent(el, '::before');
    for (const child of el.childNodes) {
      if (child.nodeType === Node.TEXT_NODE) {
        result += child.textContent;
      } else if (child.nodeType === Node.ELEMENT_NODE) {
        if (isNoise(child)) continue;
        const tag = child.tagName.toLowerCase();
        if (blockTags.has(tag)) {
          result += '\n\n' + extractText(child) + '\n\n';
        } else {
          result += extractText(child);
        }
      }
    }
    result += getPseudoContent(el, '::after');
    return result;
  }

  // Fallback chain: look for article, or main, or use the whole body
  const mainEl =
    document.querySelector('article') ||
    document.querySelector('main') ||
    document.querySelector('[role="main"]') ||
    document.body;

  let text = extractText(mainEl);

  // Clean up whitespace: replace multiple spaces with one, and multiple newlines with double newlines
  let cleanText = text
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n/g, '\n\n')
    .trim();

  // If it's suspiciously short (e.g. they put the main article outside <main>), fallback
  if (cleanText.length < 500 && mainEl !== document.body) {
    console.log('Extracted content too short, falling back to full body container.');
    text = extractText(document.body);
    cleanText = text
      .replace(/[ \t]+/g, ' ')
      .replace(/\n\s*\n/g, '\n\n')
      .trim();
  }

  console.log('Collected content length:', cleanText.length);
  return cleanText;
}

// Simplified function to determine if the background is light or dark
function isBackgroundDark() {
  const elementsToCheck = ['html', 'body', 'main', 'article'];
  let backgroundColor = null;

  for (const selector of elementsToCheck) {
    const element = document.querySelector(selector);
    if (element) {
      backgroundColor = window.getComputedStyle(element).backgroundColor;
      break;
    }
  }

  if (!backgroundColor) return false; // Default to light if unable to determine

  const rgb = backgroundColor.match(/\d+/g);
  if (!rgb) return false; // Default to light if unable to determine

  // Calculate luminance
  const r = parseInt(rgb[0], 10);
  const g = parseInt(rgb[1], 10);
  const b = parseInt(rgb[2], 10);
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance < 0.5; // Dark if luminance is less than 0.5
}

// Function to show "Fetching" placeholder without removing the original content
function showPlaceholder(targetElement, donationMessage) {
  console.log('Showing placeholder in the selected element');

  const placeholder = document.createElement('div');
  placeholder.classList.add('placeholder');

  const isDark = isBackgroundDark();
  const textColor = isDark ? '#fff' : '#000';
  const linkColor = isDark ? '#add8e6' : '#007bff'; // Light blue for dark backgrounds, blue for light backgrounds

  placeholder.style.backgroundColor = isDark ? 'rgba(0, 0, 0, 0.7)' : 'rgba(255, 255, 255, 0.7)';
  placeholder.style.color = textColor;
  placeholder.style.border = '2px dashed #007bff';
  placeholder.style.borderRadius = '10px';
  placeholder.style.padding = '32px';

  placeholder.innerHTML = `
    <style>
     @keyframes spin {
        from { transform: rotate(0deg); }
        to { transform: rotate(360deg); }
      }
    </style>
    <div style="font-size: 24px; color: ${textColor} !important;">Fetching summary... <span style="display: inline-block; animation: spin 2s linear infinite;">⏳</span></div>
    <div style="font-size: 16px; margin-top: 10px; font-weight: bold;">
    Questions, bugs or ideas? 💡, feel free to <a href="https://philwornath.com/?ref=aish#contact" target="_blank" style="color: ${linkColor} !important; font-weight: bold;">contact me</a>
      ${donationMessage} <a href="https://link.philwornath.com/?source=aish#donate" style="color: ${linkColor} !important; font-weight: bold;" target="_blank">Support AI Summary Helper</a><br>
    </div>
  `;

  // Add subtle animation to the placeholder
  placeholder.animate([
    { backgroundColor: isDark ? 'rgba(0, 0, 0, 0.7)' : 'rgba(255, 255, 255, 0.7)' },
    { backgroundColor: isDark ? 'rgba(0, 0, 0, 1)' : 'rgba(255, 255, 255, 1)' }
  ], {
    duration: 2000,
    iterations: Infinity,
    direction: 'alternate'
  });

  targetElement.appendChild(placeholder); // Append the placeholder without removing existing content
}
// Automatically insert the summary
function insertSummary(targetElement, summaryContainer) {

  console.log('Inserting summary into the target element');
  targetElement.style.backgroundColor = ''; // Remove highlight
  targetElement.style.border = ''; // Remove dashed border
  targetElement.appendChild(summaryContainer); // Append the summary to the target element
}

// Function to let the user select a target element
function selectTargetElement() {
  console.log('Prompting user to select the target element');
  return new Promise((resolve) => {
    // Create the message div
    const messageDiv = document.createElement('div');
    messageDiv.id = 'ai-summary-message';
    messageDiv.textContent = 'Click on the element where you want to insert the summary.';
    document.body.appendChild(messageDiv);

    // Style the message div to appear near the cursor
    messageDiv.style.position = 'absolute';
    messageDiv.style.backgroundColor = '#007bff';
    messageDiv.style.color = 'white';
    messageDiv.style.padding = '5px 10px';
    messageDiv.style.borderRadius = '5px';
    messageDiv.style.fontSize = '14px';
    messageDiv.style.zIndex = '10000';
    messageDiv.style.pointerEvents = 'none'; // Make sure the div does not interfere with clicks

    // Move the message div with the cursor
    document.addEventListener('mousemove', (event) => {
      messageDiv.style.left = event.pageX + 15 + 'px'; // Slight offset to the right of the cursor
      messageDiv.style.top = event.pageY + 15 + 'px';  // Slight offset below the cursor
    });

    // Function to toggle hover effect
    function hoverHandler(event) {
      event.target.classList.toggle('hover-effect');
    }

    // Function to handle click and resolve the target element
    function clickHandler(event) {
      event.preventDefault();
      event.stopPropagation();

      // Remove event listeners
      document.body.style.cursor = 'default';
      document.removeEventListener('click', clickHandler);
      document.removeEventListener('mouseover', hoverHandler);
      document.removeEventListener('mouseout', hoverHandler);
      document.removeEventListener('mousemove', mouseMoveHandler);

      // Remove the message
      messageDiv.remove();

      // Resolve the target element
      const targetElement = event.target;
      resolve(targetElement);
    }

    // Mouse move event handler to move the message
    function mouseMoveHandler(event) {
      messageDiv.style.left = event.pageX + 15 + 'px';
      messageDiv.style.top = event.pageY + 15 + 'px';
    }

    // Add the necessary event listeners
    document.addEventListener('mouseover', hoverHandler);
    document.addEventListener('mouseout', hoverHandler);
    document.addEventListener('click', clickHandler, { once: true });
    document.addEventListener('mousemove', mouseMoveHandler);
  });
}

/**
 * Universal Debug Panel - Now handles all models
 */
function updateDebugPanel(text, apiUrl) {
  let panel = document.getElementById('ai-summary-debug');
  if (!panel) {
    panel = document.createElement('div');
    panel.id = 'ai-summary-debug';
    panel.style.cssText = `position:fixed;right:10px;bottom:10px;width:350px;max-height:40vh;overflow:auto;background:#222;color:#0f0;padding:10px;z-index:10000;font-family:monospace;font-size:11px;border-radius:5px;box-shadow:0 0 10px rgba(0,0,0,0.5);`;
    document.body.appendChild(panel);
  }
  panel.innerHTML = `<strong>Debug (${apiUrl})</strong><hr><pre style="white-space:pre-wrap">${text}</pre>`;
}

