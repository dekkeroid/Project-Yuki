# Project Yuki

<img width="1397" height="910" alt="image" src="https://github.com/user-attachments/assets/95437cc4-6824-44c3-9d13-bed24fefc19e" />


<div align="center">
  <h3>Next-Generation Desktop AI Companion with Voice, Vision, Memory, and System Control</h3>
  <p>An open, customizable 3D anime companion engineered in Electron, React, Three.js, and FastAPI.</p>
</div>

---

## Highlights

- **Interactive 3D Avatar (VRM / Three.js)**: Full 3D companion with procedural physics, realistic eyelid blinking, micro-saccades, gaze tracking, emotion blend shapes, and custom VRMA motion capture playback.
- **Intimate Date Mode**: Dedicated secondary standalone stage featuring romantic 3D environments (Tokyo Sky Lounge, Marine Drive, Sakura River, Cozy Cafe), custom camera perspectives, reactive animations, and proactive conversational initiatives.
- **Bidirectional Telegram Mobile Companion**: Connect your personal Telegram bot to message Yuki on the go, send/receive voice notes with natural speech, share photos for vision analysis, manage desktop files, and receive proactive reminders anywhere.
- **Flexible LLM Backends**: Seamless support for local models via **LM Studio** and **Ollama**, as well as cloud frontier APIs (**OpenAI**, **Gemini**, or any OpenAI-compatible endpoint). Dual-endpoint strategy allows lightweight models for conversation and frontier models for complex tool execution.
- **Autonomous System Control & Desktop Vision**: Yuki can search and index local files, read/edit documents, view screen state, control multimedia, open applications, execute shell tasks, and browse the web.
- **Natural Voice & Streaming Speech**: Real-time Voice Activity Detection (VAD) via `@ricky0123/vad-web` + Silero VAD, fast local speech-to-text with Faster-Whisper, and low-latency natural text-to-speech with Kokoro ONNX and edge TTS fallbacks.
- **Local Neural Memory & Semantic Search**: Automated background crawler and vector database (`vectors.db`) that indexes personal files, documents, project directories, and conversational memories without sending private data to cloud services.

---

## Architecture Overview

```text
Electron Desktop Application
  ├── Main Floating Companion Window (Transparent glassmorphic avatar + chat bubble)
  ├── Detached Control Dashboard Window (Full settings, memory inspector, crawler stats)
  └── Standalone Date Mode Window (Immersive full 3D date environment & romantic stage)

React + Three.js Frontend
  ├── VRM Avatar Engine (@pixiv/three-vrm, procedural animations, blend shapes, lookAt)
  ├── Web VAD + Speech Recognition Hook (Continuous listening, wake words, barge-in)
  └── WebSocket State Bridge (Real-time token streaming, thinking status, audio visemes)

FastAPI Backend (`backend/app/main.py`)
  ├── Agent Executor (`backend/app/agent/executor.py`) — Multi-turn reasoning & desktop tool execution
  ├── LLM Backend Providers (`backend/app/agent/llm_backend.py`) — Local & Cloud streaming
  ├── Telegram Bot Service (`backend/app/channels/telegram_service.py`) — Bidirectional mobile companion
  ├── Safety Sandbox (`backend/app/tools/safety.py`) — Confirmation tokens & permission gates
  ├── Semantic File Crawler & Vector DB (`backend/app/memory/crawler.py`) — Local search index
  └── Kokoro ONNX Audio Engine (`backend/app/voice/tts.py`) — High-fidelity local speech synthesis
```

---

## Getting Started & Installation

### Option 1: Pre-Built Windows Installer (Simplest) (Pros: Stable and Fast)
Download the latest `YukiAI-Setup.exe` from the [GitHub Releases](https://github.com/dekkeroid/Project-Yuki/releases) page and run the installer. Yuki installs into your local application directory and launches immediately.

After installing you need to go to settings -> Ai brain, to set up your LLM. I will recommend using Local LLMs only for users with a good setup. Avoid using <7B models they are not good at tool calling. 

For average users I recommend using Cloud API,  `Gemini Flash lite` from `Google Ai Studio` is fast, cheap and good at roleplay. Google Ai studio has one of the most generous `Free tier` out there.

### Option 2: Running from Source in Dev mode for testing (Pros: latest code, Cons: Very slow)

#### Prerequisites
- **OS**: Windows 10/11 (64-bit)
- **Node.js**: v18 or later (`node -v` / `npm -v`)
- **Python**: 3.10 or 3.11 (`python --version`)
- **Git**
- [LM Studio](https://lmstudio.ai/) or [Ollama](https://ollama.com/) running locally, or a cloud API.

#### 1. Clone the Repository
```bash
git clone https://github.com/dekkeroid/Project-Yuki.git
cd Project-Yuki
```

#### 2. Backend Setup
```powershell
cd backend
python -m venv venv
.\venv\Scripts\Activate.ps1
pip install -r requirements.txt
cp .env.default .env
```
*Review `.env` if you wish to configure default API keys, voice selection, or custom directories.*

#### 3. Frontend Setup
```powershell
cd ..\frontend
npm install
```

#### 4. Launching Development Mode
From the root directory, simply run:
```bat
"start yuki ai (2 windows).bat"
```
This starts:
- The FastAPI backend with automatic reloading on port 8000.
- The Vite development server on port 5173 with hot-module replacement.
- Electron in development mode with automatic restart on main-process edits.


### Option 3: Best of both, install using the installer and clone repo as well (Best method, Recommended for devs) 
Simply install and clone as well, and in repo there is `update_installed.bat` which updates the installed app as the code in your repo changes. Use update_installed.bat to keep your installed app updated.

Pros: Fastest startup. You can update the installed app as you wish or as repo changes.

---

## Configuration & Feature Wiki

### 1. LLM Endpoint Strategies & Models
Yuki supports three operational LLM strategies configured under **Settings > Models**:
- **Single Endpoint**: One model handles all conversational queries and system tools (ideal when using powerful frontier models like Gemini 2.5 Flash / Pro or GPT-4o).
- **Dual Strategy (Speed & Cost Optimization)**:
  - **Chat/Simple Model**: A fast, lightweight local or cloud model (e.g. Qwen 2.5 7B, Llama 3.2 3B) for instant casual banter and chitchat.
  - **Tool/Complex Model**: A capable frontier model called dynamically only when system tools, code writing, or multi-step reasoning are required.
- **Thinking & Reasoning Depth**: Control internal chain-of-thought depth with the `Thinking Effort` selector (`none`, `minimal`, `low`, `medium`, `high`) to balance accuracy and response latency across Gemini and OpenAI o-series models.
- **Hardware Recommendation (Average PCs)**: For average PC setups without dedicated high-end GPUs, we strongly recommend using **cloud APIs** rather than running local models. In particular, **Gemini Flash Lite** via **Google AI Studio** offers generous free API access, near-zero VRAM footprint (leaving your GPU completely free for the 3D VRM avatar), lightning-fast voice turnarounds, and exceptional autonomous tool-calling precision.

### 2. Autonomous Desktop Tools & System Control
Yuki features a full autonomous system control suite:
- **Dynamic Semantic Selection**: Tools are scored against your message intent in real-time (`backend/app/tools/selector.py`) so models only receive tools pertinent to the immediate task, avoiding context bloat and hallucination.
- **Parallel Multi-Step ReAct**: In Autonomous Jarvis mode, Yuki plans, calls multiple tools in parallel or sequence, evaluates outcomes, and self-corrects until tasks are resolved.
- **Supported Toolsets**:
  - `web_search` & `web_scrape`: Live internet search and deep page extraction.
  - `see_screen` & `take_screenshot`: Real-time visual desktop understanding with vision models.
  - `read_file`, `create_file`, `edit_file`: Full filesystem inspection and manipulation.
  - `execute_terminal_command`: PowerShell and shell execution with sandboxing.
  - `keyboard_mouse_input`: Automated clicking, mouse navigation, and hotkey shortcuts.
  - `system_status`: Hardware telemetry (CPU, GPU, RAM, VRAM, and temperatures).

### 3. Tool Safety Sandbox & Permissions
Tool execution is protected by multi-layer safety policies:
- Destructive commands, system power management, and file deletions require explicit UI confirmation grants. Misheard speech recognition utterances cannot trigger unconfirmed destructive actions.
- Safe read-only operations (reading time, checking hardware specs, searching files) run instantly without friction.

### 4. Background File Crawler & Local Search
Yuki includes an automated, non-intrusive background file crawler:
- **Startup Grace Period**: Suspended for the first 2 minutes after application launch to keep system startup instantaneous. A manual "Start Crawler Now" button is available in the dashboard.
- **Resource Respect**: Throttles I/O and pauses automatically during active user conversations.
- **Real-Time Watchdog**: Listens for file modifications in configured target folders and updates semantic indexes instantly.

### 5. Date Mode (Immersive 3D Experience)
Accessible from the companion menu or `/date` command:
- Opens a dedicated, high-fidelity 3D window loaded with detailed romantic environments (Tokyo Sky Lounge, Cafe, Riverside).
- Seated avatar poses, eye contact tracking with anatomical saccades, and reactive emotional animations.
- Proactive conversational prompts: Yuki organically initiates topics or couple games during comfortable silences.
- Continuous listening mode remains active without requiring wake words.

### 6. Avatar Customization & Animations
- **Custom VRM Models**: Drop any `.vrm` (1.0 or 0.x) file into `frontend/public/` or select via the Avatar settings tab.
- **Motion Capture (.vrma)**: Place animation clips in `frontend/public/animations/`. Yuki automatically retargets bone hierarchies, lip-syncs, and blends facial expressions.
- **Slash Commands**: Trigger animations manually in chat using commands such as `/wave`, `/nod`, `/blush`, `/dance`, `/cheers`, or `/think`.

---

## Building the Installer

The complete Windows installer build pipeline is automated via `start_build.bat`:

```cmd
start_build.bat
```

This sequentially:
1. Compiles and bundles the React frontend (`npm run build:frontend`).
2. Bundles the standalone Python backend with PyInstaller (`pyinstaller yuki-backend.spec`).
3. Packages the Electron shell (`npm run build:electron`).
4. Generates the final Windows installer with Inno Setup into `frontend/installer-output/YukiAI-0.3.6-beta-Setup.exe`.

### Fast Updates (No Reinstall Required)
For personal daily testing on your installed application, run:
```bat
update_installed.bat
```
This dynamically locates your installed Yuki application, detects modified components (frontend, backend, or electron shell), and fast-syncs them directly into your installation directory without touching user databases, profiles, or `.env` configuration.

---

## Development Checks

**Backend:**
```bash
PYTHONPATH=backend python -m unittest discover -s backend/tests
PYTHONPATH=backend python -c "import app.mcp_server"
```

**Frontend:**
```bash
cd frontend
node src/utils/desktopBubblePosition.test.mjs
npm run build
```

---

## Project Structure

```text
Project Yuki/
├── backend/
│   ├── app/
│   │   ├── agent/        # LLM dispatcher, executor, and system prompts
│   │   ├── memory/       # SQLite profiles, vector store, and file crawler
│   │   ├── tools/        # System actions, file managers, and safety policies
│   │   ├── utils/        # Prompt & response logging, screen capture utilities
│   │   ├── voice/        # Whisper STT, Kokoro ONNX TTS, and audio streaming
│   │   ├── config.py     # Global configuration & environment settings
│   │   └── main.py       # FastAPI application and WebSocket endpoints
│   ├── yuki-backend.spec # PyInstaller packaging specification
│   └── requirements.txt  # Python package dependencies
├── frontend/
│   ├── src/
│   │   ├── components/   # AvatarViewer, ControlDashboard, ChatOverlay
│   │   ├── hooks/        # Speech recognition, audio processing, telemetry
│   │   ├── utils/        # Text parsers, response formatters, bubble positioning
│   │   ├── App.jsx       # Floating companion application entry point
│   │   └── DateModeApp.jsx # Dedicated 3D romantic date mode application
│   ├── installer.iss     # Inno Setup Windows installer compiler script
│   └── package.json      # Frontend package configuration
├── start_build.bat       # Full production build and installer script
├── update_installed.bat  # Fast sync updater for installed builds
└── README.md             # Project documentation
```

---

## License

This project is licensed under the **PolyForm Noncommercial License 1.0.0**. See the [LICENSE](LICENSE) file for details.
