import os
import json
import requests

# Load your OpenAI API key from environment variables
api_key = os.getenv('OPENAI_API_KEY')
if not api_key:
    raise ValueError("API key is missing. Set the OPENAI_API_KEY environment variable.")

translations_path = 'docs/translations.json'
lang_dir = 'docs/lang'

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
        
        if 'choices' in response_data and response_data['choices']:
            # Extract the content from the response
            translated_text = response_data['choices'][0]['message']['content'].strip()
            
            # Remove backticks if the content is wrapped in a code block
            if translated_text.startswith("```json"):
                translated_text = translated_text.strip("```json").strip("```").strip()
            
            try:
                # Parse the JSON content after stripping the backticks
                return json.loads(translated_text)
            except json.JSONDecodeError:
                print("Failed to parse JSON from translated content. Attempting to clean it up.")
                print(f"Translated text: {translated_text}")
                return None
        else:
            print(f"Unexpected response structure: {response_data}")
    
    except requests.exceptions.HTTPError as http_err:
        print(f"HTTP error occurred: {http_err}")
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

    # Load the current version and languages
    current_version_path = 'current_version.json'
    try:
        with open(current_version_path, 'r', encoding='utf-8') as file:
            current_data = json.load(file)
    except (FileNotFoundError, json.JSONDecodeError):
        current_data = {}

    current_version = current_data.get('version')
    current_languages = current_data.get('languages', [])

    new_version = data.get('version')
    new_languages = data.get('languages', [])

    # Check if the version has changed or if there are new languages
    if new_version != current_version or len(new_languages) != len(current_languages):
        # Update the current version and languages
        with open(current_version_path, 'w', encoding='utf-8') as file:
            json.dump({'version': new_version, 'languages': new_languages}, file, ensure_ascii=False, indent=2)

        content = data.get('content')

        for lang in new_languages:
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
    else:
        print("No updates needed. Version and languages are unchanged.")

if __name__ == '__main__':
    try:
        translate_file()
    except Exception as e:
        print(f"An error occurred: {e}")
