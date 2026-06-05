import json
import os
from app import config

class MemoryManager:
    def __init__(self):
        self.profile_path = config.PROFILE_PATH
        self.profile = self._load_profile()

    def _load_profile(self):
        default_profile = {
            "user_name": "Master",
            "user_interests": [],
            "custom_facts": {},
            "interaction_count": 0,
            "settings": {
                "llm_model": "ministra-3",
                "tts_voice": "af_sarah",
                "tts_rate": "1.0",
                "character_name": "Yuki",
                "character_persona": config.CHARACTER_PERSONA,
                "crawler_paused": False,
                "tagger_paused": True
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
                
                # Apply settings to runtime config
                config.TTS_VOICE = data["settings"].get("tts_voice", config.TTS_VOICE)
                config.TTS_RATE = data["settings"].get("tts_rate", config.TTS_RATE)
                config.CHARACTER_NAME = data["settings"].get("character_name", config.CHARACTER_NAME)
                config.CHARACTER_PERSONA = data["settings"].get("character_persona", config.CHARACTER_PERSONA)
                
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
        self.profile["custom_facts"][key] = value
        self._save_profile()
        return f"Successfully remembered that {key} is now '{value}'."

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

    def add_interest(self, interest: str):
        if interest not in self.profile["user_interests"]:
            self.profile["user_interests"].append(interest)
            self._save_profile()
            return f"Successfully added '{interest}' to interests."
        return f"'{interest}' is already in interests."

    def remove_interest(self, interest: str):
        if interest in self.profile["user_interests"]:
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
            
        return f"Successfully updated setting '{key}' to '{value}'."

    def get_profile_summary(self) -> str:
        """
        Generates a summary string of the user to inject into the system prompt.
        """
        summary = f"User Name: {self.profile['user_name']}\n"
        
        interests = ", ".join(self.profile["user_interests"]) if self.profile["user_interests"] else "None recorded yet"
        summary += f"Interests: {interests}\n"
        
        facts = ""
        if self.profile["custom_facts"]:
            for k, v in self.profile["custom_facts"].items():
                facts += f"- {k}: {v}\n"
        else:
            facts = "None recorded yet\n"
        
        summary += f"Custom Facts:\n{facts}"
        summary += f"Interaction count: {self.profile['interaction_count']}"
        return summary

