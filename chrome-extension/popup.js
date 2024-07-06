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
  const spinner = document.getElementById('spinner');

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
    // alert('Settings saved');
    // change button text to 'Saved! 🎉' for 3 seconds
    const originalText = event.submitter.textContent;
    const originalBackgroundColor = event.submitter.style.backgroundColor;
    event.submitter.textContent = 'Saved! 🎉';
    // background color to green
    event.submitter.style.backgroundColor = 'green';
    setTimeout(() => {
      event.submitter.textContent = originalText;
      event.submitter.style.backgroundColor = originalBackgroundColor;
    }, 3000);
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

    // Show spinner
    spinner.style.display = 'inline-block';

    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      console.log('Sending message to content script'); // Log message sending
      fetchSummaryButton.textContent = 'Fetching...';
      fetchSummaryButton.backgroundColor = 'green';
      chrome.tabs.sendMessage(tabs[0].id, { action: 'fetchSummary', additionalQuestions }, (response) => {
        console.log('Response from content script:', response);
        // fetchSummaryButton.textContent = 'Content inserted 🎉';
        // fetchSummaryButton.backgroundColor = originalBackgroundColor;

        // // wait 3 seconds before changing button text back to 'Fetch Summary'
        // setTimeout(() => {
        //   fetchSummaryButton.textContent = 'Fetch Summary';

        // }, 3000);

        // Hide spinner
        spinner.style.display = 'none';
      });
    });
  });
});
