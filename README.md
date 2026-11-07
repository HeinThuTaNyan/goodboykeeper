<div align="center">
  <img src="logo.png" alt="Good boy keeper Logo" width="110" height="110" style="border-radius: 24px;" />

  # 🐶 Good boy keeper
  **Stop Doomscrolling. Be a Good Boy.**

  [![Manifest V3](https://img.shields.io/badge/Manifest-V3-6366f1?style=for-the-badge&logo=googlechrome&logoColor=white)](manifest.json)
  [![Version](https://img.shields.io/badge/Version-1.3.0-06b6d4?style=for-the-badge)](manifest.json)
  [![Privacy](https://img.shields.io/badge/Privacy-100%25_Local_Cache-10b981?style=for-the-badge)](#100-local-privacy--security)
  [![Cross-Browser](https://img.shields.io/badge/Browsers-Chrome_%7C_Brave_%7C_Firefox_%7C_Edge-8b5cf6?style=for-the-badge)](#installation)

  <p align="center">
    A sleek, privacy-first browser extension designed to break the habit of doomscrolling on distracting websites like TikTok, Instagram, YouTube, and X—using smart active-time tracking, customizable meme/GIF interventions, and positive reinforcement.
  </p>
</div>

---

## ✨ What It Is

Instead of acting like a boring, aggressive website blocker, **Good boy keeper** tracks your real-time *active* screen time on distracting domains and interrupts endless scrolling with a funny, customizable meme/GIF pop-up alert when your time is up. When you make the healthy choice to leave the site, it rewards you with a celebratory **"What a good boy"** screen before automatically closing the tab.

---

## 🚀 Key Visual & Functional Highlights

### 🎨 Signature Mascot & Obsidian Dark-Mode UI
* Features a smirking Corgi mascot inside a modern dark-mode interface (`#0b0d13` obsidian background) accented with glowing indigo (`#6366f1`), violet (`#8b5cf6`), and cyan (`#06b6d4`) gradients.
* Instant **Current Tab Quick-Add** banner detects the active domain and lets you start a timer in one click.

### ⏱️ Interactive Clock-Style Time Dial
* **Circular SVG Slider:** Smooth draggable clock wheel with 12 clock-face tick marks and a glowing cyan handle.
* **Flexible Units & Presets:** Toggle seamlessly between **Minutes** (up to 120m) and **Hours** (up to 12h), type directly into the center input, or use one-tap quick presets (`5m`, `15m`, `30m`, `45m`, `60m`).

### 🧠 Smart Real-Time Active Tracking
* **Subdomain-Aware Normalization:** Tracks distinct web apps independently (e.g., `drive.google.com` vs. `docs.google.com` vs. `aistudio.google.com`) while automatically stripping generic prefixes (`www.`, `m.`, `mobile.`).
* **Live Status Badges:** Displays a pulsing green `Active • Counting` pill on your focused tab and `Inactive Tab • Idle` on background tabs.
* **Automatic Unfocus Pause:** Immediately pauses the countdown (`Paused • Window Unfocused`) the moment you `Alt+Tab` or switch to another application outside the browser.

### 🎭 3-Stage Funny In-Page Alert Modal (Shadow DOM)
Injected via an isolated Shadow DOM container (`#good-boy-keeper-shadow-host`) so host website styles never break the modal:
1. **Stage 1 — Time's Up Alert:** Blurs the background webpage (`backdrop-filter: blur(16px)`) and displays your custom or default "Stop it" GIF with two choices:
   * `Close Tab (I'm Leaving)`
   * `Snooze for 5 mins`
2. **Stage 2 — "What a good boy" Reward Screen:** Clicking **Close Tab** triggers a celebratory emerald/cyan reward screen (`goodboy.gif`) for **3.5 seconds** before automatically closing the tab (with a `Close Tab Now` button if you're in a rush).
3. **Stage 3 — Snooze Confirmation ("Are you sure?"):** Clicking **Snooze** triggers a second confirmation meme (`snooze.gif`) asking *"Wait... Snooze for 5 Mins?"* with options to **Go Back** or **Continue**, giving you a second chance to make a better choice.

### 🖼️ Bring Your Own Meme (Custom GIF & Headline)
* Paste any external image/GIF URL or upload a local file (`GIF`, `WebP`, `PNG`, `JPEG` up to 4.5 MB converted to Base64) along with a custom alert headline.
* Includes a live preview box inside the popup and a one-click reset to the bundled sample GIF.

### 🔒 100% Local Privacy & Security
* **Zero External Data Transfer:** All active timers, custom GIF configurations, and your **Tracked History** (up to 30 recent entries) are stored strictly in `chrome.storage.local` / `browser.storage.local`.
* **One-Click "Track Again":** Easily restart previous sessions directly from your local Tracked History list.
* **Production-Audited Security:** Built with zero unsafe `innerHTML` interpolations (100% safe DOM construction to prevent DOM XSS) and strict URL protocol/MIME allowlists.

---

## 🛠️ Installation

### Chrome / Brave / Edge (Developer Mode)
1. Clone or download this repository to your computer:
   ```bash
   git clone https://github.com/your-username/good-boy-keeper.git
   ```
2. Open your browser and navigate to `chrome://extensions/` (or `brave://extensions/` / `edge://extensions/`).
3. Enable **Developer mode** in the top-right corner.
4. Click **Load unpacked** in the top-left corner.
5. Select the root folder containing `manifest.json`.
6. Pin **Good boy keeper** to your browser toolbar and start tracking!

### Firefox (Temporary Add-on / Gecko 109.0+)
1. Open Firefox and navigate to `about:debugging#/runtime/this-firefox`.
2. Click **Load Temporary Add-on...**.
3. Select the `manifest.json` file inside the project folder.

---

## 📂 Project Structure

```text
good-boy-keeper/
├── manifest.json     # Manifest V3 configuration (Chrome, Brave, Edge & Firefox Gecko settings)
├── popup.html        # Extension popup structure (Quick-Add, SVG Time Dial, Lists, Custom GIF Config)
├── popup.css         # Obsidian dark-mode styling (#0b0d13) & animations
├── popup.js          # Popup UI controller, SVG dial math, Base64 uploader & real-time storage sync
├── background.js     # MV3 Service Worker countdown engine, window focus detection & alert delivery
├── content.js        # Shadow DOM 3-stage modal renderer & visibility heartbeat
├── content.css       # Host-level reset for the full-screen Shadow DOM container
├── logo.png          # Smirking Corgi mascot icon
├── alert.gif         # Default Stage 1 "Time's Up" GIF
├── goodboy.gif       # Stage 2 "What a good boy" celebration GIF
└── snooze.gif        # Stage 3 "Wait... Snooze for 5 Mins?" confirmation GIF
```

---

## ⚙️ How It Works Under the Hood

1. **1-Second Heartbeat & MV3 Service Worker Persistence:** `content.js` and `popup.js` send lightweight `GOOD_BOY_HEARTBEAT_TICK` messages only when a tab is visible and focused, backed by a `chrome.alarms` fallback in `background.js`.
2. **O(1) Normalized Domain Matching:** Active tab URLs are normalized and matched against tracked domains in `O(1)` time using JavaScript `Set` lookups, avoiding redundant storage writes when idle.
3. **Guaranteed Alert Delivery:** When a timer hits `0`, `background.js` logs the session as `Completed` in `siteHistory`, removes the active timer so revisiting the site later won't trigger a stale alert, and delivers `GOOD_BOY_TIME_UP` to matching tabs (dynamically injecting `content.js` via `chrome.scripting` if the tab was opened prior to installation).

---

## 📜 License

This project is open-source and available under the [MIT License](LICENSE).