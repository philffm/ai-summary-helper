// Prompt Manager
// Handles prompt dropdown and logic

/**
 * Initializes the prompt dropdown and custom prompt logic.
 * @param {HTMLElement} promptSelectEl - The prompt dropdown element.
 * @param {HTMLElement} promptInput - The custom prompt input element.
 * @param {Function} onPromptChange - Callback for prompt change.
 */
export function initPromptManager(promptSelectEl, promptInput, onPromptChange) {
    if (!promptSelectEl || !promptInput) return;

    // Add a "Custom" option to the dropdown
    const customOption = document.createElement('option');
    customOption.value = 'custom';
    customOption.textContent = 'Custom';
    promptSelectEl.appendChild(customOption);

    // Load prompts from prompts.json and populate the dropdown
    fetch('prompts.json')
        .then(response => response.json())
        .then(prompts => {
            prompts.forEach(prompt => {
                const option = document.createElement('option');
                option.value = prompt.name;
                option.textContent = prompt.name;
                option.dataset.prompt = prompt.prompt;
                promptSelectEl.appendChild(option);
            });
        })
        .catch(error => console.error('Error loading prompts:', error));

    // Load stored prompt settings
    chrome.storage.local.get(['prompt', 'selectedPreset'], data => {
        if (data.selectedPreset) promptSelectEl.value = data.selectedPreset;
        if (data.prompt) promptInput.value = data.prompt;
        togglePromptInputVisibility(promptSelectEl, promptInput);
    });

    // Update the custom prompt field when a new prompt is selected
    promptSelectEl.addEventListener('change', () => {
        if (promptSelectEl.value === 'custom') {
            promptInput.style.display = 'block';
        } else {
            promptInput.style.display = 'none';
        }
        chrome.storage.local.set({ selectedPreset: promptSelectEl.value });
        if (onPromptChange) onPromptChange(promptSelectEl.value);
    });

    // Change dropdown to "Custom" when the prompt input is edited
    promptInput.addEventListener('input', () => {
        promptSelectEl.value = 'custom';
        promptInput.style.display = 'block';
        chrome.storage.local.set({ prompt: promptInput.value, promptType: 'custom' });
        if (onPromptChange) onPromptChange('custom');
    });
}

/**
 * Toggles the visibility of the prompt input field.
 */
export function togglePromptInputVisibility(promptSelect, promptInput) {
    if (promptSelect && promptSelect.value === 'custom') {
        promptInput.style.display = 'block';
    } else {
        promptInput.style.display = 'none';
    }
}
