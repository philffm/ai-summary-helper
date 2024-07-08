document.addEventListener('DOMContentLoaded', () => {
  console.log('Popup DOMContentLoaded');

  const apiKeyInput = document.getElementById('apiKey');
  const promptInput = document.getElementById('prompt');
  const fetchSummaryButton = document.getElementById('fetchSummary');
  const additionalQuestionsInput = document.getElementById('additionalQuestions');
  const settingsForm = document.getElementById('settingsForm');
  const toggleScreenButton = document.getElementById('toggleScreen');
  const mainScreen = document.getElementById('mainScreen');
  const settingsScreen = document.getElementById('settingsScreen');
  const spinner = document.getElementById('spinner');

  chrome.storage.sync.get(['apiKey', 'prompt'], (data) => {
    console.log('Loaded settings:', data);
    if (data.apiKey) apiKeyInput.value = data.apiKey;
    if (data.prompt) promptInput.value = data.prompt;
  });

  settingsForm.addEventListener('submit', (event) => {
    event.preventDefault();
    console.log('Settings form submitted');
    chrome.storage.sync.set({
      apiKey: apiKeyInput.value,
      prompt: promptInput.value
    });
    const originalText = event.submitter.textContent;
    const originalBackgroundColor = event.submitter.style.backgroundColor;
    event.submitter.textContent = 'Saved! 🎉';
    event.submitter.style.backgroundColor = 'green';
    setTimeout(() => {
      event.submitter.textContent = originalText;
      event.submitter.style.backgroundColor = originalBackgroundColor;
    }, 3000);
  });

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

  fetchSummaryButton.addEventListener('click', () => {
    console.log('Fetch summary button clicked');
    const additionalQuestions = additionalQuestionsInput.value.trim();
    spinner.style.display = 'inline-block';

    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      console.log('Sending message to content script');
      fetchSummaryButton.textContent = 'Fetching...';
      fetchSummaryButton.style.backgroundColor = 'green';
      chrome.tabs.sendMessage(tabs[0].id, { action: 'fetchSummary', additionalQuestions }, (response) => {
        console.log('Response from content script:', response);
        spinner.style.display = 'none';
      });
    });
  });
});
