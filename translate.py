import os
import json
import requests

# Load your OpenAI API key from environment variables
api_key = os.getenv('OPENAI_API_KEY')
if not api_key:
    raise ValueError("API key is missing. Set the OPENAI_API_KEY environment variable.")

translations_path = 'docs/translations.json'
lang_dir = 'lang'

# Ensure the lang directory exists
os.makedirs(lang_dir, exist_ok=True)

def translate_content(content, target_lang):
    prompt = f"Translate the following JSON content to {target_lang} organically with SEO optimization and maintain the JSON structure: {json.dumps(content)}"
    headers = {
        'Authorization': f'Bearer {api_key}',
        'Content-Type': 'application/json'
    }
    data = {
        'model': 'gpt-4o-mini',
        'messages': [
            {'role': 'system', 'content': 'You are a professional SEO product translator for great product marketing.'},
            {'role': 'user', 'content': prompt}
        ],
        'max_tokens': 2000
    }
    
    response = requests.post('https://api.openai.com/v1/chat/completions', headers=headers, json=data)
    
    try:
        response.raise_for_status()
        response_data = response.json()
        
        # Check if 'choices' exists and contains the expected content
        if 'choices' in response_data and response_data['choices']:
            # Attempt to parse the JSON from the response content
            translated_text = response_data['choices'][0]['message']['content'].strip()
            return json.loads(translated_text)
        else:
            print(f"Unexpected response structure: {response_data}")
    
    except requests.exceptions.HTTPError as http_err:
        print(f"HTTP error occurred: {http_err}")
        print(f"Response content: {response.text}")
    except json.JSONDecodeError as json_err:
        print(f"JSON decode error: {json_err}")
        print(f"Response content: {response.text}")
    except Exception as err:
        print(f"An error occurred: {err}")
        print(f"Response content: {response.text}")
    
    return None

def translate_file():
    try:
        with open(translations_path, 'r', encoding='utf-8') as file:
            data = json.load(file)
    except FileNotFoundError:
        print(f"Translation file not found: {translations_path}")
        return
    except json.JSONDecodeError as json_err:
        print(f"Error loading JSON file: {json_err}")
        return

    languages = data.get('languages', [])
    content = data.get('content')

    for lang in languages:
        lang_code = lang.get('code')
        if not lang_code:
            print("Language code missing in configuration.")
            continue
        
        translated_content = translate_content(content, lang_code)
        if translated_content:
            output_path = os.path.join(lang_dir, f"{lang_code}.json")
            with open(output_path, 'w', encoding='utf-8') as file:
                json.dump(translated_content, file, ensure_ascii=False, indent=2)
            print(f"Translated content written to {output_path}")
            print(f"Content for {lang_code}: {translated_content}")

if __name__ == '__main__':
    try:
        translate_file()
    except Exception as e:
        print(f"An error occurred: {e}")
