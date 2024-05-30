// popup.js is the JavaScript file that runs in the popup window of the extension.
document.addEventListener('DOMContentLoaded', () => {
  console.log('Popup DOMContentLoaded'); // Log event

  const apiKeyInput = document.getElementById('apiKey');
  const promptInput = document.getElementById('prompt');
  const fetchSummaryButton = document.getElementById('fetchSummary');
  const additionalQuestionsInput = document.getElementById('additionalQuestions');
  const settingsForm = document.getElementById('settingsForm');
  const toggleScreenButton = document.getElementById('toggleScreen');
  const mainScreen = document.getElementById('mainScreen');
  const settingsScreen = document.getElementById('settingsScreen');

  // Load saved settings
  chrome.storage.sync.get(['apiKey', 'prompt'], (data) => {
    console.log('Loaded settings:', data); // Log loaded settings
    if (data.apiKey) apiKeyInput.value = data.apiKey;
    if (data.prompt) promptInput.value = data.prompt;
  });

  // Save settings
  settingsForm.addEventListener('submit', (event) => {
    event.preventDefault();
    console.log('Settings form submitted'); // Log event
    chrome.storage.sync.set({
      apiKey: apiKeyInput.value,
      prompt: promptInput.value
    });
    alert('Settings saved');
  });

  // Toggle between main and settings screen
  toggleScreenButton.addEventListener('click', () => {
    if (mainScreen.style.display === 'none') {
      mainScreen.style.display = 'block';
      settingsScreen.style.display = 'none';
      toggleScreenButton.textContent = 'Settings';
    } else {
      mainScreen.style.display = 'none';
      settingsScreen.style.display = 'block';
      toggleScreenButton.textContent = 'Back';
    }
  });

  // Fetch summary
  fetchSummaryButton.addEventListener('click', () => {
    console.log('Fetch summary button clicked'); // Log event
    const additionalQuestions = additionalQuestionsInput.value.trim();
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      console.log('Sending message to content script'); // Log message sending
      chrome.tabs.sendMessage(tabs[0].id, { action: 'fetchSummary', additionalQuestions });
    });
  });
});
