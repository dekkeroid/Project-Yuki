import os
import time
from pathlib import Path
import asyncio
import threading
from app import config

VOICE_DIR = Path(__file__).parent.resolve()
WHISPER_MODEL_DIR = VOICE_DIR / "whisper-base"

_whisper_instance = None
_current_model_size = None
_current_compute_type = None
_current_device = None

_whisper_lock = threading.RLock()

_last_stt_request_time = 0.0
STT_IDLE_TIMEOUT = 300.0  # 5 minutes

_whisper_loading = False
_whisper_using_gpu = False
_listening_mode_active = False

def set_whisper_loading(v: bool):
    """Mark whether the Whisper model is currently being loaded (used to hold off memory optimization)."""
    global _whisper_loading
    _whisper_loading = bool(v)

def is_whisper_loading() -> bool:
    return _whisper_loading

def set_listening_mode(active: bool):
    """Track whether the frontend microphone listening mode is active."""
    global _listening_mode_active
    _listening_mode_active = bool(active)
    if not active:
        # Reset the idle timer when listening mode is turned off, 
        # so the timeout countdown starts exactly from now.
        update_last_stt_time()

def is_listening_mode_active() -> bool:
    """True when the frontend mic is actively listening (whisper in active use)."""
    return _listening_mode_active

def is_whisper_on_gpu() -> bool:
    """True if the currently loaded Whisper model is running on CUDA (dedicated GPU)."""
    return _whisper_using_gpu and _whisper_instance is not None

def update_last_stt_time():
    global _last_stt_request_time
    _last_stt_request_time = time.time()

def get_last_stt_time():
    return _last_stt_request_time

def unload_whisper_if_idle(force: bool = False):
    global _whisper_instance, _current_model_size, _current_compute_type, _current_device, _whisper_using_gpu
    with _whisper_lock:
        if _whisper_instance is None:
            return
            
        if _listening_mode_active and not force:
            return # Never auto-unload while listening mode is active
            
        idle_time = time.time() - _last_stt_request_time
        if force or idle_time > config.WHISPER_IDLE_TIMEOUT:
            print(f"[STT] Whisper model unloaded ({'forced by memory pressure' if force else f'idle for {int(idle_time)}s'}).")
            _whisper_instance = None
            _current_model_size = None
            _current_compute_type = None
            _current_device = None
            _whisper_using_gpu = False
            import gc
            gc.collect()

def reset_whisper():
    """Clear the cached Whisper instance so the next call re-initializes with current config."""
    global _whisper_instance, _current_model_size, _current_compute_type, _current_device, _whisper_using_gpu
    with _whisper_lock:
        _whisper_instance = None
        _current_model_size = None
        _current_compute_type = None
        _current_device = None
        _whisper_using_gpu = False
        print("[STT] Whisper model cleared. Will re-initialize on next transcription request.")

def get_whisper_model(model_size: str = None, compute_type: str = "int8_float16") -> "WhisperModel":
    global _whisper_instance, _current_model_size, _current_compute_type, _current_device, _whisper_using_gpu

    with _whisper_lock:
        from faster_whisper import WhisperModel
        device_pref = getattr(config, "STT_DEVICE", "auto").lower()
        compute_pref = getattr(config, "WHISPER_COMPUTE_TYPE", compute_type) or compute_type

        if model_size is None:
            model_size = getattr(config, "WHISPER_MODEL", "base") or "base"
        
        # If model is already loaded and matches size, compute type, and device, return it
        if (_whisper_instance is not None 
                and _current_model_size == model_size 
                and _current_compute_type == compute_pref
                and _current_device == device_pref):
            return _whisper_instance
        
        # Determine actual device to use
        if device_pref == "cpu":
            actual_device = "cpu"
            actual_compute = "int8"
            print(f"[STT] Device set to CPU. Loading faster-whisper (CTranslate2) model '{model_size}' (int8)...")
        else:
            # auto or gpu: try CUDA first
            actual_device = "cuda"
            actual_compute = compute_pref
            print(f"[STT] Loading faster-whisper (CTranslate2) model '{model_size}' on GPU (CUDA, {compute_pref})...")

        try:
            _whisper_instance = WhisperModel(model_size, device=actual_device, compute_type=actual_compute)
            _current_model_size = model_size
            _current_compute_type = actual_compute
            _current_device = device_pref
            _whisper_using_gpu = (actual_device == "cuda")
            update_last_stt_time()
            print(f"[STT] faster-whisper (CTranslate2) model '{model_size}' loaded successfully on {actual_device.upper()} ({actual_compute}).")
        except Exception as e:
            if device_pref == "gpu":
                print(f"[STT] GPU load failed ({e}). GPU forced but unavailable. Falling back to CPU...")
            else:
                print(f"[STT] GPU load failed ({e}). Falling back to CPU (int8)...")
            try:
                _whisper_instance = WhisperModel(model_size, device="cpu", compute_type="int8")
                _current_model_size = model_size
                _current_compute_type = "int8"
                _current_device = device_pref
                _whisper_using_gpu = False
                update_last_stt_time()
                print(f"[STT] faster-whisper (CTranslate2) model '{model_size}' loaded successfully on CPU (int8).")
            except Exception as cpu_err:
                print(f"[STT] Failed to load Whisper model on CPU: {cpu_err}")
                if model_size != "base":
                    print("[STT] Falling back to 'base' Whisper model...")
                    return get_whisper_model("base", compute_type)
                raise cpu_err
            
        return _whisper_instance

import io
from typing import Union, BinaryIO

async def transcribe_audio_file(audio_input: Union[str, bytes, io.BytesIO], model_size: str = "base", compute_type: str = "int8_float16", language: str = "en") -> str:
    """
    Transcribes an audio file path or in-memory byte stream on a separate worker thread with low-latency beam_size=1 greedy decoding and Silero VAD.
    """
    update_last_stt_time()
    
    raw_bytes = None
    if isinstance(audio_input, str):
        if not os.path.exists(audio_input):
            print(f"[STT-DEBUG] Audio file path does not exist: {audio_input}")
            return ""
        whisper_input = audio_input
    elif isinstance(audio_input, bytes):
        if len(audio_input) < 1000:
            print(f"[STT-DEBUG] Raw bytes length ({len(audio_input)}) < 1000. Skipping.")
            return ""
        raw_bytes = audio_input
        whisper_input = io.BytesIO(audio_input)
    elif isinstance(audio_input, io.BytesIO):
        raw_bytes = audio_input.getvalue()
        whisper_input = audio_input
    else:
        whisper_input = audio_input

    def run_inference():
        try:
            t0 = time.time()
            active_compute = getattr(config, "WHISPER_COMPUTE_TYPE", compute_type) or compute_type
            active_model_size = getattr(config, "WHISPER_MODEL", model_size) or model_size
            model = get_whisper_model(active_model_size, active_compute)
            
            # Pre-probe container with PyAV to log stream diagnostics
            try:
                import av
                if isinstance(whisper_input, io.BytesIO):
                    whisper_input.seek(0)
                probe_container = av.open(whisper_input)
                audio_streams = [s for s in probe_container.streams if s.type == "audio"]
                stream_info = f"format='{probe_container.format.name}', streams={len(probe_container.streams)}, audio_streams={len(audio_streams)}"
                if audio_streams:
                    s0 = audio_streams[0]
                    stream_info += f", codec='{s0.codec_context.name if s0.codec_context else 'unknown'}', rate={s0.sample_rate}, channels={s0.channels}"
                probe_container.close()
                if isinstance(whisper_input, io.BytesIO):
                    whisper_input.seek(0)
                print(f"[STT-DEBUG] PyAV Container Probe: {stream_info}")
            except Exception as probe_err:
                print(f"[STT-DEBUG] PyAV Container Pre-probe warning: {probe_err}")
                if isinstance(whisper_input, io.BytesIO):
                    whisper_input.seek(0)

            whisper_prompt = (
                "Yuki, you can execute a command such as taking a screenshot, getting system stats, checking the current date or time, "
                "setting system volume, media playback control, running a terminal command, launching an application, searching files, "
                "listing directory, editing a file, deleting a file, system power control, or running a python script."
            )
            vad_params = dict(
                threshold=getattr(config, "SILERO_VAD_THRESHOLD", 0.5),
                min_speech_duration_ms=getattr(config, "SILERO_MIN_SPEECH_DURATION_MS", 150),
                min_silence_duration_ms=getattr(config, "SILERO_MIN_SILENCE_DURATION_MS", 400),
                speech_pad_ms=getattr(config, "SILERO_SPEECH_PAD_MS", 200)
            )

            # Extract exact Silero VAD cleaned audio array for the dual-stage inspector
            silero_audio_array = None
            try:
                import numpy as np
                from faster_whisper.audio import decode_audio
                from faster_whisper.vad import get_speech_timestamps, VadOptions
                if isinstance(whisper_input, io.BytesIO):
                    whisper_input.seek(0)
                pcm_audio = decode_audio(whisper_input, sampling_rate=16000)
                vad_opts = VadOptions(**vad_params)
                speech_chunks = get_speech_timestamps(pcm_audio, vad_opts)
                if speech_chunks:
                    silero_audio_array = np.concatenate([pcm_audio[c["start"]:c["end"]] for c in speech_chunks])
                if isinstance(whisper_input, io.BytesIO):
                    whisper_input.seek(0)
            except Exception as vad_extract_err:
                print(f"[STT-INSPECTOR] Silero extraction note: {vad_extract_err}")
                if isinstance(whisper_input, io.BytesIO):
                    whisper_input.seek(0)

            segments, info = model.transcribe(
                whisper_input,
                beam_size=getattr(config, "WHISPER_BEAM_SIZE", 1),
                vad_filter=True,
                vad_parameters=vad_params,
                condition_on_previous_text=getattr(config, "WHISPER_CONDITION_ON_PREVIOUS_TEXT", False),
                no_speech_threshold=getattr(config, "WHISPER_NO_SPEECH_THRESHOLD", 0.70),
                language=language if language != 'auto' else None,
                initial_prompt=whisper_prompt
            )
            
            # Combine segment text into a single transcript
            text = " ".join([segment.text for segment in segments]).strip()
            inference_ms = round((time.time() - t0) * 1000, 2)
            
            # Anti-hallucination post-filter for notorious Whisper YouTube artifacts
            lower_text = text.lower().strip(' .?!,"\'')
            hallucinations = [
                "thank you", "thanks for watching", "thank you for watching", 
                "thanks", "you", "thank you so much"
            ]
            if lower_text in hallucinations:
                print(f"[STT] Filtered known Whisper hallucination: '{text}'")
                text = ""

            # Record turn in 5-turn dual audio inspector
            try:
                from app.voice.debug_inspector import record_debug_turn
                record_debug_turn(
                    raw_bytes=raw_bytes,
                    silero_audio=silero_audio_array,
                    transcript=text,
                    whisper_ms=inference_ms,
                    model=active_model_size
                )
            except Exception as insp_err:
                print(f"[STT-INSPECTOR] Turn recording warning: {insp_err}")

            return {"text": text, "timing": {"whisper_ms": inference_ms}}
        except Exception as e:
            print(f"[STT] Whisper Transcription Error: {type(e).__name__}: {e}")
            # Record failed turn in inspector
            if raw_bytes:
                try:
                    from app.voice.debug_inspector import record_debug_turn
                    record_debug_turn(
                        raw_bytes=raw_bytes,
                        silero_audio=None,
                        transcript=f"[Decode Error: {type(e).__name__}]",
                        whisper_ms=0.0,
                        model=active_model_size if 'active_model_size' in locals() else "unknown"
                    )
                except Exception:
                    pass
            return {"text": "", "timing": {}}
            
    return await asyncio.to_thread(run_inference)

