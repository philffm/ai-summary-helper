// content.js is the script that runs in the context of the current tab's webpage. It is responsible for fetching the content of the page, sending it to the OpenAI API, and inserting the generated summary back into the page.
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  console.log('Received message:', request); // Log received message
  if (request.action === 'fetchSummary') {
    fetchSummary(request.additionalQuestions);
  }
});

async function fetchSummary(additionalQuestions) {
  console.log('Starting fetchSummary'); // Log function call
  const content = getAllTextContent();
  console.debug('Fetched content:', content);

  const MAX_TOKENS = 4000; // Set a safer limit for content to prevent exceeding model's context length

  chrome.storage.sync.get(['apiKey', 'prompt'], async (data) => {
    console.log('Retrieved storage data:', data); // Log storage retrieval
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

    // truncate content to max tokens
    const truncatedContent = truncateToTokenLimit(content, MAX_TOKENS);


    if (!apiKey) {
      alert('Please set your OpenAI API key in the extension popup.');
      return;
    }

    try {
      console.log('🕵️ Fetching summary from OpenAI...');
      const requestBody = JSON.stringify({
        model: 'gpt-3.5-turbo',
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
    } catch (error) {
      console.error('❌ Error fetching summary:', error);
      alert('Error fetching summary. Check the console for details.');
    }
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
  console.log('Getting all text content'); // Log function call
  const elements = document.querySelectorAll('p, h1, h2, h3');
  let content = '';
  elements.forEach(element => {
    content += element.textContent + '\n\n';
  });
  console.log('Collected content:', content); // Log collected content
  return content.trim();
}

function insertSummary(summaryContainer) {
  console.log('Inserting summary'); // Log function call
  const firstH1 = document.querySelector('h1');
  if (!firstH1) {
    console.warn('No <h1> element found on the page');
    return;
  }

  function findAndInsertAfterFirstLongParagraph(element) {
    if (element.tagName.toLowerCase() === 'p' && element.textContent.length > 100) {
      element.insertAdjacentElement('afterend', summaryContainer);
      console.log('Summary inserted'); // Log insertion
      return true;
    }

    for (let child of element.children) {
      if (findAndInsertAfterFirstLongParagraph(child)) {
        return true;
      }
    }

    return false;
  }

  let currentElement = firstH1.nextElementSibling;
  while (currentElement) {
    if (findAndInsertAfterFirstLongParagraph(currentElement)) {
      return;
    }
    currentElement = currentElement.nextElementSibling;
  }

  // If not found in the siblings, search recursively up and down the DOM tree
  let parentElement = firstH1.parentElement;
  while (parentElement) {
    if (findAndInsertAfterFirstLongParagraph(parentElement)) {
      return;
    }
    parentElement = parentElement.parentElement;
  }

  // if not found, insert after the first h1 and output in console
  firstH1.insertAdjacentElement('afterend', summaryContainer);

  
  console.warn('No suitable <p> element found after the first <h1>');
}
