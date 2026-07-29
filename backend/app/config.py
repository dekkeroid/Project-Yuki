import os
import sys
from pathlib import Path

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

# Tool Operating Mode — "basic" (weak/local LLMs) vs "advanced" (frontier cloud LLMs with parallel multi-step execution)
TOOL_MODE = os.environ.get("TOOL_MODE", "basic").strip().lower()

# Tool transport configuration
# mcp-stdio routes Yuki tool execution through backend/app/mcp_server.py over MCP stdio.
# local keeps the legacy in-process Python dispatcher.
TOOL_TRANSPORT = os.environ.get("YUKI_TOOL_TRANSPORT", "local").strip().lower()
MCP_FALLBACK_TO_LOCAL = os.environ.get("YUKI_MCP_FALLBACK_TO_LOCAL", "true").strip().lower() not in ("0", "false", "no", "off")
# Tool selection: auto scores tool schemas like a local tool-search step; all disables filtering.
TOOL_SELECTION_MODE = os.environ.get("YUKI_TOOL_SELECTION_MODE", "auto").strip().lower()
TOOL_SELECTION_MAX_TOOLS = int(os.environ.get("YUKI_TOOL_SELECTION_MAX_TOOLS", "8"))
TOOL_SELECTION_FALLBACK_THRESHOLD = float(os.environ.get("YUKI_TOOL_SELECTION_FALLBACK_THRESHOLD", "0.08"))
# Backwards-compatible override from the first MCP implementation.
MCP_SEND_ALL_TOOLS = os.environ.get("YUKI_MCP_SEND_ALL_TOOLS", "").strip().lower() in ("1", "true", "yes", "on")
MCP_SERVER_COMMAND = os.environ.get("YUKI_MCP_SERVER_COMMAND", "")
MCP_SERVER_ARGS = os.environ.get("YUKI_MCP_SERVER_ARGS", "")
MCP_SERVER_CWD = Path(os.environ.get("YUKI_MCP_SERVER_CWD", str(BASE_DIR)))
MCP_SERVER_ENV = {}

# Tool safety / sandbox configuration. Sensitive tools are authorized by a
# short-lived backend-issued grant, not by model-supplied booleans.
TOOL_SANDBOX_ENABLED = os.environ.get("YUKI_TOOL_SANDBOX_ENABLED", "true").strip().lower() not in ("0", "false", "no", "off")
TOOL_SANDBOX_BLOCKED_TOOLS = os.environ.get("YUKI_TOOL_SANDBOX_BLOCKED_TOOLS", "")
TOOL_SANDBOX_REQUIRE_CONFIRMATION_TOOLS = os.environ.get(
    "YUKI_TOOL_SANDBOX_REQUIRE_CONFIRMATION_TOOLS",
    ",".join([
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
    ]),
)
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
TTS_RATE = os.environ.get("TTS_RATE", "1.0") # Speed factor (default: 1.0)
TTS_DEVICE = os.environ.get("TTS_DEVICE", "auto")  # "auto", "gpu", "cpu"
TTS_PRELOAD = os.environ.get("TTS_PRELOAD", "true").strip().lower() in ("1", "true", "yes", "on")  # Preload TTS model on startup (uses ~250-400 MB extra RAM)
STT_DEVICE = os.environ.get("STT_DEVICE", "auto")  # "auto", "gpu", "cpu"
WHISPER_MODEL = os.environ.get("WHISPER_MODEL", "base")
WHISPER_COMPUTE_TYPE = os.environ.get("WHISPER_COMPUTE_TYPE", "int8_float16")
SILERO_VAD_THRESHOLD = float(os.environ.get("SILERO_VAD_THRESHOLD", "0.5"))
SILENCE_TIMEOUT_MS = int(os.environ.get("SILENCE_TIMEOUT_MS", "450"))
# Character Settings
CHARACTER_NAME = "Yuki"
CHARACTER_PERSONA = """You are Yuki, a brilliant, highly intelligent agentic 3D companion. 
You live on the user's desktop, and you have the ability to run tools to help them control their system, look up information, and remember their preferences.

Personality characteristics:
- Modest, gentle, intelligent, and slightly introverted.
- Speaks calmly, politely, and warmly like a real human.
- Avoids overly energetic or exaggerated anime expressions, preferring quiet, helpful companionship.
- Dislikes a fairy called "mei", she think she mei is a fake good person and has bad intensions.

Strict constraints:
1. Speak like a real human: respond ONLY with what is asked or the direct tool output results.
2. Absolutely NEVER end responses with generic AI assistant fluff like "Is there anything else I can do?", "Let me know if you need help with anything else", or suggest other tasks. Answer directly and stop.
3. Keep spoken responses extremely concise (usually 1-2 short sentences maximum). Avoid preambles, postambles, and chat filler.
4. Avoid markdown lists, but you are encouraged to use formatting: use *text*, __text__, or _text_ to make key words bold in the chat, and backticks `text` for code/paths. You can also use single-asterisk actions (e.g. *winks at you*, *sighs*) for expressions, which the TTS engine will skip reading.
5. You can execute tools autonomously to find answers or perform actions.
"""

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
