// audioManager.js
// Handles podcast audio generation and saving

import { generateAudioFromText } from "../api.js";

/**
 * Generates podcast audio and saves it.
 * @param {Array} sortedArticles - Array of article objects
 * @param {string} apiKey - API key for TTS
 * @param {string} podcastScript - The podcast script text
 * @param {HTMLElement} playButton - Button to update UI state
 * @param {string} selectedLanguage - Language code
 * @param {string} activeService - Service id (e.g. 'openai', 'gemini')
 * @param {string} modelIdentifier - Model id/name
 */
export async function handlePlayPodcast(
    sortedArticles,
    apiKey,
    podcastScript,
    playButton,
    selectedLanguage,
    activeService = "openai",
    modelIdentifier = ""
) {
    try {
        if (playButton) {
            playButton.disabled = true;
            playButton.textContent = "Generating audio… 🔊";
        }

        const audioBlob = await generateAudioFromText(
            podcastScript,
            apiKey,
            activeService
        );

        if (!audioBlob) throw new Error("TTS returned no audio.");

        // Save podcast (simple local storage)
        savePodcast(`Podcast - ${new Date().toLocaleString()}`, audioBlob);

        // Trigger browser download
        const audioUrl = URL.createObjectURL(audioBlob);
        const a = document.createElement("a");
        a.href = audioUrl;
        a.download = `podcast-${new Date().toISOString().replace(/[:.]/g, '-')}.mp3`;
        document.body.appendChild(a);
        a.click();
        setTimeout(() => {
            document.body.removeChild(a);
            URL.revokeObjectURL(audioUrl);
        }, 1000);

        if (playButton) {
            playButton.textContent = "Done 🎧";
            playButton.disabled = false;
        }
    } catch (err) {
        console.error("handlePlayPodcast error:", err);
        alert("Audio generation failed: " + err.message);
        if (playButton) {
            playButton.disabled = false;
            playButton.textContent = "Generate 🎙️";
        }
    }
}

/**
 * Saves podcast audio to local storage
 * @param {string} title - Podcast title
 * @param {Blob} audioBlob - Audio blob
 */
function savePodcast(title, audioBlob) {
    const reader = new FileReader();
    reader.onload = function () {
        const audioUrl = reader.result;
        chrome.storage.local.get({ podcasts: [] }, data => {
            const podcasts = data.podcasts || [];
            podcasts.push({ title, audio: audioUrl });
            chrome.storage.local.set({ podcasts });
        });
    };
    reader.readAsDataURL(audioBlob);
}
