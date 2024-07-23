chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  console.log('Received message:', request);
  if (request.action === 'fetchSummary') {
    fetchSummary(request.additionalQuestions).then((result) => {
      sendResponse(result);
    }).catch((error) => {
      sendResponse({ success: false, message: error.message });
    });
    return true;
  }
});

async function fetchSummary(additionalQuestions) {
  console.log('Starting fetchSummary');
  const content = getAllTextContent();
  console.debug('Fetched content:', content);

  const MAX_TOKENS = 4000;

  return new Promise((resolve, reject) => {
    chrome.storage.sync.get(['apiKey', 'prompt'], async (data) => {
      console.log('Retrieved storage data:', data);
      const apiKey = data.apiKey;
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
        alert('Please set your OpenAI API key in the extension popup.');
        reject(new Error('API key not set'));
        return;
      }

      try {
        console.log('🕵️ Fetching summary from OpenAI...');
        const requestBody = JSON.stringify({
          // model: 'gpt-3.5-turbo',
          model: 'gpt-4o-mini',
          messages: [
            { role: 'system', content: 'You are a helpful assistant.' },
            { role: 'user', content: 'Summarize in valid html format with sections:' + prompt },
            { role: 'user', content: truncatedContent },
          ]
        });
        console.debug('📦 Request payload:', requestBody);

        const response = await fetch('https://api.openai.com/v1/chat/completions', {
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
        console.debug('🚀 OpenAI response:', result);

        const summary = result.choices[0].message.content;

        const summaryContainer = document.createElement('blockquote');
        summaryContainer.innerHTML = `<div><h2>AI Summary 🧙</h2>${summary.replace(/\n\n/g, '<br>')}</div>`;

        insertSummary(summaryContainer);
        resolve({ success: true, message: 'Summary inserted successfully' });

      } catch (error) {
        console.error('❌ Error fetching summary:', error);
        alert('Error fetching summary. Check the console for details.');
        reject(error);
      }
    });
  });
}

function truncateToTokenLimit(text, maxTokens) {
  const encodedText = new TextEncoder().encode(text);
  if (encodedText.length > maxTokens) {
    return new TextDecoder().decode(encodedText.slice(0, maxTokens));
  }
  return text;
}

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

function insertSummary(summaryContainer) {
  console.log('Inserting summary');
  
  const style = document.createElement('style');
  style.innerHTML = `
    #ai-summary-message {
      position: fixed;
      top: 0;
      left: 0;
      width: 100%;
      background-color: #007bff;
      color: white;
      text-align: center;
      padding: 10px 0;
      z-index: 10000;
      font-size: 18px;
      font-weight: bold;
      animation: pulsate 1s infinite;
    }
    @keyframes pulsate {
      0% { transform: scale(1); }
      50% { transform: scale(1.1); }
      100% { transform: scale(1); }
    }
    .hover-effect {
      outline: 4px dashed #007bff;
      background-color: rgba(0, 123, 255, 0.1);
      animation: fadeInOut 2s;
      outline-offset: 4px;
    }
  `;
  document.head.appendChild(style);

  const messageDiv = document.createElement('div');
  messageDiv.id = 'ai-summary-message';
  messageDiv.textContent = 'Click on the element where you want to insert the summary before.';
  document.body.prepend(messageDiv);

  document.body.style.cursor = 'crosshair';

  function hoverHandler(event) {
    event.target.classList.toggle('hover-effect');
  }

  document.addEventListener('mouseover', hoverHandler);
  document.addEventListener('mouseout', hoverHandler);

  document.addEventListener('click', function handler(event) {
    event.preventDefault();
    event.stopPropagation();
    document.body.style.cursor = 'default';
    const targetElement = event.target;

    document.removeEventListener('click', handler);
    document.removeEventListener('mouseover', hoverHandler);
    document.removeEventListener('mouseout', hoverHandler);

    messageDiv.remove();
    targetElement.insertAdjacentElement('beforebegin', summaryContainer);
    console.log('Summary inserted before the selected element');
  }, { once: true });
}
