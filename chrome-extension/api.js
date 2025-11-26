async function createChatCompletion(inputText, apiKey, selectedLanguage, podcastName) {
    const apiUrl = 'https://api.openai.com/v1/chat/completions';
    const model = 'gpt-4o'; // Ensure this is the correct model as per OpenAI documentation

    // Define the conversation messages
    const messages = [
        {
            role: 'system',
            content: `Podcast Name: ${podcastName}\n In language code"${selectedLanguage}" language, you are a creative and engaging podcast host. Transform the provided article summaries into an exciting 1 minute podcast script that captivates the audience. use language ${selectedLanguage}. Include the source of the article in the script. only include the domain, not the full URL.`
        },
        {
            role: 'user',
            content: inputText
        }
    ];

    // Define the request payload
    const requestBody = {
        model: model,
        messages: messages,
        max_tokens: 2500, // Adjust based on desired script length
        temperature: 0.7, // Adjust for creativity
        top_p: 1,
        n: 1,
        stream: false,
        stop: null
    };

    console.log('📤 Sending chat completion request to OpenAI:', requestBody);

    try {
        const response = await fetch(apiUrl, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(requestBody)
        });

        console.log('📥 Received response from Chat Completion API:', response);

        if (!response.ok) {
            let errorMessage = `Status: ${response.status}`;
            try {
                const errorData = await response.json();
                if (errorData.error) {
                    errorMessage += ` - ${errorData.error.message}`;
                    console.error('🛑 OpenAI Chat Completion API Error:', errorData.error);
                } else {
                    console.error('🛑 Unexpected error structure:', errorData);
                }
            } catch (parseError) {
                const errorText = await response.text();
                console.error('🛑 Error parsing OpenAI Chat Completion API error response:', parseError);
                console.error('🛑 Raw Error Response:', errorText);
            }
            throw new Error(errorMessage);
        }

        const data = await response.json();
        const podcastScript = data.choices[0].message.content.trim();
        return podcastScript;
    } catch (error) {
        console.error('🛑 Error in createChatCompletion:', error);
        throw error; // Propagate the error to be handled by the caller
    }
}

/**
 * Generates audio from the provided text using OpenAI's speech API.
 * @param {string} text - The text to convert to speech.
 * @param {string} apiKey - The OpenAI API key.
 * @returns {Promise<Blob|null>} - The audio blob or null if failed.
 */
async function generateAudioFromText(text, apiKey) {
    const apiUrl = 'https://api.openai.com/v1/audio/speech'; // Verify the correct endpoint
    const requestBody = {
        model: "tts-1", // Ensure this is the correct model as per OpenAI documentation
        input: text,
        voice: "alloy"  // Ensure 'alloy' is a valid voice option
    };

    console.log('📤 Sending audio generation request to OpenAI:', requestBody);

    try {
        const response = await fetch(apiUrl, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(requestBody)
        });

        console.log('📥 Received response from Audio API:', response);

        if (!response.ok) {
            let errorMessage = `Status: ${response.status}`;
            try {
                const errorData = await response.json();
                if (errorData.error) {
                    errorMessage += ` - ${errorData.error.message}`;
                    console.error('🛑 OpenAI Audio API Error:', errorData.error);
                } else {
                    console.error('🛑 Unexpected error structure:', errorData);
                }
            } catch (parseError) {
                const errorText = await response.text();
                console.error('🛑 Error parsing OpenAI Audio API error response:', parseError);
                console.error('🛑 Raw Error Response:', errorText);
            }
            throw new Error(errorMessage);
        }

        const audioBlob = await response.blob();
        console.log('🎧 Audio blob received:', audioBlob);
        return audioBlob;
    } catch (error) {
        console.error('🛑 Error in generateAudioFromText:', error);
        throw error; // Propagate the error to be handled by the caller
    }
}