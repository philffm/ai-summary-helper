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

  const donateLink = document.getElementById('donate-link');

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
      // change to svg icon
      // toggleScreenButton.textContent = 'Settings';
      toggleScreenButton.textContent = '⚙️';
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
