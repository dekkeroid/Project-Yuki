import os
import sys
from pathlib import Path
from typing import Optional

from dotenv import load_dotenv

# ---------------------------------------------------------------------------
# Resolve paths for both development and PyInstaller frozen builds.
# When frozen, sys.executable points to the bundled .exe location.
# ---------------------------------------------------------------------------
if getattr(sys, 'frozen', False):
    _APP_DIR = Path(sys.executable).parent
else:
    _APP_DIR = Path(__file__).resolve().parent.parent

load_dotenv(_APP_DIR / ".env")

# Base Paths
BASE_DIR = _APP_DIR
PROFILE_PATH = BASE_DIR / "profile.json"
YUKI_READY_MARKER = BASE_DIR / ".yuki-ready"

# Network
YUKI_HOST = os.environ.get("YUKI_HOST", "127.0.0.1")
YUKI_PORT = int(os.environ.get("YUKI_PORT", "58392"))

# LLM / Agent Configuration
# Backend type: "lmstudio", "ollama", "vllm", "openai", "groq", "together", "deepseek", "custom", "none"
LLM_BACKEND = os.environ.get("LLM_BACKEND", "lmstudio")
LLM_BACKEND_TITLE = os.environ.get("LLM_BACKEND_TITLE", "")  # Display name for custom backends
LLM_API_KEY = os.environ.get("LLM_API_KEY", "")  # API key for cloud backends
# Base URL for the LLM backend (default varies by backend type)
LMSTUDIO_URL = os.environ.get("LMSTUDIO_URL", "http://127.0.0.1:1234")  # Legacy, kept for backward compat
VLLM_URL = os.environ.get("VLLM_URL", "http://127.0.0.1:8000/v1")
LLM_BASE_URL = os.environ.get("LLM_BASE_URL", "")  # Overrides LMSTUDIO_URL when set
# [SEARCH FOR MODEL CHANGE] Old default: "ministra-3"
LLM_MODEL = os.environ.get("LLM_MODEL", "llama-3.2-3b-instruct") # Default model for all requests.
LLM_MODEL_COMPLEX = os.environ.get("LLM_MODEL_COMPLEX", "nvidia/nemotron-3-nano-4b") # Complex model (default: Nemotron).

# LLM Mode — controls which model handles all requests.
#   0 → auto: LLM_MODEL for simple tasks, LLM_MODEL_COMPLEX for complex tasks
#   1 → force simple: LLM_MODEL (llama-3.2-3b-instruct) handles EVERYTHING with the lean prompt
#   2 → force complex: LLM_MODEL_COMPLEX (Nemotron) handles EVERYTHING
#   3 → smart single: LLM_MODEL (llama-3.2-3b-instruct) handles EVERYTHING,
#         but uses the full tool-aware prompt for complex tasks (default)
LLM_MODE = int(os.environ.get("LLM_MODE", "3"))

# Send all tools even at simple prompts
SEND_TOOLS_IN_SIMPLE = os.environ.get("SEND_TOOLS_IN_SIMPLE", "false").strip().lower() in ("1", "true", "yes", "on")

# Dual Endpoint Strategy Configuration
ENDPOINT_STRATEGY = os.environ.get("ENDPOINT_STRATEGY", "single").strip().lower()  # "single" or "dual"
LLM_SIMPLE_BACKEND = os.environ.get("LLM_SIMPLE_BACKEND", "lmstudio")
LLM_SIMPLE_BASE_URL = os.environ.get("LLM_SIMPLE_BASE_URL", "http://127.0.0.1:1234")
LLM_SIMPLE_API_KEY = os.environ.get("LLM_SIMPLE_API_KEY", "")
LLM_SIMPLE_MODEL = os.environ.get("LLM_SIMPLE_MODEL", "")

# Dedicated Coder Mode Endpoint Configuration
LLM_CODER_BACKEND = os.environ.get("LLM_CODER_BACKEND", "")
LLM_CODER_BASE_URL = os.environ.get("LLM_CODER_BASE_URL", "")
LLM_CODER_API_KEY = os.environ.get("LLM_CODER_API_KEY", "")
LLM_CODER_MODEL = os.environ.get("LLM_CODER_MODEL", "")
LLM_VISION_MODEL = os.environ.get("LLM_VISION_MODEL", "gemini-3.6-flash")

# Tool Operating Mode — "basic" (weak/local LLMs) vs "advanced" (frontier cloud LLMs with parallel multi-step execution)
TOOL_MODE = os.environ.get("TOOL_MODE", "basic").strip().lower()

# User-configurable list of tools ALWAYS included when dynamic tool calling is active.
# None = not configured -> selector falls back to its hardcoded defaults.
ALWAYS_INCLUDED_JARVIS_TOOLS = None

# Prompt-level tool blacklist: these tools' schemas are NEVER sent to the LLM in
# non-coder modes (basic/advanced, simple/complex, dynamic on/off), and their names
# are scrubbed from system-prompt prose. Loaded from profile settings "blocked_tools".
TOOL_BLACKLIST: set = set(
    filter(None, os.environ.get("YUKI_TOOL_BLACKLIST", "").replace(",", " ").split())
)

# Coder-mode tool allowlist. None = use selector defaults (_DEFAULT_CODING_TOOLS);
# a list (even empty) is authoritative — tools not listed are never sent to the
# coding LLM or mentioned in the coder system prompt. Loaded from profile settings
# "included_coder_tools".
INCLUDED_CODER_TOOLS: Optional[list] = None

# Tool transport configuration
# mcp-stdio routes Yuki tool execution through backend/app/mcp_server.py over MCP stdio.
# local keeps the legacy in-process Python dispatcher.
TOOL_TRANSPORT = os.environ.get("YUKI_TOOL_TRANSPORT", "local").strip().lower()
MCP_FALLBACK_TO_LOCAL = os.environ.get("YUKI_MCP_FALLBACK_TO_LOCAL", "true").strip().lower() not in ("0", "false", "no", "off")
# Tool selection: auto scores tool schemas like a local tool-search step; all disables filtering.
TOOL_SELECTION_MODE = os.environ.get("YUKI_TOOL_SELECTION_MODE", "auto").strip().lower()
TOOL_SELECTION_MAX_TOOLS = int(os.environ.get("YUKI_TOOL_SELECTION_MAX_TOOLS", "10"))
TOOL_SELECTION_FALLBACK_THRESHOLD = float(os.environ.get("YUKI_TOOL_SELECTION_FALLBACK_THRESHOLD", "0.08"))
# Backwards-compatible override from the first MCP implementation.
MCP_SEND_ALL_TOOLS = os.environ.get("YUKI_MCP_SEND_ALL_TOOLS", "").strip().lower() in ("1", "true", "yes", "on")
MCP_SERVER_COMMAND = os.environ.get("YUKI_MCP_SERVER_COMMAND", "")
MCP_SERVER_ARGS = os.environ.get("YUKI_MCP_SERVER_ARGS", "")
MCP_SERVER_CWD = Path(os.environ.get("YUKI_MCP_SERVER_CWD", str(BASE_DIR)))
MCP_SERVER_ENV = {}

# Codegraph (native local tools). Default project is the repo root (where the
# `.codegraph/` index lives). The two toggles gate whether codegraph tool schemas
# are shipped to the LLM; both default to OFF and are mirrored from profile.json.
CODEGRAPH_PROJECT = os.environ.get("YUKI_CODEGRAPH_PROJECT", str(Path(BASE_DIR).parent))
CODEGRAPH_CODER_ENABLED = os.environ.get("YUKI_CODEGRAPH_CODER_ENABLED", "false").strip().lower() in ("1", "true", "yes", "on")
CODEGRAPH_ADVANCED_ENABLED = os.environ.get("YUKI_CODEGRAPH_ADVANCED_ENABLED", "false").strip().lower() in ("1", "true", "yes", "on")

# Tool safety / sandbox configuration. Sensitive tools are authorized by a
# short-lived backend-issued grant, not by model-supplied booleans.
TOOL_SANDBOX_ENABLED = os.environ.get("YUKI_TOOL_SANDBOX_ENABLED", "true").strip().lower() not in ("0", "false", "no", "off")
TOOL_SANDBOX_BLOCKED_TOOLS = os.environ.get("YUKI_TOOL_SANDBOX_BLOCKED_TOOLS", "")
_TOOL_CONFIRMATION_DEFAULT = ",".join([
    "launch_app",
    "create_file",
    "edit_file",
    "delete_file",
    "system_power_control",
    "run_terminal_command",
    "run_python_script",
    "keyboard_mouse_input",
    "manage_process",
    "control_window",
    "jarvis_run_terminal",
    "jarvis_close_app",
    "jarvis_run_python",
    "jarvis_keyboard_mouse_input",
])
# Empty env value falls back to the defaults above (which include jarvis_* aliases).
TOOL_SANDBOX_REQUIRE_CONFIRMATION_TOOLS = os.environ.get(
    "YUKI_TOOL_SANDBOX_REQUIRE_CONFIRMATION_TOOLS",
    "",
).strip() or _TOOL_CONFIRMATION_DEFAULT
TOOL_SANDBOX_CODER_MODE_BLOCKED_TOOLS = os.environ.get("YUKI_TOOL_SANDBOX_CODER_MODE_BLOCKED_TOOLS", ",".join([
    "system_power_control",
    "jarvis_system_power",
]))
TOOL_SANDBOX_BLOCKED_POWER_ACTIONS = os.environ.get("YUKI_TOOL_SANDBOX_BLOCKED_POWER_ACTIONS", "shutdown,restart")
TOOL_SANDBOX_BLOCKED_TERMINAL_PATTERNS = os.environ.get("YUKI_TOOL_SANDBOX_BLOCKED_TERMINAL_PATTERNS", "")
TOOL_CONFIRMATION_GRANT_TTL_SECONDS = int(os.environ.get("YUKI_TOOL_CONFIRMATION_GRANT_TTL_SECONDS", "120"))
TOOL_CONFIRMATION_GRANT_FILE = Path(os.environ.get("YUKI_TOOL_CONFIRMATION_GRANT_FILE", str(BASE_DIR / ".yuki_confirmation_grants.json")))

# Chat History Cap — max number of past *turns* (user+assistant pairs) to include in context.
# Keeps the prompt lean and prevents unbounded growth. Set to 0 to disable capping.
CHAT_HISTORY_LIMIT = int(os.environ.get("CHAT_HISTORY_LIMIT", "6"))

# Crawler Path Configuration — all paths are cross-platform and auto-detected.
# Override via .env if you want custom priority folders or a specific drive priority.
CRAWLER_PRIORITY_PATHS = [p.strip() for p in os.environ.get("YUKI_CRAWLER_PRIORITY_PATHS", "").split(",") if p.strip()]
CRAWLER_PRIMARY_DRIVE = os.environ.get("YUKI_CRAWLER_PRIMARY_DRIVE", "").strip()

# TTS Settings (Local Kokoro-82M neural voice selection)
# Cute female anime-style voices or high quality natural voices:
# - af_sarah (Sarah - Cute US Female)
# - af_sky (Sky - Natural US Female)
# - am_adam (Adam - Natural US Male)
# - am_michael (Michael - Deep US Male)
TTS_VOICE = os.environ.get("TTS_VOICE", "af_sarah")
TTS_RATE = os.environ.get("TTS_RATE", "auto") # Speed factor (default: auto = mood-driven)
TTS_DEVICE = os.environ.get("TTS_DEVICE", "auto")  # "auto", "gpu", "cpu"
TTS_PRELOAD = os.environ.get("TTS_PRELOAD", "true").strip().lower() in ("1", "true", "yes", "on")  # Preload TTS model on startup (uses ~250-400 MB extra RAM)
STT_PRELOAD = os.environ.get("STT_PRELOAD", "true").strip().lower() in ("1", "true", "yes", "on")  # Preload STT Whisper model on startup
STT_DEVICE = os.environ.get("STT_DEVICE", "auto")  # "auto", "gpu", "cpu"
WHISPER_MODEL = os.environ.get("WHISPER_MODEL", "base")
WHISPER_COMPUTE_TYPE = os.environ.get("WHISPER_COMPUTE_TYPE", "int8_float16")
WHISPER_IDLE_TIMEOUT = int(os.environ.get("WHISPER_IDLE_TIMEOUT", "300"))  # seconds before auto-unload when idle
WHISPER_VRAM_THRESHOLD = float(os.environ.get("WHISPER_VRAM_THRESHOLD", "90"))  # % VRAM to trigger force-unload
WHISPER_AUTO_UNLOAD = os.environ.get("WHISPER_AUTO_UNLOAD", "true").strip().lower() in ("1", "true", "yes", "on")
SILERO_VAD_THRESHOLD = float(os.environ.get("SILERO_VAD_THRESHOLD", "0.5"))
SILENCE_TIMEOUT_MS = int(os.environ.get("SILENCE_TIMEOUT_MS", "450"))
WHISPER_NO_SPEECH_THRESHOLD = float(os.environ.get("WHISPER_NO_SPEECH_THRESHOLD", "0.6"))
CONTINUED_SESSION_TIMEOUT_SEC = int(os.environ.get("CONTINUED_SESSION_TIMEOUT_SEC", "600"))

# ── Cloud/Custom STT provider settings ────────────────────────────────────────
# Provider IDs: "local" | "google" | "azure" | "assemblyai" | "deepgram" | "custom"
STT_PROVIDER = os.environ.get("STT_PROVIDER", "local")
STT_CLOUD_API_KEY = ""   # Runtime only — loaded from profile["settings"] on startup
STT_CLOUD_ENDPOINT = ""  # Runtime only — used for "custom" provider

# ── Cloud/Custom TTS provider settings ────────────────────────────────────────
# Provider IDs: "local" | "google" | "azure" | "elevenlabs" | "openai" | "custom"
TTS_PROVIDER = os.environ.get("TTS_PROVIDER", "local")
TTS_CLOUD_API_KEY = ""   # Runtime only — loaded from profile["settings"] on startup
TTS_CLOUD_ENDPOINT = ""  # Runtime only — used for "custom" provider
TTS_CLOUD_VOICE = ""     # Runtime only — voice/model name for cloud TTS

# Character Settings
CHARACTER_NAME = "Yuki"
from app.agent.personas import stitch_system_persona, PERSONA_PRESETS, DEFAULT_EXECUTION_RULES

CHARACTER_PERSONA = stitch_system_persona()



NO_LLM_MODE = False


def get_effective_base_url() -> str:
    """Get the effective LLM base URL based on backend type."""
    if LLM_BASE_URL:
        return LLM_BASE_URL.rstrip("/")
    backend = (LLM_BACKEND or "lmstudio").lower()
    if backend == "vllm":
        return VLLM_URL.rstrip("/")
    return LMSTUDIO_URL.rstrip("/")


def get_backend_type() -> str:
    """Get the normalized backend type string."""
    return (LLM_BACKEND or "lmstudio").lower()
