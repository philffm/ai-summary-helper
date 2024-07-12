<style>
    h1:first-of-type {
        display: none;
    }

</style>

<!-- # ![Icon](chrome-extension/icons/icon48.png) AI Summary Helper  -->
<h1 style="display: flex; align-content: center; align-items: center; gap: 12px;"><img src="icon.svg" style="width:48px; height:48px">AI Summary Helper</h1>

<a href="https://www.producthunt.com/posts/ai-summary-helper?embed=true&utm_source=badge-featured&utm_medium=badge&utm_souce=badge-ai&#0045;summary&#0045;helper" target="_blank"><img src="https://api.producthunt.com/widgets/embed-image/v1/featured.svg?post_id=461601&theme=dark" alt="AI&#0032;Summary&#0032;Helper - Instantly&#0032;summarize&#0032;all&#0032;the&#0032;web&#0032;content&#0032;your&#0032;browse | Product Hunt" style="width: 250px; height: 54px;" width="250" height="54" /></a>


I often stumble over articles online I might want to read later. This often resulted in 100 tabs open and eventually me losing track of them all. 

>On the go I am way more likely to engage with the content I intentionally selected earlier. 

Summary Helper allows to summarize articles with a custom prompt - so it can be as tailored to your language, profession or point of view as you define it. The summary gets inserted in the content area itself. This way you can easily forward the artice including the generated summary to your Kindle device e.g. using [Reabbles Send-to-Kindle tool](https://send.reabble.com/). 

**Variant A:** [Create your Bookmarklet](https://philffm.github.io/ai-summary-helper/bookmarklet-generator/) 
- Browser & OS-agnostic, even works on iOS 

![Demo](bookmarklet-generator/demo.gif)

**Variant B:** [Download Chrome Browser Plugin (outdated)](https://chromewebstore.google.com/detail/ai-summary-helper-summari/hldbejcjaedipeegjcinmhejdndchkmb)


## Overview

This project includes two components:
- **Chrome Extension**: A browser plugin for generating AI summaries of web content.
- **Bookmarklet Generator**: A tool for creating bookmarklets that provide AI summaries.

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

### Browser Plugin

### Bookmarklet Generator 
- [x] Save API Key in Browser
- [x] iOS compatibility 
- [x] Select dom element by clicking 
    - "Where sould summary be insertd
- [x] Add status state
    - pulsating
    - Spinner
    - Blurred
- [ ] Include update mechanism (make the bookmarklet check this repo for a newer script) 


## Privacy Policy

The privacy policy for this project is available in the [Privacy section](/chrome-extension/privacy.md).

## License

2024 Phil Wornath - [MIT License](LICENSE)