// mainScreen.js
// Handles main screen UI and logic for AI Summary Helper extension

export function initMainScreen() {
    const fetchSummaryButton = document.getElementById('fetchSummary');
    const additionalQuestionsInput = document.getElementById('additionalQuestions');
    const languageSelect = document.getElementById('languageSelect');

    if (!fetchSummaryButton) return;

    fetchSummaryButton.addEventListener('click', async () => {
        const additionalQuestions = additionalQuestionsInput.value;
        const selectedLanguage = languageSelect.value;

        // Retrieve the prompt text (stored as `prompt`). For presets, promptManager
        // stores the actual preset text in `prompt` as well, so we can always use it.
        chrome.storage.sync.get(['prompt', 'promptType', 'presetPrompt'], async (data) => {
            let promptToUse = data.prompt || '';

            // Disable the button and change its text
            fetchSummaryButton.disabled = true;
            fetchSummaryButton.textContent = 'Select content element';

            try {
                const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
                const activeTab = tabs[0];
                if (!activeTab) return;

                // 1. Ensure the content script is actually there
                await ensureContentScript(activeTab.id, activeTab.url);

                // 2. Now send the real message - Trigger and forget
                const message = {
                    action: 'fetchSummary',
                    additionalQuestions,
                    selectedLanguage,
                    prompt: promptToUse
                };

                chrome.tabs.sendMessage(activeTab.id, message, (response) => {
                    if (chrome.runtime.lastError) {
                        console.warn("Popup closed before result, but that's okay because we moved to streaming.");
                    }
                });

                // Close the popup to avoid port closed errors and let the user watch the stream
                setTimeout(() => window.close(), 100);
            } catch (err) {
                console.error('Failed to communicate with tab:', err);
                alert(err.message);
                fetchSummaryButton.disabled = false;
                fetchSummaryButton.textContent = '🪄 Fetch Summary';
            }
        });
    });
}

// Helper to check if content script is loaded, or inject it if not
async function ensureContentScript(tabId, url) {
    // Restricted Chrome URLs
    if (url && (url.startsWith('chrome://') || url.startsWith('https://chrome.google.com/webstore'))) {
        throw new Error('AI Summary cannot run on system pages or the Web Store.');
    }

    try {
        // Ping the content script
        await chrome.tabs.sendMessage(tabId, { action: 'PING' });
    } catch (e) {
        // If ping fails, inject
        console.log("Injecting content script due to ping failure...");
        await chrome.scripting.executeScript({
            target: { tabId },
            files: ['content.js']
        });
        // Give it a moment to initialize listeners
        await new Promise(resolve => setTimeout(resolve, 250));
    }
}
