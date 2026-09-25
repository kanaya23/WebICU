### *Do it once, and capture every action you do, give it to an ai. Walk away with a uhh whatever you're making BUT FASTER!!!.*

# WebICU

A zero-build browser extension that records user interactions, links clicks to their hidden network requests, and generates standalone offline snapshots—designed specifically to be dropped into an AI agent so it can write scrapers for you.

---

## Why I Built This

I created WebICU as a personal hobby project and practical utility for my own workflow. 

My primary use case is simple: I use WebICU to record my manual browsing actions on a website, export the structured session bundle (which includes interaction timelines, DOM mutations, network requests, and self-contained HTML snapshots), and **drop the entire export into an AI agent** (Claude, Gemini, ChatGPT, etc.). The AI agent analyzes the exact user actions and captured page states to automatically write a resilient web scraper or automation script for me.

## Project Status

> **Note**: This extension is released strictly as a **personal tool and proof-of-concept**. I am **not maintaining** this repository, adding new features, or providing support. It is shared as-is—feel free to fork, customize, or adapt it to your own needs!

---

## Features

- **Zero-Build Architecture**: Pure vanilla JavaScript (ES modules), HTML, and CSS. No `node_modules`, bundlers, or compilation steps required. Load directly into Chrome.
- **Action & Causality Tracking**: Automatically detects user interactions (clicks, text inputs, form submissions) and links them to the exact network calls and spawned DOM elements they triggered.
- **Self-Contained HTML Snapshots**: Captures offline-ready, standalone HTML snapshots during key workflow moments with inlined styles and images.
- **Interactive Session Studio**: Built-in player with timeline scrubber, variable playback speeds, and DOM inspector.
- **Structured ZIP Export**: One-click export packaging session metadata, request dumps, offline snapshots, and a zero-dependency Node CLI (`query_session.js`) for rapid terminal querying.
- **Dual Recording Engines**: 
  - *Stealth MV3*: Silent, lightweight recording via page context injection.
  - *CDP Debugger*: Low-level Chrome DevTools Protocol engine for detailed network and WebSocket interception.

---

## Installation

1. Clone or download this repository to your computer.
2. Open Google Chrome (or any Chromium browser like Brave or Edge) and go to `chrome://extensions`.
3. Enable **Developer mode** using the toggle in the top-right corner.
4. Click **Load unpacked**.
5. Select this project directory.

---

## Quick Start

1. Navigate to the website you want to record.
2. Click the **WebICU** icon in your browser toolbar.
3. Click **Start Recording** (the badge will show `REC`).
4. Perform your workflow (search, click items, fill inputs, paginate).
5. Click **Stop & Save** in the popup.
6. The **Session Studio** will open automatically, allowing you to replay your session, inspect causality, preview snapshots, or click **Export ZIP** to download the complete intelligence archive.

---

## Acknowledgments & Credits

- [rrweb](https://github.com/rrweb-io/rrweb) (MIT License) — Core DOM mutation recording and replay playback engine.
- Offline standalone HTML snapshotting inspired by the concept popularized by [SingleFile](https://github.com/gildas-lormeau/SingleFile).

---

## License

Released under the [MIT License](LICENSE).
