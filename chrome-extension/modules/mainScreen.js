// mainScreen.js
// Handles main screen UI and logic for AI Summary Helper extension

export function initMainScreen() {
    const fetchSummaryButton = document.getElementById('fetchSummary');
    const additionalQuestionsInput = document.getElementById('additionalQuestions');
    const languageSelect = document.getElementById('languageSelect');

    if (!fetchSummaryButton) return;

    fetchSummaryButton.addEventListener('click', () => {
        const additionalQuestions = additionalQuestionsInput.value;
        const selectedLanguage = languageSelect.value;

        // Retrieve the prompt text (stored as `prompt`). For presets, promptManager
        // stores the actual preset text in `prompt` as well, so we can always use it.
        chrome.storage.sync.get(['prompt', 'promptType', 'presetPrompt'], (data) => {
            let promptToUse = data.prompt || '';

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
                    // Re-enable button after response
                    fetchSummaryButton.disabled = false;
                    fetchSummaryButton.textContent = '🪄 Fetch Summary';
                });
            });
        });
    });
}
