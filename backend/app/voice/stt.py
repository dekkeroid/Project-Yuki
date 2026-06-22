import os
from pathlib import Path
import asyncio
from faster_whisper import WhisperModel
from app import config

VOICE_DIR = Path(__file__).parent.resolve()
WHISPER_MODEL_DIR = VOICE_DIR / "whisper-base"

_whisper_instance = None
_current_model_size = None
_current_compute_type = None
_current_device = None

def reset_whisper():
    """Clear the cached Whisper instance so the next call re-initializes with current config."""
    global _whisper_instance, _current_model_size, _current_compute_type, _current_device
    _whisper_instance = None
    _current_model_size = None
    _current_compute_type = None
    _current_device = None
    print("[STT] Whisper model cleared. Will re-initialize on next transcription request.")

def get_whisper_model(model_size: str = None, compute_type: str = "int8_float16") -> WhisperModel:
    global _whisper_instance, _current_model_size, _current_compute_type, _current_device

    device_pref = getattr(config, "STT_DEVICE", "auto").lower()

    if model_size is None:
        model_size = str(WHISPER_MODEL_DIR) if WHISPER_MODEL_DIR.exists() and (WHISPER_MODEL_DIR / "model.bin").exists() else "base"
    
    # If model is already loaded and matches size, compute type, and device, return it
    if (_whisper_instance is not None 
            and _current_model_size == model_size 
            and _current_compute_type == compute_type
            and _current_device == device_pref):
        return _whisper_instance
    
    # Determine actual device to use
    if device_pref == "cpu":
        actual_device = "cpu"
        actual_compute = "int8"
        print(f"[STT] Device set to CPU. Loading Whisper model from '{model_size}' (int8)...")
    else:
        # auto or gpu: try CUDA first
        actual_device = "cuda"
        actual_compute = compute_type
        print(f"[STT] Loading Whisper model from '{model_size}' on GPU (CUDA, {compute_type})...")

    try:
        _whisper_instance = WhisperModel(model_size, device=actual_device, compute_type=actual_compute)
        _current_model_size = model_size
        _current_compute_type = actual_compute
        _current_device = device_pref
        print(f"[STT] Whisper model loaded successfully on {actual_device.upper()}.")
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
            print(f"[STT] Whisper model loaded successfully on CPU.")
        except Exception as cpu_err:
            print(f"[STT] Failed to load Whisper model on CPU: {cpu_err}")
            if model_size != "tiny" and model_size != str(WHISPER_MODEL_DIR / "whisper-tiny") if (WHISPER_MODEL_DIR / "whisper-tiny").exists() else True:
                print("[STT] Falling back to 'tiny' Whisper model...")
                return get_whisper_model("tiny", compute_type)
            raise cpu_err
        
    return _whisper_instance

async def transcribe_audio_file(file_path: str, model_size: str = "base", compute_type: str = "int8_float16", language: str = "en") -> str:
    """
    Transcribes an audio file on a separate worker thread to keep the FastAPI event loop unblocked.
    """
    if not os.path.exists(file_path):
        print(f"[STT] Audio file path does not exist: {file_path}")
        return ""
        
    def run_inference():
        try:
            model = get_whisper_model(model_size, compute_type)
            whisper_prompt = (
                "Yuki, you can execute a command such as taking a screenshot, getting system stats, checking the current date or time, "
                "setting system volume, media playback control, running a terminal command, launching an application, searching files, "
                "listing directory, editing a file, deleting a file, system power control, or running a python script."
            )
            segments, info = model.transcribe(file_path, beam_size=5, vad_filter=True, language=language, initial_prompt=whisper_prompt)
            
            # Combine segment text into a single transcript
            text = " ".join([segment.text for segment in segments]).strip()
            return text
        except Exception as e:
            print(f"[STT] Whisper Transcription Error: {e}")
            return ""
            
    return await asyncio.to_thread(run_inference)
