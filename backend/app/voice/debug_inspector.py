import os
import json
import time
import wave
import threading
from pathlib import Path
from typing import Optional, List, Dict, Any
import numpy as np

from app import config

DEBUG_AUDIO_DIR = config.BASE_DIR / "debug_audio"
MANIFEST_FILE = DEBUG_AUDIO_DIR / "debug_manifest.json"
MAX_SAVED_TURNS = 5

_inspector_lock = threading.Lock()
_turn_counter = 0

def _ensure_dir():
    os.makedirs(DEBUG_AUDIO_DIR, exist_ok=True)

def _load_manifest() -> List[Dict[str, Any]]:
    _ensure_dir()
    if not os.path.exists(MANIFEST_FILE):
        return []
    try:
        with open(MANIFEST_FILE, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return []

def _save_manifest(turns: List[Dict[str, Any]]):
    _ensure_dir()
    try:
        with open(MANIFEST_FILE, "w", encoding="utf-8") as f:
            json.dump(turns, f, indent=2, ensure_ascii=False)
    except Exception as e:
        print(f"[STT-INSPECTOR] Failed to save manifest: {e}")

def record_debug_turn(
    raw_bytes: Optional[bytes],
    silero_audio: Optional[np.ndarray],
    transcript: str,
    whisper_ms: float,
    model: str,
    raw_duration_ms: Optional[float] = None,
    sample_rate: int = 16000
) -> Dict[str, Any]:
    """
    Saves both the raw browser WebM and the Silero VAD cleaned 16kHz WAV audio,
    rotating out older turns to keep only the last MAX_SAVED_TURNS.
    """
    global _turn_counter
    with _inspector_lock:
        _ensure_dir()
        turns = _load_manifest()
        
        # Determine next turn ID
        if turns:
            highest_id = max(t.get("turn_id", 0) for t in turns)
            _turn_counter = max(_turn_counter, highest_id)
        _turn_counter += 1
        turn_id = _turn_counter

        now_str = time.strftime("%Y-%m-%d %H:%M:%S")
        time_short = time.strftime("%H:%M:%S")

        raw_filename = f"turn_{turn_id}_raw.webm"
        silero_filename = f"turn_{turn_id}_silero.wav"

        raw_path = DEBUG_AUDIO_DIR / raw_filename
        silero_path = DEBUG_AUDIO_DIR / silero_filename

        raw_size = 0
        if raw_bytes:
            try:
                with open(raw_path, "wb") as f:
                    f.write(raw_bytes)
                raw_size = len(raw_bytes)
            except Exception as e:
                print(f"[STT-INSPECTOR] Could not save raw WebM: {e}")

        silero_size = 0
        silero_duration_ms = 0.0
        has_silero = False
        if silero_audio is not None and len(silero_audio) > 0:
            try:
                # Convert float32 [-1.0, 1.0] to int16 PCM
                int16_audio = (np.clip(silero_audio, -1.0, 1.0) * 32767).astype(np.int16)
                with wave.open(str(silero_path), "wb") as wf:
                    wf.setnchannels(1)
                    wf.setsampwidth(2)
                    wf.setframerate(sample_rate)
                    wf.writeframes(int16_audio.tobytes())
                silero_size = os.path.getsize(silero_path)
                silero_duration_ms = round((len(silero_audio) / sample_rate) * 1000, 1)
                has_silero = True
            except Exception as e:
                print(f"[STT-INSPECTOR] Could not save Silero WAV: {e}")

        entry = {
            "turn_id": turn_id,
            "timestamp": now_str,
            "time_short": time_short,
            "transcript": transcript or "",
            "is_empty": not bool(transcript and transcript.strip()),
            "whisper_ms": round(whisper_ms, 1),
            "model": model,
            "raw_file": raw_filename if raw_size > 0 else None,
            "raw_size_bytes": raw_size,
            "raw_duration_ms": raw_duration_ms,
            "silero_file": silero_filename if has_silero else None,
            "silero_size_bytes": silero_size,
            "silero_duration_ms": silero_duration_ms,
        }

        # Keep newest at the top
        turns.insert(0, entry)

        # Prune old turns beyond MAX_SAVED_TURNS
        while len(turns) > MAX_SAVED_TURNS:
            old_turn = turns.pop()
            if old_turn.get("raw_file"):
                p = DEBUG_AUDIO_DIR / old_turn["raw_file"]
                if os.path.exists(p):
                    try: os.remove(p)
                    except Exception: pass
            if old_turn.get("silero_file"):
                p = DEBUG_AUDIO_DIR / old_turn["silero_file"]
                if os.path.exists(p):
                    try: os.remove(p)
                    except Exception: pass

        _save_manifest(turns)
        print(f"[STT-INSPECTOR] Saved Turn #{turn_id} to audio inspector (Raw: {raw_size}B, Silero: {silero_duration_ms}ms, Transcript: '{transcript}')")
        return entry

def get_recent_turns() -> List[Dict[str, Any]]:
    """Returns the list of the last 5 turns."""
    with _inspector_lock:
        return _load_manifest()

def get_audio_file_path(filename: str) -> Optional[Path]:
    """Safely resolves an audio file inside DEBUG_AUDIO_DIR."""
    # Prevent path traversal
    safe_name = os.path.basename(filename)
    path = DEBUG_AUDIO_DIR / safe_name
    if os.path.exists(path) and path.is_file():
        return path
    return None
