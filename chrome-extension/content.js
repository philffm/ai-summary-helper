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
  console.log('Received message:', request);
  if (request.action === 'fetchSummary') {
    const { additionalQuestions, selectedLanguage, prompt } = request;

    chrome.storage.sync.get(['summaryLength'], (data) => {
      const summaryLength = data.summaryLength || 500; // Default to 500 if not set

      const donationMessage = getRandomDonationMessage();
      const donationLink = `<a href="https://link.philwornath.com/?source=aish#donate" target="_blank">${donationMessage}</a>`;

      selectTargetElement().then((targetElement) => {
        if (targetElement) {
          fetchSummary(additionalQuestions, selectedLanguage, prompt, summaryLength, targetElement).then((result) => {
            sendResponse(result);
          }).catch((error) => {
            sendResponse({ success: false, message: error.message });
          });
        } else {
          sendResponse({ success: false, message: 'No target element selected' });
        }
      });

    });

    return true; // Indicates we will send a response asynchronously
  } else if (request.action === 'setServices') {
    servicesData = request.services;
    console.log('Services data received:', servicesData);
  } else if (request.action === 'setModelConfig') {
    modelConfig = request.modelConfig;
    console.log('Model configuration received:', modelConfig);
  }
});

async function fetchSummary(additionalQuestions, selectedLanguage, prompt, summaryLength, targetElement) {
  const tokenLimit = 1000; // Define a default value for tokenLimit

  const promptDetails = {
    prompt,
    summaryLength,
    additionalQuestions,
    selectedLanguage
  };
  console.log('Starting fetchSummary with prompt details:', promptDetails);

  // Fetch content before showing the placeholder
  const content = getAllTextContent();
  console.debug('Fetched content:', content);

  // Capture the current page URL
  const pageUrl = window.location.href;
  console.debug('Page URL:', pageUrl);

  // Capture the page title
  const pageTitle = document.title;
  console.debug('Page Title:', pageTitle);

  // Capture the meta description
  const metaDescription = document.querySelector('meta[name="description"]')?.getAttribute('content') || 'No description available';
  console.debug('Meta Description:', metaDescription);

  // Truncate content to fit within the token limit
  const truncatedContent = truncateToTokenLimit(content, tokenLimit);
  console.debug('Truncated content:', truncatedContent);

  // Show placeholder after fetching content
  const donationMessage = getRandomDonationMessage();
  showPlaceholder(targetElement, donationMessage);

  const MAX_TOKENS = 4000;

  return new Promise((resolve, reject) => {
    chrome.storage.sync.get(['activeService', 'servicesConfig'], async (data) => {
      console.log('Retrieved storage data:', data);

      const activeService = data.activeService || 'openai';
      const cfg = (data.servicesConfig || {})[activeService] || {};
      const apiKey = cfg.apiKey || '';

      if (!apiKey) {
        alert('Please set your API key in the extension popup.');
        reject(new Error('API key not set'));
        return;
      }

      try {
        // Prefer modelConfig sent from popup (endpoint + model + responseStructure)
        let apiUrl = modelConfig?.endpointUrl || cfg.endpoint;
        let modelIdentifier = modelConfig?.modelIdentifier || cfg.customModel || cfg.model;

        console.debug('Resolved apiUrl:', apiUrl, 'modelIdentifier:', modelIdentifier);

        if (!apiUrl) {
          const msg = 'Model endpoint is not configured. Open the extension settings and set a valid endpoint.';
          console.error('❌', msg);
          const placeholderEl = targetElement.querySelector('.placeholder');
          if (placeholderEl) placeholderEl.innerHTML = msg;
          throw new Error(msg);
        }

        try {
          new URL(apiUrl);
        } catch (urlErr) {
          const msg = `Configured endpoint is not a valid URL: ${apiUrl}`;
          console.error('❌', msg, urlErr);
          const placeholderEl = targetElement.querySelector('.placeholder');
          if (placeholderEl) placeholderEl.innerHTML = msg;
          throw new Error(msg);
        }

        console.log('🕵️ Fetching summary from:', modelIdentifier);

        // Prepare request and headers. Gemini requires a different shape and
        // uses the `x-goog-api-key` header instead of Bearer tokens.
        let requestBody;
        const headers = { 'Content-Type': 'application/json' };
        let finalApiUrl = apiUrl;

        if (activeService === 'gemini') {
          // Build Gemini REST request: contents -> parts -> text
          // Ensure we call the correct model-specific endpoint
          finalApiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(modelIdentifier)}:generateContent`;

          // Ask Gemini to return strict, valid HTML only. Place the instruction
          // before the user content so the model understands the required output
          // format. We include language and length constraints.
          const geminiInstruction = `Please produce ONLY valid HTML. Return a single <div> element containing an <h2> title (the summary heading) and one or more <p> paragraphs (the summary content). Do NOT include any explanation, JSON, markdown, or surrounding text — only the HTML snippet. Preserve quoted text exactly as in the source.`;

          requestBody = JSON.stringify({
            contents: [
              {
                parts: [
                  { text: `${geminiInstruction}\n\nOutput Language: ${selectedLanguage}. Strictly stick to a maximum of ${summaryLength} words.\n\nPrompt:\n${prompt}\n\nContent:\n${truncatedContent}` }
                ]
              }
            ]
          });

          // Gemini expects an API key in the `x-goog-api-key` header
          headers['x-goog-api-key'] = apiKey;
        } else {
          // Default: OpenAI-like providers (chat completion style)
          requestBody = JSON.stringify({
            model: modelIdentifier,
            messages: [
              { role: 'system', content: 'You summarize content and return a html div  with h2 headings and <p> paragraphs. When you quote, keep it literal and in the input language.' },
              { role: 'user', content: 'Strictly stick to word limit of ' + summaryLength + ' words or ' + tokenLimit + ' tokens' + ' Output Language: ' + selectedLanguage + '. ' + prompt + truncatedContent },
            ],
            stream: false // Ensure streaming is off for local models
          });

          headers['Authorization'] = `Bearer ${apiKey}`;
        }

        console.log('🚀 Request URL:', finalApiUrl);
        console.log('🚀 Request headers:', headers);
        console.log('🚀 Request body:', requestBody);

        // Show donation and bug message
        const donationMessage = getRandomDonationMessage();
        const messageContainer = document.createElement('div');
        messageContainer.innerHTML = `
        <p>Questions, bugs or ideas? 💡, feel free to <a href="https://philwornath.com/?ref=aish#contact" target="_blank">contact me</a></p>
        <p>${donationMessage} - <a href="https://link.philwornath.com/?source=aish#donate" target="_blank">Support AI Summary Helper</a></p>
        `;

        const response = await fetch(finalApiUrl, {
          method: 'POST',
          headers,
          body: requestBody
        });

        if (!response.ok) {
          const errorResponse = await response.text();
          console.error(`HTTP error! status: ${response.status}, response: ${errorResponse}`);

          // Provide a clearer message for Gemini 401/UNAUTHENTICATED errors
          if (activeService === 'gemini' && response.status === 401) {
            throw new Error(`HTTP ${response.status} - Gemini authentication failed. Gemini requires an API key passed in the 'x-goog-api-key' header (see https://ai.google.dev/gemini-api/docs/api-key). Response: ${errorResponse}`);
          }

          throw new Error(`HTTP error! status: ${response.status}, response: ${errorResponse}`);
        }

        const result = await response.json();
        console.debug('🚀 API response:', result);

        // Helper: safely extract a nested field using a responseStructure string like
        // "result.choices?.[0]?.message?.content". This implements optional chaining
        // and array index access without using eval.
        function getByResponseStructure(obj, responseStructure) {
          try {
            if (!responseStructure || typeof responseStructure !== 'string') return undefined;
            let path = responseStructure.replace(/^result\./, '');
            // Treat optional chaining tokens `?.` as `.` for traversal; we'll bail on undefined anyway.
            path = path.replace(/\?\./g, '.');
            const re = /([A-Za-z_$][\w$]*)|\[(\d+)\]/g;
            let cur = obj;
            let match;
            while ((match = re.exec(path)) !== null) {
              const prop = match[1] !== undefined ? match[1] : Number(match[2]);
              if (cur == null) return undefined;
              cur = cur[prop];
            }
            return cur;
          } catch (e) {
            console.warn('getByResponseStructure failed', e);
            return undefined;
          }
        }

        // Primary extraction using responseStructure from services if available
        let summary = getByResponseStructure(result, modelConfig?.responseStructure);

        // Common fallbacks for various API shapes
        if (!summary) {
          if (result.choices && result.choices[0]) {
            // OpenAI-like: choices[0].message.content or choices[0].text
            summary = result.choices[0].message?.content || result.choices[0].text;
          }
        }
        // Gemini-like responses: candidates[].content.parts[].text
        if (!summary && result.candidates && result.candidates[0]) {
          summary = result.candidates[0].content?.parts?.[0]?.text || result.candidates[0].text;
        }
        if (!summary && result.message && result.message.content) {
          summary = result.message.content;
        }
        if (!summary && Array.isArray(result.output) && result.output[0]) {
          // Some providers use result.output[0].content[0].text
          summary = result.output[0].content?.[0]?.text || result.output[0].text;
        }
        if (!summary && result.content) {
          summary = result.content;
        }

        if (!summary) summary = 'Error: No summary returned';

        // Remove the placeholder but keep the existing content
        const placeholder = targetElement.querySelector('.placeholder');
        if (placeholder) placeholder.remove();

        // remove placeholder from content 
        const placeholderInContent = content.replace(/<div class="placeholder">.*<\/div>/, '');

        // Save additional details to local storage
        saveToLocalStorage(content, summary, pageUrl, pageTitle, metaDescription);

        const summaryContainer = document.createElement('blockquote');
        summaryContainer.innerHTML = `
        <div><h2>AI Summary 🧙</h2>  ${summary.replace(/\n\n/g, '<br>')} ${messageContainer.innerHTML}  </div>`;

        insertSummary(targetElement, summaryContainer);
        resolve({ success: true, message: 'Summary inserted successfully' });

      } catch (error) {
        console.error('❌ Error fetching summary:', error);
        targetElement.querySelector('.placeholder').innerHTML = `Error fetching summary. Please try again later. Make sure your API key is set and internet connection is stable. If the problem persists, please <a href="https://app.formbricks.com/s/cm3kn4nmg00032dmy85vlbjzp" target="_blank">give feedback</a> or <a href="https://philwornath.com/?ref=aish#contact" target="_blank">contact me</a>. Error details: ${error.message}`;
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

// Function to truncate text content to fit within a token limit
function truncateToTokenLimit(text, maxTokens) {
  const encodedText = new TextEncoder().encode(text);
  if (encodedText.length > maxTokens) {
    return new TextDecoder().decode(encodedText.slice(0, maxTokens));
  }
  return text;
}

// Function to extract all relevant text content from the page
function getAllTextContent() {
  console.log('Getting all text content');
  const elements = document.querySelectorAll('p, h1, h2, h3');
  let content = '';
  elements.forEach(element => {
    content += element.textContent + '\n\n';
  });
  console.log('Collected content:', content);
  return content.trim();
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

