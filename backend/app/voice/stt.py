import os
from pathlib import Path
import asyncio
from faster_whisper import WhisperModel

VOICE_DIR = Path(__file__).parent.resolve()

_whisper_instance = None
_current_model_size = None
_current_compute_type = None

def get_whisper_model(model_size: str = "base", compute_type: str = "int8_float16") -> WhisperModel:
    global _whisper_instance, _current_model_size, _current_compute_type
    
    # If model is already loaded and matches size and compute type, return it
    if (_whisper_instance is not None 
            and _current_model_size == model_size 
            and _current_compute_type == compute_type):
        return _whisper_instance
        
    print(f"[STT] Loading local Whisper '{model_size}' model on GPU (CUDA, {compute_type})...")
    try:
        _whisper_instance = WhisperModel(model_size, device="cuda", compute_type=compute_type)
        _current_model_size = model_size
        _current_compute_type = compute_type
        print(f"[STT] Whisper '{model_size}' ({compute_type}) model loaded successfully on GPU.")
    except Exception as e:
        print(f"[STT] GPU load failed ({e}). Falling back to CPU (int8)...")
        try:
            _whisper_instance = WhisperModel(model_size, device="cpu", compute_type="int8")
            _current_model_size = model_size
            _current_compute_type = "int8"
            print(f"[STT] Whisper '{model_size}' model loaded successfully on CPU.")
        except Exception as cpu_err:
            print(f"[STT] Failed to load Whisper model '{model_size}' on CPU: {cpu_err}")
            # Fallback to tiny if base fails for some reason
            if model_size != "tiny":
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
            # Transcribe returns a generator of segments, and transcription info
            segments, info = model.transcribe(file_path, beam_size=5, vad_filter=True, language=language, initial_prompt="Yuki")
            
            # Combine segment text into a single transcript
            text = " ".join([segment.text for segment in segments]).strip()
            return text
        except Exception as e:
            print(f"[STT] Whisper Transcription Error: {e}")
            return ""
            
    return await asyncio.to_thread(run_inference)
