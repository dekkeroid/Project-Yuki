"""
LLM Backend Abstraction Layer

Provides a unified interface for different LLM backends:
- LMStudioBackend: Local LM Studio server (OpenAI-compatible + model loading)
- OllamaBackend: Local Ollama server (OpenAI-compatible, auto-pulls models)
- OpenAICompatibleBackend: Generic OpenAI-compatible API (OpenAI, Groq, Together, Deepseek, etc.)
"""

import json
import re
import aiohttp
import requests
from abc import ABC, abstractmethod
from typing import Dict, Any, List, Optional, Tuple
from app import config


class LLMBackend(ABC):
    """Abstract base class for LLM backends."""

    @property
    @abstractmethod
    def name(self) -> str:
        """Human-readable backend name."""
        ...

    @property
    @abstractmethod
    def base_url(self) -> str:
        """Base URL for API requests."""
        ...

    @abstractmethod
    async def health_check(self) -> bool:
        """Check if the backend is reachable."""
        ...

    @abstractmethod
    async def list_models(self) -> List[Dict[str, Any]]:
        """List available models. Returns [{"id": "...", "name": "...", "loaded": bool}]."""
        ...

    @abstractmethod
    async def ensure_model_loaded(self, model_name: str) -> bool:
        """Ensure a model is loaded/available. Returns True if ready."""
        ...

    @abstractmethod
    def build_headers(self) -> Dict[str, str]:
        """Build HTTP headers for API requests."""
        ...

    @abstractmethod
    def build_payload(self, model: str, messages: List[Dict], temperature: float,
                      use_tools: bool = False, tools: list = None,
                      stream: bool = False, context_length: int = None) -> Dict:
        """Build the request payload for chat completion."""
        ...

    @abstractmethod
    def supports_context_length(self) -> bool:
        """Whether this backend supports the context_length parameter."""
        ...

    def get_chat_url(self) -> str:
        """Get the chat completions endpoint URL."""
        return f"{self.base_url}/v1/chat/completions"

    def get_models_url(self) -> str:
        """Get the models listing endpoint URL."""
        return f"{self.base_url}/v1/models"

    def get_error_message(self, error: Exception) -> str:
        """Get a user-friendly error message for connection failures."""
        return (
            f"Hmph! I couldn't reach my brain server ({self.name}). "
            f"Make sure it's running on {self.base_url}! Error: {str(error)}"
        )


class LMStudioBackend(LLMBackend):
    """LM Studio local server backend."""

    def __init__(self, base_url_override: str = None):
        self._base_url_override = base_url_override

    @property
    def name(self) -> str:
        return "LM Studio"

    @property
    def base_url(self) -> str:
        if self._base_url_override:
            return self._base_url_override.rstrip("/")
        return config.get_effective_base_url()

    def supports_context_length(self) -> bool:
        return True

    def build_headers(self) -> Dict[str, str]:
        return {"Content-Type": "application/json"}

    def build_payload(self, model: str, messages: List[Dict], temperature: float,
                      use_tools: bool = False, tools: list = None,
                      stream: bool = False, context_length: int = 8192) -> Dict:
        payload = {
            "model": model,
            "messages": messages,
            "temperature": temperature,
            "context_length": context_length or 8192,
        }
        if stream:
            payload["stream"] = True
        if use_tools and tools:
            payload["tools"] = tools
            payload["tool_choice"] = "auto"
        return payload

    def get_models_url(self) -> str:
        return f"{self.base_url}/api/v1/models"

    async def health_check(self) -> bool:
        try:
            async with aiohttp.ClientSession() as session:
                async with session.get(self.get_models_url(), timeout=aiohttp.ClientTimeout(total=5)) as resp:
                    return resp.status == 200
        except Exception:
            return False

    async def list_models(self) -> List[Dict[str, Any]]:
        try:
            async with aiohttp.ClientSession() as session:
                async with session.get(self.get_models_url(), timeout=aiohttp.ClientTimeout(total=10)) as resp:
                    if resp.status != 200:
                        return []
                    data = await resp.json()
                    models = data.get("data", [])
                    if isinstance(data, dict) and not models:
                        models = data.get("models", [])
                    result = []
                    for m in models:
                        model_id = m.get("id") or m.get("key") or m.get("path") or ""
                        if not model_id:
                            continue
                        is_loaded = (
                            m.get("loaded", False) is True or
                            m.get("state") == "loaded" or
                            bool(m.get("loaded_instances"))
                        )
                        result.append({"id": model_id, "name": model_id, "loaded": is_loaded})
                    return result
        except Exception as e:
            print(f"[LMStudio] Error listing models: {e}")
            return []

    async def ensure_model_loaded(self, model_name: str) -> bool:
        try:
            async with aiohttp.ClientSession() as session:
                async with session.get(self.get_models_url(), timeout=aiohttp.ClientTimeout(total=5)) as resp:
                    if resp.status != 200:
                        print(f"[LMStudio] Failed to fetch models list. Status: {resp.status}")
                        return False
                    payload_data = await resp.json()
                    available_models = payload_data.get("data", [])
                    if isinstance(payload_data, dict) and not available_models:
                        available_models = payload_data.get("models", [])

                search_keyword = "llama" if "llama" in model_name.lower() else "nemotron"
                pattern = re.compile(rf".*{search_keyword}.*", re.IGNORECASE)

                print(f"[LMStudio] Scanning {len(available_models)} downloaded models for keyword '{search_keyword}'...")
                specific_match = None
                keyword_match = None
                specific_loaded = False

                for model_entry in available_models:
                    model_key = model_entry.get("id") or model_entry.get("key") or model_entry.get("path") or ""
                    print(f"[LMStudio]   -> Found Library Entry: '{model_key}'")
                    if not model_key:
                        continue
                    is_loaded = (
                        model_entry.get("loaded", False) is True or
                        model_entry.get("state") == "loaded" or
                        bool(model_entry.get("loaded_instances"))
                    )
                    if model_name.lower() in model_key.lower():
                        specific_match = model_key
                        specific_loaded = is_loaded
                        break
                    if keyword_match is None and pattern.match(model_key):
                        keyword_match = model_key

                lm_studio_identifier = None
                if specific_match:
                    lm_studio_identifier = specific_match
                    if specific_loaded:
                        print(f"[LMStudio] Discovery Success: '{model_name}' maps to active instance '{lm_studio_identifier}'. Skipping load sequence.")
                        return True
                elif keyword_match:
                    lm_studio_identifier = keyword_match
                    print(f"[LMStudio] Warning: Exact match for '{model_name}' not found. Falling back to keyword match: '{lm_studio_identifier}'.")

                if not lm_studio_identifier:
                    print(f"[LMStudio] Model '{model_name}' not found in library.")
                    return False

                print(f"[LMStudio] Model '{model_name}' is offline. Automatically loading: '{lm_studio_identifier}'...")
                async with session.post(f"{self.base_url}/api/v1/models/load", json={"model": lm_studio_identifier}, timeout=aiohttp.ClientTimeout(total=45)) as load_resp:
                    if load_resp.status == 200:
                        print(f"[LMStudio] Successfully auto-loaded model: '{lm_studio_identifier}'")
                        return True
                    else:
                        error_body = await load_resp.text()
                        print(f"[LMStudio] Failed to auto-load. HTTP {load_resp.status}: {error_body}")
                        return False
        except Exception as e:
            print(f"[LMStudio] Could not reach LM Studio ({e}). Model will be loaded on first use.")
            return False


class OllamaBackend(LLMBackend):
    """Ollama local server backend."""

    def __init__(self, base_url_override: str = None):
        self._base_url_override = base_url_override

    @property
    def name(self) -> str:
        return "Ollama"

    @property
    def base_url(self) -> str:
        if self._base_url_override:
            return self._base_url_override.rstrip("/")
        return config.get_effective_base_url()

    def supports_context_length(self) -> bool:
        return False

    def build_headers(self) -> Dict[str, str]:
        return {"Content-Type": "application/json"}

    def build_payload(self, model: str, messages: List[Dict], temperature: float,
                      use_tools: bool = False, tools: list = None,
                      stream: bool = False, context_length: int = None) -> Dict:
        payload = {
            "model": model,
            "messages": messages,
            "temperature": temperature,
        }
        if stream:
            payload["stream"] = True
        if use_tools and tools:
            payload["tools"] = tools
            payload["tool_choice"] = "auto"
        return payload

    async def health_check(self) -> bool:
        try:
            async with aiohttp.ClientSession() as session:
                async with session.get(self.get_models_url(), timeout=aiohttp.ClientTimeout(total=5)) as resp:
                    return resp.status == 200
        except Exception:
            return False

    async def list_models(self) -> List[Dict[str, Any]]:
        try:
            async with aiohttp.ClientSession() as session:
                async with session.get(self.get_models_url(), timeout=aiohttp.ClientTimeout(total=10)) as resp:
                    if resp.status != 200:
                        return []
                    data = await resp.json()
                    models = data.get("data", [])
                    return [{"id": m.get("id", ""), "name": m.get("id", ""), "loaded": True} for m in models if m.get("id")]
        except Exception as e:
            print(f"[Ollama] Error listing models: {e}")
            return []

    async def ensure_model_loaded(self, model_name: str) -> bool:
        models = await self.list_models()
        model_ids = [m["id"] for m in models]
        if model_name in model_ids:
            print(f"[Ollama] Model '{model_name}' already available.")
            return True
        # Ollama auto-pulls on first use via /v1/chat/completions, but we can trigger it explicitly
        print(f"[Ollama] Model '{model_name}' not found locally. It will be pulled on first use.")
        return True  # Let Ollama handle the pull


class OpenAICompatibleBackend(LLMBackend):
    """Generic OpenAI-compatible API backend (OpenAI, Groq, Together, Deepseek, etc.)."""

    def __init__(self, base_url_override: str = None, api_key_override: str = None):
        self._base_url_override = base_url_override
        self._api_key_override = api_key_override

    @property
    def name(self) -> str:
        return config.LLM_BACKEND_TITLE or "OpenAI-compatible"

    @property
    def base_url(self) -> str:
        if self._base_url_override:
            return self._base_url_override.rstrip("/")
        return config.get_effective_base_url()

    def supports_context_length(self) -> bool:
        return False

    def build_headers(self) -> Dict[str, str]:
        headers = {"Content-Type": "application/json"}
        api_key = self._api_key_override or config.LLM_API_KEY
        if api_key:
            headers["Authorization"] = f"Bearer {api_key}"
        return headers

    def build_payload(self, model: str, messages: List[Dict], temperature: float,
                      use_tools: bool = False, tools: list = None,
                      stream: bool = False, context_length: int = None) -> Dict:
        payload = {
            "model": model,
            "messages": messages,
            "temperature": temperature,
        }
        if stream:
            payload["stream"] = True
        if use_tools and tools:
            payload["tools"] = tools
            payload["tool_choice"] = "auto"
        return payload

    async def health_check(self) -> bool:
        try:
            async with aiohttp.ClientSession() as session:
                async with session.get(self.get_models_url(), headers=self.build_headers(), timeout=aiohttp.ClientTimeout(total=10)) as resp:
                    return resp.status == 200
        except Exception:
            return False

    async def list_models(self) -> List[Dict[str, Any]]:
        try:
            async with aiohttp.ClientSession() as session:
                async with session.get(self.get_models_url(), headers=self.build_headers(), timeout=aiohttp.ClientTimeout(total=10)) as resp:
                    if resp.status != 200:
                        return []
                    data = await resp.json()
                    models = data.get("data", [])
                    return [{"id": m.get("id", ""), "name": m.get("id", ""), "loaded": True} for m in models if m.get("id")]
        except Exception as e:
            print(f"[OpenAI-compatible] Error listing models: {e}")
            return []

    async def ensure_model_loaded(self, model_name: str) -> bool:
        # Cloud backends don't need model loading
        return True


# ---------------------------------------------------------------------------
# Backend Factory
# ---------------------------------------------------------------------------

_backend_instance: Optional[LLMBackend] = None


def get_backend(base_url_override: str = None, api_key_override: str = None) -> LLMBackend:
    """Get or create the active LLM backend based on config.

    Args:
        base_url_override: If provided, use this URL instead of config (for setup detection).
        api_key_override: If provided, use this key instead of config (for setup detection).
    """
    global _backend_instance
    # When using overrides, always create a fresh instance (don't cache)
    if base_url_override or api_key_override:
        return _create_backend_instance(base_url_override=base_url_override, api_key_override=api_key_override)
    backend_type = getattr(config, "LLM_BACKEND", "lmstudio").lower()
    if _backend_instance is None or _backend_instance.name.lower().replace(" ", "") != backend_type.replace(" ", ""):
        _backend_instance = _create_backend_instance()
    return _backend_instance


def _create_backend_instance(base_url_override: str = None, api_key_override: str = None) -> LLMBackend:
    """Create a backend instance based on config or overrides."""
    backend_type = getattr(config, "LLM_BACKEND", "lmstudio").lower()
    if base_url_override:
        # During setup detection, infer backend type from the override URL
        url = base_url_override.lower()
        if "11434" in url or "ollama" in url:
            backend_type = "ollama"
        elif "8000" in url or "vllm" in url:
            backend_type = "vllm"
        elif "lmstudio" in url or "1234" in url:
            backend_type = "lmstudio"
    if backend_type == "none":
        return None
    if backend_type == "ollama":
        return OllamaBackend(base_url_override=base_url_override)
    elif backend_type in ("openai", "groq", "together", "deepseek", "custom", "vllm"):
        return OpenAICompatibleBackend(base_url_override=base_url_override, api_key_override=api_key_override)
    else:
        return LMStudioBackend(base_url_override=base_url_override)


def reset_backend():
    """Force re-creation of the backend on next get_backend() call."""
    global _backend_instance
    _backend_instance = None
