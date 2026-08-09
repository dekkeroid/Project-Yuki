import json
import os
from app import config
from app.memory.mood_engine import MoodEngine, AXES as MOOD_AXES

DEFAULT_MOOD_SPECTRUM = {
    "happiness": 75,
    "energy": 65,
    "curiosity": 80,
    "affection": 70,
    "stress_level": 15,
    "doomer": 20,
    "hunger": 30,
    "horniness": 50,
    "playfulness": 55,
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
                "character_persona": config.CHARACTER_PERSONA,
                "crawler_paused": False,
                "tagger_paused": True,
                "active_vrm_model": "default.vrm",
                "whisper_model": "small",
                "whisper_compute_type": "int8_float16",
                "use_local_whisper": True,
                "stt_language": "en",
                "no_llm_mode": False,
                "dynamic_tool_calling": True,
                "blocked_tools": [],
                "enable_intent_check": True,
                "vad_threshold": 0.16,
                "silero_vad_threshold": 0.50,
                "silero_min_speech_duration_ms": 150,
                "silero_min_silence_duration_ms": 400,
                "silero_speech_pad_ms": 100,
                "whisper_beam_size": 1,
                "whisper_condition_on_previous_text": False,
                "silence_timeout_ms": 450,
                "continued_session_timeout_sec": 120,
                "whisper_no_speech_threshold": 0.6,
                "llm_mode": 3,
                "enable_rotation": True,
                "auto_reset_rotation": False,
                "mood_source": "script",
                "tts_preload": True,
                "vrm_dpr": 1.5,
                "vrm_fps": 40,
                "chat_mode": False,
                "keep_memory_saving": True,
                "tool_mode": "basic",
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
                "llm_summary_model": ""
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
                config.STT_DEVICE = data["settings"].get("stt_device", config.STT_DEVICE)
                config.WHISPER_MODEL = data["settings"].get("whisper_model", getattr(config, "WHISPER_MODEL", "small"))
                config.WHISPER_COMPUTE_TYPE = data["settings"].get("whisper_compute_type", getattr(config, "WHISPER_COMPUTE_TYPE", "int8_float16"))
                config.SILERO_VAD_THRESHOLD = float(data["settings"].get("silero_vad_threshold", getattr(config, "SILERO_VAD_THRESHOLD", 0.50)))
                config.SILERO_MIN_SPEECH_DURATION_MS = int(data["settings"].get("silero_min_speech_duration_ms", getattr(config, "SILERO_MIN_SPEECH_DURATION_MS", 150)))
                config.SILERO_MIN_SILENCE_DURATION_MS = int(data["settings"].get("silero_min_silence_duration_ms", getattr(config, "SILERO_MIN_SILENCE_DURATION_MS", 400)))
                config.SILERO_SPEECH_PAD_MS = int(data["settings"].get("silero_speech_pad_ms", getattr(config, "SILERO_SPEECH_PAD_MS", 100)))
                config.WHISPER_BEAM_SIZE = int(data["settings"].get("whisper_beam_size", getattr(config, "WHISPER_BEAM_SIZE", 1)))
                config.WHISPER_CONDITION_ON_PREVIOUS_TEXT = bool(data["settings"].get("whisper_condition_on_previous_text", getattr(config, "WHISPER_CONDITION_ON_PREVIOUS_TEXT", False)))
                config.SILENCE_TIMEOUT_MS = int(data["settings"].get("silence_timeout_ms", getattr(config, "SILENCE_TIMEOUT_MS", 450)))
                config.CONTINUED_SESSION_TIMEOUT_SEC = int(data["settings"].get("continued_session_timeout_sec", getattr(config, "CONTINUED_SESSION_TIMEOUT_SEC", 120)))
                config.WHISPER_NO_SPEECH_THRESHOLD = float(data["settings"].get("whisper_no_speech_threshold", getattr(config, "WHISPER_NO_SPEECH_THRESHOLD", 0.6)))
                config.TOOL_MODE = data["settings"].get("tool_mode", getattr(config, "TOOL_MODE", "basic")).strip().lower()
                config.SEND_TOOLS_IN_SIMPLE = bool(data["settings"].get("send_tools_in_simple", False))
                config.CODEGRAPH_CODER_ENABLED = bool(data["settings"].get("codegraph_coder_enabled", getattr(config, "CODEGRAPH_CODER_ENABLED", False)))
                config.CODEGRAPH_ADVANCED_ENABLED = bool(data["settings"].get("codegraph_advanced_enabled", getattr(config, "CODEGRAPH_ADVANCED_ENABLED", False)))
                config.ENDPOINT_STRATEGY = data["settings"].get("endpoint_strategy", "single").strip().lower()
                config.LLM_SIMPLE_BACKEND = data["settings"].get("llm_simple_backend", getattr(config, "LLM_SIMPLE_BACKEND", "lmstudio"))
                config.LLM_SIMPLE_BASE_URL = data["settings"].get("llm_simple_base_url", getattr(config, "LLM_SIMPLE_BASE_URL", "http://127.0.0.1:1234"))
                config.LLM_SIMPLE_MODEL = data["settings"].get("llm_simple_model", getattr(config, "LLM_SIMPLE_MODEL", ""))
                config.LLM_CODER_BACKEND = data["settings"].get("llm_coder_backend", getattr(config, "LLM_CODER_BACKEND", ""))
                config.LLM_CODER_BASE_URL = data["settings"].get("llm_coder_base_url", getattr(config, "LLM_CODER_BASE_URL", ""))
                config.LLM_CODER_MODEL = data["settings"].get("llm_coder_model", getattr(config, "LLM_CODER_MODEL", ""))
                config.CHARACTER_NAME = data["settings"].get("character_name", config.CHARACTER_NAME)
                
                # IMPORTANT FIX FOR PROD:
                # If a legacy character_persona is saved in settings, but NO custom_persona_prompts exist, 
                # we should NOT blindly load it for the "sassy_tech_gf" if they are a new user. 
                # However, to preserve state for old users, we DO load it, but we also ensure 
                # custom_persona_prompts dictionary is explicitly initialized if missing.
                if "custom_persona_prompts" not in data["settings"]:
                    data["settings"]["custom_persona_prompts"] = {}
                
                from app.agent.personas import get_clean_character_backstory
                config.CHARACTER_PERSONA = get_clean_character_backstory(data)
                config.LLM_MODEL = data["settings"].get("llm_model", config.LLM_MODEL)
                config.NO_LLM_MODE = data["settings"].get("no_llm_mode", False)
                config.LLM_BACKEND = data["settings"].get("llm_backend", config.LLM_BACKEND)
                config.LLM_BASE_URL = data["settings"].get("llm_base_url", config.LLM_BASE_URL)
                config.LLM_MODE = int(data["settings"].get("llm_mode", config.LLM_MODE))
                raw_key = data["settings"].get("llm_api_key", config.LLM_API_KEY)
                simple_key = data["settings"].get("llm_simple_api_key", config.LLM_SIMPLE_API_KEY)
                coder_key = data["settings"].get("llm_coder_api_key", getattr(config, "LLM_CODER_API_KEY", ""))
                from app.utils.security import decrypt_api_key
                dec_raw = decrypt_api_key(raw_key) if (raw_key and ("enc_v1:" in str(raw_key) or "gAAAA" in str(raw_key))) else (raw_key or "")
                dec_simple = decrypt_api_key(simple_key) if (simple_key and ("enc_v1:" in str(simple_key) or "gAAAA" in str(simple_key))) else (simple_key or "")
                dec_coder = decrypt_api_key(coder_key) if (coder_key and ("enc_v1:" in str(coder_key) or "gAAAA" in str(coder_key))) else (coder_key or "")
                config.LLM_API_KEY = dec_raw
                config.LLM_SIMPLE_API_KEY = dec_simple
                config.LLM_CODER_API_KEY = dec_coder
                data["settings"]["llm_api_key"] = dec_raw
                data["settings"]["llm_simple_api_key"] = dec_simple
                data["settings"]["llm_coder_api_key"] = dec_coder
                for ep in data["settings"].get("saved_custom_endpoints", []):
                    if isinstance(ep, dict) and ep.get("api_key") and ("enc_v1:" in str(ep["api_key"]) or "gAAAA" in str(ep["api_key"])):
                        ep["api_key"] = decrypt_api_key(ep["api_key"])
                if "always_included_tools" in data["settings"]:
                    config.ALWAYS_INCLUDED_JARVIS_TOOLS = list(data["settings"].get("always_included_tools") or [])
                if "blocked_tools" in data["settings"]:
                    config.TOOL_BLACKLIST = set(data["settings"].get("blocked_tools") or [])
                if "included_coder_tools" in data["settings"]:
                    config.INCLUDED_CODER_TOOLS = list(data["settings"].get("included_coder_tools") or [])
                
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
        self._save_profile()

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
        if key == "tts_voice":
            config.TTS_VOICE = value
        elif key == "tts_rate":
            config.TTS_RATE = value
        elif key == "character_name":
            config.CHARACTER_NAME = value
        elif key == "character_persona":
            preset_key = self.profile.get("settings", {}).get("persona_preset", "sassy_tech_gf")
            val_str = str(value).strip()
            from app.agent.personas import PERSONA_PRESETS
            builtin_prompt = PERSONA_PRESETS.get(preset_key, {}).get("prompt", "").strip()
            if "custom_persona_prompts" not in self.profile["settings"]:
                self.profile["settings"]["custom_persona_prompts"] = {}
            if builtin_prompt and val_str == builtin_prompt:
                self.profile["settings"]["custom_persona_prompts"].pop(preset_key, None)
            else:
                self.profile["settings"]["custom_persona_prompts"][preset_key] = val_str
            from app.agent.personas import get_clean_character_backstory
            config.CHARACTER_PERSONA = get_clean_character_backstory(self.profile)
        elif key in ("persona_preset", "auto_evolving_archetype", "archetype_intensity", "execution_rules"):
            from app.agent.personas import get_clean_character_backstory
            config.CHARACTER_PERSONA = get_clean_character_backstory(self.profile)
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
            
        return f"Successfully updated setting '{key}' to '{value}'."

    def reset_custom_persona_prompt(self, preset: str = None) -> str:
        """Deletes custom Section 1 prompt override for preset and restores built-in default backup prompt."""
        preset_key = preset or self.profile.get("settings", {}).get("persona_preset", "sassy_tech_gf")
        if "settings" in self.profile and "custom_persona_prompts" in self.profile["settings"]:
            if preset_key in self.profile["settings"]["custom_persona_prompts"]:
                del self.profile["settings"]["custom_persona_prompts"][preset_key]
                self._save_profile()
        from app.agent.personas import get_clean_character_backstory
        config.CHARACTER_PERSONA = get_clean_character_backstory(self.profile)
        return config.CHARACTER_PERSONA

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

    def react_mood(self, text: str, scope: str = "full") -> dict:
        """Script/regex reactions to a user message. scope: full | physical | emotion."""
        return self._mood_engine.react_to_message(text, scope=scope)

    def react_mood_self(self, text: str, scope: str = "full") -> dict:
        """Script/regex reactions to Yuki's OWN response text — her speech feeds back into her mood."""
        return self._mood_engine.react_to_self(text, scope=scope)

    def apply_turn_effects(self) -> dict:
        """mood_effecter — per-turn couplings run once at the end of each turn."""
        return self._mood_engine.apply_turn_effects()

    def apply_llm_mood(self, deltas: dict) -> bool:
        """Apply LLM-parsed <mood_update> deltas (script-only axes blocked)."""
        return self._mood_engine.apply_llm_deltas(deltas)

    def react_mood_outcome(self, tool_name: str, success: bool):
        """Reactions to her own tool results."""
        self._mood_engine.react_to_outcome(tool_name, success)

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
                "character_persona": self.profile.get("settings", {}).get("character_persona", config.CHARACTER_PERSONA),
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
        tts_voice = persona.get("tts_voice") or data.get("tts_voice")

        if char_name:
            self.profile["settings"]["character_name"] = str(char_name).strip()
            config.CHARACTER_NAME = str(char_name).strip()
        if char_persona:
            self.profile["settings"]["character_persona"] = str(char_persona).strip()
            config.CHARACTER_PERSONA = str(char_persona).strip()
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
        
        # Also update character_persona if this is the currently active persona
        default_prompt = PERSONA_PRESETS.get(preset_key, PERSONA_PRESETS["sassy_tech_gf"])["prompt"]
        if settings.get("persona_preset") == preset_key:
            from app.agent.personas import sanitize_base_backstory
            clean = sanitize_base_backstory(default_prompt)
            self.profile["settings"]["character_persona"] = clean
            from app import config
            config.CHARACTER_PERSONA = clean
            self._save_profile()
            return clean
            
        return default_prompt


