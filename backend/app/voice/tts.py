import io
import os
import sys
import urllib.request
from pathlib import Path
import soundfile as sf
import time

def add_nvidia_dll_directories():
    # Find site-packages/nvidia directory and inject paths
    for path in sys.path:
        if not path:
            continue
        nvidia_dir = Path(path) / "nvidia"
        if nvidia_dir.exists() and nvidia_dir.is_dir():
            for bin_dir in nvidia_dir.rglob("bin"):
                if bin_dir.is_dir():
                    try:
                        resolved_path = str(bin_dir.resolve())
                        if hasattr(os, "add_dll_directory"):
                            os.add_dll_directory(resolved_path)
                        os.environ["PATH"] = resolved_path + os.pathsep + os.environ["PATH"]
                    except Exception as e:
                        print(f"[TTS] Warning: Failed to add DLL directory {bin_dir}: {e}")

add_nvidia_dll_directories()

from kokoro_onnx import Kokoro
from app import config

VOICE_DIR = Path(__file__).parent.resolve()
MODEL_PATH = VOICE_DIR / "kokoro-v1.0.onnx"
VOICES_PATH = VOICE_DIR / "voices-v1.0.bin"

MODEL_URL = "https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/kokoro-v1.0.onnx"
VOICES_URL = "https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/voices-v1.0.bin"

def _ensure_model_files():
    if not VOICE_DIR.exists():
        os.makedirs(VOICE_DIR, exist_ok=True)
        
    for url, path in [(MODEL_URL, MODEL_PATH), (VOICES_URL, VOICES_PATH)]:
        if not path.exists():
            print(f"[TTS] Model file {path.name} is missing. Initiating download...")
            temp_path = path.with_suffix(".tmp")
            try:
                urllib.request.urlretrieve(url, temp_path)
                if os.path.exists(temp_path):
                    os.rename(temp_path, path)
                    print(f"[TTS] Successfully downloaded and saved {path.name}")
            except Exception as e:
                print(f"[TTS] Failed to download {path.name}: {e}")
                if os.path.exists(temp_path):
                    try:
                        os.remove(temp_path)
                    except Exception:
                        pass
                raise e

# Ensure files exist before initializing Kokoro
_ensure_model_files()

# Lazy-loaded Kokoro instance
_kokoro_instance = None


def _build_session(providers: list):
    """Create an ONNX InferenceSession with the given provider list."""
    import onnxruntime as ort
    if hasattr(ort, "preload_dlls"):
        try:
            ort.preload_dlls()
        except Exception as e:
            print(f"[TTS] Warning preloading DLLs: {e}")
    import multiprocessing
    sess_options = ort.SessionOptions()
    sess_options.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL
    sess_options.enable_cpu_mem_arena = True
    cores = multiprocessing.cpu_count()
    sess_options.intra_op_num_threads = min(6, cores)
    sess_options.inter_op_num_threads = 2
    return ort.InferenceSession(str(MODEL_PATH), sess_options=sess_options, providers=providers)


def get_kokoro() -> Kokoro:
    global _kokoro_instance
    if _kokoro_instance is not None:
        return _kokoro_instance

    print("[TTS] Loading local Kokoro-ONNX neural model into memory...")
    import onnxruntime as ort

    # Build provider list: prefer GPU, always keep CPU as fallback
    available = ort.get_available_providers()
    gpu_provider = None
    if "DmlExecutionProvider" in available:
        gpu_provider = "DmlExecutionProvider"
    elif "CUDAExecutionProvider" in available:
        gpu_provider = "CUDAExecutionProvider"

    if gpu_provider:
        print(f"[TTS] Trying GPU provider: {gpu_provider}...")
        try:
            session = _build_session([gpu_provider, "CPUExecutionProvider"])
            active_providers = session.get_providers()
            if gpu_provider not in active_providers:
                # Provider loaded but silently fell back (e.g. missing CUDA toolkit DLLs)
                print(f"[TTS] {gpu_provider} listed but not active (missing runtime libs). Active: {active_providers}")
                print(f"[TTS] Falling back to CPU. Install the matching CUDA Toolkit to enable GPU.")
            else:
                kokoro = Kokoro.from_session(session, str(VOICES_PATH))
                # Validate actual inference works on the GPU provider
                print("[TTS] Validating GPU provider with warm-up inference...")
                t_warm = time.time()
                kokoro.create("hi", voice="af_sarah", speed=1.0, lang="en-us")
                elapsed = int((time.time() - t_warm) * 1000)
                print(f"[TTS] {gpu_provider} warm-up OK in {elapsed}ms - GPU is active.")
                _kokoro_instance = kokoro
                return _kokoro_instance
        except Exception as e:
            print(f"[TTS] {gpu_provider} is incompatible with this model ({type(e).__name__} : {e}). Falling back to CPU.")

    # CPU-only path (fallback or no GPU)
    print("[TTS] Loading with CPU provider...")
    session = _build_session(["CPUExecutionProvider"])
    _kokoro_instance = Kokoro.from_session(session, str(VOICES_PATH))
    print(f"[TTS] Model loaded on CPU. Active providers: {session.get_providers()}")

    # Warm-up on CPU
    try:
        print("[TTS] Running CPU warm-up inference to pre-compile ONNX graph...")
        t_warm = time.time()
        _kokoro_instance.create("hi", voice="af_sarah", speed=1.0, lang="en-us")
        print(f"[TTS] CPU warm-up done in {int((time.time()-t_warm)*1000)}ms - model is hot and ready.")
    except Exception as e:
        print(f"[TTS] CPU warm-up failed (non-fatal): {e}")

    return _kokoro_instance


def clean_text_for_tts(text: str) -> str:
    if not text:
        return ""
    import re
    
    # 1. Double asterisks and double underscores -> replace with inner text
    text = re.sub(r'\*\*(.*?)\*\*|__(.*?)__', lambda m: m.group(1) or m.group(2) or "", text)
    
    # 2. Single asterisks and single underscores -> filter out actions, keep emphasis
    action_stems = [
        'wink', 'smile', 'giggle', 'laugh', 'sigh', 'pout', 'wave', 'nod', 
        'shrug', 'chuckle', 'blush', 'cry', 'gasp', 'yawn', 'look', 'reset', 
        'facepalm', 'point', 'cough', 'scream', 'whisper'
    ]
    
    def replace_single(match):
        inner = (match.group(1) or match.group(2) or "").strip()
        if not inner:
            return ""
        inner_lower = inner.lower()
        if any(stem in inner_lower for stem in action_stems):
            return ""  # strip the gesture action description entirely
        return inner   # keep text for emphasis
        
    text = re.sub(r'\*(.*?)\*|_(.*?)_', replace_single, text)
    
    # 3. Remove backticks but keep their inner text
    text = text.replace('`', '')
    
    # 4. Remove emojis
    emoji_pattern = re.compile(
        '['
        '\U0001f600-\U0001f64f'  # emoticons
        '\U0001f300-\U0001f5ff'  # symbols & pictographs
        '\U0001f680-\U0001f6ff'  # transport & map symbols
        '\U0001f1e0-\U0001f1ff'  # flags
        '\u2702-\u27b0'          # dingbats
        '\u24c2-\U0001f251'      # CJK symbols
        '\u2600-\u27BF'          # miscellaneous symbols
        '\uE000-\uF8FF'          # private use
        ']+', flags=re.UNICODE
    )
    text = emoji_pattern.sub('', text)
    
    # 5. Replace multiple spaces with a single space
    text = re.sub(r'\s+', ' ', text).strip()
    return text


async def generate_speech_bytes(text: str, voice: str = None, rate: str = None) -> bytes:
    """
    Generates WAV audio bytes for a given text using Kokoro-ONNX locally.
    """
    text = clean_text_for_tts(text)
    if not text.strip():
        return b""
        
    if voice is None:
        voice = config.TTS_VOICE
    if rate is None:
        rate = config.TTS_RATE

    # Map voice selections to local Kokoro voices
    voice_lower = voice.lower() if voice else ""
    kokoro_voice = "af_sarah"
    lang_code = "en-us"

    # 3 American Female
    if "sarah" in voice_lower or "af_sarah" in voice_lower:
        kokoro_voice = "af_sarah"
        lang_code = "en-us"
    elif "sky" in voice_lower or "af_sky" in voice_lower:
        kokoro_voice = "af_sky"
        lang_code = "en-us"
    elif "bella" in voice_lower or "af_bella" in voice_lower:
        kokoro_voice = "af_bella"
        lang_code = "en-us"
        
    # 3 British Female
    elif "isabella" in voice_lower or "bf_isabella" in voice_lower:
        kokoro_voice = "bf_isabella"
        lang_code = "en-gb"
    elif "alice" in voice_lower or "bf_alice" in voice_lower:
        kokoro_voice = "bf_alice"
        lang_code = "en-gb"
    elif "lily" in voice_lower or "bf_lily" in voice_lower:
        kokoro_voice = "bf_lily"
        lang_code = "en-gb"
        
    # 3 Japanese Female
    elif "alpha" in voice_lower or "jf_alpha" in voice_lower:
        kokoro_voice = "jf_alpha"
        lang_code = "ja"
    elif "glowing" in voice_lower or "jf_glowing" in voice_lower:
        kokoro_voice = "jf_glowing"
        lang_code = "ja"
    elif "yasmin" in voice_lower or "jf_yasmin" in voice_lower:
        kokoro_voice = "jf_yasmin"
        lang_code = "ja"
    else:
        kokoro_voice = "af_sarah"
        lang_code = "en-us"

    # Map percentage rate (e.g. "+15%") or standard string speed to float factor
    speed_factor = 1.0
    if rate is not None:
        if isinstance(rate, str):
            if "%" in rate:
                try:
                    percent = int(rate.replace("%", "").replace("+", "").replace("-", ""))
                    factor = 1.0 + (percent / 100.0) if "+" in rate else 1.0 - (percent / 100.0)
                    speed_factor = max(0.5, min(2.0, factor))
                except ValueError:
                    speed_factor = 1.0
            else:
                try:
                    speed_factor = float(rate)
                except ValueError:
                    speed_factor = 1.0
        elif isinstance(rate, (int, float)):
            speed_factor = float(rate)

    try:
        t0 = time.time()
        print(f"[TTS] generate_speech_bytes start voice={kokoro_voice} lang={lang_code} rate={speed_factor} text='{text[:80]}'")
        kokoro = get_kokoro()
        import asyncio
        samples, sample_rate = await asyncio.to_thread(
            kokoro.create, text, voice=kokoro_voice, speed=speed_factor, lang=lang_code
        )
        
        # Write to WAV bytes in-memory
        audio_buffer = io.BytesIO()
        sf.write(audio_buffer, samples, sample_rate, format='WAV')
        t_elapsed = time.time() - t0
        print(f"[TTS] generate_speech_bytes finished time_ms={int(t_elapsed*1000)} text_len={len(text)}")
        return audio_buffer.getvalue()
    except Exception as e:
        print(f"[TTS] Kokoro Generation Error: {e}")
        return b""
