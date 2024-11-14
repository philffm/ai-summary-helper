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

  const historyButton = document.getElementById('historyButton');
  const backButton = document.getElementById('backButton');
  const historyScreen = document.getElementById('historyScreen');
  const articleList = document.getElementById('articleList');
  const screenList = [mainScreen, settingsScreen, historyScreen];
  const languageSelect = document.getElementById('languageSelect');


  const titleElement = document.querySelector('.logoheader h2');

  // Define a configuration object for screens
  const screenConfig = {
    mainScreen: {
      show: ['mainScreen', 'historyButton', 'toggleScreenButton'],
      toggleButtonText: '⚙️',
      titleText: 'AI Summary Helper'
    },
    settingsScreen: {
      show: ['settingsScreen', 'toggleScreenButton'],
      toggleButtonText: 'Back',
      titleText: 'Settings'
    },
    historyScreen: {
      show: ['historyScreen', 'backButton'],
      toggleButtonText: '',
      titleText: 'History (Beta)'
    }
  };

  // Function to show a screen based on the configuration
  function showScreen(screenName) {
    const config = screenConfig[screenName];
    if (!config) {
      console.error(`Screen configuration for "${screenName}" not found.`);
      return;
    }

    // Hide all screens and buttons by default
    screenList.forEach(screen => screen.style.display = 'none');
    document.getElementById('historyButton').style.display = 'none';
    document.getElementById('backButton').style.display = 'none';
    document.getElementById('toggleScreenButton').style.display = 'none';

    // Show only the elements specified in the configuration
    config.show.forEach(elementId => {
      const element = document.getElementById(elementId);
      if (element) {
        element.style.display = 'block';
      }
    });

    // Ensure body styles remain consistent
    document.body.style.margin = '0';
    document.body.style.padding = '0';
    document.body.style.lineHeight = '1.2';

    // Update toggle button text and title
    toggleScreenButton.textContent = config.toggleButtonText;
    titleElement.textContent = config.titleText;
  }

  // Event listeners to switch screens
  toggleScreenButton.addEventListener('click', () => {
    if (settingsScreen.style.display === 'block') {
      showScreen('mainScreen');
    } else {
      showScreen('settingsScreen');
    }
  });

  historyButton.addEventListener('click', () => {
    showScreen('historyScreen');
    loadHistory();
  });

  backButton.addEventListener('click', () => showScreen('mainScreen'));

  // Initial call to show the main screen
  showScreen('mainScreen');

  function loadHistory() {
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
              <button class="button-secondary expand-button">Expand</button>
            </div>
            <div class="article-content" style="display: none;">
              <button class="button-secondary share-button">Share 🔗</button>
              <button class="button-secondary open-button">Read 👓</button>
              <button class="delete-button" aria-label="Delete article">🗑️</button>
              <p><strong>Summary:</strong> ${article.summary}</p>
              <p><strong>Content:</strong> ${article.content}</p>
            </div>
          `;
          articleList.appendChild(listItem);

          const expandButton = listItem.querySelector('.expand-button');
          const articleContent = listItem.querySelector('.article-content');
          const openButton = listItem.querySelector('.open-button');
          const shareButton = listItem.querySelector('.share-button');
          const deleteButton = listItem.querySelector('.delete-button');

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
                      font-family: 'Georgia', serif;
                      padding: 20px;
                      max-width: 800px;
                      margin: auto;
                      background-color: #f4f4f4;
                      color: #333;
                      line-height: 1.6;
                    }
                    h2 {
                      color: #444;
                    }
                    p, pre {
                      line-height: 1.6;
                    }
                    pre {
                      white-space: pre-wrap;
                      word-wrap: break-word;
                    }
                  </style>
                </head>
                <body>
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


          deleteButton.addEventListener('click', function () {
            if (confirm('Are you sure you want to delete this article?')) {
              // Retrieve the articles array from storage
              chrome.storage.local.get('articles', (data) => {
                const articles = data.articles || [];

                // Use a unique identifier for each article, such as a timestamp or a unique ID
                const updatedArticles = articles.filter((item) => item.timestamp !== article.timestamp);

                // Save the updated list back to local storage
                chrome.storage.local.set({ articles: updatedArticles }, () => {
                  console.log('Article deleted successfully');
                  loadHistory(); // Refresh the archive list
                });
              });
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
  chrome.storage.sync.get(['apiKey', 'prompt', 'model', 'localEndpoint', 'modelIdentifier', 'selectedLanguage'], (data) => {
    console.log('Loaded settings:', data);
    apiKeyInput.value = data.apiKey || '';
    promptInput.value = data.prompt || '';
    modelInput.value = data.model || 'openai';
    localEndpointInput.value = data.localEndpoint || '';
    modelIdentifierInput.value = data.modelIdentifier || ''; // Load model identifier

    // Set the selected language if it exists
    if (data.selectedLanguage) {
      languageSelect.value = data.selectedLanguage;
    }

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
    const additionalQuestions = document.getElementById('additionalQuestions').value;
    const selectedLanguage = document.getElementById('languageSelect').value;

    // Disable the button and change its text
    fetchSummaryButton.disabled = true;
    fetchSummaryButton.textContent = 'Select content element';

    // Send a message to the content script with the donation message
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      chrome.tabs.sendMessage(tabs[0].id, {
        action: 'fetchSummary',
        additionalQuestions,
        selectedLanguage,
      }, (response) => {
        if (response && response.success) {
          console.log('Summary fetched successfully:', response.message);
        } else {
          console.error('Failed to fetch summary:', response ? response.message : 'No response');
        }

        // Re-enable the button and reset its text after the operation
        fetchSummaryButton.disabled = false;
        fetchSummaryButton.textContent = '🪄 Fetch Summary';
      });
    });
  });

  // Fetch languages from the JSON file
  fetch('translations.json')
    .then(response => response.json())
    .then(data => {
      data.languages.forEach(language => {
        const option = document.createElement('option');
        option.value = language.code;
        option.textContent = `${language.emoji} ${language.name}`;
        languageSelect.appendChild(option);
      });

      // Set the selected language if it exists
      chrome.storage.sync.get('selectedLanguage', (data) => {
        if (data.selectedLanguage) {
          languageSelect.value = data.selectedLanguage;
        }
      });
    })
    .catch(error => console.error('Error fetching languages:', error));

  // Save the selected language to local storage when it changes
  languageSelect.addEventListener('change', () => {
    chrome.storage.sync.set({ selectedLanguage: languageSelect.value });
  });

  const searchInput = document.getElementById('searchInput');

  // Function to filter articles based on search input
  function filterArticles() {
    const filterText = searchInput.value.toLowerCase();
    const articles = document.querySelectorAll('.article-card');

    articles.forEach(article => {
      const headerText = article.querySelector('.article-header h4').textContent.toLowerCase();
      const contentText = article.querySelector('.article-content').textContent.toLowerCase();

      if (headerText.includes(filterText) || contentText.includes(filterText)) {
        article.style.display = 'block';
      } else {
        article.style.display = 'none';
      }
    });
  }

  // Add event listener to search input to filter articles on input
  searchInput.addEventListener('input', filterArticles);

  document.addEventListener('keydown', (event) => {
    if (event.metaKey && event.key === 'f') { // Check for ⌘ + F
      event.preventDefault(); // Prevent the default find action
      if (historyScreen.style.display === 'block') {
        searchInput.focus(); // Focus the search input if history screen is visible
      }
    }
  });
});
