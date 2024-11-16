function init() {

  // Define the default prompt
  const defaultPrompt = `- brief summary
  - fun standup comedy set on the topic (sell it to me, make fun of it)
  - what does it mean for my profession (ux)
  - add some book recommendations
  `;

  // Write the default prompt to storage if not already set
  chrome.storage.sync.get('prompt', (data) => {
    if (!data.prompt) {
      chrome.storage.sync.set({ prompt: defaultPrompt, promptType: 'custom' }, () => {
        console.log('Default prompt set for new users.');
      });
    }
  });
  // output entire local storage
  chrome.storage.sync.get(null, (data) => {
    console.log('All settings:', data);
  });
}

fetch(chrome.runtime.getURL('manifest.json'))
  .then(response => response.json())
  .then(manifest => {
    document.getElementById('versionNumber').textContent = manifest.version;
  })
  .catch(error => console.error('Error fetching manifest:', error));

init();


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
  const apiKeyContainer = document.getElementById('apiKeyContainer'); // Container for API key input
  const localEndpointContainer = document.getElementById('localEndpointContainer'); // Container for local endpoint input
  const localEndpointInput = document.getElementById('localEndpoint'); // Input for local endpoint
  const modelIdentifierInput = document.getElementById('modelIdentifier');

  const historyButton = document.getElementById('historyButton');
  const backButton = document.getElementById('backButton');
  const historyScreen = document.getElementById('historyScreen');
  const articleList = document.getElementById('articleList');

  const appsButton = document.getElementById('appsButton');
  const compatibleToolsSection = document.querySelector('.compatible-tools');
  const screenList = [mainScreen, settingsScreen, historyScreen];
  const languageSelect = document.getElementById('languageSelect');
  const deleteSettingsButton = document.getElementById('deleteSettingsButton');


  const titleElement = document.querySelector('.logoheader h2');

  // Define a configuration object for screens
  const screenConfig = {
    mainScreen: {
      show: ['mainScreen', 'historyButton', 'toggleScreenButton', 'appsButton'],
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

    hideAllScreens();
    showConfiguredElements(config.show);
    updateBodyStyles();
    updateScreenText(config);

  }

  function hideAllScreens() {
    screenList.forEach(screen => screen.style.display = 'none');
    ['historyButton', 'backButton', 'toggleScreenButton', 'appsButton'].forEach(id => {
      document.getElementById(id).style.display = 'none';
    });
  }

  function showConfiguredElements(elements) {
    elements.forEach(elementId => {
      const element = document.getElementById(elementId);
      if (element) {
        element.style.display = 'block';
      }
    });
  }

  function updateBodyStyles() {
    document.body.style.margin = '0';
    document.body.style.padding = '0';
    document.body.style.lineHeight = '1.2';
  }

  function updateScreenText(config) {
    toggleScreenButton.textContent = config.toggleButtonText;
    titleElement.textContent = config.titleText;
  }



  // Add event listener to the "Delete Settings" button
  if (deleteSettingsButton) {
    deleteSettingsButton.addEventListener('click', (event) => {
      event.preventDefault(); // Prevent any default action
      if (confirm('Are you sure you want to delete all settings? This action cannot be undone.')) {
        chrome.storage.sync.clear(() => {
          alert('Settings have been reset to default.');
          location.reload(); // Reload the page to reflect changes
        });
      }
    });
  }


  if (deleteHistoryButton) {
    deleteHistoryButton.addEventListener('click', (event) => {
      event.preventDefault();
      // clear only history / articles
      chrome.storage.local.set({ articles: [] }, () => {
        if (confirm('Are you sure you want to delete all history? This action cannot be undone.')) {
          alert('History has been reset.');
          location.reload(); // Reload the page to reflect changes
        }
      });
    });
  }

  // Event listeners to switch screens
  toggleScreenButton.addEventListener('click', () => {
    if (settingsScreen.style.display === 'block') {
      showScreen('mainScreen');
    } else {
      showScreen('settingsScreen');
    }
  });

  chrome.storage.sync.get(['apiKey'], (data) => {
    if (!data.apiKey) {
      const toastMessage = document.createElement('div');
      toastMessage.className = 'toast-message';
      toastMessage.textContent = 'To fetch summaries, set your API key in settings ⤴';
      document.body.appendChild(toastMessage);

      // Optionally, remove the toast after a few seconds
      setTimeout(() => {
        toastMessage.remove();
      }, 5000);
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
      articleList.innerHTML = ''; // Clear existing articles

      console.log('Articles loaded:', data.articles); // Debugging: Log all articles

      if (data.articles.length === 0 && !document.querySelector('#emptyMessage')) {
        const emptyMessage = document.createElement('div');
        emptyMessage.id = 'emptyMessage';
        emptyMessage.innerHTML = `
          <p>🗂️ Your archive is as empty as a desert! Start saving some articles to fill it up. 🌵</p>
        `;
        articleList.appendChild(emptyMessage);
      } else {
        // Sort articles by timestamp in descending order
        const sortedArticles = data.articles.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

        sortedArticles.forEach((article, index) => {
          console.log(`Processing article ${index + 1}:`, article); // Debugging: Log each article

          const articleHeader = article.title || article.content.split('\n')[0] || "No title available";
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

          let articleDomain = '';
          if (article.url) {
            articleDomain = new URL(article.url).hostname;
          }

          listItem.innerHTML = `
            <div class="article-header">
              <div>
                <h4>${articleHeader}</h4>
                <p class="article-date">💾 ${formattedDate} ${article.url ? `from <a href="${article.url}" target="_blank">${articleDomain}</a> ↗` : ''}
              </div>
              <button class="button-secondary expand-button">Expand</button>
            </div>
            <div class="article-content" style="display: none;">
              <button class="button-secondary share-button">Share 🔗</button>
              <button class="button-secondary open-button">Read 👓</button>
              <button class="delete-button" aria-label="Delete article">🗑️</button>
              <p><strong>Description:</strong> ${article.description || 'No description available'}</p>
              <p><strong>Summary:</strong> ${article.summary || 'No summary available'}</p>
              <p><strong>Content:</strong> ${article.content || 'No content available'}</p>
            </div>
          `;
          articleList.appendChild(listItem);

          // Safely add event listeners
          const expandButton = listItem.querySelector('.expand-button');
          const articleContent = listItem.querySelector('.article-content');
          const openButton = listItem.querySelector('.open-button');
          const shareButton = listItem.querySelector('.share-button');
          const deleteButton = listItem.querySelector('.delete-button');

          if (expandButton && articleContent) {
            expandButton.addEventListener('click', () => {
              const isVisible = articleContent.style.display === 'block';
              articleContent.style.display = isVisible ? 'none' : 'block';
              expandButton.textContent = isVisible ? 'Expand' : 'Collapse';
            });
          }

          if (openButton) {
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
          }

          if (shareButton) {
            shareButton.addEventListener('click', () => {
              if (navigator.share) {
                const summaryText = article.summary.replace(/<[^>]*>/g, '').trim();
                const shareData = {
                  title: `📄 ${article.title || 'No title available'}`,
                  url: article.url,
                  text: `🪄${summaryText || 'No summary available'}`
                };
                navigator.share(shareData)
                  .then(() => {
                    console.log('Article shared successfully');
                  })
                  .catch((error) => {
                    console.error('Error sharing article:', error);
                  });
              } else {
                console.error('Web Share API not supported in this browser');
              }
            });
          }

          if (deleteButton) {
            deleteButton.addEventListener('click', function () {
              if (confirm('Are you sure you want to delete this article?')) {
                chrome.storage.local.get('articles', (data) => {
                  const articles = data.articles || [];
                  const updatedArticles = articles.filter((item) => item.timestamp !== article.timestamp);
                  chrome.storage.local.set({ articles: updatedArticles }, () => {
                    console.log('Article deleted successfully');
                    loadHistory(); // Refresh the archive list
                  });
                });
              }
            });
          }

          // Make the entire card clickable
          listItem.addEventListener('click', (event) => {
            if (!event.target.classList.contains('expand-button')) {
              const isVisible = articleContent.style.display === 'block';
              articleContent.style.display = isVisible ? 'none' : 'block';
              expandButton.textContent = isVisible ? 'Expand' : 'Collapse';
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


  // Function to toggle the visibility of the prompt input field
  function togglePromptInputVisibility() {
    if (promptSelect.value === 'custom') {
      promptInput.style.display = 'block'; // Show the custom prompt field
    } else {
      promptInput.style.display = 'none'; // Hide the custom prompt field
    }
  }

  // Event listener to toggle the visibility of the prompt input field on change
  promptSelect.addEventListener('change', () => {
    togglePromptInputVisibility();
    // Save the selected preset
    chrome.storage.sync.set({ selectedPreset: promptSelect.value });
  });

  // Initial call to set the correct visibility on page load
  chrome.storage.sync.get(['selectedPreset'], (data) => {
    if (data.selectedPreset) {
      promptSelect.value = data.selectedPreset;
    }
    togglePromptInputVisibility(); // Ensure visibility is set correctly on load
  });

  // Load stored settings from Chrome storage
  chrome.storage.sync.get(['apiKey', 'prompt', 'model', 'localEndpoint', 'modelIdentifier', 'selectedLanguage', 'promptType', 'presetPrompt'], (data) => {
    console.log('Loaded settings from local storage:', data);
    apiKeyInput.value = data.apiKey || '';
    promptInput.value = data.prompt || '';
    modelInput.value = data.model || 'openai';
    localEndpointInput.value = data.localEndpoint || '';
    modelIdentifierInput.value = data.modelIdentifier || '';

    // Set the selected language if it exists
    if (data.selectedLanguage) {
      languageSelect.value = data.selectedLanguage;
    }

    // Set the prompt type and load the appropriate prompt
    if (data.promptType === 'custom') {
      promptSelect.value = 'custom';
      promptInput.value = data.prompt || defaultPrompt; // Load from storage or use default
      promptInput.style.display = 'block'; // Ensure the custom prompt field is visible
    } else {
      promptSelect.value = data.presetPrompt || 'default';
      promptInput.style.display = 'none';
    }

    toggleInputVisibility();
  });

  // Update the custom prompt field when a new prompt is selected
  promptSelect.addEventListener('change', () => {
    if (promptSelect.value === 'custom') {
      promptInput.style.display = 'block'; // Show the custom prompt field
      chrome.storage.sync.set({ promptType: 'custom' });
    } else {
      promptInput.style.display = 'none'; // Hide the custom prompt field
      chrome.storage.sync.set({ promptType: 'preset', presetPrompt: promptSelect.value });
    }
  });

  // Change dropdown to "Custom" when the prompt input is edited
  promptInput.addEventListener('input', () => {
    promptSelect.value = 'custom';
    promptInput.style.display = 'block'; // Ensure the custom prompt field is visible
    chrome.storage.sync.set({ prompt: promptInput.value, promptType: 'custom' });
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
      modelIdentifier: modelIdentifierInput.value,
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

      // Load stored prompt settings
      chrome.storage.sync.get(['prompt', 'selectedPreset'], (data) => {
        if (data.selectedPreset) {
          promptSelect.value = data.selectedPreset;
          if (data.selectedPreset === 'custom') {
            promptInput.value = data.prompt || '';
            promptInput.style.display = 'block';
          } else {
            promptInput.style.display = 'none';
          }
        }
      });

      // Update the custom prompt field when a new prompt is selected
      promptSelect.addEventListener('change', () => {
        if (promptSelect.value === 'custom') {
          promptInput.style.display = 'block'; // Show the custom prompt field
        } else {
          promptInput.style.display = 'none'; // Hide the custom prompt field
        }
        // Save the selected preset
        chrome.storage.sync.set({ selectedPreset: promptSelect.value });
      });

      // Change dropdown to "Custom" when the prompt input is edited
      promptInput.addEventListener('input', () => {
        promptSelect.value = 'custom';
        promptInput.style.display = 'block'; // Ensure the custom prompt field is visible
        // Save the custom prompt
        chrome.storage.sync.set({ prompt: promptInput.value });
      });
    });


  fetchSummaryButton.addEventListener('click', () => {
    const additionalQuestions = document.getElementById('additionalQuestions').value;
    const selectedLanguage = document.getElementById('languageSelect').value;

    // Retrieve the selected prompt or custom prompt
    chrome.storage.sync.get(['prompt', 'promptType', 'presetPrompt'], (data) => {
      let promptToUse = '';
      if (data.promptType === 'custom') {
        promptToUse = data.prompt;
      } else {
        promptToUse = data.presetPrompt; // Use the preset name or identifier
      }

      // Disable the button and change its text
      fetchSummaryButton.disabled = true;
      fetchSummaryButton.textContent = 'Select content element';

      // Send a message to the content script with the selected prompt
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        chrome.tabs.sendMessage(tabs[0].id, {
          action: 'fetchSummary',
          additionalQuestions,
          selectedLanguage,
          prompt: promptToUse
        }, (response) => {
          if (response && response.success) {
            console.log('Summary fetched successfully:', response.message);

            // Display additional data
            displayArticleDetails(response.data);
          } else {
            console.error('Failed to fetch summary:', response ? response.message : 'No response');
          }

          // Re-enable the button and reset its text after the operation
          fetchSummaryButton.disabled = false;
          fetchSummaryButton.textContent = '🪄 Fetch Summary';
        });
      });
    });
  });

  // Function to display article details in the popup
  function displayArticleDetails(data) {
    const articleDetailsContainer = document.getElementById('articleDetails');
    articleDetailsContainer.innerHTML = `
      <h3>Article Details</h3>
      <p><strong>Title:</strong> ${data.title || 'No title available'}</p>
      <p><strong>Description:</strong> ${data.description || 'No description available'}</p>
      <p><strong>URL:</strong> <a href="${data.url}" target="_blank">${data.url}</a></p>
    `;
  }

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

  const summaryLengthSlider = document.getElementById('summaryLength');
  const summaryLengthValue = document.getElementById('summaryLengthValue');

  // Load stored summary length
  chrome.storage.sync.get(['summaryLength'], (data) => {
    const length = data.summaryLength || 500; // Default to 500 if not set
    summaryLengthSlider.value = length;
    summaryLengthValue.textContent = length;
  });

  // Update the displayed value and store it when the slider changes
  summaryLengthSlider.addEventListener('input', () => {
    const newLength = summaryLengthSlider.value;
    summaryLengthValue.textContent = newLength;

    // Store the new summary length in local storage
    chrome.storage.sync.set({ summaryLength: newLength }, () => {
      console.log(`Summary length updated to ${newLength}`);
    });
  });

  // Function to load compatible tools and display them as cards
  function loadCompatibleTools() {
    fetch('compatible-tools.json')
      .then(response => response.json())
      .then(tools => {
        const compatibleToolsList = document.getElementById('compatibleToolsList');
        compatibleToolsList.innerHTML = ''; // Clear existing content

        // Add the explanatory card
        const explanatoryCard = document.createElement('div');
        explanatoryCard.classList.add('explanatory-card');
        explanatoryCard.innerHTML = '💠 Working well with AI Summary Helper';
        compatibleToolsList.appendChild(explanatoryCard);

        // Add each tool as a card
        tools.forEach(tool => {
          const toolCard = document.createElement('div');
          toolCard.classList.add('tool-card');
          toolCard.innerHTML = `
            <div class="tool-card-content">
              <h3>${tool.Name}</h3>
              <p>${tool.Description}</p>
              <a href="${tool.URL}" target="_blank" class="discover-button">Discover ↗</a>
            </div>
          `;
          compatibleToolsList.appendChild(toolCard);
        });
      })
      .catch(error => console.error('Error loading compatible tools:', error));
  }

  // Call the function to load compatible tools
  loadCompatibleTools();

  // Toggle the visibility of the compatible tools section
  appsButton.addEventListener('click', () => {
    if (compatibleToolsSection.style.display === 'none' || compatibleToolsSection.style.display === '') {
      compatibleToolsSection.style.display = 'block';
    } else {
      compatibleToolsSection.style.display = 'none';
    }
  });

  // Initially hide the compatible tools section
  compatibleToolsSection.style.display = 'none';

  // Accordion functionality
  const accordionButtons = document.querySelectorAll('.accordion-button');
  accordionButtons.forEach(button => {
    button.addEventListener('click', (event) => {
      event.preventDefault(); // Prevent form submission

      // Toggle the clicked button and its content
      const content = button.nextElementSibling;
      const isActive = button.classList.contains('active');

      // Close all accordion contents
      const allContents = document.querySelectorAll('.accordion-content');
      allContents.forEach(content => {
        content.style.maxHeight = null;
      });

      // Remove 'active' class from all buttons
      accordionButtons.forEach(btn => btn.classList.remove('active'));

      // If the clicked button was not active, activate it
      if (!isActive) {
        button.classList.add('active');
        content.style.maxHeight = content.scrollHeight + "px";
      }
    });
  });

  const saveButton = document.querySelector('.button-primary.fixed-button'); // Assuming this is your save button

  // Trigger save when API key is updated
  apiKeyInput.addEventListener('input', () => {
    saveButton.click();
  });

  // Function to trigger save
  function triggerSave() {
    saveButton.click();
  }

  // Debounce function to delay execution
  function debounce(func, delay) {
    let timeout;
    return function (...args) {
      clearTimeout(timeout);
      timeout = setTimeout(() => func.apply(this, args), delay);
    };
  }

  // Add event listeners to all input elements within the settings form
  const inputs = settingsForm.querySelectorAll('select');
  inputs.forEach(input => {
    input.addEventListener('input', triggerSave);
  });

  // Add debounced event listener for textarea elements
  const textareas = settingsForm.querySelectorAll('textarea, input');
  const debouncedSave = debounce(triggerSave, 1000);
  textareas.forEach(textarea => {
    textarea.addEventListener('input', debouncedSave);
  });

  const apiKeyLink = document.getElementById('apiKeyLink');

  // Function to update the API key link based on the selected model
  function updateApiKeyLink(model) {
    let linkHtml = '';
    if (model === 'openai') {
      linkHtml = '(Get your <a href="https://platform.openai.com/api-keys" target="_blank">OpenAI API key</a>)';
    } else if (model === 'mistral') {
      linkHtml = '(Get your <a href="https://console.mistral.ai/api-keys/" target="_blank">Mistral API key</a>)';
    } else if (model === 'ollama') {
      linkHtml = '(Visit <a href="https://ollama.com/" target="_blank">Ollama</a> for more information)';
    } else {
      linkHtml = ''; // Clear the link if no valid model is selected
    }
    apiKeyLink.innerHTML = linkHtml;
  }

  // Update the link when the model changes
  modelInput.addEventListener('change', () => {
    updateApiKeyLink(modelInput.value);
    toggleInputVisibility();
  });

  // Initial call to set the correct link on page load
  updateApiKeyLink(modelInput.value);


  // Function to handle first-time setup
  function firstTimeSetup() {
    chrome.storage.sync.get('prompt', (data) => {
      if (!data.prompt) {
        const defaultPrompt = " - a brief summary - 2 best quotes from the text - pitch the article as a standup comedian - what does it mean for my profession - e.g. ux, developer, marketing";
        chrome.storage.sync.set({ prompt: defaultPrompt, promptType: 'custom' }, () => {
          console.log('Default prompt set for new users.');
        });
      }
    });
  }

  // Call the first-time setup function
  firstTimeSetup();


});