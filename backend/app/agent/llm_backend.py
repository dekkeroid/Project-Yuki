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
        url = self.base_url.rstrip("/")
        if url.endswith("/chat/completions"):
            return url
        if url.endswith("/v1") or "/v1/" in url or url.endswith("/v1beta/openai"):
            return f"{url}/chat/completions"
        return f"{url}/v1/chat/completions"

    def get_models_url(self) -> str:
        """Get the models listing endpoint URL."""
        url = self.base_url.rstrip("/")
        if url.endswith("/models"):
            return url
        if url.endswith("/v1") or "/v1/" in url or url.endswith("/v1beta/openai"):
            return f"{url}/models"
        return f"{url}/v1/models"

    async def unload_model(self, model_name: str) -> bool:
        """Unload a model from memory. Default: no-op. Override in backends that support it."""
        return True

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
        url = self.get_models_url()
        print(f"[LMStudio][list_models] Fetching {url}")
        try:
            async with aiohttp.ClientSession() as session:
                async with session.get(url, timeout=aiohttp.ClientTimeout(total=10)) as resp:
                    print(f"[LMStudio][list_models] HTTP {resp.status}")
                    if resp.status != 200:
                        body_preview = (await resp.text())[:300]
                        print(f"[LMStudio][list_models] Non-200 body: {body_preview}")
                        return []
                    data = await resp.json()
                    models = data.get("data", [])
                    if isinstance(data, dict) and not models:
                        models = data.get("models", [])
                    print(f"[LMStudio][list_models] Response keys: {list(data.keys()) if isinstance(data, dict) else 'not dict'}, models count: {len(models)}")
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
                    print(f"[LMStudio][list_models] Returning {len(result)} models: {[m['id'] for m in result]}")
                    return result
        except Exception as e:
            print(f"[LMStudio] Could not list models — {e}")
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

    async def unload_model(self, model_name: str) -> bool:
        try:
            async with aiohttp.ClientSession() as session:
                async with session.get(self.get_models_url(), timeout=aiohttp.ClientTimeout(total=5)) as resp:
                    if resp.status != 200:
                        return False
                    data = await resp.json()
                    available = data.get("data", [])
                    if isinstance(data, dict) and not available:
                        available = data.get("models", [])

                for m in available:
                    model_key = m.get("id") or m.get("key") or m.get("path") or ""
                    if model_name.lower() in model_key.lower():
                        is_loaded = (
                            m.get("loaded", False) is True or
                            m.get("state") == "loaded" or
                            bool(m.get("loaded_instances"))
                        )
                        if not is_loaded:
                            print(f"[LMStudio] Model '{model_name}' is not loaded.")
                            return True

                        async with session.post(
                            f"{self.base_url}/api/v1/models/unload",
                            json={"instance_id": model_key},
                            timeout=aiohttp.ClientTimeout(total=15),
                        ) as unload_resp:
                            if unload_resp.status == 200:
                                print(f"[LMStudio] Unloaded '{model_name}'")
                                return True
                            else:
                                body = await unload_resp.text()
                                print(f"[LMStudio] Unload failed for '{model_name}': HTTP {unload_resp.status}: {body}")
                                return False
                print(f"[LMStudio] Model '{model_name}' not found for unload.")
                return True
        except Exception as e:
            print(f"[LMStudio] Unload request failed: {e}")
            return False


class OllamaBackend(LLMBackend):
    """Ollama local server backend."""

    def __init__(self, base_url_override: str = None):
        self._base_url_override = base_url_override
        self._currently_loaded_model: Optional[str] = None

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
        url = self.get_models_url()
        print(f"[Ollama][list_models] Fetching {url}")
        try:
            async with aiohttp.ClientSession() as session:
                async with session.get(url, timeout=aiohttp.ClientTimeout(total=10)) as resp:
                    print(f"[Ollama][list_models] HTTP {resp.status}")
                    if resp.status != 200:
                        body_preview = (await resp.text())[:300]
                        print(f"[Ollama][list_models] Non-200 response body: {body_preview}")
                        return []
                    data = await resp.json()
                    models_raw = data.get("data", [])
                    print(f"[Ollama][list_models] 'data' key has {len(models_raw)} entries, full response keys: {list(data.keys())}")
                    models = [{"id": m.get("id", ""), "name": m.get("id", ""), "loaded": True} for m in models_raw if m.get("id")]
                    print(f"[Ollama][list_models] Returning {len(models)} models: {[m['id'] for m in models]}")
                    return models
        except Exception as e:
            print(f"[Ollama] Could not list models — {e}")
            return []

    async def unload_model(self, model_name: str) -> bool:
        try:
            async with aiohttp.ClientSession() as session:
                if model_name:
                    async with session.post(
                        f"{self.base_url}/api/generate",
                        json={"model": model_name, "prompt": "", "keep_alive": 0},
                        timeout=aiohttp.ClientTimeout(total=15),
                    ) as resp:
                        if resp.status == 200:
                            print(f"[Ollama] Unloaded '{model_name}' (keep_alive=0)")
                        else:
                            body = await resp.text()
                            print(f"[Ollama] Unload note for '{model_name}': HTTP {resp.status}: {body}")

                # Query /api/ps to unload any lingering loaded models except current target
                try:
                    async with session.get(
                        f"{self.base_url}/api/ps",
                        timeout=aiohttp.ClientTimeout(total=5)
                    ) as ps_resp:
                        if ps_resp.status == 200:
                            ps_data = await ps_resp.json()
                            running_models = ps_data.get("models", [])
                            for m in running_models:
                                m_name = m.get("name") or m.get("model")
                                if m_name and m_name != model_name:
                                    print(f"[Ollama] Unloading lingering model from RAM/VRAM: '{m_name}'")
                                    await session.post(
                                        f"{self.base_url}/api/generate",
                                        json={"model": m_name, "prompt": "", "keep_alive": 0},
                                        timeout=aiohttp.ClientTimeout(total=10)
                                    )
                except Exception as ps_err:
                    pass

                self._currently_loaded_model = None
                return True
        except Exception as e:
            print(f"[Ollama] Unload request failed for '{model_name}': {e}")
            return False

    async def ensure_model_loaded(self, model_name: str) -> bool:
        if self._currently_loaded_model == model_name:
            print(f"[Ollama] Model '{model_name}' already in memory.")
            return True
        try:
            if self._currently_loaded_model and self._currently_loaded_model != model_name:
                print(f"[Ollama] Preloading '{model_name}', unloading previous model '{self._currently_loaded_model}'...")
                await self.unload_model(self._currently_loaded_model)
            else:
                print(f"[Ollama] Preloading '{model_name}' with keep_alive=60m...")

            async with aiohttp.ClientSession() as session:
                async with session.post(
                    f"{self.base_url}/api/generate",
                    json={"model": model_name, "prompt": "", "keep_alive": "60m"},
                    timeout=aiohttp.ClientTimeout(total=300),
                ) as resp:
                    if resp.status == 200:
                        self._currently_loaded_model = model_name
                        print(f"[Ollama] Model '{model_name}' preloaded (keep_alive=60m)")
                        return True
                    else:
                        body = await resp.text()
                        print(f"[Ollama] Preload failed for '{model_name}': HTTP {resp.status}: {body}")
                        self._currently_loaded_model = None
                        return False
        except Exception as e:
            print(f"[Ollama] Preload failed for '{model_name}': {e}")
            self._currently_loaded_model = None
            return False


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

    _global_key_index: int = 0

    def get_api_key_pool(self) -> List[str]:
        raw_key = self._api_key_override or getattr(config, "LLM_CODER_API_KEY", None) or config.LLM_API_KEY or ""
        if not raw_key:
            return []
        keys = [k.strip() for k in re.split(r'[,;\s]+', str(raw_key)) if k.strip()]
        return keys

    def build_headers(self, key_index: Optional[int] = None) -> Dict[str, str]:
        headers = {"Content-Type": "application/json"}
        keys = self.get_api_key_pool()
        if keys:
            if key_index is None:
                idx = OpenAICompatibleBackend._global_key_index
                OpenAICompatibleBackend._global_key_index += 1
            else:
                idx = key_index
            selected_key = keys[idx % len(keys)]
            headers["Authorization"] = f"Bearer {selected_key}"
            print(f"[KeyPool] Request using rotated key {idx % len(keys) + 1}/{len(keys)} (...{selected_key[-6:]})")
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
        url = self.get_models_url()
        print(f"[OpenAI][list_models] Fetching {url}")
        try:
            async with aiohttp.ClientSession() as session:
                async with session.get(url, headers=self.build_headers(), timeout=aiohttp.ClientTimeout(total=10)) as resp:
                    print(f"[OpenAI][list_models] HTTP {resp.status}")
                    if resp.status != 200:
                        body_preview = (await resp.text())[:300]
                        print(f"[OpenAI][list_models] Non-200 body: {body_preview}")
                        return []
                    data = await resp.json()
                    models = data.get("data", [])
                    print(f"[OpenAI][list_models] Response keys: {list(data.keys()) if isinstance(data, dict) else 'not dict'}, 'data' count: {len(models)}")
                    result = [{"id": m.get("id", ""), "name": m.get("id", ""), "loaded": True} for m in models if m.get("id")]
                    print(f"[OpenAI][list_models] Returning {len(result)} models: {[m['id'] for m in result]}")
                    return result
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
