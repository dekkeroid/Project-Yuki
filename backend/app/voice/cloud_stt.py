"""
cloud_stt.py — Cloud and Custom STT provider implementations.

Each provider exposes a single async function:
    transcribe(audio_bytes: bytes, language: str) -> str

Supported providers:
  google       — Google Cloud Speech-to-Text v1 (REST)
  azure        — Azure Cognitive Services Speech (REST)
  assemblyai   — AssemblyAI (REST, free-tier available)
  deepgram     — Deepgram Nova (REST, free-tier available)
  custom       — User-supplied endpoint (POST audio, receive JSON {"text": "..."})

STT has NO fallback on failure — a STTProviderError is raised with a user-friendly
message that the caller should surface to the frontend.
"""

from __future__ import annotations
import asyncio
import json
import os
import tempfile
from typing import Optional


class STTProviderError(Exception):
    """Raised when a cloud/custom STT provider fails to transcribe."""
    pass


# ─────────────────────────────────────────────────────────────────────────────
# Google Cloud Speech-to-Text v1 (REST)
# ─────────────────────────────────────────────────────────────────────────────

async def transcribe_google(audio_bytes: bytes, api_key: str, language: str = "en-US") -> str:
    """
    Transcribe using Google Cloud Speech-to-Text v1 REST API.
    Free tier: 60 minutes/month for standard models.
    Docs: https://cloud.google.com/speech-to-text/docs/reference/rest/v1/speech/recognize
    """
    import base64
    import urllib.request
    import urllib.error

    lang_code = _normalize_language_bcp47(language)
    audio_b64 = base64.b64encode(audio_bytes).decode("ascii")
    payload = json.dumps({
        "config": {
            "encoding": "WEBM_OPUS",
            "languageCode": lang_code,
            "model": "latest_short",
            "enableAutomaticPunctuation": True,
        },
        "audio": {"content": audio_b64}
    }).encode("utf-8")

    url = f"https://speech.googleapis.com/v1/speech:recognize?key={api_key}"
    req = urllib.request.Request(
        url, data=payload,
        headers={"Content-Type": "application/json"},
        method="POST"
    )
    try:
        def _do_request():
            with urllib.request.urlopen(req, timeout=20) as resp:
                return json.loads(resp.read().decode("utf-8"))
        data = await asyncio.to_thread(_do_request)
        results = data.get("results", [])
        if not results:
            return ""
        return " ".join(
            r.get("alternatives", [{}])[0].get("transcript", "")
            for r in results
        ).strip()
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", errors="replace")
        raise STTProviderError(f"Google STT error {e.code}: {body[:200]}") from e
    except Exception as e:
        raise STTProviderError(f"Could not reach Google STT service: {e}") from e


# ─────────────────────────────────────────────────────────────────────────────
# Azure Cognitive Services — Speech REST API
# ─────────────────────────────────────────────────────────────────────────────

async def transcribe_azure(
    audio_bytes: bytes,
    api_key: str,
    region: str = "eastus",
    language: str = "en-US"
) -> str:
    """
    Transcribe using Azure Speech REST API (batch recognition).
    Free tier: 5 hours/month.
    Docs: https://learn.microsoft.com/en-us/azure/ai-services/speech-service/rest-speech-to-text
    """
    import urllib.request
    import urllib.error

    lang_code = _normalize_language_bcp47(language)
    url = (
        f"https://{region}.stt.speech.microsoft.com/speech/recognition/conversation"
        f"/cognitiveservices/v1?language={lang_code}&format=simple"
    )
    req = urllib.request.Request(
        url, data=audio_bytes,
        headers={
            "Ocp-Apim-Subscription-Key": api_key,
            "Content-Type": "audio/webm; codecs=opus",
            "Accept": "application/json",
        },
        method="POST"
    )
    try:
        def _do_request():
            with urllib.request.urlopen(req, timeout=20) as resp:
                return json.loads(resp.read().decode("utf-8"))
        data = await asyncio.to_thread(_do_request)
        return data.get("DisplayText", "").strip()
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", errors="replace")
        raise STTProviderError(f"Azure STT error {e.code}: {body[:200]}") from e
    except Exception as e:
        raise STTProviderError(f"Could not reach Azure STT service: {e}") from e


# ─────────────────────────────────────────────────────────────────────────────
# AssemblyAI — free-tier friendly
# ─────────────────────────────────────────────────────────────────────────────

async def transcribe_assemblyai(audio_bytes: bytes, api_key: str, language: str = "en") -> str:
    """
    Transcribe using AssemblyAI (upload → submit → poll).
    Free tier: up to 100 hours/month with credits.
    Docs: https://www.assemblyai.com/docs/getting-started
    """
    import urllib.request
    import urllib.error
    import time

    headers = {"authorization": api_key, "content-type": "application/json"}

    def _upload():
        req = urllib.request.Request(
            "https://api.assemblyai.com/v2/upload",
            data=audio_bytes,
            headers={"authorization": api_key},
            method="POST"
        )
        with urllib.request.urlopen(req, timeout=30) as resp:
            return json.loads(resp.read().decode("utf-8"))["upload_url"]

    def _submit(upload_url):
        payload = json.dumps({"audio_url": upload_url}).encode("utf-8")
        req = urllib.request.Request(
            "https://api.assemblyai.com/v2/transcript",
            data=payload,
            headers={**headers},
            method="POST"
        )
        with urllib.request.urlopen(req, timeout=15) as resp:
            return json.loads(resp.read().decode("utf-8"))["id"]

    def _poll(transcript_id):
        url = f"https://api.assemblyai.com/v2/transcript/{transcript_id}"
        for _ in range(30):  # max ~30s
            req = urllib.request.Request(url, headers={"authorization": api_key})
            with urllib.request.urlopen(req, timeout=10) as resp:
                data = json.loads(resp.read().decode("utf-8"))
            status = data.get("status")
            if status == "completed":
                return data.get("text", "")
            if status == "error":
                raise STTProviderError(f"AssemblyAI error: {data.get('error', 'unknown')}")
            time.sleep(1)
        raise STTProviderError("AssemblyAI transcription timed out after 30s.")

    try:
        upload_url = await asyncio.to_thread(_upload)
        transcript_id = await asyncio.to_thread(_submit, upload_url)
        text = await asyncio.to_thread(_poll, transcript_id)
        return text.strip()
    except STTProviderError:
        raise
    except Exception as e:
        raise STTProviderError(f"Could not reach AssemblyAI service: {e}") from e


# ─────────────────────────────────────────────────────────────────────────────
# Deepgram Nova — fast & accurate
# ─────────────────────────────────────────────────────────────────────────────

async def transcribe_deepgram(audio_bytes: bytes, api_key: str, language: str = "en") -> str:
    """
    Transcribe using Deepgram Nova-3 (REST).
    Free tier: $200 credit on sign-up (~hundreds of hours).
    Docs: https://developers.deepgram.com/docs/getting-started-with-pre-recorded-audio
    """
    import urllib.request
    import urllib.error

    lang = language.split("-")[0].lower() if "-" in language else language.lower()
    url = f"https://api.deepgram.com/v1/listen?model=nova-3&language={lang}&punctuate=true"
    req = urllib.request.Request(
        url, data=audio_bytes,
        headers={
            "Authorization": f"Token {api_key}",
            "Content-Type": "audio/webm",
        },
        method="POST"
    )
    try:
        def _do_request():
            with urllib.request.urlopen(req, timeout=20) as resp:
                return json.loads(resp.read().decode("utf-8"))
        data = await asyncio.to_thread(_do_request)
        channels = data.get("results", {}).get("channels", [])
        if not channels:
            return ""
        alts = channels[0].get("alternatives", [])
        if not alts:
            return ""
        return alts[0].get("transcript", "").strip()
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", errors="replace")
        raise STTProviderError(f"Deepgram STT error {e.code}: {body[:200]}") from e
    except Exception as e:
        raise STTProviderError(f"Could not reach Deepgram service: {e}") from e


# ─────────────────────────────────────────────────────────────────────────────
# Custom — user-supplied endpoint
# ─────────────────────────────────────────────────────────────────────────────

async def transcribe_custom(
    audio_bytes: bytes,
    endpoint: str,
    api_key: str = "",
    language: str = "en"
) -> str:
    """
    POST audio bytes to a user-supplied endpoint.
    Expected response: JSON with a "text" key, e.g. {"text": "Hello world"}.
    The Authorization header is set to Bearer {api_key} if api_key is non-empty.
    """
    import urllib.request
    import urllib.error

    if not endpoint:
        raise STTProviderError("Custom STT endpoint URL is not configured.")

    headers: dict = {"Content-Type": "audio/webm"}
    if api_key:
        headers["Authorization"] = f"Bearer {api_key}"

    req = urllib.request.Request(endpoint, data=audio_bytes, headers=headers, method="POST")
    try:
        def _do_request():
            with urllib.request.urlopen(req, timeout=20) as resp:
                return json.loads(resp.read().decode("utf-8"))
        data = await asyncio.to_thread(_do_request)
        return str(data.get("text", "")).strip()
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", errors="replace")
        raise STTProviderError(f"Custom STT endpoint error {e.code}: {body[:200]}") from e
    except Exception as e:
        raise STTProviderError(f"Could not reach custom STT endpoint: {e}") from e


# ─────────────────────────────────────────────────────────────────────────────
# Dispatcher — called by the main transcribe endpoint
# ─────────────────────────────────────────────────────────────────────────────

async def transcribe_via_cloud_provider(
    audio_bytes: bytes,
    provider: str,
    api_key: str,
    endpoint: str = "",
    region: str = "eastus",
    language: str = "en",
) -> str:
    """
    Dispatch transcription to the configured cloud/custom STT provider.
    Raises STTProviderError on any failure (no local fallback).
    """
    provider = (provider or "local").lower().strip()

    if provider == "google":
        return await transcribe_google(audio_bytes, api_key, language=language)
    elif provider == "azure":
        return await transcribe_azure(audio_bytes, api_key, region=region, language=language)
    elif provider == "assemblyai":
        return await transcribe_assemblyai(audio_bytes, api_key, language=language)
    elif provider == "deepgram":
        return await transcribe_deepgram(audio_bytes, api_key, language=language)
    elif provider == "custom":
        return await transcribe_custom(audio_bytes, endpoint, api_key=api_key, language=language)
    else:
        raise STTProviderError(f"Unknown STT provider: '{provider}'")


# ─────────────────────────────────────────────────────────────────────────────
# Helpers
# ─────────────────────────────────────────────────────────────────────────────

def _normalize_language_bcp47(language: str) -> str:
    """Ensure language is in BCP-47 format (e.g. 'en' → 'en-US')."""
    if not language or language == "auto":
        return "en-US"
    if "-" in language:
        return language  # Already BCP-47
    _defaults = {
        "en": "en-US", "fr": "fr-FR", "de": "de-DE", "es": "es-ES",
        "ja": "ja-JP", "zh": "zh-CN", "ko": "ko-KR", "pt": "pt-BR",
        "it": "it-IT", "ru": "ru-RU", "ar": "ar-SA", "hi": "hi-IN",
    }
    return _defaults.get(language.lower(), f"{language}-{language.upper()}")
