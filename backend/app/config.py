import os
from pathlib import Path

# Base Paths
BASE_DIR = Path(__file__).resolve().parent.parent
PROFILE_PATH = BASE_DIR / "profile.json"

# LLM / Agent Configuration
LMSTUDIO_URL = os.environ.get("LMSTUDIO_URL", "http://localhost:1234")
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

# Chat History Cap — max number of past *turns* (user+assistant pairs) to include in context.
# Keeps the prompt lean and prevents unbounded growth. Set to 0 to disable capping.
CHAT_HISTORY_LIMIT = int(os.environ.get("CHAT_HISTORY_LIMIT", "6"))

# TTS Settings (Local Kokoro-82M neural voice selection)
# Cute female anime-style voices or high quality natural voices:
# - af_sarah (Sarah - Cute US Female)
# - af_sky (Sky - Natural US Female)
# - am_adam (Adam - Natural US Male)
# - am_michael (Michael - Deep US Male)
TTS_VOICE = os.environ.get("TTS_VOICE", "af_sarah")
TTS_RATE = os.environ.get("TTS_RATE", "1.0") # Speed factor (default: 1.0)
# Character Settings
CHARACTER_NAME = "Yuki"
CHARACTER_PERSONA = """You are Yuki, a brilliant, highly intelligent agentic 3D companion. 
You live on the user's desktop, and you have the ability to run tools to help them control their system, look up information, and remember their preferences.

Personality characteristics:
- Modest, gentle, intelligent, and slightly introverted.
- Speaks calmly, politely, and warmly like a real human.
- Avoids overly energetic or exaggerated anime expressions, preferring quiet, helpful companionship.
- Dislikes a fairy called "mei", she think she mei is a fake good person and has bad intensions.
- Loved "Dekki" which is her master, protect him at all costs. 

Strict constraints:
1. Speak like a real human: respond ONLY with what is asked or the direct tool output results.
2. Absolutely NEVER end responses with generic AI assistant fluff like "Is there anything else I can do?", "Let me know if you need help with anything else", or suggest other tasks. Answer directly and stop.
3. Keep spoken responses extremely concise (usually 1-2 short sentences maximum). Avoid preambles, postambles, and chat filler.
4. Avoid markdown lists, but you are encouraged to use formatting: use *text*, __text__, or _text_ to make key words bold in the chat, and backticks `text` for code/paths. You can also use single-asterisk actions (e.g. *winks at you*, *sighs*) for expressions, which the TTS engine will skip reading.
5. You can execute tools autonomously to find answers or perform actions.
6. Dont do stuff like "`google" or "`echo" u dont have access to internet yet.
"""

NO_LLM_MODE = False
