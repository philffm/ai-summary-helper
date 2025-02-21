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

  // show get podcasts from local storage
  chrome.storage.local.get({ podcasts: [] }, (data) => {
    console.log('Podcasts:', data.podcasts);
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

  const podcastButton = document.getElementById('podcastButton');
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

  loadPodcasts();

  // Call loadPodcasts on page load to display existing podcasts


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
      show: ['historyScreen', 'backButton', 'podcastButton'],
      toggleButtonText: '',
      titleText: 'History'
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
    ['historyButton', 'backButton', 'toggleScreenButton', 'appsButton', 'podcastButton'].forEach(id => {
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
                const podcast = podcasts[0]; // Assuming you want to share the first podcast
                const podcastUrl = podcast.audio; // Base64-encoded data URL

                if (podcastUrl && podcastUrl.startsWith('data:')) {
                  // Convert base64 to Blob
                  const byteString = atob(podcastUrl.split(',')[1]);
                  const mimeString = podcastUrl.split(',')[0].split(':')[1].split(';')[0];
                  const ab = new ArrayBuffer(byteString.length);
                  const ia = new Uint8Array(ab);
                  for (let i = 0; i < byteString.length; i++) {
                    ia[i] = byteString.charCodeAt(i);
                  }
                  const blob = new Blob([ab], { type: mimeString });
                  const blobUrl = URL.createObjectURL(blob);

                  navigator.share({
                    title: podcast.title,
                    url: blobUrl
                  }).then(() => {
                    console.log('Podcast shared successfully.');
                    URL.revokeObjectURL(blobUrl); // Clean up the Blob URL
                  }).catch((error) => {
                    console.error('Error sharing podcast:', error);
                  });
                } else {
                  console.error('Invalid data URL for sharing:', podcastUrl);
                  alert('Cannot share podcast: Invalid data URL.');
                }
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

        // ======= Toggle Play Podcast Button Visibility =======
        togglePlayPodcastButton(sortedArticles);
      }
    });
  }

  /**
   * Toggles the visibility of the Play Podcast button based on selected model and API key.
   * @param {Array} sortedArticles - The list of sorted articles.
   * 
   * 
   */
  function togglePlayPodcastButton(sortedArticles) {
    chrome.storage.sync.get(['model', 'apiKey', 'selectedLanguage'], (data) => {
      const playButton = document.getElementById('playPodcastButton');
      const audioPlayer = document.getElementById('podcastAudioPlayer');

      console.log('🔍 Selected Model:', data.model);
      console.log('🔑 API Key Present:', data.apiKey ? 'Yes' : 'No');

      if (data.model === 'openai' && data.apiKey) {
        console.log('✅ Conditions met: Displaying Play Podcast Button.');
        playButton.style.display = 'block';
        audioPlayer.style.display = 'none';
        audioPlayer.src = '';

        // Attach event listener if not already attached
        if (!playButton.dataset.listenerAttached) {
          playButton.addEventListener('click', () => handlePlayPodcast(sortedArticles, data.apiKey, audioPlayer, playButton, data.selectedLanguage));
          playButton.dataset.listenerAttached = 'true'; // Prevent multiple attachments
          console.log('🔗 Play Podcast button event listener attached.');
        }
      } else {
        if (data.model !== 'openai') {
          console.warn('⚠️ Selected model is not OpenAI. Play Podcast Button will be hidden.');
        }
        if (!data.apiKey) {
          console.warn('⚠️ API Key is not set. Play Podcast Button will be hidden.');
        }
        playButton.style.display = 'none';
      }
    });
  }

  /**
   * Handles the Play Podcast button click event.
   * @param {Array} sortedArticles - The list of sorted articles.
   * @param {string} apiKey - The OpenAI API key.
   * @param {HTMLElement} audioPlayer - The audio player element.
   * @param {HTMLElement} playButton - The Play Podcast button element.
   * @param {string} selectedLanguage - The selected language.
   */
  async function handlePlayPodcast(sortedArticles, apiKey, audioPlayer, playButton, selectedLanguage) {
    selectedLanguage = document.getElementById('languageSelect').value;
    console.log('️ Play Podcast button clicked.');
    playButton.disabled = true;
    playButton.textContent = '🎙️ Generating Podcast...';

    // 40000 tokens max, 1 token = 4 characters 
    const MAX_INPUT_LENGTH = 10000; // Maximum allowed characters for OpenAI API

    try {
      // Step 1: Combine Articles
      const { combinedInput, includedCount } = createCombinedInput(sortedArticles, MAX_INPUT_LENGTH);
      console.log(`✅ Included ${includedCount} article(s) in the podcast.`);
      console.log('📝 Combined Input:', combinedInput);

      if (!combinedInput.trim()) {
        alert('⚠️ No summaries available to generate a podcast.');
        console.warn('❌ Combined input is empty.');
        resetPlayButton(playButton);
        return;
      }

      // Step 2: Create Chat Completion for Engaging Script
      console.log('🔄 Creating chat completion for the podcast script.');
      const podcastName = document.getElementById('podcastNameInput').value;
      const podcastScript = await createChatCompletion(combinedInput, apiKey, selectedLanguage, podcastName);
      console.log('📝 Generated Podcast Script:', podcastScript);

      if (!podcastScript.trim()) {
        alert('⚠️ Failed to generate a podcast script.');
        console.warn('❌ Podcast script is empty.');
        resetPlayButton(playButton);
        return;
      }

      // Step 3: Generate Audio from Podcast Script
      console.log('🔄 Generating audio from the podcast script.');
      const audioBlob = await generateAudioFromText(podcastScript, apiKey);

      if (audioBlob) {
        console.log('✅ Audio blob successfully generated.');
        const audioURL = URL.createObjectURL(audioBlob);
        audioPlayer.src = audioURL;
        audioPlayer.style.display = 'block';
        audioPlayer.play()
          .then(() => console.log('▶️ Audio is playing.'))
          .catch(err => console.error('❌ Error playing audio:', err));

        // Save the podcast
        const podcastTitle = `Podcast - ${new Date().toLocaleString()}`;
        console.log('📥 Saving podcast:', podcastTitle);
        savePodcast(podcastTitle, audioBlob);
      } else {
        alert('⚠️ Failed to generate audio.');
        console.error('❌ Audio blob is null.');
      }
    } catch (error) {
      console.error('🛑 Error in handlePlayPodcast:', error);
      alert(`❌ An error occurred while generating the podcast: ${error.message}`);
    } finally {
      resetPlayButton(playButton);
    }
  }

  /**
   * Resets the Play Podcast button to its default state.
   * @param {HTMLElement} playButton - The Play Podcast button element.
   */
  function resetPlayButton(playButton) {
    playButton.disabled = false;
    playButton.textContent = '🎙️ Play Podcast';
    console.log('🔄 Play Podcast button re-enabled.');
  }

  /**
   * Creates a combined input string from article summaries, titles, and URLs without exceeding the max length.
   * Counts only the characters in the summaries to determine inclusion.
   * @param {Array} articles - The list of sorted articles.
   * @param {number} maxLength - The maximum allowed character length for summaries.
   * @returns {Object} - An object containing the combined input and the count of included articles.
   */
  function createCombinedInput(articles, maxLength) {
    let combinedInput = '';
    let includedCount = 0;
    let currentSummaryLength = 0;

    for (let article of articles) {
      // Strip HTML from the summary
      const plainSummary = stripHtml(article.summary);

      // Calculate the length of the summary
      const summaryLength = plainSummary.length;

      // Check if adding this summary would exceed the maxLength
      if ((currentSummaryLength + summaryLength) > maxLength * 0.9) {
        console.log('📏 Maximum summary length reached. Stopping further additions.');
        break; // Stop adding more articles
      }

      // Construct a plain text block for each article
      const articleText = `Title: ${article.title}\nSummary: ${plainSummary}\nURL: ${article.url}\n\n`;

      combinedInput += articleText;
      includedCount += 1;
      currentSummaryLength += summaryLength;
    }

    return { combinedInput, includedCount };
  }

  /**
   * Creates a chat completion using OpenAI's Chat API to generate an engaging podcast script.
   * @param {string} inputText - The combined input text from articles.
   * @param {string} apiKey - The OpenAI API key.
   * @returns {Promise<string>} - The generated podcast script.
   */
  async function createChatCompletion(inputText, apiKey, selectedLanguage, podcastName) {
    const apiUrl = 'https://api.openai.com/v1/chat/completions';
    const model = 'gpt-4o'; // Ensure this is the correct model as per OpenAI documentation

    // Define the conversation messages
    const messages = [
      {
        role: 'system',
        content: `Podcast Name: ${podcastName}\n In language code"${selectedLanguage}" language, you are a creative and engaging podcast host. Transform the provided article summaries into an exciting 1 minute podcast script that captivates the audience. use language ${selectedLanguage}. Include the source of the article in the script. only include the domain, not the full URL.`
      },
      {
        role: 'user',
        content: inputText
      }
    ];

    // Define the request payload
    const requestBody = {
      model: model,
      messages: messages,
      max_tokens: 2500, // Adjust based on desired script length
      temperature: 0.7, // Adjust for creativity
      top_p: 1,
      n: 1,
      stream: false,
      stop: null
    };

    console.log('📤 Sending chat completion request to OpenAI:', requestBody);

    try {
      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(requestBody)
      });

      console.log('📥 Received response from Chat Completion API:', response);

      if (!response.ok) {
        let errorMessage = `Status: ${response.status}`;
        try {
          const errorData = await response.json();
          if (errorData.error) {
            errorMessage += ` - ${errorData.error.message}`;
            console.error('🛑 OpenAI Chat Completion API Error:', errorData.error);
          } else {
            console.error('🛑 Unexpected error structure:', errorData);
          }
        } catch (parseError) {
          const errorText = await response.text();
          console.error('🛑 Error parsing OpenAI Chat Completion API error response:', parseError);
          console.error('🛑 Raw Error Response:', errorText);
        }
        throw new Error(errorMessage);
      }

      const data = await response.json();
      const podcastScript = data.choices[0].message.content.trim();
      return podcastScript;
    } catch (error) {
      console.error('🛑 Error in createChatCompletion:', error);
      throw error; // Propagate the error to be handled by the caller
    }
  }

  /**
   * Generates audio from the provided text using OpenAI's speech API.
   * @param {string} text - The text to convert to speech.
   * @param {string} apiKey - The OpenAI API key.
   * @returns {Promise<Blob|null>} - The audio blob or null if failed.
   */
  async function generateAudioFromText(text, apiKey) {
    const apiUrl = 'https://api.openai.com/v1/audio/speech'; // Verify the correct endpoint
    const requestBody = {
      model: "tts-1", // Ensure this is the correct model as per OpenAI documentation
      input: text,
      voice: "alloy"  // Ensure 'alloy' is a valid voice option
    };

    console.log('📤 Sending audio generation request to OpenAI:', requestBody);

    try {
      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(requestBody)
      });

      console.log('📥 Received response from Audio API:', response);

      if (!response.ok) {
        let errorMessage = `Status: ${response.status}`;
        try {
          const errorData = await response.json();
          if (errorData.error) {
            errorMessage += ` - ${errorData.error.message}`;
            console.error('🛑 OpenAI Audio API Error:', errorData.error);
          } else {
            console.error('🛑 Unexpected error structure:', errorData);
          }
        } catch (parseError) {
          const errorText = await response.text();
          console.error('🛑 Error parsing OpenAI Audio API error response:', parseError);
          console.error('🛑 Raw Error Response:', errorText);
        }
        throw new Error(errorMessage);
      }

      const audioBlob = await response.blob();
      console.log('🎧 Audio blob received:', audioBlob);
      return audioBlob;
    } catch (error) {
      console.error('🛑 Error in generateAudioFromText:', error);
      throw error; // Propagate the error to be handled by the caller
    }
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
    event.submitter.textContent = 'Saved! ';
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

  // Add debounced event listener for textarea and input elements
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

  /**
   * Estimates the number of tokens in a given string.
   * Note: This is a simple approximation. For exact counts, use OpenAI's Tokenizer.
   * @param {string} text - The text to tokenize.
   * @returns {number} - Estimated number of tokens.
   */
  function estimateTokenCount(text) {
    return Math.ceil(text.length / 4);
  }

  /**
   * Creates a combined input string from article summaries, titles, and URLs without exceeding the max token limit.
   * @param {Array} articles - The list of sorted articles.
   * @param {number} maxTokens - The maximum allowed token count.
   * @returns {Object} - An object containing the combined input and the count of included articles.
   */
  function createCombinedInputByTokens(articles, maxTokens) {
    let combinedInput = '';
    let includedCount = 0;
    let currentTokenCount = 0;

    for (let article of articles) {
      // Strip HTML from the summary
      const plainSummary = stripHtml(article.summary);

      // Construct a plain text block for each article
      const articleText = `Title: ${article.title}\nSummary: ${plainSummary}\nURL: ${article.url}\n\n`;
      const articleTokenCount = estimateTokenCount(articleText);

      // Check if adding this article would exceed the maxTokens
      if ((currentTokenCount + articleTokenCount) > maxTokens) {
        console.log('📏 Maximum token limit reached. Stopping further additions.');
        break; // Stop adding more articles
      }

      combinedInput += articleText;
      includedCount += 1;
      currentTokenCount += articleTokenCount;
    }

    return { combinedInput, includedCount };
  }

  /**
   * Strips HTML tags from a given string.
   * @param {string} html - The HTML string to be stripped.
   * @returns {string} - The plain text string without HTML tags.
   */
  function stripHtml(html) {
    const tmp = document.createElement('DIV');
    tmp.innerHTML = html;
    return tmp.textContent || tmp.innerText || '';
  }

  // Function to save a podcast to local storage
  function savePodcast(title, audioBlob) {
    const reader = new FileReader();
    reader.onloadend = function () {
      const base64data = reader.result;
      chrome.storage.local.get({ podcasts: [] }, (data) => {
        const podcasts = data.podcasts;
        podcasts.push({ title, audio: base64data, timestamp: Date.now() });
        chrome.storage.local.set({ podcasts }, () => {
          if (chrome.runtime.lastError) {
            console.error('Error saving podcast:', chrome.runtime.lastError);
          } else {
            console.log('Podcast saved successfully.');
            loadPodcasts(); // Refresh the list
          }
        });
      });
    };
    reader.readAsDataURL(audioBlob);
  }


  // Function to load podcasts from local storage
  function loadPodcasts() {
    const podcastList = document.getElementById('podcastList');
    podcastList.innerHTML = ''; // Clear existing podcasts

    // Add explanatory card
    const explanatoryCard = document.createElement('div');
    explanatoryCard.classList.add('explanatory-card');
    explanatoryCard.innerHTML = '💠 Keep your friends in the loop: Transform your last reads into mini-podcasts you can share with your friends. (Requires OpenAI for now)';
    podcastList.appendChild(explanatoryCard);

    // add input file for podcast name 
    const podcastNameInput = document.createElement('input');
    podcastNameInput.type = 'text';
    podcastNameInput.id = 'podcastNameInput';
    podcastNameInput.placeholder = 'Podcast Name';
    explanatoryCard.appendChild(podcastNameInput);



    // Add play podcast button
    const playPodcastButton = document.createElement('button');
    playPodcastButton.id = 'playPodcastButton';
    playPodcastButton.classList.add('button-primary');
    playPodcastButton.textContent = '🎙️ Create';
    playPodcastButton.style.display = 'none';
    explanatoryCard.appendChild(playPodcastButton);



    chrome.storage.local.get({ podcasts: [] }, (data) => {
      data.podcasts.forEach((podcast, index) => {
        const listItem = document.createElement('div');
        listItem.classList.add('podcast-card');
        listItem.innerHTML = `
          <div class="podcast-card-content">
            <h3>${podcast.title}</h3>
            <audio controls src="${podcast.audio}"></audio>
            <button class="delete-podcast-button">Delete</button>
          </div>
        `;
        podcastList.appendChild(listItem);

        // Add event listeners
        const deleteButton = listItem.querySelector('.delete-podcast-button');
        const shareButton = listItem.querySelector('.share-podcast-button');

        deleteButton.addEventListener('click', () => {
          if (confirm('Are you sure you want to delete this podcast?')) {
            data.podcasts.splice(index, 1);
            chrome.storage.local.set({ podcasts: data.podcasts }, () => {
              console.log('Podcast deleted successfully.');
              loadPodcasts(); // Refresh the list
            });
          }
        });

      });
    });
  }

  const podcastTools = document.querySelector('.podcast-tools');
  const podcastList = document.getElementById('podcastList');
  const podcastAudioPlayer = document.getElementById('podcastAudioPlayer');
  const playPodcastButton = document.getElementById('playPodcastButton');

  // Initially hide podcast elements
  podcastTools.style.display = 'none';
  podcastList.style.display = 'none';
  podcastAudioPlayer.style.display = 'none';
  playPodcastButton.style.display = 'none';

  podcastButton.addEventListener('click', () => {
    // Toggle visibility of podcast elements
    const isVisible = podcastTools.style.display === 'block';
    podcastTools.style.display = isVisible ? 'none' : 'block';
    podcastList.style.display = isVisible ? 'none' : 'block';
    podcastAudioPlayer.style.display = isVisible ? 'none' : 'block';
    playPodcastButton.style.display = isVisible ? 'none' : 'block';
  });

});