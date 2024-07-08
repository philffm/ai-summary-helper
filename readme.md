# ![Icon](chrome-extension/icons/icon48.png) AI Summary Helper 

I often stumble over articles online I might want to read later. I used to open articles "for later" up until a point when I had 100 tabs open and eventually lost track of them all. 

With the summary helper I created a tool that allows to summarize articles with a custom prompt - so it can be as tailored to your language and profession or interested as you define it. The summary gets inserted in the content area itself. This way you can easily forward the artice including the generated summary to your Kindle device using [Reabbles Send-to-Kindle tool](https://send.reabble.com/). 

[Create your Bookmarklet](https://philffm.github.io/ai-summary-helper/bookmarklet-generator/) 
- Browser & OS-agnostic, even works on iOS 
![Demo](bookmarklet-generator/demo.gif)

[Download Chrome Browser Plugin (outdated)](https://chromewebstore.google.com/detail/ai-summary-helper-summari/hldbejcjaedipeegjcinmhejdndchkmb)

>On the go I am way more likely to engage with the content I intentionally selected earlier. 

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
- [] iOS compatibility (press to add?)
- [] Select dom element by clicking 
    - "Where sould summary be insertd
- [x] Add status state
    - pulsating
    - Spinner
    - Blurred

