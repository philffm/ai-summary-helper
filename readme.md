<link href="style.css" rel="stylesheet">
<!-- # ![Icon](chrome-extension/icons/icon48.png) AI Summary Helper  -->
<h1 style="display: flex; align-content: center; align-items: center; gap: 12px;"><img src="icon.svg" style="width:48px; height:48px">AI Summary Helper</h1>

>You are on the hunt for interesting articles around the web, open 100 tabs and end up… not reading them. Sounds familiar?

Summary Helper allows to summarize articles with a custom prompt - so it can be as tailored to your language, profession or point of view as you define it. The summary gets inserted in the content area itself. This way you can easily forward the artice including the generated summary to your Kindle device e.g. using [Reabbles Send-to-Kindle tool](https://send.reabble.com/). 

<a href="https://www.producthunt.com/posts/ai-summary-helper?embed=true&utm_source=badge-featured&utm_medium=badge&utm_souce=badge-ai&#0045;summary&#0045;helper" target="_blank"><img src="https://api.producthunt.com/widgets/embed-image/v1/featured.svg?post_id=461601&theme=dark" alt="AI&#0032;Summary&#0032;Helper - Instantly&#0032;summarize&#0032;all&#0032;the&#0032;web&#0032;content&#0032;your&#0032;browse | Product Hunt" style="width: 250px; height: 54px;text-align: center;" width="250" height="54" /></a> 
<a href="https://chrome.google.com/webstore/detail/ai-summary-helper-summari/hldbejcjaedipeegjcinmhejdndchkmb" target="_blank"><img src="https://storage.googleapis.com/web-dev-uploads/image/WlD8wC6g8khYWPJUsQceQkhXSlv1/iNEddTyWiMfLSwFD6qGq.png" alt="Chrome Web Store" style="width: 206px; height: 58px;text-align: center;" width="206" height="58" /></a><a href="https://philffm.github.io/ai-summary-helper/bookmarklet-generator/" target="_blank"><img src="assets/createBookmarklet.svg" alt="Create Bookmarklet" /></a>


>On the go I am way more likely to engage with the content I intentionally selected earlier. The tailored briefing then helps me to recall why I chose the article, suggests me books and other media related to it. 

![AI Summary Helper](assets/aish.png)sh.png)

**Variant A:** [Create your Bookmarklet](https://philffm.github.io/ai-summary-helper/bookmarklet-generator/) 
- Browser & OS-agnostic, even works on iOS 

![Demo](bookmarklet-generator/demo.gif)

**Variant B:** [Download Chrome Browser Plugin](https://chromewebstore.google.com/detail/ai-summary-helper-summari/hldbejcjaedipeegjcinmhejdndchkmb)


## Overview

This project includes two components:
- **Chrome Extension**: A browser plugin for generating AI summaries of web content.
- **Bookmarklet Generator**: A tool for creating bookmarklets that provide AI summaries.

|  | Bookmarklet  | Browser Extension |
| --- | --- | --- |
| OpenAI | ✅ | ✅ |
| Mistral AI | ✅ | ✅ |
| Custom Prompt | 🟠 Initially set base prompt | ✅ Base + custom prompt per request|
| Cross Platform | ✅ | ❌|


## Project Structure

- `chrome-extension/`: Contains the files for the Chrome extension.
- `bookmarklet-generator/`: Contains the files for the bookmarklet generator.
- `privacy.md`: Privacy policy for the project.

## Installation and Usage

### Chrome Extension

1. Navigate to the `chrome-extension` directory and follow the instructions in the `readme.md`.

### Bookmarklet Generator

1. Navigate to the `bookmarklet-generator` directory and follow the instructions in the `readme.md`.


## Feature Agenda 🚀

Bookmarklet generator generally ships faster since it is faster to iterate on.

### Browser Plugin

### Bookmarklet Generator 
- [x] Save API Key in Browser
- [x] iOS compatibility 
- [x] Select dom element by clicking to make insertion-point be definable by user
- [x] Add status state
- [ ] Include update mechanism (make the bookmarklet check this repo for a newer script) 
- [ ] Support other providers (on-device? What are some local LLMs we could use for this / API through localhost?)


## Privacy Policy

The privacy policy for this project is available in the [Privacy section](/chrome-extension/privacy.md).

## License

2024 Phil Wornath - [MIT License](LICENSE)
