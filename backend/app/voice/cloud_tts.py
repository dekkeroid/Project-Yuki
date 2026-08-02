"""
cloud_tts.py — Cloud and Custom TTS provider implementations.

Each provider exposes a single async function:
    synthesize(text, voice, rate) -> bytes  (WAV or MP3 bytes)

Supported providers:
  google       — Google Cloud Text-to-Speech v1 (REST, LINEAR16 WAV output)
  azure        — Azure Cognitive Services TTS (REST, WAV output)
  elevenlabs   — ElevenLabs (REST, MP3 → WAV conversion)
  openai       — OpenAI TTS API (MP3 → WAV conversion)
  custom       — User-supplied endpoint (POST JSON, receive audio bytes)

On failure, TTSProviderError is raised.  The caller (main.py) catches it and
returns a special sentinel response so the frontend can fall back to the
browser's speechSynthesis API.
"""

from __future__ import annotations
import asyncio
import io
import json
import urllib.request
import urllib.error
from typing import Optional


class TTSProviderError(Exception):
    """Raised when a cloud/custom TTS provider fails to synthesise audio."""
    pass


# Sentinel returned by the caller so the frontend knows to use browser TTS
WEB_TTS_FALLBACK_SENTINEL = "__WEB_TTS_FALLBACK__"


# ─────────────────────────────────────────────────────────────────────────────
# Google Cloud Text-to-Speech v1 (REST)
# ─────────────────────────────────────────────────────────────────────────────

async def synthesize_google(
    text: str,
    api_key: str,
    voice_name: str = "en-US-Standard-C",
    speaking_rate: float = 1.0,
) -> bytes:
    """
    Synthesize speech using Google Cloud TTS v1 REST API.
    Free tier: 1 million characters/month for Standard voices.
    Docs: https://cloud.google.com/text-to-speech/docs/reference/rest/v1/text/synthesize
    Returns WAV bytes.
    """
    import base64

    lang_code = _extract_lang_code(voice_name)
    payload = json.dumps({
        "input": {"text": text[:5000]},
        "voice": {"languageCode": lang_code, "name": voice_name},
        "audioConfig": {
            "audioEncoding": "LINEAR16",
            "speakingRate": max(0.25, min(4.0, speaking_rate)),
        },
    }).encode("utf-8")

    url = f"https://texttospeech.googleapis.com/v1/text:synthesize?key={api_key}"
    req = urllib.request.Request(
        url, data=payload,
        headers={"Content-Type": "application/json"},
        method="POST"
    )
    try:
        def _do():
            with urllib.request.urlopen(req, timeout=20) as resp:
                return json.loads(resp.read().decode("utf-8"))
        data = await asyncio.to_thread(_do)
        audio_b64 = data.get("audioContent", "")
        if not audio_b64:
            raise TTSProviderError("Google TTS returned empty audio content.")
        raw = base64.b64decode(audio_b64)
        return _pcm_to_wav(raw) if not raw[:4] == b"RIFF" else raw
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", errors="replace")
        raise TTSProviderError(f"Google TTS error {e.code}: {body[:200]}") from e
    except TTSProviderError:
        raise
    except Exception as e:
        raise TTSProviderError(f"Could not reach Google TTS service: {e}") from e


# ─────────────────────────────────────────────────────────────────────────────
# Azure Cognitive Services Text-to-Speech (REST)
# ─────────────────────────────────────────────────────────────────────────────

async def synthesize_azure(
    text: str,
    api_key: str,
    region: str = "eastus",
    voice_name: str = "en-US-AriaNeural",
    speaking_rate: float = 1.0,
) -> bytes:
    """
    Synthesize speech using Azure TTS REST API (SSML, WAV output).
    Free tier: 0.5 million characters/month for Neural voices.
    Docs: https://learn.microsoft.com/en-us/azure/ai-services/speech-service/rest-text-to-speech
    """
    rate_pct = int((speaking_rate - 1.0) * 100)
    rate_str = f"+{rate_pct}%" if rate_pct >= 0 else f"{rate_pct}%"
    lang_code = _extract_lang_code(voice_name)
    ssml = (
        f'<speak version="1.0" xml:lang="{lang_code}">'
        f'<voice xml:lang="{lang_code}" name="{voice_name}">'
        f'<prosody rate="{rate_str}">{_xml_escape(text[:5000])}</prosody>'
        f"</voice></speak>"
    ).encode("utf-8")

    url = f"https://{region}.tts.speech.microsoft.com/cognitiveservices/v1"
    req = urllib.request.Request(
        url, data=ssml,
        headers={
            "Ocp-Apim-Subscription-Key": api_key,
            "Content-Type": "application/ssml+xml",
            "X-Microsoft-OutputFormat": "riff-24khz-16bit-mono-pcm",
        },
        method="POST"
    )
    try:
        def _do():
            with urllib.request.urlopen(req, timeout=20) as resp:
                return resp.read()
        wav_bytes = await asyncio.to_thread(_do)
        return wav_bytes
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", errors="replace")
        raise TTSProviderError(f"Azure TTS error {e.code}: {body[:200]}") from e
    except Exception as e:
        raise TTSProviderError(f"Could not reach Azure TTS service: {e}") from e


# ─────────────────────────────────────────────────────────────────────────────
# ElevenLabs
# ─────────────────────────────────────────────────────────────────────────────

async def synthesize_elevenlabs(
    text: str,
    api_key: str,
    voice_id: str = "21m00Tcm4TlvDq8ikWAM",  # Rachel — ElevenLabs default
    speaking_rate: float = 1.0,
) -> bytes:
    """
    Synthesize speech using ElevenLabs API (MP3 output → converted to WAV).
    Free tier: 10 000 characters/month.
    Docs: https://elevenlabs.io/docs/api-reference/text-to-speech
    """
    payload = json.dumps({
        "text": text[:5000],
        "model_id": "eleven_monolingual_v1",
        "voice_settings": {
            "stability": 0.5,
            "similarity_boost": 0.75,
            "speed": max(0.7, min(1.2, speaking_rate)),
        },
    }).encode("utf-8")

    url = f"https://api.elevenlabs.io/v1/text-to-speech/{voice_id}"
    req = urllib.request.Request(
        url, data=payload,
        headers={
            "xi-api-key": api_key,
            "Content-Type": "application/json",
            "Accept": "audio/mpeg",
        },
        method="POST"
    )
    try:
        def _do():
            with urllib.request.urlopen(req, timeout=25) as resp:
                return resp.read()
        mp3_bytes = await asyncio.to_thread(_do)
        return _mp3_to_wav(mp3_bytes)
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", errors="replace")
        raise TTSProviderError(f"ElevenLabs TTS error {e.code}: {body[:200]}") from e
    except Exception as e:
        raise TTSProviderError(f"Could not reach ElevenLabs service: {e}") from e


# ─────────────────────────────────────────────────────────────────────────────
# OpenAI TTS
# ─────────────────────────────────────────────────────────────────────────────

async def synthesize_openai(
    text: str,
    api_key: str,
    voice: str = "nova",
    speaking_rate: float = 1.0,
    base_url: str = "https://api.openai.com/v1",
) -> bytes:
    """
    Synthesize speech using OpenAI TTS API (MP3 → WAV).
    Free tier: None, but pay-per-character.
    Voices: alloy, echo, fable, onyx, nova, shimmer.
    Docs: https://platform.openai.com/docs/guides/text-to-speech
    """
    speed = max(0.25, min(4.0, speaking_rate))
    payload = json.dumps({
        "model": "tts-1",
        "input": text[:4096],
        "voice": voice,
        "speed": speed,
        "response_format": "mp3",
    }).encode("utf-8")

    url = f"{base_url.rstrip('/')}/audio/speech"
    req = urllib.request.Request(
        url, data=payload,
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        },
        method="POST"
    )
    try:
        def _do():
            with urllib.request.urlopen(req, timeout=25) as resp:
                return resp.read()
        mp3_bytes = await asyncio.to_thread(_do)
        return _mp3_to_wav(mp3_bytes)
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", errors="replace")
        raise TTSProviderError(f"OpenAI TTS error {e.code}: {body[:200]}") from e
    except Exception as e:
        raise TTSProviderError(f"Could not reach OpenAI TTS service: {e}") from e


# ─────────────────────────────────────────────────────────────────────────────
# Custom — user-supplied endpoint
# ─────────────────────────────────────────────────────────────────────────────

async def synthesize_custom(
    text: str,
    endpoint: str,
    api_key: str = "",
    voice: str = "",
    speaking_rate: float = 1.0,
) -> bytes:
    """
    POST JSON to a user-supplied endpoint and receive audio bytes.
    Request body: {"text": "...", "voice": "...", "speed": 1.0}
    Response: raw audio bytes (WAV or MP3).
    """
    if not endpoint:
        raise TTSProviderError("Custom TTS endpoint URL is not configured.")

    payload = json.dumps({
        "text": text[:5000],
        "voice": voice,
        "speed": speaking_rate,
    }).encode("utf-8")
    headers: dict = {"Content-Type": "application/json"}
    if api_key:
        headers["Authorization"] = f"Bearer {api_key}"

    req = urllib.request.Request(endpoint, data=payload, headers=headers, method="POST")
    try:
        def _do():
            with urllib.request.urlopen(req, timeout=25) as resp:
                content_type = resp.headers.get("Content-Type", "")
                body = resp.read()
                return body, content_type
        audio_bytes, content_type = await asyncio.to_thread(_do)
        if "mpeg" in content_type or "mp3" in content_type:
            return _mp3_to_wav(audio_bytes)
        return audio_bytes  # Assume WAV
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", errors="replace")
        raise TTSProviderError(f"Custom TTS endpoint error {e.code}: {body[:200]}") from e
    except Exception as e:
        raise TTSProviderError(f"Could not reach custom TTS endpoint: {e}") from e


# ─────────────────────────────────────────────────────────────────────────────
# Dispatcher — called by the TTS endpoint
# ─────────────────────────────────────────────────────────────────────────────

async def synthesize_via_cloud_provider(
    text: str,
    provider: str,
    api_key: str,
    endpoint: str = "",
    region: str = "eastus",
    voice: str = "",
    speaking_rate: float = 1.0,
) -> bytes:
    """
    Dispatch synthesis to the configured cloud/custom TTS provider.
    Raises TTSProviderError on any failure.
    """
    provider = (provider or "local").lower().strip()

    if provider == "google":
        voice_name = voice or "en-US-Standard-C"
        return await synthesize_google(text, api_key, voice_name=voice_name, speaking_rate=speaking_rate)
    elif provider == "azure":
        voice_name = voice or "en-US-AriaNeural"
        return await synthesize_azure(text, api_key, region=region, voice_name=voice_name, speaking_rate=speaking_rate)
    elif provider == "elevenlabs":
        voice_id = voice or "21m00Tcm4TlvDq8ikWAM"
        return await synthesize_elevenlabs(text, api_key, voice_id=voice_id, speaking_rate=speaking_rate)
    elif provider == "openai":
        voice_name = voice or "nova"
        return await synthesize_openai(text, api_key, voice=voice_name, speaking_rate=speaking_rate)
    elif provider == "custom":
        return await synthesize_custom(text, endpoint, api_key=api_key, voice=voice, speaking_rate=speaking_rate)
    else:
        raise TTSProviderError(f"Unknown TTS provider: '{provider}'")


# ─────────────────────────────────────────────────────────────────────────────
# Helpers
# ─────────────────────────────────────────────────────────────────────────────

def _extract_lang_code(voice_name: str) -> str:
    """Extract BCP-47 language code from a voice name like 'en-US-Standard-C'."""
    parts = voice_name.split("-")
    if len(parts) >= 2:
        return f"{parts[0]}-{parts[1]}"
    return "en-US"


def _xml_escape(text: str) -> str:
    return (
        text.replace("&", "&amp;")
            .replace("<", "&lt;")
            .replace(">", "&gt;")
            .replace('"', "&quot;")
    )


def _pcm_to_wav(raw_pcm: bytes, sample_rate: int = 24000, channels: int = 1, sample_width: int = 2) -> bytes:
    """Wrap raw 16-bit PCM bytes in a WAV container."""
    import struct
    data_size = len(raw_pcm)
    header = struct.pack(
        "<4sI4s4sIHHIIHH4sI",
        b"RIFF", 36 + data_size, b"WAVE",
        b"fmt ", 16, 1, channels,
        sample_rate, sample_rate * channels * sample_width,
        channels * sample_width, sample_width * 8,
        b"data", data_size,
    )
    return header + raw_pcm


def _mp3_to_wav(mp3_bytes: bytes) -> bytes:
    """Convert MP3 bytes to WAV using pydub (if available) or return as-is."""
    try:
        from pydub import AudioSegment
        seg = AudioSegment.from_mp3(io.BytesIO(mp3_bytes))
        buf = io.BytesIO()
        seg.export(buf, format="wav")
        return buf.getvalue()
    except ImportError:
        # pydub not installed — return MP3; frontend can handle it
        return mp3_bytes
    except Exception:
        return mp3_bytes
