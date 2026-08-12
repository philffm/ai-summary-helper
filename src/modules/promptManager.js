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

    // Load stored prompt settings from sync storage (canonical place used by the app)
    chrome.storage.sync.get(['prompt', 'presetPrompt', 'promptType'], data => {
        if (data.presetPrompt) promptSelectEl.value = data.presetPrompt;
        if (data.prompt) promptInput.value = data.prompt;
        // If promptType indicates custom, make sure the input is visible
        togglePromptInputVisibility(promptSelectEl, promptInput);
    });

    // Update the custom prompt field when a new prompt is selected
    promptSelectEl.addEventListener('change', () => {
        if (promptSelectEl.value === 'custom') {
            promptInput.style.display = 'block';
            // For custom, keep `prompt` as the custom text (user-edited)
            chrome.storage.sync.set({ presetPrompt: promptSelectEl.value, promptType: 'custom' });
        } else {
            promptInput.style.display = 'none';
            // For preset, store both the preset name and the actual prompt text
            const selectedOption = promptSelectEl.options[promptSelectEl.selectedIndex];
            const presetPromptText = selectedOption?.dataset?.prompt || '';
            chrome.storage.sync.set({ presetPrompt: promptSelectEl.value, prompt: presetPromptText, promptType: 'preset' });
            // Also update the textarea so it reflects the preset content if needed
            if (promptInput) promptInput.value = presetPromptText;
        }
        if (onPromptChange) onPromptChange(promptSelectEl.value);
    });

    // Change dropdown to "Custom" when the prompt input is edited
    promptInput.addEventListener('input', () => {
        promptSelectEl.value = 'custom';
        promptInput.style.display = 'block';
        chrome.storage.sync.set({ prompt: promptInput.value, promptType: 'custom' });
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
