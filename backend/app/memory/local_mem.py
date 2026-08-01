import json
import os
from app import config

DEFAULT_MOOD_SPECTRUM = {
    "happiness": 75,
    "energy": 65,
    "curiosity": 80,
    "affection": 70,
    "stress_level": 15,
    "doomer": 20,
    "hunger": 30,
    "horniness": 50
}

class MemoryManager:
    def __init__(self):
        self.profile_path = config.PROFILE_PATH
        self.profile = self._load_profile()

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
                "tts_rate": "1.0",
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
                "enable_intent_check": True,
                "vad_threshold": 0.015,
                "silence_timeout_ms": 450,
                "llm_mode": 3,
                "enable_rotation": True,
                "auto_reset_rotation": False,
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
                "basic_history_token_limit": 2500,
                "basic_history_keep_turns": 6,
                "advanced_history_token_limit": 40000,
                "advanced_history_keep_turns": 16
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
                config.SILERO_VAD_THRESHOLD = float(data["settings"].get("vad_threshold", getattr(config, "SILERO_VAD_THRESHOLD", 0.015)))
                config.SILENCE_TIMEOUT_MS = int(data["settings"].get("silence_timeout_ms", getattr(config, "SILENCE_TIMEOUT_MS", 450)))
                config.TOOL_MODE = data["settings"].get("tool_mode", getattr(config, "TOOL_MODE", "basic")).strip().lower()
                config.SEND_TOOLS_IN_SIMPLE = bool(data["settings"].get("send_tools_in_simple", False))
                config.ENDPOINT_STRATEGY = data["settings"].get("endpoint_strategy", "single").strip().lower()
                config.LLM_SIMPLE_BACKEND = data["settings"].get("llm_simple_backend", getattr(config, "LLM_SIMPLE_BACKEND", "lmstudio"))
                config.LLM_SIMPLE_BASE_URL = data["settings"].get("llm_simple_base_url", getattr(config, "LLM_SIMPLE_BASE_URL", "http://127.0.0.1:1234"))
                config.LLM_SIMPLE_MODEL = data["settings"].get("llm_simple_model", getattr(config, "LLM_SIMPLE_MODEL", ""))
                config.LLM_CODER_BACKEND = data["settings"].get("llm_coder_backend", getattr(config, "LLM_CODER_BACKEND", ""))
                config.LLM_CODER_BASE_URL = data["settings"].get("llm_coder_base_url", getattr(config, "LLM_CODER_BASE_URL", ""))
                config.LLM_CODER_MODEL = data["settings"].get("llm_coder_model", getattr(config, "LLM_CODER_MODEL", ""))
                config.CHARACTER_NAME = data["settings"].get("character_name", config.CHARACTER_NAME)
                config.CHARACTER_PERSONA = data["settings"].get("character_persona", config.CHARACTER_PERSONA)
                config.LLM_MODEL = data["settings"].get("llm_model", config.LLM_MODEL)
                config.NO_LLM_MODE = data["settings"].get("no_llm_mode", False)
                config.LLM_BACKEND = data["settings"].get("llm_backend", config.LLM_BACKEND)
                config.LLM_BASE_URL = data["settings"].get("llm_base_url", config.LLM_BASE_URL)
                config.LLM_MODE = int(data["settings"].get("llm_mode", config.LLM_MODE))
                raw_key = data["settings"].get("llm_api_key", config.LLM_API_KEY)
                simple_key = data["settings"].get("llm_simple_api_key", config.LLM_SIMPLE_API_KEY)
                coder_key = data["settings"].get("llm_coder_api_key", getattr(config, "LLM_CODER_API_KEY", ""))
                from app.utils.security import decrypt_api_key
                config.LLM_API_KEY = decrypt_api_key(raw_key) if (raw_key and ("enc_v1:" in str(raw_key) or "gAAAA" in str(raw_key))) else (raw_key or "")
                config.LLM_SIMPLE_API_KEY = decrypt_api_key(simple_key) if (simple_key and ("enc_v1:" in str(simple_key) or "gAAAA" in str(simple_key))) else (simple_key or "")
                config.LLM_CODER_API_KEY = decrypt_api_key(coder_key) if (coder_key and ("enc_v1:" in str(coder_key) or "gAAAA" in str(coder_key))) else (coder_key or "")
                if "always_included_tools" in data["settings"]:
                    config.ALWAYS_INCLUDED_JARVIS_TOOLS = list(data["settings"].get("always_included_tools") or [])
                
                return data
        except Exception as e:
            print(f"Error loading profile: {e}. Reinitializing with default profile.")
            try:
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
        self.profile["settings"][key] = value
        self._save_profile()
        
        # Apply to config dynamically
        if key == "tts_voice":
            config.TTS_VOICE = value
        elif key == "tts_rate":
            config.TTS_RATE = value
        elif key == "character_name":
            config.CHARACTER_NAME = value
        elif key == "character_persona":
            config.CHARACTER_PERSONA = value
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
        if "mood_spectrum" not in self.profile or not isinstance(self.profile["mood_spectrum"], dict):
            self.profile["mood_spectrum"] = dict(DEFAULT_MOOD_SPECTRUM)
            self._save_profile()
        else:
            for k, v in DEFAULT_MOOD_SPECTRUM.items():
                if k not in self.profile["mood_spectrum"]:
                    self.profile["mood_spectrum"][k] = v
        return self.profile["mood_spectrum"]

    def update_mood_spectrum(self, updates: dict):
        current = self.get_mood_spectrum()
        for k, v in updates.items():
            if k in DEFAULT_MOOD_SPECTRUM:
                try:
                    current[k] = max(0, min(100, int(v)))
                except Exception:
                    pass
        self._save_profile()
        return current

    def reset_mood_spectrum(self):
        self.profile["mood_spectrum"] = dict(DEFAULT_MOOD_SPECTRUM)
        self._save_profile()
        return self.profile["mood_spectrum"]

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


