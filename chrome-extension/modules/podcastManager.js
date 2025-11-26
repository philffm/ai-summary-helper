// Function to load podcasts from local storage
function loadPodcasts() {
    const podcastList = document.getElementById('podcastList');
    podcastList.innerHTML = ''; // Clear existing podcasts

    // Add explanatory card
    const explanatoryCard = document.createElement('div');
    explanatoryCard.classList.add('explanatory-card');
    explanatoryCard.innerHTML = '💠 Keep your friends in the loop: Transform your last reads into mini-podcasts you can share with your friends. (Requires OpenAI for now)';
    podcastList.appendChild(explanatoryCard);

    // Add input field for podcast name
    const podcastNameInput = document.createElement('input');
    podcastNameInput.type = 'text';
    podcastNameInput.id = 'podcastNameInput';
    podcastNameInput.placeholder = 'Podcast Name';
    explanatoryCard.appendChild(podcastNameInput);
    // Attach the existing Play/Create button from the DOM (avoid duplicate IDs)
    const existingPlayButton = document.getElementById('playPodcastButton');
    if (existingPlayButton) {
        // Move the existing button into the explanatory card so it appears next to the input
        explanatoryCard.appendChild(existingPlayButton);
    }

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

document.getElementById('podcastButton').addEventListener('click', () => {
    // Toggle visibility of podcast elements
    const isVisible = podcastTools.style.display === 'block';
    podcastTools.style.display = isVisible ? 'none' : 'block';
    podcastList.style.display = isVisible ? 'none' : 'block';
    podcastAudioPlayer.style.display = isVisible ? 'none' : 'block';
    playPodcastButton.style.display = isVisible ? 'none' : 'block';
});

/**
 * Handles the Play Podcast button click event.
 * @param {Array} sortedArticles - The list of sorted articles.
 * @param {string} apiKey - The OpenAI API key.
 * @param {HTMLElement} audioPlayer - The audio player element.
 * @param {HTMLElement} playButton - The Play Podcast button element.
 * @param {string} selectedLanguage - The selected language.
 */
async function handlePlayPodcast(sortedArticles, apiKey, audioPlayer, playButton, selectedLanguage, activeService = 'openai', modelIdentifier = '') {
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
        const podcastScript = await createChatCompletion(combinedInput, apiKey, selectedLanguage, podcastName, activeService, modelIdentifier);
        console.log('📝 Generated Podcast Script:', podcastScript);

        if (!podcastScript.trim()) {
            alert('⚠️ Failed to generate a podcast script.');
            console.warn('❌ Podcast script is empty.');
            resetPlayButton(playButton);
            return;
        }

        // Step 3: Generate Audio from Podcast Script
        console.log('🔄 Generating audio from the podcast script.');
        const audioBlob = await generateAudioFromText(podcastScript, apiKey, activeService);

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
 * Combine article summaries into a single input string, respecting a max length.
 * @param {Array} articles
 * @param {number} maxLength
 * @returns {{combinedInput: string, includedCount: number}}
 */
function createCombinedInput(articles, maxLength) {
    if (!Array.isArray(articles)) return { combinedInput: '', includedCount: 0 };
    let combined = '';
    let count = 0;
    for (const a of articles) {
        const piece = (a.summary || a.content || a.title || '').trim();
        if (!piece) continue;
        // Add separator
        const toAdd = (combined ? '\n\n' : '') + piece;
        if ((combined + toAdd).length > maxLength) break;
        combined += toAdd;
        count += 1;
    }
    return { combinedInput: combined, includedCount: count };
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

// Podcast module initializer
function initPodcastManager(ui) {
    // Setup podcast UI and load podcasts
    loadPodcasts();
    // Wire up Create/Play button to generate a podcast from saved articles
    const btn = document.getElementById('playPodcastButton');
    if (btn) {
        // Avoid attaching multiple listeners if init is called more than once
        btn.removeEventListener('click', btn._podcastClickHandler);
        const handler = async () => {
            try {
                // Load saved article summaries from local storage
                chrome.storage.local.get(['articles'], (data) => {
                    const articles = data.articles || [];
                    // Get API key from sync storage (openai service by default)
                    chrome.storage.sync.get(['servicesConfig', 'activeService'], (sdata) => {
                        const activeService = sdata.activeService || 'openai';
                        const cfg = (sdata.servicesConfig || {})[activeService] || {};
                        const apiKey = cfg.apiKey || '';
                        const modelIdentifier = cfg.customModel || cfg.model || '';
                        if (!apiKey) {
                            alert(`Please set your ${activeService} API key in the extension settings before creating a podcast.`);
                            return;
                        }
                        // pass modelIdentifier so createChatCompletion can use the correct model
                        handlePlayPodcast(articles, apiKey, podcastAudioPlayer, btn, undefined, activeService, modelIdentifier);
                    });
                });
            } catch (err) {
                console.error('Error handling play podcast click:', err);
            }
        };
        btn._podcastClickHandler = handler;
        btn.addEventListener('click', handler);
    }
    // You can add more initialization logic here if needed, e.g. wiring up UIManager events
}

// Export the functions
export { loadPodcasts, handlePlayPodcast, resetPlayButton, initPodcastManager };
