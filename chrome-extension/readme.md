# AI Summary Extension

![Icon](icons/icon128.png)

## Overview

**AI Summary Extension** helps you quickly fetch and insert AI-generated summaries of web content. This extension can be easily combined with Reabble's **Send To Kindle** extension to provide both a concise summary and the full article, making it perfect for on-the-go reading within seconds.

## Features

- 🧠 **AI-Generated Summaries**: Uses OpenAI to generate summaries of web content.
- 📚 **Combine with Send To Kindle**: Easily integrate with Reabble's **Send To Kindle** extension to get both a summary and the full article sent to your Kindle.
- ⚙️ **Customizable Prompts**: Configure the base prompt for summaries and add additional questions for more tailored results.
- 🚀 **Quick and Easy**: Fetch the gist of an article quickly and have the option to read the full content later.

## Installation

1. Clone or download the repository.
2. Open Chrome and navigate to `chrome://extensions/`.
3. Enable **Developer mode** by clicking the toggle switch in the top right corner.
4. Click the **Load unpacked** button and select the directory containing the extension.

## Usage

1. Click on the extension icon ![Icon](icons/icon16.png) in the Chrome toolbar to open the popup.
2. Enter any additional questions about the article (optional).
3. Click **Fetch Summary** to generate and insert the summary into the current webpage.
4. To configure your OpenAI API key and base prompt, click the **Settings** button in the popup and enter your details.

## Settings

- **OpenAI API Key**: Your API key for accessing OpenAI's services.
- **Base Prompt**: The default prompt used for generating summaries.

## Example Use Case

Combine AI Summary Extension with Reabble's **Send To Kindle** extension to get both a summary and the full article for convenient on-the-go reading.

## Development

### File Structure

- `manifest.json`: Chrome extension manifest file.
- `popup.html`: HTML file for the extension popup.
- `popup.js`: JavaScript file for handling popup interactions.
- `content.js`: Content script for interacting with web pages.
- `background.js`: Background script for managing extension background tasks.
- `icons/`: Directory containing the extension icons.

### Scripts

- **popup.js**: Handles user interactions in the popup, including fetching summaries and saving settings.
- **content.js**: Injected into web pages to fetch content and insert summaries.

## Contributing

Feel free to open issues or submit pull requests with improvements. We welcome all contributions!

## License

This project is licensed under the MIT License. See the [LICENSE](LICENSE) file for details.

![Icon](icons/icon128.png)
