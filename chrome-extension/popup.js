document.addEventListener('DOMContentLoaded', () => {
  console.log('Popup DOMContentLoaded');

  const apiKeyInput = document.getElementById('apiKey');
  const modelInput = document.getElementById('model'); // New model selector
  const promptInput = document.getElementById('prompt');
  const fetchSummaryButton = document.getElementById('fetchSummary');
  const additionalQuestionsInput = document.getElementById('additionalQuestions');
  const settingsForm = document.getElementById('settingsForm');
  const toggleScreenButton = document.getElementById('toggleScreen');
  const mainScreen = document.getElementById('mainScreen');
  const settingsScreen = document.getElementById('settingsScreen');
  const spinner = document.getElementById('spinner');
  const donateLink = document.getElementById('donate-link');
  const apiKeyContainer = document.getElementById('apiKeyContainer'); // Container for API key input
  const localEndpointContainer = document.getElementById('localEndpointContainer'); // Container for local endpoint input
  const localEndpointInput = document.getElementById('localEndpoint'); // Input for local endpoint

  // Array of random donation messages
  const donationMessages = [
    'Like the extension? Help me brew new ideas with a soothing cup of tea! 🍵',
    'Love the extension? Help me upgrade my workspace with a new plant! 🌿',
    'Want to support? Buy me a book to inspire the next feature! 📚',
    'Supporting my work? Help me fund a tiny house to code in peace! 🏡',
    'Love this project? Get me closer to my goal of relocating into a sailboat! 🚤',
    'Feeling generous? A pizza would definitely boost my brainstorming sessions! 🍕',
    'Enjoying the tool? Help me turn my remote work into a van life adventure! 🚐',
    'Happy with the tool? Your support can help me build my tiny home! 🏠',
    'Appreciate the extension? Buy me a kayak to paddle through my creative process! 🛶',
    'Like innovation? Support my mission to design from the deck of a boat! ⛴️',
    'Enjoying the tool? Get me a smoothie to recharge my problem-solving skills! 🥤'
  ];

  // Randomize donation link text
  const randomMessage = donationMessages[Math.floor(Math.random() * donationMessages.length)];
  donateLink.textContent = randomMessage;

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
  chrome.storage.sync.get(['apiKey', 'prompt', 'model', 'localEndpoint'], (data) => {
    console.log('Loaded settings:', data);
    if (data.apiKey) apiKeyInput.value = data.apiKey;
    if (data.prompt) {
      promptInput.value = data.prompt;
    } else {
      promptInput.placeholder = `If not set, default prompt:\n${defaultPrompt}`; // Set default prompt as placeholder with intro text
    }
    if (data.model) modelInput.value = data.model; // Load the model selection
    if (data.localEndpoint) localEndpointInput.value = data.localEndpoint; // Load the local endpoint

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
      model: modelInput.value, // Save the selected model
      localEndpoint: localEndpointInput.value // Save the local endpoint
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

  // Toggle between settings screen and main screen
  toggleScreenButton.addEventListener('click', () => {
    const titleElement = document.querySelector('.logoheader h2');

    if (mainScreen.style.display === 'none') {
      mainScreen.style.display = 'block';
      settingsScreen.style.display = 'none';
      toggleScreenButton.textContent = '⚙️'; // Switch back to settings icon
      titleElement.textContent = 'AI Summary Helper'; // Change title back to main
    } else {
      mainScreen.style.display = 'none';
      settingsScreen.style.display = 'block';
      toggleScreenButton.textContent = 'Back'; // Text when showing settings
      titleElement.textContent = 'Settings'; // Change title to settings
    }
  });

  // Handle the "Fetch Summary" button click
  fetchSummaryButton.addEventListener('click', () => {
    console.log('Fetch Summary button clicked');
    const additionalQuestions = additionalQuestionsInput.value.trim();
    spinner.style.display = 'inline-block';

    // Query the active tab and send the message to the content script
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      console.log('Sending message to content script');
      fetchSummaryButton.textContent = 'Select element to fetch...';
      fetchSummaryButton.style.background = 'green';
      chrome.tabs.sendMessage(tabs[0].id, { action: 'fetchSummary', additionalQuestions }, (response) => {
        console.log('Response from content script:', response);
        spinner.style.display = 'none';
        fetchSummaryButton.textContent = '🪄 Fetch Summary';
        fetchSummaryButton.style.background = '';
      });
    });
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
});

