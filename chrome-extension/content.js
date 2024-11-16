let cachedDonationMessage = '';

// Define the donation messages
const donationMessages = [
  "Like the extension? Help me brew new ideas with a soothing cup of tea! 🍵",
  "Love the extension? Help me upgrade my workspace with a new plant! 🌿",
  "Want to support? Buy me a book to inspire the next feature! 📚",
  "Supporting my work? Help me fund a tiny house to code in peace! 🏡",
  "Love this project? Get me closer to my goal of relocating into a sailboat! 🚤",
  "Feeling generous? A pizza would definitely boost my brainstorming sessions! 🍕",
  "Enjoying the tool? Help me turn my remote work into a van life adventure! 🚐",
  "Happy with the tool? Your support can help me build my tiny home! 🏠",
  "Appreciate the extension? Buy me a kayak to paddle through my creative process! 🛶",
  "Like innovation? Support my mission to design from the deck of a boat! ⛴️",
  "Enjoying the tool? Get me a smoothie to recharge my problem-solving skills! 🥤"
];

// Function to get a random donation message
function getRandomDonationMessage() {
  const randomIndex = Math.floor(Math.random() * donationMessages.length);
  return donationMessages[randomIndex];
}

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
          showPlaceholder(targetElement, donationLink); // Use the donation link
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
  }
});

async function fetchSummary(additionalQuestions, selectedLanguage, prompt, summaryLength, targetElement) {
  const promptDetails = {
    prompt,
    summaryLength,
    additionalQuestions,
    selectedLanguage
  };
  console.log('Starting fetchSummary with prompt details:', promptDetails);
  const content = getAllTextContent();
  console.debug('Fetched content:', content);

  const MAX_TOKENS = 4000;

  return new Promise((resolve, reject) => {
    chrome.storage.sync.get(['apiKey', 'model', 'localEndpoint', 'modelIdentifier'], async (data) => {
      console.log('Retrieved storage data:', data);
      const apiKey = data.apiKey;
      const model = data.model || 'openai';
      const localEndpoint = data.localEndpoint || 'http://localhost:11434/api/chat';
      const userModelIdentifier = data.modelIdentifier;

      const modelIdentifier = userModelIdentifier || (model === 'openai'
        ? 'gpt-4o-mini'
        : model === 'mistral'
          ? 'mistral-large-latest'
          : 'llama3.2'); // Default to llama3.2 for Ollama

      if (additionalQuestions) {
        prompt += `\n\nAdditional questions: ${additionalQuestions} - Please answer in a serious and engaging way.`;
        console.debug('Prompt with additional questions', prompt);
      }

      if (selectedLanguage && selectedLanguage !== 'en') {
        prompt += `\n\nImportant: Summarize in  ${selectedLanguage} language.`;
      }

      prompt += `\n\nPlease limit the summary to approximately ${summaryLength} words.`;

      const truncatedContent = truncateToTokenLimit(content, MAX_TOKENS);

      if (!apiKey) {
        alert('Please set your API key in the extension popup.');
        reject(new Error('API key not set'));
        return;
      }

      try {
        const apiUrl = model === 'openai'
          ? 'https://api.openai.com/v1/chat/completions'
          : model === 'mistral'
            ? 'https://api.mistral.ai/v1/chat/completions'
            : localEndpoint; // Use local endpoint for Ollama

        console.log('🕵️ Fetching summary from:', model);
        const requestBody = JSON.stringify({
          model: modelIdentifier,
          messages: [
            { role: 'system', content: 'You summarize content and return a html div  with h2 headings and <p> paragraphs. When you quote, keep it literal and in the input language.' },
            { role: 'user', content: 'Stick to word limit of ' + summaryLength + ' words. ' + 'Output Language: ' + selectedLanguage + '. ' + prompt + truncatedContent },
          ],
          stream: false // Ensure streaming is off for local models
        });

        console.log('🚀 Request body:', requestBody);
        // Show donation and bug message
        const donationMessage = getRandomDonationMessage();
        const messageContainer = document.createElement('div');
        messageContainer.innerHTML = `
        <p>Questions, bugs or ideas? 💡, feel free to <a href="https://philwornath.com/?ref=aish#contact" target="_blank">contact me</a></p>
        <p>${donationMessage} - <a href="https://link.philwornath.com/?source=aish#donate" target="_blank">Donate here</a></p>
        `;

        const response = await fetch(apiUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`
          },
          body: requestBody
        });

        if (!response.ok) {
          const errorResponse = await response.text();
          throw new Error(`HTTP error! status: ${response.status}, response: ${errorResponse}`);
        }

        const result = await response.json();
        console.debug('🚀 API response:', result);

        let summary;
        if (model === 'ollama' || model === 'llama3.2') {
          summary = result.message?.content || 'Error: No summary returned';
        } else if (model === 'openai' || model === 'mistral') {
          summary = result.choices?.[0]?.message?.content || 'Error: No summary returned';
        } else {
          summary = 'Error: Unsupported model';
        }

        // Remove the placeholder but keep the existing content
        const placeholder = targetElement.querySelector('.placeholder');
        if (placeholder) placeholder.remove();

        // remove placeholder from content 
        const placeholderInContent = content.replace(/<div class="placeholder">.*<\/div>/, '');

        saveToLocalStorage(content, summary);

        const summaryContainer = document.createElement('blockquote');
        summaryContainer.innerHTML = `
        <div><h2>AI Summary 🧙</h2>  ${summary.replace(/\n\n/g, '<br>')} ${messageContainer.innerHTML}  </div>`;

        insertSummary(targetElement, summaryContainer);
        resolve({ success: true, message: 'Summary inserted successfully' });

      } catch (error) {
        console.error('❌ Error fetching summary:', error);
        targetElement.querySelector('.placeholder').innerHTML = 'Error fetching summary. Please try again later.';
        reject(error);
      }
    });
  });
}

// Function to save content and summary to local storage
function saveToLocalStorage(content, summary) {
  const timestamp = new Date().toISOString();
  const articleData = { content, summary, timestamp };

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

// Function to determine if the background is light or dark
function isBackgroundDark() {
  const bodyStyle = window.getComputedStyle(document.body);
  const backgroundColor = bodyStyle.backgroundColor;
  const rgb = backgroundColor.match(/\d+/g);
  if (!rgb) return false; // Default to light if unable to determine

  // Calculate luminance
  const luminance = (0.299 * rgb[0] + 0.587 * rgb[1] + 0.114 * rgb[2]) / 255;
  return luminance < 0.5; // Dark if luminance is less than 0.5
}

// Function to show "Fetching" placeholder without removing the original content
function showPlaceholder(targetElement, donationMessage) {
  console.log('Showing placeholder in the selected element');

  const placeholder = document.createElement('div');
  placeholder.classList.add('placeholder');

  const isDark = isBackgroundDark();
  const textColor = isDark ? '#000' : '#fff';
  const linkColor = isDark ? '#000' : '#fff';

  placeholder.style.backgroundColor = isDark ? 'rgba(255, 255, 255, 0.7)' : 'rgba(0, 0, 0, 0.7)';
  placeholder.style.color = textColor;
  placeholder.style.border = '2px dashed #007bff';
  placeholder.style.borderRadius = '10px';
  placeholder.style.padding = '32px';
  // link color



  placeholder.innerHTML = `
    <style>
     @keyframes spin {
        from { transform: rotate(0deg); }
        to { transform: rotate(360deg); }
      }
    </style>
    <div style="font-size: 24px;">Fetching summary... <span style="display: inline-block; animation: spin 2s linear infinite;">⏳</span></div>
    <div style="font-size: 16px; margin-top: 10px; font-weight: bold;">
      ${donationMessage}<br>
      Questions, bugs or ideas? 💡, feel free to <a href="https://philwornath.com/?ref=aish#contact" target="_blank" style="color: ${linkColor}; font-weight: bold;">contact me</a>
    </div>
  `;

  // Add subtle animation to the placeholder
  placeholder.animate([
    { backgroundColor: isDark ? 'rgba(255, 255, 255, 0.7)' : 'rgba(0, 0, 0, 0.7)' },
    { backgroundColor: isDark ? 'rgba(255, 255, 255, 1)' : 'rgba(0, 0, 0, 1)' }
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
