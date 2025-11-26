/**
 * Create a chat completion using the active service config.
 * Falls back to StorageManager.getActiveServiceConfig() when apiKey/service/model are not provided.
 * Supports OpenAI-like providers and Gemini (Google) generateContent.
 *
 * @param {string} inputText - The user/system combined input text to send to the model
 * @param {string} apiKey - (optional) API key; if omitted, will be read from storage
 * @param {string} selectedLanguage - language code used in system instruction
 * @param {string} podcastName - optional podcast name included in system instruction
 * @param {string} activeService - (optional) service id e.g. 'openai' or 'gemini'
 * @param {string} modelIdentifier - (optional) model id/name to use
 */
async function createChatCompletion(inputText, apiKey, selectedLanguage, podcastName, activeService = null, modelIdentifier = null) {
    try {
        // If caller didn't provide service/model/apiKey, load active service config
        if (!apiKey || !activeService || !modelIdentifier) {
            try {
                const { default: StorageManager } = await import('./modules/storageManager.js');
                const cfg = await StorageManager.getActiveServiceConfig();
                activeService = activeService || cfg.id || 'openai';
                apiKey = apiKey || cfg.apiKey || '';
                modelIdentifier = modelIdentifier || cfg.model || '';
            } catch (e) {
                console.warn('Could not import StorageManager or get active service config', e);
            }
        }

        // Ensure we have an apiKey
        if (!apiKey) throw new Error('API key not provided for the active service');

        // Build a system instruction tailored to podcast creation
        const systemInstruction = `Podcast Name: ${podcastName || 'Untitled Podcast'}\nIn language code "${selectedLanguage || 'en-US'}" you are a creative and engaging podcast host. Transform the provided article summaries into an exciting ~1 minute podcast script that captivates the audience. Include the source domain when appropriate.`;

        // Gemini branch
        if ((activeService || '').toLowerCase() === 'gemini') {
            const finalApiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(modelIdentifier)}:generateContent`;
            const fullText = `${systemInstruction}\n\n${inputText}`;

            const reqObj = {
                temperature: 0.3,
                candidateCount: 1,
                maxOutputTokens: 800,
                contents: [ { parts: [ { text: fullText } ] } ]
            };

            console.log('📤 Sending request to Gemini:', { url: finalApiUrl, model: modelIdentifier, length: fullText.length });

            const resp = await fetch(finalApiUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'x-goog-api-key': apiKey
                },
                body: JSON.stringify(reqObj)
            });

            if (!resp.ok) {
                const txt = await resp.text();
                console.error('� Gemini error:', resp.status, txt);
                throw new Error(`Gemini request failed: ${resp.status} ${txt}`);
            }

            const data = await resp.json();
            // Try several known Gemini shapes
            const candidates = data.candidates || [];
            let out = candidates[0]?.content?.parts?.[0]?.text || data.output?.[0]?.content?.[0]?.text || data.candidates?.[0]?.text || data.message?.content || JSON.stringify(data);
            if (typeof out === 'object') out = JSON.stringify(out);
            return String(out).trim();
        }

        // Default: OpenAI-like
        const apiUrl = modelIdentifier && modelIdentifier.startsWith('http') ? modelIdentifier : 'https://api.openai.com/v1/chat/completions';
        const messages = [
            { role: 'system', content: systemInstruction },
            { role: 'user', content: inputText }
        ];

        const requestBody = {
            model: modelIdentifier || 'gpt-4o',
            messages,
            max_tokens: 2500,
            temperature: 0.7,
            top_p: 1,
            n: 1,
            stream: false
        };

        console.log('� Sending chat completion request to OpenAI-like endpoint:', { apiUrl, model: requestBody.model });

        const response = await fetch(apiUrl, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(requestBody)
        });

        if (!response.ok) {
            let em = `Status: ${response.status}`;
            try {
                const err = await response.json();
                em += ` - ${JSON.stringify(err)}`;
            } catch (e) {
                const txt = await response.text();
                em += ` - ${txt}`;
            }
            throw new Error(em);
        }

        const result = await response.json();
        const podcastScript = result.choices?.[0]?.message?.content || result.choices?.[0]?.text || JSON.stringify(result);
        return String(podcastScript).trim();
    } catch (error) {
        console.error('🛑 Error in createChatCompletion:', error);
        throw error;
    }
}

/**
 * Generates audio from the provided text using OpenAI's speech API.
 * @param {string} text - The text to convert to speech.
 * @param {string} apiKey - The OpenAI API key.
 * @returns {Promise<Blob|null>} - The audio blob or null if failed.
 */
/**
 * Generate audio blob from text. Supports OpenAI TTS and Google TTS (Gemini) depending on activeService.
 * @param {string} text
 * @param {string} apiKey - optional; will be read from storage if missing
 * @param {string} activeService - optional service id
 */
async function generateAudioFromText(text, apiKey = '', activeService = null) {
    try {
        if (!apiKey || !activeService) {
            try {
                const { default: StorageManager } = await import('./modules/storageManager.js');
                const cfg = await StorageManager.getActiveServiceConfig();
                apiKey = apiKey || cfg.apiKey || '';
                activeService = activeService || cfg.id || 'openai';
            } catch (e) {
                console.warn('Could not import StorageManager for TTS fallback', e);
            }
        }

        if (!apiKey) throw new Error('API key not provided for TTS');

        // Gemini / Google Cloud Text-to-Speech
        if ((activeService || '').toLowerCase() === 'gemini') {
            // Google Cloud TTS v1 expects a POST to https://texttospeech.googleapis.com/v1/text:synthesize
            // We can pass the apiKey either as query ?key=API_KEY or via x-goog-api-key header.
            const apiUrl = `https://texttospeech.googleapis.com/v1/text:synthesize?key=${encodeURIComponent(apiKey)}`;
            const payload = {
                input: { text },
                // sensible defaults; users can later expose voice selection in settings
                voice: { languageCode: 'en-US', name: 'en-US-Wavenet-D' },
                audioConfig: { audioEncoding: 'MP3' }
            };

            console.log('📤 Sending TTS request to Google TTS:', { apiUrl });

            const resp = await fetch(apiUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });

            if (!resp.ok) {
                const txt = await resp.text();
                throw new Error(`Google TTS failed: ${resp.status} ${txt}`);
            }

            const data = await resp.json();
            const audioContent = data?.audioContent;
            if (!audioContent) throw new Error('No audioContent in Google TTS response');

            // audioContent is base64-encoded
            const binary = atob(audioContent);
            const len = binary.length;
            const buffer = new Uint8Array(len);
            for (let i = 0; i < len; i++) buffer[i] = binary.charCodeAt(i);
            return new Blob([buffer], { type: 'audio/mpeg' });
        }

        // Default: OpenAI TTS (if available)
        const apiUrl = 'https://api.openai.com/v1/audio/speech';
        const requestBody = {
            model: 'tts-1',
            input: text,
            voice: 'alloy'
        };

        const response = await fetch(apiUrl, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(requestBody)
        });

        if (!response.ok) {
            const t = await response.text();
            throw new Error(`OpenAI TTS failed: ${response.status} ${t}`);
        }

        return await response.blob();
    } catch (error) {
        console.error('🛑 Error in generateAudioFromText:', error);
        throw error;
    }
}