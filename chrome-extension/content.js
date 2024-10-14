chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  console.log('Received message:', request);
  if (request.action === 'fetchSummary') {
    selectTargetElement().then((targetElement) => {
      if (targetElement) {
        showPlaceholder(targetElement); // Show "Fetching" placeholder
        fetchSummary(request.additionalQuestions, targetElement).then((result) => {
          sendResponse(result);
        }).catch((error) => {
          sendResponse({ success: false, message: error.message });
        });
      } else {
        sendResponse({ success: false, message: 'No target element selected' });
      }
    });
    return true; // Indicates we will send a response asynchronously
  }
});

async function fetchSummary(additionalQuestions, targetElement) {
  console.log('Starting fetchSummary');
  const content = getAllTextContent();
  console.debug('Fetched content:', content);

  const MAX_TOKENS = 4000;

  return new Promise((resolve, reject) => {
    // Fetch settings including API key, prompt, and model from Chrome storage
    chrome.storage.sync.get(['apiKey', 'prompt', 'model', 'localEndpoint', 'modelIdentifier'], async (data) => {
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

      let prompt = data.prompt && data.prompt.length > 1
        ? data.prompt
        : `
        <h3> section: Article summary section with creative title where you explain it like I'm five what's the deal with the article.
        <h3> section: More extensive summary with a bit more detail (4-5 sentences).
        <h3> section: Make a fun reference to the topic related to my competence as a UX designer.
        <h3> section: make fun about the topic like a standup comedian.
        <h3> section: related book and media recommendations.
        <h3> section: if additional questions are provided, answer them in a serious and engaging way.
        Add emojis, add hashtags, use html, highlight interesting parts, word limit: max 1000 - as much as you think is appropriate`;

      if (additionalQuestions) {
        prompt += `\n\nAdditional questions: ${additionalQuestions} - Please answer in a serious and engaging way.`;
        console.debug('Prompt with additional questions', prompt);
      }

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
            { role: 'system', content: 'You are a helpful assistant.' },
            { role: 'user', content: 'Summarize in valid html format with sections:' + prompt },
            { role: 'user', content: truncatedContent },
          ],
          stream: false // Ensure streaming is off for local models
        });

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

        // Adjust this part to correctly access the message content
        let summary;
        if (model === 'ollama' || model === 'llama3.2') {
          // Adjust for the response structure from Ollama using the llama3.2 model
          summary = result.message?.content || 'Error: No summary returned';
        } else if (model === 'openai' || model === 'mistral') {
          // For OpenAI or Mistral models that use the `choices` array
          summary = result.choices?.[0]?.message?.content || 'Error: No summary returned';
        } else {
          summary = 'Error: Unsupported model';
        }


        const summaryContainer = document.createElement('blockquote');
        summaryContainer.innerHTML = `<div><h2>AI Summary 🧙</h2>${summary.replace(/\n\n/g, '<br>')}</div>`;

        insertSummary(targetElement, summaryContainer); // Insert the fetched summary without removing existing content
        resolve({ success: true, message: 'Summary inserted successfully' });

      } catch (error) {
        console.error('❌ Error fetching summary:', error);
        targetElement.querySelector('.placeholder').innerHTML = 'Error fetching summary. Please try again later.'; // Show error message
        reject(error);
      }
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

// Function to show "Fetching" placeholder without removing the original content
function showPlaceholder(targetElement) {
  console.log('Showing placeholder in the selected element');

  const placeholder = document.createElement('div');
  placeholder.classList.add('placeholder');
  placeholder.style.backgroundColor = '#f0f0f0'; // Highlight the element
  placeholder.style.padding = '32px';
  placeholder.innerHTML = 'Fetching summary... ⏳';

  // Add subtle animation to the placeholder
  placeholder.animate([
    { opacity: 0.5 },
    { opacity: 1 }
  ], {
    duration: 1000,
    iterations: Infinity
  });

  targetElement.appendChild(placeholder); // Append the placeholder without removing existing content
}

// Automatically insert the summary
function insertSummary(targetElement, summaryContainer) {
  // Remove the placeholder but keep the existing content
  const placeholder = targetElement.querySelector('.placeholder');
  if (placeholder) placeholder.remove();

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
