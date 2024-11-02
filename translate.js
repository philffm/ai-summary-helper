const fs = require('fs');
const path = require('path');
const { Configuration, OpenAIApi } = require('openai');

// Load your OpenAI API key from environment variables
const openai = new OpenAIApi(new Configuration({
    apiKey: process.env.OPENAI_API_KEY,
}));

const translationsPath = path.join(__dirname, 'page', 'translations.json');
const langDir = path.join(__dirname, 'lang');

// Ensure the lang directory existss
if (!fs.existsSync(langDir)) {
    fs.mkdirSync(langDir);
}

async function translateContent(content, targetLang) {
    const prompt = `Translate the following JSON content to ${targetLang} organically with SEO optimization and maintain the JSON structure: ${JSON.stringify(content)}`;
    const response = await openai.createCompletion({
        model: "gpt-4o",
        prompt: prompt,
        max_tokens: 2000,
    });

    return JSON.parse(response.data.choices[0].text.trim());
}

async function translateFile() {
    const data = JSON.parse(fs.readFileSync(translationsPath, 'utf8'));
    const languages = data.languages;
    const content = data.content;

    for (const lang of languages) {
        const translatedContent = await translateContent(content, lang.code);
        const outputPath = path.join(langDir, `${lang.code}.json`);
        fs.writeFileSync(outputPath, JSON.stringify(translatedContent, null, 2));
    }
}

translateFile().catch(console.error);
