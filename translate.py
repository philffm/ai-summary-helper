import os
import json
import requests

# Load your OpenAI API key from environment variables
api_key = os.getenv('OPENAI_API_KEY')
translations_path = 'docs/translations.json'
lang_dir = 'lang'

# Ensure the lang directory exists
if not os.path.exists(lang_dir):
    os.makedirs(lang_dir)

def translate_content(content, target_lang):
    prompt = f"Translate the following JSON content to {target_lang} organically with SEO optimization and maintain the JSON structure: {json.dumps(content)}"
    headers = {
        'Authorization': f'Bearer {api_key}',
        'Content-Type': 'application/json'
    }
    data = {
        'model': 'gpt-4o-mini',
        'messages': [
            {'role': 'system', 'content': 'You are a professional seo product translator for great product marketing.'},
            {'role': 'user', 'content': prompt}
        ],
        'max_tokens': 2000
    }
    response = requests.post('https://api.openai.com/v1/chat/completions', headers=headers, json=data)
    response.raise_for_status()
    return json.loads(response.json()['choices'][0]['message']['content'].strip())

def translate_file():
    with open(translations_path, 'r', encoding='utf-8') as file:
        data = json.load(file)
    languages = data['languages']
    content = data['content']

    for lang in languages:
        translated_content = translate_content(content, lang['code'])
        output_path = os.path.join(lang_dir, f"{lang['code']}.json")
        with open(output_path, 'w', encoding='utf-8') as file:
            json.dump(translated_content, file, ensure_ascii=False, indent=2)

if __name__ == '__main__':
    try:
        translate_file()
    except Exception as e:
        print(f"An error occurred: {e}")
