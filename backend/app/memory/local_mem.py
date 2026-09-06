import json
import os
import time
from datetime import datetime
from app import config
from app.memory.mood_engine import MoodEngine, AXES as MOOD_AXES

DEFAULT_MOOD_SPECTRUM = {
    "happiness": 60,
    "energy": 55,
    "curiosity": 65,
    "affection": 55,
    "stress_level": 20,
    "hunger": 30,
    "horniness": 45,
    "playfulness": 50,
    "anger": 10
}

class MemoryManager:
    def __init__(self):
        self.profile_path = config.PROFILE_PATH
        self.profile = self._load_profile()
        self.mood_broadcast = None
        self._mood_engine = MoodEngine(
            self.profile,
            save_fn=self._save_profile,
            broadcast_fn=self._fire_mood_broadcast,
        )

    def _fire_mood_broadcast(self, payload: dict):
        if self.mood_broadcast:
            self.mood_broadcast(payload)

    def set_mood_broadcast(self, broadcast_fn):
        """Allows the main app to push live mood updates over WebSocket."""
        self.mood_broadcast = broadcast_fn
        self._mood_engine.set_broadcast(broadcast_fn)

    def _load_profile(self):
        default_profile = {
            "user_name": "Master",
            "user_interests": [],
            "user_hobbies": [],
            "user_likes": [],
            "user_dislikes": [],
            "custom_facts": {},
            "interaction_count": 0,
            "last_active_epoch": None,
            "last_shutdown_epoch": None,
            "recent_greetings": [],
            "covered_news_today": {"date": "", "items": []},
            "mood_spectrum": dict(DEFAULT_MOOD_SPECTRUM),
            "settings": {
                # [SEARCH FOR MODEL CHANGE] Old: "llm_model": "ministra-3",
                "llm_model": "llama-3.2-3b-instruct",
                "llm_backend": "lmstudio",
                "llm_base_url": "",
                "llm_api_key": "",
                "tts_voice": "bf_isabella",
                "tts_rate": "auto",
                "tts_device": "auto",
                "stt_device": "auto",
                "character_name": "Yuki",
                "persona_preset": "sassy_tech_gf",
                "custom_persona_prompts": {},
                "user_presets": {},
                "character_persona": config.CHARACTER_PERSONA,
                "execution_rules": getattr(config, "DEFAULT_EXECUTION_RULES", ""),
                "auto_evolving_archetype": True,
                "archetype_intensity": "moderate",
                "crawler_paused": False,
                "tagger_paused": True,
                "active_vrm_model": "default.vrm",
                "start_with_last_avatar_size": True,
                "enable_vector_memory": False,
                "embedding_model": "",
                "embedding_use_local": False,
                "embedding_backend": "lmstudio",
                "embedding_base_url": "http://127.0.0.1:1234",
                "embedding_api_key": "",
                "whisper_model": "small",
                "whisper_compute_type": "int8_float16",
                "use_local_whisper": True,
                "llm_speech_input_enabled": False,
                "stt_language": "en",
                "no_llm_mode": False,
                "dynamic_tool_calling": True,
                "blocked_tools": [],
                "enable_intent_check": True,
                "vad_threshold": 0.03,
                "silero_vad_threshold": 0.50,
                "silero_min_speech_duration_ms": 150,
                "silero_min_silence_duration_ms": 400,
                "silero_speech_pad_ms": 200,
                "whisper_beam_size": 1,
                "whisper_condition_on_previous_text": False,
                "silence_timeout_ms": 800,
                "continued_session_timeout_sec": 120,
                "max_recording_duration_sec": 120,
                "whisper_no_speech_threshold": 0.70,
                "stt_auto_gain_control": False,
                "allow_voice_barge_in": False,
                "stt_echo_cancellation": True,
                "stt_noise_suppression": True,
                "stt_transport_mode": "websocket_stream",
                "use_neural_browser_vad": True,
                "browser_neural_vad_confidence": 0.60,
                "adaptive_silence_cutoff": True,
                "aed_enabled": True,
                "aed_confidence_threshold": 0.45,
                "aed_fast_reflex": True,
                "llm_mode": 3,
                "enable_rotation": True,
                "auto_reset_rotation": False,
                "mood_source": "script",
                "tts_preload": True,
                "kokoro_ipa_interjections": False,
                "vrm_dpr": 1.5,
                "vrm_fps": 40,
                "chat_mode": False,
                "keep_memory_saving": True,
                "tool_mode": "basic",
                "hotkey_shortcut": "Alt+S",
                "hotkey_focus_chat": True,
                "hotkey_open_logs": False,
                "hotkey_turn_on_listening": True,
                "listen_on_startup": config.LISTEN_ON_STARTUP,
                "send_tools_in_simple": False,
                "endpoint_strategy": "single",
                "llm_simple_backend": "lmstudio",
                "llm_simple_base_url": "http://127.0.0.1:1234",
                "llm_simple_api_key": "",
                "llm_simple_model": "",
                "persistent_chat_history": False,
                "manage_todo_enabled": True,
                "ask_user_enabled": True,
                "codegraph_coder_enabled": False,
                "codegraph_advanced_enabled": False,
                "basic_history_token_limit": 2500,
                "basic_history_keep_turns": 6,
                "advanced_history_token_limit": 40000,
                "advanced_history_keep_turns": 16,
                "history_summary_percent": 50,
                "history_summary_position": "oldest",
                "llm_summary_model": "",
                "llm_vision_model": "",
                "llm_image_gen_model": "",
                "use_free_image_gen": False,
                "image_gen_provider": "pollinations",
                "huggingface_api_key": "",
                "stable_horde_api_key": "0000000000",
                "stable_horde_model": "Pony Diffusion V6 XL",
                "user_country": "Auto",
                "user_location": "Auto",
                "greeting_weather_enabled": True,
                "greeting_news_enabled": True,
                "greeting_news_topics": "",
                "allow_voice_barge_in": True,
                "barge_in_sensitivity": 1.0,
                "telegram_enabled": False,
                "telegram_bot_token": "",
                "telegram_allowed_users": "",
                "telegram_voice_replies": True,
                "telegram_notify_reminders": True,
                "telegram_verbose_tools": True,
                "proactive_nudge_mode": "visual_only",
                "proactive_nudge_interval_min": 45,
                "proactive_nudge_engine": "template",
                "proactive_nudge_include_screen": False,
                "proactive_nudge_quiet_min": 30,
                "proactive_nudge_boredom_pct": 80,
                "desk_sleep_idle_min": 3,
                "companion_nap_silence_min": 5,
                "companion_nap_energy_pct": 30,
                "disabled_animations": []
            }
        }
        if not os.path.exists(self.profile_path):
            self._save_profile(default_profile)
            return default_profile
        
        try:
            with open(self.profile_path, "r", encoding="utf-8") as f:
                data = json.load(f)
                # Ensure all default keys exist
                for k, v in default_profile.items():
                    if k not in data:
                        data[k] = v
                
                # Ensure settings structure is complete
                if "settings" not in data:
                    data["settings"] = default_profile["settings"]
                else:
                    for sk, sv in default_profile["settings"].items():
                        if sk not in data["settings"]:
                            data["settings"][sk] = sv

                # Migrate legacy 'openai' backend string to unified 'custom'
                if data["settings"].get("llm_backend") == "openai":
                    data["settings"]["llm_backend"] = "custom"
                if data["settings"].get("llm_simple_backend") == "openai":
                    data["settings"]["llm_simple_backend"] = "custom"

                # Apply settings to runtime config
                config.TTS_VOICE = data["settings"].get("tts_voice", config.TTS_VOICE)
                config.TTS_RATE = data["settings"].get("tts_rate", config.TTS_RATE)
                config.TTS_DEVICE = data["settings"].get("tts_device", config.TTS_DEVICE)
                config.KOKORO_IPA_INTERJECTIONS = bool(data["settings"].get("kokoro_ipa_interjections", getattr(config, "KOKORO_IPA_INTERJECTIONS", False)))
                config.STT_DEVICE = data["settings"].get("stt_device", config.STT_DEVICE)
                config.LLM_SPEECH_INPUT_ENABLED = bool(data["settings"].get("llm_speech_input_enabled", getattr(config, "LLM_SPEECH_INPUT_ENABLED", False)))
                config.WHISPER_MODEL = data["settings"].get("whisper_model", getattr(config, "WHISPER_MODEL", "small"))
                config.WHISPER_COMPUTE_TYPE = data["settings"].get("whisper_compute_type", getattr(config, "WHISPER_COMPUTE_TYPE", "int8_float16"))
                config.SILERO_VAD_THRESHOLD = float(data["settings"].get("silero_vad_threshold", getattr(config, "SILERO_VAD_THRESHOLD", 0.50)))
                config.SILERO_MIN_SPEECH_DURATION_MS = int(data["settings"].get("silero_min_speech_duration_ms", getattr(config, "SILERO_MIN_SPEECH_DURATION_MS", 150)))
                config.SILERO_MIN_SILENCE_DURATION_MS = int(data["settings"].get("silero_min_silence_duration_ms", getattr(config, "SILERO_MIN_SILENCE_DURATION_MS", 400)))
                config.SILERO_SPEECH_PAD_MS = int(data["settings"].get("silero_speech_pad_ms", getattr(config, "SILERO_SPEECH_PAD_MS", 200)))
                config.WHISPER_BEAM_SIZE = int(data["settings"].get("whisper_beam_size", getattr(config, "WHISPER_BEAM_SIZE", 1)))
                config.WHISPER_CONDITION_ON_PREVIOUS_TEXT = bool(data["settings"].get("whisper_condition_on_previous_text", getattr(config, "WHISPER_CONDITION_ON_PREVIOUS_TEXT", False)))
                config.SILENCE_TIMEOUT_MS = int(data["settings"].get("silence_timeout_ms", getattr(config, "SILENCE_TIMEOUT_MS", 1000)))
                config.CONTINUED_SESSION_TIMEOUT_SEC = int(data["settings"].get("continued_session_timeout_sec", getattr(config, "CONTINUED_SESSION_TIMEOUT_SEC", 120)))
                config.MAX_RECORDING_DURATION_SEC = int(data["settings"].get("max_recording_duration_sec", getattr(config, "MAX_RECORDING_DURATION_SEC", 120)))
                config.WHISPER_NO_SPEECH_THRESHOLD = float(data["settings"].get("whisper_no_speech_threshold", getattr(config, "WHISPER_NO_SPEECH_THRESHOLD", 0.70)))
                config.STT_AUTO_GAIN_CONTROL = bool(data["settings"].get("stt_auto_gain_control", getattr(config, "STT_AUTO_GAIN_CONTROL", False)))
                config.ALLOW_VOICE_BARGE_IN = bool(data["settings"].get("allow_voice_barge_in", getattr(config, "ALLOW_VOICE_BARGE_IN", True)))
                config.BARGE_IN_SENSITIVITY = float(data["settings"].get("barge_in_sensitivity", getattr(config, "BARGE_IN_SENSITIVITY", 1.0)))
                config.STT_ECHO_CANCELLATION = bool(data["settings"].get("stt_echo_cancellation", getattr(config, "STT_ECHO_CANCELLATION", True)))
                config.STT_NOISE_SUPPRESSION = bool(data["settings"].get("stt_noise_suppression", getattr(config, "STT_NOISE_SUPPRESSION", True)))
                config.STT_TRANSPORT_MODE = data["settings"].get("stt_transport_mode", getattr(config, "STT_TRANSPORT_MODE", "websocket_stream"))
                config.USE_NEURAL_BROWSER_VAD = bool(data["settings"].get("use_neural_browser_vad", getattr(config, "USE_NEURAL_BROWSER_VAD", True)))
                config.BROWSER_NEURAL_VAD_CONFIDENCE = float(data["settings"].get("browser_neural_vad_confidence", getattr(config, "BROWSER_NEURAL_VAD_CONFIDENCE", 0.60)))
                config.ADAPTIVE_SILENCE_CUTOFF = bool(data["settings"].get("adaptive_silence_cutoff", getattr(config, "ADAPTIVE_SILENCE_CUTOFF", True)))
                config.AED_ENABLED = bool(data["settings"].get("aed_enabled", getattr(config, "AED_ENABLED", True)))
                config.AED_CONFIDENCE_THRESHOLD = float(data["settings"].get("aed_confidence_threshold", getattr(config, "AED_CONFIDENCE_THRESHOLD", 0.45)))
                config.AED_FAST_REFLEX = bool(data["settings"].get("aed_fast_reflex", getattr(config, "AED_FAST_REFLEX", True)))
                config.TOOL_MODE = data["settings"].get("tool_mode", getattr(config, "TOOL_MODE", "basic")).strip().lower()
                config.DISABLED_ANIMATIONS = list(data["settings"].get("disabled_animations", []))
                config.USER_COUNTRY = data["settings"].get("user_country", getattr(config, "USER_COUNTRY", "Auto"))
                config.USER_LOCATION = data["settings"].get("user_location", getattr(config, "USER_LOCATION", "Auto"))
                config.GREETING_WEATHER_ENABLED = bool(data["settings"].get("greeting_weather_enabled", getattr(config, "GREETING_WEATHER_ENABLED", True)))
                config.GREETING_NEWS_ENABLED = bool(data["settings"].get("greeting_news_enabled", getattr(config, "GREETING_NEWS_ENABLED", True)))
                config.GREETING_NEWS_TOPICS = str(data["settings"].get("greeting_news_topics", getattr(config, "GREETING_NEWS_TOPICS", "")))
                config.SEND_TOOLS_IN_SIMPLE = bool(data["settings"].get("send_tools_in_simple", False))
                config.HOTKEY_SHORTCUT = data["settings"].get("hotkey_shortcut", getattr(config, "HOTKEY_SHORTCUT", "Alt+S"))
                config.HOTKEY_FOCUS_CHAT = bool(data["settings"].get("hotkey_focus_chat", getattr(config, "HOTKEY_FOCUS_CHAT", True)))
                config.HOTKEY_OPEN_LOGS = bool(data["settings"].get("hotkey_open_logs", getattr(config, "HOTKEY_OPEN_LOGS", False)))
                config.HOTKEY_TURN_ON_LISTENING = bool(data["settings"].get("hotkey_turn_on_listening", getattr(config, "HOTKEY_TURN_ON_LISTENING", True)))
                config.LISTEN_ON_STARTUP = bool(data["settings"].get("listen_on_startup", getattr(config, "LISTEN_ON_STARTUP", False)))
                config.CODEGRAPH_CODER_ENABLED = bool(data["settings"].get("codegraph_coder_enabled", getattr(config, "CODEGRAPH_CODER_ENABLED", False)))
                config.CODEGRAPH_ADVANCED_ENABLED = bool(data["settings"].get("codegraph_advanced_enabled", getattr(config, "CODEGRAPH_ADVANCED_ENABLED", False)))
                config.ENDPOINT_STRATEGY = data["settings"].get("endpoint_strategy", "single").strip().lower()
                config.LLM_SIMPLE_BACKEND = data["settings"].get("llm_simple_backend", getattr(config, "LLM_SIMPLE_BACKEND", "lmstudio"))
                config.LLM_SIMPLE_BASE_URL = data["settings"].get("llm_simple_base_url", getattr(config, "LLM_SIMPLE_BASE_URL", "http://127.0.0.1:1234"))
                config.LLM_SIMPLE_MODEL = data["settings"].get("llm_simple_model", getattr(config, "LLM_SIMPLE_MODEL", ""))
                config.LLM_CODER_BACKEND = data["settings"].get("llm_coder_backend", getattr(config, "LLM_CODER_BACKEND", ""))
                config.LLM_CODER_BASE_URL = data["settings"].get("llm_coder_base_url", getattr(config, "LLM_CODER_BASE_URL", ""))
                config.LLM_CODER_MODEL = data["settings"].get("llm_coder_model", getattr(config, "LLM_CODER_MODEL", ""))
                config.LLM_VISION_MODEL = data["settings"].get("llm_vision_model", getattr(config, "LLM_VISION_MODEL", ""))
                config.LLM_IMAGE_GEN_MODEL = data["settings"].get("llm_image_gen_model", getattr(config, "LLM_IMAGE_GEN_MODEL", ""))
                config.USE_FREE_IMAGE_GEN = bool(data["settings"].get("use_free_image_gen", getattr(config, "USE_FREE_IMAGE_GEN", False)))
                config.IMAGE_GEN_PROVIDER = str(data["settings"].get("image_gen_provider", getattr(config, "IMAGE_GEN_PROVIDER", "pollinations"))).strip().lower()
                config.HUGGINGFACE_API_KEY = str(data["settings"].get("huggingface_api_key", getattr(config, "HUGGINGFACE_API_KEY", ""))).strip()
                config.STABLE_HORDE_API_KEY = str(data["settings"].get("stable_horde_api_key", getattr(config, "STABLE_HORDE_API_KEY", "0000000000"))).strip()
                config.STABLE_HORDE_MODEL = str(data["settings"].get("stable_horde_model", getattr(config, "STABLE_HORDE_MODEL", "Pony Diffusion V6 XL"))).strip()
                config.CHARACTER_NAME = data["settings"].get("character_name", config.CHARACTER_NAME)
                config.PERSONA_PRESET = data["settings"].get("persona_preset", getattr(config, "PERSONA_PRESET", "sassy_tech_gf"))
                data["settings"]["persona_preset"] = config.PERSONA_PRESET
                config.AUTO_EVOLVING_ARCHETYPE = bool(data["settings"].get("auto_evolving_archetype", getattr(config, "AUTO_EVOLVING_ARCHETYPE", True)))
                config.ARCHETYPE_INTENSITY = str(data["settings"].get("archetype_intensity", getattr(config, "ARCHETYPE_INTENSITY", "moderate"))).strip().lower()

                if "custom_persona_prompts" not in data["settings"] or not isinstance(data["settings"]["custom_persona_prompts"], dict):
                    data["settings"]["custom_persona_prompts"] = {}
                if "user_presets" not in data["settings"] or not isinstance(data["settings"]["user_presets"], dict):
                    data["settings"]["user_presets"] = {}

                from app.agent.personas import get_clean_character_backstory
                config.CHARACTER_PERSONA = get_clean_character_backstory(data)
                data["settings"]["character_persona"] = config.CHARACTER_PERSONA
                config.PROACTIVE_NUDGE_MODE = str(data["settings"].get("proactive_nudge_mode", getattr(config, "PROACTIVE_NUDGE_MODE", "visual_only"))).strip().lower()
                config.PROACTIVE_NUDGE_INTERVAL_MIN = int(data["settings"].get("proactive_nudge_interval_min", getattr(config, "PROACTIVE_NUDGE_INTERVAL_MIN", 45)))
                config.PROACTIVE_NUDGE_ENGINE = str(data["settings"].get("proactive_nudge_engine", getattr(config, "PROACTIVE_NUDGE_ENGINE", "template"))).strip().lower()
                config.PROACTIVE_NUDGE_INCLUDE_SCREEN = bool(data["settings"].get("proactive_nudge_include_screen", getattr(config, "PROACTIVE_NUDGE_INCLUDE_SCREEN", False)))
                config.PROACTIVE_NUDGE_QUIET_MIN = int(data["settings"].get("proactive_nudge_quiet_min", getattr(config, "PROACTIVE_NUDGE_QUIET_MIN", 30)))
                config.PROACTIVE_NUDGE_BOREDOM_PCT = int(data["settings"].get("proactive_nudge_boredom_pct", getattr(config, "PROACTIVE_NUDGE_BOREDOM_PCT", 80)))
                config.DESK_SLEEP_IDLE_MIN = int(data["settings"].get("desk_sleep_idle_min", getattr(config, "DESK_SLEEP_IDLE_MIN", 3)))
                config.COMPANION_NAP_SILENCE_MIN = int(data["settings"].get("companion_nap_silence_min", getattr(config, "COMPANION_NAP_SILENCE_MIN", 5)))
                config.COMPANION_NAP_ENERGY_PCT = int(data["settings"].get("companion_nap_energy_pct", getattr(config, "COMPANION_NAP_ENERGY_PCT", 30)))
                config.LLM_MODEL = data["settings"].get("llm_model", config.LLM_MODEL)
                config.START_WITH_LAST_AVATAR_SIZE = bool(data["settings"].get("start_with_last_avatar_size", getattr(config, "START_WITH_LAST_AVATAR_SIZE", True)))
                config.ENABLE_VECTOR_MEMORY = bool(data["settings"].get("enable_vector_memory", getattr(config, "ENABLE_VECTOR_MEMORY", False)))
                config.EMBEDDING_MODEL = str(data["settings"].get("embedding_model", getattr(config, "EMBEDDING_MODEL", ""))).strip()
                config.EMBEDDING_USE_LOCAL = bool(data["settings"].get("embedding_use_local", getattr(config, "EMBEDDING_USE_LOCAL", False)))
                config.EMBEDDING_BACKEND = str(data["settings"].get("embedding_backend", getattr(config, "EMBEDDING_BACKEND", "lmstudio"))).strip()
                config.EMBEDDING_BASE_URL = str(data["settings"].get("embedding_base_url", getattr(config, "EMBEDDING_BASE_URL", "http://127.0.0.1:1234"))).strip()
                config.NO_LLM_MODE = data["settings"].get("no_llm_mode", False)
                config.LLM_BACKEND = data["settings"].get("llm_backend", config.LLM_BACKEND)
                config.LLM_BASE_URL = data["settings"].get("llm_base_url", config.LLM_BASE_URL)
                config.LLM_MODE = int(data["settings"].get("llm_mode", config.LLM_MODE))
                raw_key = data["settings"].get("llm_api_key", config.LLM_API_KEY)
                simple_key = data["settings"].get("llm_simple_api_key", config.LLM_SIMPLE_API_KEY)
                coder_key = data["settings"].get("llm_coder_api_key", getattr(config, "LLM_CODER_API_KEY", ""))
                emb_key = data["settings"].get("embedding_api_key", getattr(config, "EMBEDDING_API_KEY", ""))
                from app.utils.security import decrypt_api_key
                dec_raw = decrypt_api_key(raw_key) if (raw_key and ("enc_v1:" in str(raw_key) or "gAAAA" in str(raw_key))) else (raw_key or "")
                dec_simple = decrypt_api_key(simple_key) if (simple_key and ("enc_v1:" in str(simple_key) or "gAAAA" in str(simple_key))) else (simple_key or "")
                dec_coder = decrypt_api_key(coder_key) if (coder_key and ("enc_v1:" in str(coder_key) or "gAAAA" in str(coder_key))) else (coder_key or "")
                dec_emb = decrypt_api_key(emb_key) if (emb_key and ("enc_v1:" in str(emb_key) or "gAAAA" in str(emb_key))) else (emb_key or "")
                config.LLM_API_KEY = dec_raw
                config.LLM_SIMPLE_API_KEY = dec_simple
                config.LLM_CODER_API_KEY = dec_coder
                config.EMBEDDING_API_KEY = dec_emb
                data["settings"]["llm_api_key"] = dec_raw
                data["settings"]["llm_simple_api_key"] = dec_simple
                data["settings"]["llm_coder_api_key"] = dec_coder
                data["settings"]["embedding_api_key"] = dec_emb
                for ep in data["settings"].get("saved_custom_endpoints", []):
                    if isinstance(ep, dict) and ep.get("api_key") and ("enc_v1:" in str(ep["api_key"]) or "gAAAA" in str(ep["api_key"])):
                        ep["api_key"] = decrypt_api_key(ep["api_key"])
                if "always_included_tools" in data["settings"]:
                    config.ALWAYS_INCLUDED_JARVIS_TOOLS = list(data["settings"].get("always_included_tools") or [])
                if "blocked_tools" in data["settings"]:
                    config.TOOL_BLACKLIST = set(data["settings"].get("blocked_tools") or [])
                if "included_coder_tools" in data["settings"]:
                    config.INCLUDED_CODER_TOOLS = list(data["settings"].get("included_coder_tools") or [])

                config.TELEGRAM_ENABLED = bool(data["settings"].get("telegram_enabled", getattr(config, "TELEGRAM_ENABLED", False)))
                raw_tg_token = data["settings"].get("telegram_bot_token", getattr(config, "TELEGRAM_BOT_TOKEN", ""))
                dec_tg_token = decrypt_api_key(raw_tg_token) if (raw_tg_token and ("enc_v1:" in str(raw_tg_token) or "gAAAA" in str(raw_tg_token))) else (raw_tg_token or "")
                config.TELEGRAM_BOT_TOKEN = dec_tg_token
                config.TELEGRAM_ALLOWED_USERS = str(data["settings"].get("telegram_allowed_users", getattr(config, "TELEGRAM_ALLOWED_USERS", "")))
                config.TELEGRAM_VOICE_REPLIES = bool(data["settings"].get("telegram_voice_replies", getattr(config, "TELEGRAM_VOICE_REPLIES", True)))
                config.TELEGRAM_NOTIFY_REMINDERS = bool(data["settings"].get("telegram_notify_reminders", getattr(config, "TELEGRAM_NOTIFY_REMINDERS", True)))
                config.TELEGRAM_VERBOSE_TOOLS = bool(data["settings"].get("telegram_verbose_tools", getattr(config, "TELEGRAM_VERBOSE_TOOLS", True)))
                
                return data
        except Exception as e:
            import traceback
            traceback.print_exc()
            print(f"Error loading profile: {e}. Backing up corrupted profile and reinitializing.")
            try:
                import shutil
                if os.path.exists(self.profile_path):
                    shutil.copy2(self.profile_path, f"{self.profile_path}.bak")
                with open(self.profile_path, "w", encoding="utf-8") as f:
                    json.dump(default_profile, f, indent=4, ensure_ascii=False)
            except Exception as save_err:
                print(f"Error repairing profile: {save_err}")
            return default_profile

    def _save_profile(self, data=None):
        if data is None:
            data = self.profile
        try:
            with open(self.profile_path, "w", encoding="utf-8") as f:
                json.dump(data, f, indent=4, ensure_ascii=False)
        except Exception as e:
            print(f"Error saving profile: {e}")

    def increment_interactions(self):
        self.profile["interaction_count"] += 1
        self.record_session_active()

    def record_session_active(self):
        """Records the current timestamp as the last active interaction time."""
        now = time.time()
        self.profile["last_active_epoch"] = now
        try:
            from app.memory.presence_engine import presence_manager
            presence_manager.record_interaction()
        except Exception:
            pass
        self._save_profile()

    def record_session_shutdown(self):
        """Records the current timestamp as the last shutdown/exit time."""
        now = time.time()
        self.profile["last_shutdown_epoch"] = now
        self.profile["last_active_epoch"] = now
        self._save_profile()

    def record_greeting(self, text: str, max_keep: int = 6):
        """Records the text of a completed startup greeting to prevent repeating news/topics."""
        if not text or not text.strip():
            return
        greetings = self.profile.setdefault("recent_greetings", [])
        clean = text.strip()
        # Avoid duplicate or near-identical sequential entries (e.g. sharing the same first 5 words)
        clean_prefix = " ".join(clean.lower().split()[:5])
        if greetings:
            last_prefix = " ".join(greetings[-1].lower().split()[:5])
            if clean_prefix and clean_prefix == last_prefix:
                greetings[-1] = clean
                self._save_profile()
                return
        greetings.append(clean)
        if len(greetings) > max_keep:
            self.profile["recent_greetings"] = greetings[-max_keep:]
        self._save_profile()

    def get_recent_greetings(self, limit: int = 6) -> list:
        """Returns the last N greetings spoken by Yuki."""
        greetings = self.profile.get("recent_greetings", [])
        if not isinstance(greetings, list):
            return []
        return [g.strip() for g in greetings[-limit:] if isinstance(g, str) and g.strip()]

    def record_covered_news(self, items: list):
        """Records news headline titles covered today to prevent repetition across restarts/reloads."""
        if not items:
            return
        today_str = datetime.now().strftime("%Y-%m-%d")
        covered = self.profile.setdefault("covered_news_today", {"date": today_str, "items": []})
        if not isinstance(covered, dict) or covered.get("date") != today_str:
            covered = {"date": today_str, "items": []}
            self.profile["covered_news_today"] = covered
        cur_items = covered.setdefault("items", [])
        for it in items:
            it_clean = it.split("[Source:")[0].strip()
            if it_clean and it_clean not in cur_items:
                cur_items.append(it_clean)
        # Keep up to 30 items for the day
        covered["items"] = cur_items[-30:]
        self._save_profile()

    def get_covered_news_today(self) -> list:
        """Returns list of news headline titles already covered today."""
        today_str = datetime.now().strftime("%Y-%m-%d")
        covered = self.profile.get("covered_news_today")
        if not isinstance(covered, dict) or covered.get("date") != today_str:
            return []
        items = covered.get("items", [])
        return items if isinstance(items, list) else []

    def get_absence_duration_seconds(self) -> float:
        """Returns elapsed seconds since last active/shutdown session."""
        now = time.time()
        candidates = []
        for key in ("last_shutdown_epoch", "last_active_epoch", "mood_last_update"):
            val = self.profile.get(key)
            if val and isinstance(val, (int, float)) and 0 < val <= now:
                candidates.append(float(val))

        try:
            from app.memory.db import get_relationship_status
            rel = get_relationship_status()
            rel_epoch = rel.get("last_interaction_epoch")
            if rel_epoch and isinstance(rel_epoch, (int, float)) and 0 < rel_epoch <= now:
                candidates.append(float(rel_epoch))
        except Exception:
            pass

        if not candidates:
            return 0.0

        last_time = max(candidates)
        return max(0.0, now - last_time)

    def update_fact(self, key: str, value: str):
        raw_items = [v.strip() for v in str(value).split(",") if v.strip()]
        existing = self.profile["custom_facts"].get(key)
        if existing is None:
            if len(raw_items) == 1:
                self.profile["custom_facts"][key] = raw_items[0]
            else:
                self.profile["custom_facts"][key] = raw_items
        else:
            if not isinstance(existing, list):
                existing = [existing]
            for item in raw_items:
                if item not in existing:
                    existing.append(item)
            self.profile["custom_facts"][key] = existing
        self._save_profile()
        return f"Successfully remembered that {key} is now stored."

    def delete_fact(self, key: str):
        if key in self.profile["custom_facts"]:
            del self.profile["custom_facts"][key]
            self._save_profile()
            return f"Successfully deleted fact '{key}'."
        return f"Fact '{key}' not found."

    def set_custom_facts(self, facts: dict):
        self.profile["custom_facts"] = facts
        self._save_profile()
        return "Successfully updated custom facts."

    def _add_list_item(self, target_list_key: str, item: str, category_name: str) -> str:
        if not item or not item.strip():
            return f"No valid {category_name} provided."
        if target_list_key not in self.profile or not isinstance(self.profile[target_list_key], list):
            self.profile[target_list_key] = []

        raw_items = [i.strip() for i in str(item).split(",") if i.strip()]
        added = []
        already = []
        for single in raw_items:
            if single not in self.profile[target_list_key]:
                self.profile[target_list_key].append(single)
                added.append(single)
            else:
                already.append(single)

        self._save_profile()
        if added and already:
            return f"Added '{', '.join(added)}' to {category_name}. ('{', '.join(already)}' was already recorded)."
        elif added:
            return f"Successfully added '{', '.join(added)}' to {category_name}."
        else:
            return f"'{', '.join(already)}' is already in {category_name}."

    def add_interest(self, interest: str):
        return self._add_list_item("user_interests", interest, "interests")

    def add_hobby(self, hobby: str):
        return self._add_list_item("user_hobbies", hobby, "hobbies")

    def add_like(self, like: str):
        return self._add_list_item("user_likes", like, "likes")

    def add_dislike(self, dislike: str):
        return self._add_list_item("user_dislikes", dislike, "dislikes")

    def remove_interest(self, interest: str):
        if interest in self.profile.get("user_interests", []):
            self.profile["user_interests"].remove(interest)
            self._save_profile()
            return f"Successfully removed '{interest}' from interests."
        return f"'{interest}' was not in interests."

    def set_user_interests(self, interests: list):
        self.profile["user_interests"] = interests
        self._save_profile()
        return "Successfully updated interests."

    def set_user_name(self, name: str):
        self.profile["user_name"] = name
        self._save_profile()
        return f"Name updated to '{name}'."

    def update_setting(self, key: str, value: str):
        if "settings" not in self.profile:
            self.profile["settings"] = {}
        print(f"[DEBUG] update_setting: Setting {key} to {value}")
        self.profile["settings"][key] = value
        self._save_profile()
        print(f"[DEBUG] update_setting: Saved profile to disk. Value is now {self.profile['settings'][key]}")
        
        # Apply to config dynamically
        if key == "aed_enabled":
            config.AED_ENABLED = bool(value)
        elif key == "aed_confidence_threshold":
            config.AED_CONFIDENCE_THRESHOLD = float(value)
        elif key == "aed_fast_reflex":
            config.AED_FAST_REFLEX = bool(value)
        elif key == "listen_on_startup":
            config.LISTEN_ON_STARTUP = bool(value)
        elif key == "llm_speech_input_enabled":
            config.LLM_SPEECH_INPUT_ENABLED = bool(value)
        elif key == "tts_voice":
            config.TTS_VOICE = value
        elif key == "tts_rate":
            config.TTS_RATE = value
        elif key == "character_name":
            config.CHARACTER_NAME = value
        elif key == "character_persona":
            preset_key = self.profile.get("settings", {}).get("persona_preset", "sassy_tech_gf")
            val_str = str(value).strip()
            if "custom_persona_prompts" not in self.profile["settings"] or not isinstance(self.profile["settings"]["custom_persona_prompts"], dict):
                self.profile["settings"]["custom_persona_prompts"] = {}
            self.profile["settings"]["custom_persona_prompts"][preset_key] = val_str
            self.profile["settings"]["character_persona"] = val_str
            config.CHARACTER_PERSONA = val_str
            self._save_profile()
        elif key == "custom_persona_prompts":
            if "custom_persona_prompts" not in self.profile["settings"] or not isinstance(self.profile["settings"]["custom_persona_prompts"], dict):
                self.profile["settings"]["custom_persona_prompts"] = {}
            if isinstance(value, dict):
                for k, v in value.items():
                    k_clean = str(k).strip()
                    v_clean = str(v).strip() if v is not None else ""
                    if v_clean:
                        self.profile["settings"]["custom_persona_prompts"][k_clean] = v_clean
                    else:
                        self.profile["settings"]["custom_persona_prompts"].pop(k_clean, None)
            from app.agent.personas import get_clean_character_backstory
            config.CHARACTER_PERSONA = get_clean_character_backstory(self.profile)
            self.profile["settings"]["character_persona"] = config.CHARACTER_PERSONA
            self._save_profile()
        elif key == "persona_preset":
            val_str = str(value).strip()
            self.profile["settings"]["persona_preset"] = val_str
            config.PERSONA_PRESET = val_str
            from app.agent.personas import get_clean_character_backstory
            config.CHARACTER_PERSONA = get_clean_character_backstory(self.profile)
            self.profile["settings"]["character_persona"] = config.CHARACTER_PERSONA
            self._save_profile()
        elif key == "user_presets":
            if isinstance(value, dict):
                if "user_presets" not in self.profile["settings"] or not isinstance(self.profile["settings"]["user_presets"], dict):
                    self.profile["settings"]["user_presets"] = {}
                self.profile["settings"]["user_presets"] = value
                from app.agent.personas import get_clean_character_backstory
                config.CHARACTER_PERSONA = get_clean_character_backstory(self.profile)
                self.profile["settings"]["character_persona"] = config.CHARACTER_PERSONA
                self._save_profile()
        elif key == "execution_rules":
            self.profile["settings"]["execution_rules"] = str(value).strip()
            from app.agent.personas import get_clean_character_backstory
            config.CHARACTER_PERSONA = get_clean_character_backstory(self.profile)
            self.profile["settings"]["character_persona"] = config.CHARACTER_PERSONA
            self._save_profile()
        elif key == "auto_evolving_archetype":
            val_bool = bool(value)
            config.AUTO_EVOLVING_ARCHETYPE = val_bool
            self.profile["settings"]["auto_evolving_archetype"] = val_bool
            from app.agent.personas import get_clean_character_backstory
            config.CHARACTER_PERSONA = get_clean_character_backstory(self.profile)
            self.profile["settings"]["character_persona"] = config.CHARACTER_PERSONA
            self._save_profile()
        elif key == "archetype_intensity":
            val_str = str(value).strip().lower()
            config.ARCHETYPE_INTENSITY = val_str
            self.profile["settings"]["archetype_intensity"] = val_str
            from app.agent.personas import get_clean_character_backstory
            config.CHARACTER_PERSONA = get_clean_character_backstory(self.profile)
            self.profile["settings"]["character_persona"] = config.CHARACTER_PERSONA
            self._save_profile()
        elif key == "disabled_animations":
            clean_anims = [str(x).strip() for x in value] if isinstance(value, list) else []
            config.DISABLED_ANIMATIONS = clean_anims
            self.profile["settings"]["disabled_animations"] = clean_anims
            self._save_profile()
        elif key == "llm_model":
            config.LLM_MODEL = value
        elif key == "llm_backend":
            config.LLM_BACKEND = value
            from app.agent.llm_backend import reset_backend
            reset_backend()
        elif key == "llm_base_url":
            config.LLM_BASE_URL = value
            from app.agent.llm_backend import reset_backend
            reset_backend()
        elif key == "llm_api_key":
            from app.utils.security import decrypt_api_key, encrypt_api_key
            config.LLM_API_KEY = decrypt_api_key(value) if value and value.startswith("enc_v1:") else value
            self.profile["settings"]["llm_api_key"] = encrypt_api_key(value) if value else ""
            self._save_profile()
            from app.agent.llm_backend import reset_backend
            reset_backend()
        elif key == "no_llm_mode":
            config.NO_LLM_MODE = bool(value)
        elif key == "llm_mode":
            config.LLM_MODE = int(value)
        elif key == "codegraph_coder_enabled":
            config.CODEGRAPH_CODER_ENABLED = bool(value)
        elif key == "codegraph_advanced_enabled":
            config.CODEGRAPH_ADVANCED_ENABLED = bool(value)
        elif key == "hotkey_shortcut":
            config.HOTKEY_SHORTCUT = str(value)
        elif key == "hotkey_focus_chat":
            config.HOTKEY_FOCUS_CHAT = bool(value)
        elif key == "hotkey_open_logs":
            config.HOTKEY_OPEN_LOGS = bool(value)
        elif key == "hotkey_turn_on_listening":
            config.HOTKEY_TURN_ON_LISTENING = bool(value)
        elif key == "allow_voice_barge_in":
            config.ALLOW_VOICE_BARGE_IN = bool(value)
        elif key == "barge_in_sensitivity":
            config.BARGE_IN_SENSITIVITY = float(value)
        elif key == "silero_vad_threshold":
            config.SILERO_VAD_THRESHOLD = float(value)
        elif key == "silero_min_speech_duration_ms":
            config.SILERO_MIN_SPEECH_DURATION_MS = int(value)
        elif key == "silero_min_silence_duration_ms":
            config.SILERO_MIN_SILENCE_DURATION_MS = int(value)
        elif key == "silero_speech_pad_ms":
            config.SILERO_SPEECH_PAD_MS = int(value)
        elif key == "whisper_beam_size":
            config.WHISPER_BEAM_SIZE = int(value)
        elif key == "whisper_condition_on_previous_text":
            config.WHISPER_CONDITION_ON_PREVIOUS_TEXT = bool(value)
        elif key == "silence_timeout_ms":
            config.SILENCE_TIMEOUT_MS = int(value)
        elif key == "continued_session_timeout_sec":
            config.CONTINUED_SESSION_TIMEOUT_SEC = int(value)
        elif key == "max_recording_duration_sec":
            config.MAX_RECORDING_DURATION_SEC = int(value)
        elif key == "whisper_no_speech_threshold":
            config.WHISPER_NO_SPEECH_THRESHOLD = float(value)
        elif key == "stt_auto_gain_control":
            config.STT_AUTO_GAIN_CONTROL = bool(value)
        elif key == "allow_voice_barge_in":
            config.ALLOW_VOICE_BARGE_IN = bool(value)
        elif key == "stt_echo_cancellation":
            config.STT_ECHO_CANCELLATION = bool(value)
        elif key == "stt_noise_suppression":
            config.STT_NOISE_SUPPRESSION = bool(value)
        elif key == "stt_transport_mode":
            config.STT_TRANSPORT_MODE = str(value)
        elif key == "use_neural_browser_vad":
            config.USE_NEURAL_BROWSER_VAD = bool(value)
        elif key == "browser_neural_vad_confidence":
            config.BROWSER_NEURAL_VAD_CONFIDENCE = float(value)
        elif key == "adaptive_silence_cutoff":
            config.ADAPTIVE_SILENCE_CUTOFF = bool(value)
        elif key == "llm_vision_model":
            config.LLM_VISION_MODEL = str(value).strip()
        elif key == "llm_image_gen_model":
            config.LLM_IMAGE_GEN_MODEL = str(value).strip()
        elif key == "use_free_image_gen":
            config.USE_FREE_IMAGE_GEN = bool(value)
        elif key == "image_gen_provider":
            config.IMAGE_GEN_PROVIDER = str(value).strip().lower()
        elif key == "huggingface_api_key":
            config.HUGGINGFACE_API_KEY = str(value).strip()
        elif key == "stable_horde_api_key":
            config.STABLE_HORDE_API_KEY = str(value).strip()
        elif key == "stable_horde_model":
            config.STABLE_HORDE_MODEL = str(value).strip()
        elif key == "telegram_enabled":
            config.TELEGRAM_ENABLED = bool(value)
        elif key == "telegram_bot_token":
            from app.utils.security import decrypt_api_key, encrypt_api_key
            config.TELEGRAM_BOT_TOKEN = decrypt_api_key(value) if value and value.startswith("enc_v1:") else str(value).strip()
            self.profile["settings"]["telegram_bot_token"] = encrypt_api_key(value) if value else ""
            self._save_profile()
        elif key == "telegram_allowed_users":
            config.TELEGRAM_ALLOWED_USERS = str(value).strip()
        elif key == "telegram_voice_replies":
            config.TELEGRAM_VOICE_REPLIES = bool(value)
        elif key == "telegram_notify_reminders":
            config.TELEGRAM_NOTIFY_REMINDERS = bool(value)
        elif key == "telegram_verbose_tools":
            config.TELEGRAM_VERBOSE_TOOLS = bool(value)
        elif key == "proactive_nudge_mode":
            config.PROACTIVE_NUDGE_MODE = str(value).strip().lower()
        elif key == "proactive_nudge_interval_min":
            config.PROACTIVE_NUDGE_INTERVAL_MIN = int(value)
        elif key == "proactive_nudge_engine":
            config.PROACTIVE_NUDGE_ENGINE = str(value).strip().lower()
        elif key == "proactive_nudge_include_screen":
            config.PROACTIVE_NUDGE_INCLUDE_SCREEN = bool(value)
        elif key == "proactive_nudge_quiet_min":
            config.PROACTIVE_NUDGE_QUIET_MIN = int(value)
        elif key == "proactive_nudge_boredom_pct":
            config.PROACTIVE_NUDGE_BOREDOM_PCT = int(value)
        elif key == "desk_sleep_idle_min":
            config.DESK_SLEEP_IDLE_MIN = int(value)
        elif key == "companion_nap_silence_min":
            config.COMPANION_NAP_SILENCE_MIN = int(value)
        elif key == "companion_nap_energy_pct":
            config.COMPANION_NAP_ENERGY_PCT = int(value)
        elif key == "kokoro_ipa_interjections":
            config.KOKORO_IPA_INTERJECTIONS = bool(value)
            
        return f"Successfully updated setting '{key}' to '{value}'."

    def get_profile_summary(self) -> str:
        """
        Generates a summary string of the user to inject into the system prompt.
        """
        summary = f"User Name: {self.profile['user_name']}\n"
        
        interests = ", ".join(self.profile.get("user_interests", [])) if self.profile.get("user_interests") else "None recorded yet"
        summary += f"Interests: {interests}\n"

        hobbies = ", ".join(self.profile.get("user_hobbies", [])) if self.profile.get("user_hobbies") else "None recorded yet"
        summary += f"Hobbies: {hobbies}\n"

        likes = ", ".join(self.profile.get("user_likes", [])) if self.profile.get("user_likes") else "None recorded yet"
        summary += f"Likes: {likes}\n"

        dislikes = ", ".join(self.profile.get("user_dislikes", [])) if self.profile.get("user_dislikes") else "None recorded yet"
        summary += f"Dislikes: {dislikes}\n"
        
        facts = ""
        if self.profile.get("custom_facts"):
            for k, v in self.profile["custom_facts"].items():
                if isinstance(v, list):
                    v_str = ", ".join(str(x) for x in v)
                else:
                    v_str = str(v)
                facts += f"- {k}: {v_str}\n"
        else:
            facts = "None recorded yet\n"
        
        summary += f"Custom Facts:\n{facts}"
        return summary

    def get_mood_spectrum(self) -> dict:
        return self._mood_engine.current()

    def get_mood_baselines(self) -> dict:
        return self._mood_engine.baselines()

    def update_mood_spectrum(self, updates: dict):
        return self._mood_engine.apply_manual(updates)

    def reset_mood_spectrum(self):
        return self._mood_engine.reset()

    # ── Mood engine v2 helpers ────────────────────────────────────────
    def step_mood(self) -> bool:
        """Time-based drift toward baseline + random walk + circadian."""
        return self._mood_engine.step()

    def nap_drift(self, delta_minutes: float = 1.0) -> bool:
        """Recharges energy at 1 pt/min during companion nap."""
        changed = self._mood_engine.nap_drift(delta_minutes)
        if changed:
            self._mood_engine._save()
            self._mood_engine._notify()
        return changed

    def sleep_drift(self, hours: float) -> bool:
        """Recharges energy during full sleep."""
        changed = self._mood_engine._sleep_drift(time.time(), hours)
        if changed:
            self._mood_engine._save()
            self._mood_engine._notify()
        return changed

    def react_mood(self, text: str, scope: str = "full") -> dict:
        """Script/regex reactions to a user message. scope: full | physical | emotion."""
        return self._mood_engine.react_to_message(text, scope=scope)

    def react_mood_self(self, text: str, scope: str = "full") -> dict:
        """Script/regex reactions to Yuki's OWN response text — her speech feeds back into her mood."""
        return self._mood_engine.react_to_self(text, scope=scope)

    def apply_turn_effects(self, llm_handled_energy: bool = False) -> dict:
        """mood_effecter — per-turn couplings run once at the end of each turn."""
        return self._mood_engine.apply_turn_effects(llm_handled_energy=llm_handled_energy)

    def apply_llm_mood(self, deltas: dict) -> bool:
        """Apply LLM-parsed <mood_update> deltas (script-only axes blocked)."""
        return self._mood_engine.apply_llm_deltas(deltas)

    def react_mood_outcome(self, tool_name: str, success: bool, drain_energy: bool = True):
        """Reactions to her own tool results."""
        self._mood_engine.react_to_outcome(tool_name, success, drain_energy=drain_energy)

    def on_mood_startup(self) -> bool:
        """Offline catch-up + daily shake-up + hourly jitter."""
        return self._mood_engine.on_startup()

    def get_mood_meta(self) -> dict:
        """Narrative/volatility/expression/voice hints for prompt, avatar and TTS."""
        return self._mood_engine.meta()

    def export_persona_data(self) -> dict:
        import datetime
        return {
            "export_type": "persona",
            "version": "1.0",
            "exported_at": datetime.datetime.now(datetime.timezone.utc).isoformat(),
            "app": "Project Yuki",
            "persona": {
                "character_name": self.profile.get("settings", {}).get("character_name", config.CHARACTER_NAME),
                "persona_preset": self.profile.get("settings", {}).get("persona_preset", getattr(config, "PERSONA_PRESET", "sassy_tech_gf")),
                "custom_persona_prompts": self.profile.get("settings", {}).get("custom_persona_prompts", {}),
                "character_persona": self.profile.get("settings", {}).get("character_persona", config.CHARACTER_PERSONA),
                "execution_rules": self.profile.get("settings", {}).get("execution_rules", ""),
                "tts_voice": self.profile.get("settings", {}).get("tts_voice", config.TTS_VOICE)
            },
            "user_profile": {
                "user_name": self.profile.get("user_name", "Master"),
                "user_interests": self.profile.get("user_interests", []),
                "user_hobbies": self.profile.get("user_hobbies", []),
                "user_likes": self.profile.get("user_likes", []),
                "user_dislikes": self.profile.get("user_dislikes", []),
                "custom_facts": self.profile.get("custom_facts", {}),
                "mood_spectrum": self.get_mood_spectrum(),
                "interaction_count": self.profile.get("interaction_count", 0)
            }
        }

    def import_persona_data(self, data: dict):
        if not isinstance(data, dict):
            raise ValueError("Invalid persona JSON payload")
        
        persona = data.get("persona", {})
        user_prof = data.get("user_profile", {})

        # If data is flat or structured
        char_name = persona.get("character_name") or data.get("character_name")
        char_persona = persona.get("character_persona") or data.get("character_persona")
        persona_preset = persona.get("persona_preset") or data.get("persona_preset")
        custom_prompts = persona.get("custom_persona_prompts") or data.get("custom_persona_prompts")
        execution_rules = persona.get("execution_rules") or data.get("execution_rules")
        tts_voice = persona.get("tts_voice") or data.get("tts_voice")

        if char_name:
            self.profile["settings"]["character_name"] = str(char_name).strip()
            config.CHARACTER_NAME = str(char_name).strip()
        if persona_preset:
            self.profile["settings"]["persona_preset"] = str(persona_preset).strip()
            config.PERSONA_PRESET = str(persona_preset).strip()
        if isinstance(custom_prompts, dict):
            if "custom_persona_prompts" not in self.profile["settings"]:
                self.profile["settings"]["custom_persona_prompts"] = {}
            self.profile["settings"]["custom_persona_prompts"].update(custom_prompts)
        if char_persona:
            self.profile["settings"]["character_persona"] = str(char_persona).strip()
            config.CHARACTER_PERSONA = str(char_persona).strip()
        else:
            from app.agent.personas import get_clean_character_backstory
            config.CHARACTER_PERSONA = get_clean_character_backstory(self.profile)
            self.profile["settings"]["character_persona"] = config.CHARACTER_PERSONA
        if execution_rules:
            self.profile["settings"]["execution_rules"] = str(execution_rules).strip()
        if tts_voice:
            self.profile["settings"]["tts_voice"] = str(tts_voice).strip()
            config.TTS_VOICE = str(tts_voice).strip()

        if "user_name" in user_prof:
            self.profile["user_name"] = str(user_prof["user_name"])
        elif "user_name" in data:
            self.profile["user_name"] = str(data["user_name"])

        for field in ["user_interests", "user_hobbies", "user_likes", "user_dislikes"]:
            val = user_prof.get(field, data.get(field))
            if isinstance(val, list):
                self.profile[field] = val

        custom_facts = user_prof.get("custom_facts", data.get("custom_facts"))
        if isinstance(custom_facts, dict):
            self.profile["custom_facts"] = custom_facts

        mood = user_prof.get("mood_spectrum", data.get("mood_spectrum"))
        if isinstance(mood, dict):
            self.update_mood_spectrum(mood)

        interaction_count = user_prof.get("interaction_count", data.get("interaction_count"))
        if isinstance(interaction_count, int):
            self.profile["interaction_count"] = interaction_count

        self._save_profile()
        return self.profile

    def export_settings_data(self) -> dict:
        import datetime
        import copy
        from app.utils.security import decrypt_api_key

        settings_copy = copy.deepcopy(self.profile.get("settings", {}))
        
        # Decrypt API keys for export so they can be restored on another machine
        raw_key = settings_copy.get("llm_api_key", "")
        if raw_key:
            settings_copy["llm_api_key"] = decrypt_api_key(raw_key) if raw_key.startswith("enc_v1:") else raw_key
            
        simple_key = settings_copy.get("llm_simple_api_key", "")
        if simple_key:
            settings_copy["llm_simple_api_key"] = decrypt_api_key(simple_key) if simple_key.startswith("enc_v1:") else simple_key

        return {
            "export_type": "settings",
            "version": "1.0",
            "exported_at": datetime.datetime.now(datetime.timezone.utc).isoformat(),
            "app": "Project Yuki",
            "settings": settings_copy
        }

    def import_settings_data(self, data: dict):
        if not isinstance(data, dict):
            raise ValueError("Invalid settings JSON payload")

        imported_settings = data.get("settings", data)
        if not isinstance(imported_settings, dict):
            raise ValueError("Invalid settings structure in payload")

        from app.utils.security import encrypt_api_key, decrypt_api_key

        # Update settings object
        for k, v in imported_settings.items():
            if k in ["llm_api_key", "llm_simple_api_key"]:
                decrypted = decrypt_api_key(v) if isinstance(v, str) and v.startswith("enc_v1:") else v
                self.profile["settings"][k] = encrypt_api_key(decrypted) if decrypted else ""
            else:
                self.profile["settings"][k] = v

        self._save_profile()
        # Re-apply all settings to runtime config
        self.profile = self._load_profile()
        return self.profile["settings"]

    def reset_custom_persona_prompt(self, preset_key: str = None) -> str:
        """Removes the custom prompt override for a persona and returns its built-in default."""
        settings = self.profile.get("settings", {})
        if preset_key is None:
            preset_key = settings.get("persona_preset", "sassy_tech_gf")
            
        custom_prompts = settings.get("custom_persona_prompts", {})
        if preset_key in custom_prompts:
            del custom_prompts[preset_key]
            
        self.profile["settings"]["custom_persona_prompts"] = custom_prompts
        self._save_profile()
        
        from app.agent.personas import PERSONA_PRESETS
        user_presets = settings.get("user_presets", {})
        
        if preset_key in user_presets and isinstance(user_presets[preset_key], dict) and user_presets[preset_key].get("prompt"):
            default_prompt = user_presets[preset_key]["prompt"]
        elif preset_key in PERSONA_PRESETS:
            default_prompt = PERSONA_PRESETS[preset_key]["prompt"]
        else:
            default_prompt = PERSONA_PRESETS["sassy_tech_gf"]["prompt"]

        # Also update character_persona if this is the currently active persona
        if settings.get("persona_preset") == preset_key:
            from app.agent.personas import sanitize_base_backstory
            clean = sanitize_base_backstory(default_prompt)
            self.profile["settings"]["character_persona"] = clean
            from app import config
            config.CHARACTER_PERSONA = clean
            self._save_profile()
            return clean
            
        return default_prompt

    def save_user_preset(self, name: str, description: str, prompt: str, preset_id: str = None) -> dict:
        """Creates or updates a user-defined character persona preset."""
        import re, time
        if "settings" not in self.profile:
            self.profile["settings"] = {}
        if "user_presets" not in self.profile["settings"] or not isinstance(self.profile["settings"]["user_presets"], dict):
            self.profile["settings"]["user_presets"] = {}

        name_clean = str(name).strip() if name else "Custom Persona"
        desc_clean = str(description).strip() if description else "User-defined character persona."
        prompt_clean = str(prompt).strip() if prompt else ""

        if preset_id and str(preset_id).strip():
            pid = str(preset_id).strip()
        else:
            base_slug = re.sub(r'[^a-z0-9_]+', '_', name_clean.lower()).strip('_') or "custom"
            pid = f"user_{base_slug}_{int(time.time())}"

        self.profile["settings"]["user_presets"][pid] = {
            "name": name_clean,
            "description": desc_clean,
            "prompt": prompt_clean
        }

        # Activate this preset
        self.profile["settings"]["persona_preset"] = pid
        from app import config
        config.PERSONA_PRESET = pid
        from app.agent.personas import get_clean_character_backstory
        config.CHARACTER_PERSONA = get_clean_character_backstory(self.profile)
        self.profile["settings"]["character_persona"] = config.CHARACTER_PERSONA
        self._save_profile()

        return {
            "preset_id": pid,
            "name": name_clean,
            "description": desc_clean,
            "prompt": prompt_clean,
            "all_user_presets": self.profile["settings"]["user_presets"]
        }

    def delete_user_preset(self, preset_id: str) -> dict:
        """Deletes a user-defined persona preset."""
        if "settings" not in self.profile:
            self.profile["settings"] = {}
        user_presets = self.profile["settings"].get("user_presets", {})
        pid = str(preset_id).strip()

        if pid in user_presets:
            user_presets.pop(pid, None)
            self.profile["settings"]["user_presets"] = user_presets

            # If deleted preset was active, fall back to sassy_tech_gf
            if self.profile["settings"].get("persona_preset") == pid:
                self.profile["settings"]["persona_preset"] = "sassy_tech_gf"
                from app import config
                config.PERSONA_PRESET = "sassy_tech_gf"

            if "custom_persona_prompts" in self.profile["settings"]:
                self.profile["settings"]["custom_persona_prompts"].pop(pid, None)

            from app.agent.personas import get_clean_character_backstory
            from app import config
            config.CHARACTER_PERSONA = get_clean_character_backstory(self.profile)
            self.profile["settings"]["character_persona"] = config.CHARACTER_PERSONA
            self._save_profile()

        return {
            "active_preset": self.profile["settings"].get("persona_preset", "sassy_tech_gf"),
            "user_presets": self.profile["settings"].get("user_presets", {})
        }

    def reset_all_builtin_personas(self) -> dict:
        """Resets all built-in persona customizations back to personas.py defaults,
        leaving user-defined custom presets (+ Add a Preset) completely untouched."""
        if "settings" not in self.profile:
            self.profile["settings"] = {}

        user_presets = self.profile["settings"].get("user_presets", {})
        custom_prompts = self.profile["settings"].get("custom_persona_prompts", {})

        # Retain only overrides for user-created presets; clear all built-in overrides
        cleaned_custom_prompts = {
            k: v for k, v in custom_prompts.items() if k in user_presets
        }
        self.profile["settings"]["custom_persona_prompts"] = cleaned_custom_prompts

        from app.agent.personas import get_clean_character_backstory
        from app import config
        config.CHARACTER_PERSONA = get_clean_character_backstory(self.profile)
        self.profile["settings"]["character_persona"] = config.CHARACTER_PERSONA
        self._save_profile()

        return {
            "status": "success",
            "active_preset": self.profile["settings"].get("persona_preset", "sassy_tech_gf"),
            "character_persona": config.CHARACTER_PERSONA,
            "custom_persona_prompts": cleaned_custom_prompts,
            "user_presets": user_presets
        }


