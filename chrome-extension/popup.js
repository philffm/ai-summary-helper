document.addEventListener('DOMContentLoaded', () => {
  console.log('Popup DOMContentLoaded');

  const apiKeyInput = document.getElementById('apiKey');
  const modelInput = document.getElementById('model'); // New model selector
  const promptInput = document.getElementById('prompt');
  const fetchSummaryButton = document.getElementById('fetchSummary');
  const additionalQuestionsInput = document.getElementById('additionalQuestions');
  const settingsForm = document.getElementById('settingsForm');
  const toggleScreenButton = document.getElementById('toggleScreenButton');
  const mainScreen = document.getElementById('mainScreen');
  const settingsScreen = document.getElementById('settingsScreen');
  const spinner = document.getElementById('spinner');
  const donateLink = document.getElementById('donate-link');
  const apiKeyContainer = document.getElementById('apiKeyContainer'); // Container for API key input
  const localEndpointContainer = document.getElementById('localEndpointContainer'); // Container for local endpoint input
  const localEndpointInput = document.getElementById('localEndpoint'); // Input for local endpoint
  const modelIdentifierInput = document.getElementById('modelIdentifier');

  const archiveButton = document.getElementById('archiveButton');
  const backButton = document.getElementById('backButton');
  const archiveScreen = document.getElementById('archiveScreen');
  const articleList = document.getElementById('articleList');

  const titleElement = document.querySelector('.logoheader h2');

  // Load donation messages from JSON file
  fetch('donationMessages.json')
    .then(response => response.json())
    .then(donationMessages => {
      const randomMessage = donationMessages[Math.floor(Math.random() * donationMessages.length)];
      donateLink.textContent = randomMessage;
    })
    .catch(error => console.error('Error loading donation messages:', error));

  // Toggle between settings screen and main screen
  toggleScreenButton.addEventListener('click', () => {
    if (settingsScreen.style.display === 'block') {
      showMainScreen();
    } else {
      showSettingsScreen();
    }
  });

  // Show archive screen
  archiveButton.addEventListener('click', () => {
    showArchiveScreen();
    loadArchivedArticles();
  });

  // Back to main screen from archive
  backButton.addEventListener('click', showMainScreen);

  function showMainScreen() {
    mainScreen.style.display = 'block';
    settingsScreen.style.display = 'none';
    archiveScreen.style.display = 'none';
    archiveButton.style.display = 'inline-block';
    backButton.style.display = 'none';
    toggleScreenButton.style.display = 'inline-block';
    toggleScreenButton.textContent = '⚙️';
    titleElement.textContent = 'AI Summary Helper';
  }

  function showSettingsScreen() {
    mainScreen.style.display = 'none';
    settingsScreen.style.display = 'block';
    archiveScreen.style.display = 'none';
    archiveButton.style.display = 'none';
    backButton.style.display = 'none';
    toggleScreenButton.style.display = 'inline-block';
    toggleScreenButton.textContent = 'Back';
    titleElement.textContent = 'Settings';
  }

  function showArchiveScreen() {
    mainScreen.style.display = 'none';
    document.body.style.margin = '0';
    settingsScreen.style.display = 'none';
    archiveScreen.style.display = 'block';
    archiveButton.style.display = 'none';
    backButton.style.display = 'inline-block';
    toggleScreenButton.style.display = 'none';
    titleElement.textContent = 'Archive (Beta)';
  }

  function loadArchivedArticles() {
    chrome.storage.local.get({ articles: [] }, (data) => {
      const articleList = document.getElementById('articleList');
      articleList.innerHTML = ''; // Clear existing list

      if (data.articles.length === 0) {
        // Display a fun message if there are no articles
        const emptyMessage = document.createElement('div');
        emptyMessage.classList.add('empty-message');
        emptyMessage.innerHTML = `
          <p>🗂️ Your archive is as empty as a desert! Start saving some articles to fill it up. 🌵</p>
        `;
        articleList.appendChild(emptyMessage);
      } else {
        // Sort articles by timestamp in descending order
        const sortedArticles = data.articles.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

        sortedArticles.forEach((article, index) => {
          const articleHeader = article.content.substring(0, 50) + '...';
          const listItem = document.createElement('li');
          listItem.classList.add('article-card');
          const formattedDate = new Date(article.timestamp).toLocaleDateString(undefined, {
            year: 'numeric',
            month: 'short',
            day: 'numeric'
          });
          const formattedTime = new Date(article.timestamp).toLocaleTimeString(undefined, {
            hour: '2-digit',
            minute: '2-digit'
          });

          // Extract domain name from URL if available
          let domainName = 'Unknown Source';
          let urlLink = '';
          if (article.url) {
            try {
              const url = new URL(article.url);
              domainName = url.hostname;
              urlLink = `<a href="${article.url}" target="_blank">${domainName}</a>`;
            } catch (e) {
              console.error('Invalid URL:', article.url);
            }
          }

          listItem.innerHTML = `
            <div class="article-header">
              <div>
                <h4>${articleHeader}</h4>
                <p class="article-date">💾 ${formattedDate} at ${formattedTime}</p>
              </div>
              <button class="expand-button">Expand</button>
              </div>
              <div class="article-content" style="display: none;">
              <button class="secondary share-button">Share 🔗</button>
              <button class="secondary open-button">Open in New Tab 👓</button>
              <p><strong>Summary:</strong> ${article.summary}</p>
              <p><strong>Content:</strong> ${article.content}</p>
            </div>
          `;
          articleList.appendChild(listItem);

          const expandButton = listItem.querySelector('.expand-button');
          const articleContent = listItem.querySelector('.article-content');
          const openButton = listItem.querySelector('.open-button');
          const shareButton = listItem.querySelector('.share-button');

          // Add event listener to the entire card
          listItem.addEventListener('click', (event) => {
            // Prevent the event from triggering when clicking on buttons inside the card
            if (event.target.tagName === 'BUTTON') return;

            const isVisible = articleContent.style.display === 'block';
            articleContent.style.display = isVisible ? 'none' : 'block';
            expandButton.textContent = isVisible ? 'Expand' : 'Collapse';
          });

          expandButton.addEventListener('click', () => {
            const isVisible = articleContent.style.display === 'block';
            articleContent.style.display = isVisible ? 'none' : 'block';
            expandButton.textContent = isVisible ? 'Expand' : 'Collapse';
          });

          openButton.addEventListener('click', () => {
            const newTab = window.open();
            newTab.document.write(`
              <html>
                <head>
                  <title>Article Details</title>
                  <style>
                    body {
                      font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
                      padding: 20px;
                      max-width: 800px;
                      margin: auto;
                      background-color: #f5f5f5;
                      border-radius: 8px;
                      box-shadow: 0 0 10px rgba(0, 0, 0, 0.1);
                    }
                    h2 {
                      color: #333;
                    }
                    p, pre {
                      line-height: 1.6;
                    }
                    pre {
                      white-space: pre-wrap;
                      word-wrap: break-word;
                    }
                    .logo {
                      display: flex;
                      align-items: center;
                      gap: 12px;
                      margin-bottom: 20px;
                    }
                    .logo img {
                      width: 48px;
                      height: 48px;
                    }
                    .logo h1 {
                      font-size: 24px;
                      color: #333;
                    }
                  </style>
                </head>
                <body>
                  <div class="logo">
                    <h1>Saved Article from AI Summary Helper</h1>
                  </div>
                  <h2>Summary</h2>
                  <p>${article.summary}</p>
                  <h2>Content</h2>
                  <pre>${article.content}</pre>
                </body>
              </html>
            `);
            newTab.document.close();
          });

          shareButton.addEventListener('click', () => {
            if (navigator.share) {
              // Use Markdown-like syntax for formatting
              const summaryText = `**Summary:** ${article.summary.replace(/<[^>]*>/g, '')}`;
              const contentText = `**Content:** ${article.content.replace(/<[^>]*>/g, '')}`;
              navigator.share({
                title: 'Article from AI Summary Helper',
                text: `${summaryText}\n\n${contentText}`,
                url: article.url
              }).then(() => {
                console.log('Article shared successfully');
              }).catch((error) => {
                console.error('Error sharing article:', error);
              });
            } else {
              console.error('Web Share API not supported in this browser');
            }
          });
        });
      }
    });
  }

  // Function to toggle visibility of API key and endpoint inputs
  function toggleInputVisibility() {
    if (modelInput.value === 'ollama') {
      apiKeyContainer.style.display = 'none';
      localEndpointContainer.style.display = 'block';
    } else {
      apiKeyContainer.style.display = 'block';
      localEndpointContainer.style.display = 'none';
    }
  }

  // Default prompt to use as a placeholder
  const defaultPrompt = `
    <h3> Article summary section with creative title explaining the article in simple terms.
    <h3> More extensive summary with a bit more detail (4-5 sentences).
    <h3> Fun reference to the topic related to my competence as a UX designer.
    <h3> Humorous take on the topic like a standup comedian.
    <h3> Related book and media recommendations.
    <h3> Answer additional questions in a serious and engaging way.
    Add emojis, hashtags, use HTML, highlight interesting parts, max 1000 words.
  `;

  // Load stored settings from Chrome storage
  chrome.storage.sync.get(['apiKey', 'prompt', 'model', 'localEndpoint', 'modelIdentifier'], (data) => {
    console.log('Loaded settings:', data);
    apiKeyInput.value = data.apiKey || '';
    promptInput.value = data.prompt || '';
    modelInput.value = data.model || 'openai';
    localEndpointInput.value = data.localEndpoint || '';
    modelIdentifierInput.value = data.modelIdentifier || ''; // Load model identifier

    // Call toggleInputVisibility after setting the model to ensure correct initial visibility
    toggleInputVisibility();
  });

  // Save the settings when the form is submitted
  settingsForm.addEventListener('submit', (event) => {
    event.preventDefault();
    console.log('Settings form submitted');
    chrome.storage.sync.set({
      apiKey: apiKeyInput.value,
      prompt: promptInput.value,
      model: modelInput.value,
      localEndpoint: localEndpointInput.value,
      modelIdentifier: modelIdentifierInput.value // Save model identifier
    });

    // Change button text temporarily to indicate success
    const originalText = event.submitter.textContent;
    const originalBackground = event.submitter.style.background;
    event.submitter.textContent = 'Saved! 🎉';
    event.submitter.style.background = 'linear-gradient(135deg, #4CAF50, #388E3C)'; // Darker green gradient
    setTimeout(() => {
      event.submitter.textContent = originalText;
      event.submitter.style.background = originalBackground;
    }, 3000);
  });

  // Add event listener to model input to toggle input visibility
  modelInput.addEventListener('change', toggleInputVisibility);

  // Initial call to set the correct visibility on page load
  toggleInputVisibility();

  // Load prompts from prompts.json and populate the dropdown
  fetch('prompts.json')
    .then(response => response.json())
    .then(prompts => {
      const promptSelect = document.getElementById('promptSelect');
      const promptInput = document.getElementById('prompt'); // Assuming there's an input field for custom prompts

      // Add a "Custom" option to the dropdown
      const customOption = document.createElement('option');
      customOption.value = 'custom';
      customOption.textContent = 'Custom';
      promptSelect.appendChild(customOption);

      prompts.forEach(prompt => {
        const option = document.createElement('option');
        option.value = prompt.prompt;
        option.textContent = prompt.name;
        promptSelect.appendChild(option);
      });

      // Update the custom prompt field when a new prompt is selected
      promptSelect.addEventListener('change', () => {
        if (promptSelect.value !== 'custom') {
          promptInput.value = promptSelect.value;
        }
      });

      // Change dropdown to "Custom" when the prompt input is edited
      promptInput.addEventListener('input', () => {
        promptSelect.value = 'custom';
      });
    });

  fetchSummaryButton.addEventListener('click', () => {
    const additionalQuestions = additionalQuestionsInput.value;
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      chrome.tabs.sendMessage(tabs[0].id, { action: 'fetchSummary', additionalQuestions }, (response) => {
        if (response && response.success) {
          console.log('Summary fetched successfully:', response.message);
        } else {
          console.error('Failed to fetch summary:', response ? response.message : 'No response');
        }
      });
    });
  });
});
