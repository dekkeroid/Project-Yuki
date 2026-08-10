import io
import os
import sys
import urllib.request
from pathlib import Path
import soundfile as sf
import time
import re
import threading

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

from app import config

VOICE_DIR = Path(__file__).parent.resolve()
MODEL_PATH = VOICE_DIR / "kokoro-v1.0.fp16.onnx"
VOICES_PATH = VOICE_DIR / "voices-v1.0.bin"
_kokoro_instance = None

MODEL_URL = "https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/kokoro-v1.0.fp16.onnx"
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

# Model files will be verified lazily inside get_kokoro()

# Lazy-loaded Kokoro instance
_kokoro_instance = None
_kokoro_lock = threading.Lock()

def reset_kokoro():
    """Clear the cached Kokoro instance so the next call re-initializes with current config."""
    global _kokoro_instance
    with _kokoro_lock:
        _kokoro_instance = None
    print("[TTS] Kokoro instance cleared. Will re-initialize on next speech request.")

async def get_kokoro_async() -> "Kokoro":
    if _kokoro_instance is not None:
        return _kokoro_instance
    import asyncio
    return await asyncio.to_thread(get_kokoro)


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


def get_kokoro() -> "Kokoro":
    global _kokoro_instance
    if _kokoro_instance is not None:
        return _kokoro_instance

    with _kokoro_lock:
        if _kokoro_instance is not None:
            return _kokoro_instance

        from kokoro_onnx import Kokoro

        # Defer NVIDIA DLL loading and model file checks to here to make imports instant
        add_nvidia_dll_directories()
        _ensure_model_files()

        device_pref = getattr(config, "TTS_DEVICE", "auto").lower()
        print(f"[TTS] Loading local Kokoro-ONNX neural model into memory... (device preference: {device_pref})")
        import onnxruntime as ort

        # Build provider list based on user device preference
        available = ort.get_available_providers()

        if device_pref == "cpu":
            # Force CPU only
            print("[TTS] Device set to CPU. Loading with CPU provider...")
            session = _build_session(["CPUExecutionProvider"])
            _kokoro_instance = Kokoro.from_session(session, str(VOICES_PATH))
            print(f"[TTS] Model loaded on CPU. Active providers: {session.get_providers()}")
            _warmup_cpu(_kokoro_instance)
            return _kokoro_instance

        # auto or gpu: try GPU providers
        gpu_provider = None
        if "CUDAExecutionProvider" in available:
            gpu_provider = "CUDAExecutionProvider"
        elif "DmlExecutionProvider" in available:
            gpu_provider = "DmlExecutionProvider"

        if gpu_provider:
            providers = [gpu_provider, "CPUExecutionProvider"] if device_pref == "auto" else [gpu_provider]
            print(f"[TTS] Trying GPU provider: {gpu_provider}...")
            try:
                session = _build_session(providers)
                active_providers = session.get_providers()
                if gpu_provider not in active_providers:
                    print(f"[TTS] {gpu_provider} listed but not active (missing runtime libs). Active: {active_providers}")
                    if device_pref == "gpu":
                        print(f"[TTS] GPU forced but {gpu_provider} is unavailable. Falling back to CPU so TTS still works.")
                    else:
                        print(f"[TTS] Falling back to CPU. Install the matching CUDA Toolkit to enable GPU.")
                else:
                    kokoro = Kokoro.from_session(session, str(VOICES_PATH))
                    print("[TTS] Validating GPU provider with warm-up inference...")
                    t_warm = time.time()
                    kokoro.create("hi", voice="af_sarah", speed=1.0, lang="en-us")
                    elapsed = int((time.time() - t_warm) * 1000)
                    print(f"[TTS] {gpu_provider} warm-up OK in {elapsed}ms - GPU is active.")
                    _kokoro_instance = kokoro
                    return _kokoro_instance
            except Exception as e:
                if device_pref == "gpu":
                    print(f"[TTS] GPU forced but failed ({type(e).__name__}: {e}). Falling back to CPU so TTS still works.")
                else:
                    print(f"[TTS] {gpu_provider} is incompatible with this model ({type(e).__name__} : {e}). Falling back to CPU.")

        # CPU-only path (fallback or no GPU)
        print("[TTS] Loading with CPU provider...")
        session = _build_session(["CPUExecutionProvider"])
        _kokoro_instance = Kokoro.from_session(session, str(VOICES_PATH))
        print(f"[TTS] Model loaded on CPU. Active providers: {session.get_providers()}")
        _warmup_cpu(_kokoro_instance)

        return _kokoro_instance


def _warmup_cpu(kokoro):
    """Run CPU warm-up inference to pre-compile ONNX graph."""
    try:
        print("[TTS] Running CPU warm-up inference to pre-compile ONNX graph...")
        t_warm = time.time()
        kokoro.create("hi", voice="af_sarah", speed=1.0, lang="en-us")
        print(f"[TTS] CPU warm-up done in {int((time.time()-t_warm)*1000)}ms - model is hot and ready.")
    except Exception as e:
        print(f"[TTS] CPU warm-up failed (non-fatal): {e}")


_kks_instance = None

def transliterate_for_tts(text: str) -> str:
    global _kks_instance
    if not text:
        return ""
    if all(ord(c) < 128 for c in text):
        return text

    # Initialize pykakasi on demand
    if _kks_instance is None:
        import pykakasi
        _kks_instance = pykakasi.kakasi()

    import pypinyin
    from anyascii import anyascii

    # 1. Run pykakasi to convert Japanese parts to Romaji.
    #    We align the results to prevent pykakasi from dropping characters.
    try:
        res_kakasi = _kks_instance.convert(text)
        parts = []
        i = 0
        for item in res_kakasi:
            orig = item['orig']
            hepburn = item['hepburn']
            if not orig:
                continue
            idx = text.find(orig, i)
            if idx == -1:
                val = hepburn if hepburn else orig
                parts.append(val)
                continue
            if idx > i:
                parts.append(text[i:idx])
            # Add spaces around transliterated Japanese words for better TTS pronunciation
            if hepburn and hepburn != orig:
                val = f" {hepburn} "
            else:
                val = orig
            parts.append(val)
            i = idx + len(orig)
        if i < len(text):
            parts.append(text[i:])
        text_kakasi = "".join(parts)
    except Exception:
        text_kakasi = text

    # 2. Run pypinyin to convert remaining Chinese/Hanzi characters to Pinyin.
    try:
        pinyin_parts = []
        for char in text_kakasi:
            if 0x4E00 <= ord(char) <= 0x9FFF:
                py = pypinyin.lazy_pinyin(char)
                if py:
                    pinyin_parts.append(f" {py[0]} ")
                else:
                    pinyin_parts.append(char)
            else:
                pinyin_parts.append(char)
        text_pinyin = "".join(pinyin_parts)
    except Exception:
        text_pinyin = text_kakasi

    # 3. Finally run anyascii for remaining non-ASCII characters
    try:
        text_ascii = anyascii(text_pinyin)
    except Exception:
        text_ascii = text_pinyin

    return text_ascii


def clean_text_for_tts(text: str) -> str:
    import re
    if not text:
        return ""

    # 1. Strip thought / reasoning / think blocks (including unclosed tags)
    text = re.sub(r'<(thought|think|reasoning)>[\s\S]*?</\1>', '', text, flags=re.IGNORECASE)
    text = re.sub(r'<(thought|think|reasoning)>[\s\S]*$', '', text, flags=re.IGNORECASE)

    # 2. Strip unique animation and emotion tags (<yuki_anim:.../>, <yuki_emotion:.../>, [anim:...], [emotion:...])
    text = re.sub(r'<(?:yuki_)?(?:anim|emotion):[a-zA-Z0-9_\-]+\/?>|\[(?:anim|emotion):\s*[a-zA-Z0-9_\-]+\]', '', text, flags=re.IGNORECASE)

    # 3. Strip HTML / XML tags (e.g. <div>, <span ...>, <br/>, <b>, <code>) leaving inner text
    text = re.sub(r'</?[a-zA-Z][^>]*>', ' ', text)

    # 4. Code Block Speech Filtering (Replace multi-line code blocks with clean spoken summary)
    text = re.sub(r'```[a-zA-Z0-9_\-]*\n[\s\S]*?```', ' I have provided the code on your screen. ', text)
    text = re.sub(r'```[\s\S]*?```', ' I have provided the code on your screen. ', text)

    # 5. Strip URLs, File Paths, and IP addresses BEFORE numeric ITN runs
    text = re.sub(r'\bhttps?://(?:www\.)?([^/\s]+)(?:/[^\s]*)?', r'\1', text)
    text = re.sub(r'(?<!http://)(?<!https://)\bwww\.([^/\s]+)(?:/[^\s]*)?', r'\1', text)
    text = re.sub(r'\bfile://(?:[^/\n]*/)+([^/\n\'"]+)', r'\1', text)
    text = re.sub(r'\bfile://([^/\n\'"]+)', r'\1', text)
    text = re.sub(r'\b[A-Za-z]:[\\/](?:[^\\/\n]+[\\/])+([^\\/\n\'"]+)', r'\1', text)
    text = re.sub(r'\b[A-Za-z]:[\\/]([^\\/\n\'"]+)', r'\1', text)
    text = re.sub(r'(^|\s)/(?:[^/\s]+/)+([^/\s]+)', r'\1\2', text)
    text = re.sub(r"\b(?:\d{1,3}\.){3}\d{1,3}\b", "localhost", text)

    # 6. Strip Markdown Headers (#, ##), Bullet Lists (- , * , 1. ), & Blockquotes (>)
    text = re.sub(r'^[#>\-\*]+\s+', '', text, flags=re.MULTILINE)
    text = re.sub(r'^\d+\.\s+', '', text, flags=re.MULTILINE)

    # 7. KaTeX Math Formulas & Decimal ITN
    text = re.sub(r'\\frac\{([^}]+)\}\{([^}]+)\}', r'\1 over \2', text)
    text = re.sub(r'\\sqrt\{([^}]+)\}', r'square root of \1', text)
    text = re.sub(r'\\sqrt\s+([a-zA-Z0-9]+)', r'square root of \1', text)
    text = text.replace(r'\times', ' times ').replace(r'\cdot', ' times ')
    text = text.replace(r'\neq', ' is not equal to ').replace(r'\approx', ' is approximately ')
    text = text.replace(r'\leq', ' is less than or equal to ').replace(r'\geq', ' is greater than or equal to ')
    text = text.replace(r'\infty', ' infinity ').replace(r'\pi', ' pi ')
    text = text.replace(r'\sum', ' sum ').replace(r'\prod', ' product ')
    text = re.sub(r'([a-zA-Z0-9)]+)\^2', r'\1 squared', text)
    text = re.sub(r'([a-zA-Z0-9)]+)\^3', r'\1 cubed', text)
    text = re.sub(r'([a-zA-Z0-9)]+)\^\{([^}]+)\}', r'\1 to the power of \2', text)
    text = re.sub(r'([a-zA-Z0-9)]+)\^([a-zA-Z0-9]+)', r'\1 to the power of \2', text)
    text = re.sub(r'\$\$(.*?)\$\$|\\\[(.*?)\\\]', lambda m: m.group(1) or m.group(2) or "", text, flags=re.DOTALL)
    text = re.sub(r'\\\((.*?)\\\)|\$(.*?)\$', lambda m: m.group(1) or m.group(2) or "", text, flags=re.DOTALL)
    text = re.sub(r'(\d+)\.(\d+)', r'\1 point \2', text)

    # 8. Industry-Standard ITN: Currency & Unit Symbols
    text = re.sub(r'\$(\d+(?:\.\d+)?)', r'\1 dollars', text)
    text = re.sub(r'£(\d+(?:\.\d+)?)', r'\1 pounds', text)
    text = re.sub(r'€(\d+(?:\.\d+)?)', r'\1 euros', text)
    text = re.sub(r'₹(\d+(?:\.\d+)?)', r'\1 rupees', text)
    text = re.sub(r'¥(\d+(?:\.\d+)?)', r'\1 yen', text)
    text = re.sub(r'(\d+(?:\.\d+)?)\s*yuan\b', r'\1 yuan', text, flags=re.IGNORECASE)

    text = re.sub(r'(\d+)\s*%', r'\1 percent', text)
    text = re.sub(r'(\d+)\s*°[CC]', r'\1 degrees Celsius', text)
    text = re.sub(r'(\d+)\s*°[FF]', r'\1 degrees Fahrenheit', text)
    text = re.sub(r'(\d+)\s*km/h\b', r'\1 kilometers per hour', text, flags=re.IGNORECASE)
    text = re.sub(r'(\d+)\s*mph\b', r'\1 miles per hour', text, flags=re.IGNORECASE)
    text = re.sub(r'(\d+)\s*GB\b', r'\1 gigabytes', text)
    text = re.sub(r'(\d+)\s*Gb\b', r'\1 gigabits', text)
    text = re.sub(r'(\d+)\s*gb\b', r'\1 gigabytes', text)
    text = re.sub(r'(\d+)\s*MB\b', r'\1 megabytes', text)
    text = re.sub(r'(\d+)\s*Mb\b', r'\1 megabits', text)
    text = re.sub(r'(\d+)\s*mb\b', r'\1 megabytes', text)
    text = re.sub(r'(\d+)\s*TB\b', r'\1 terabytes', text)
    text = re.sub(r'(\d+)\s*Tb\b', r'\1 terabits', text)
    text = re.sub(r'(\d+)\s*tb\b', r'\1 terabytes', text)
    text = re.sub(r'(\d+)\s*KB\b', r'\1 kilobytes', text)
    text = re.sub(r'(\d+)\s*Kb\b', r'\1 kilobits', text)
    text = re.sub(r'(\d+)\s*kb\b', r'\1 kilobytes', text)

    abbreviations = [
        (r'\be\.g\.\b', 'for example'),
        (r'\bi\.e\.\b', 'that is'),
        (r'\betc\.\b', 'etcetera'),
        (r'\bapprox\.\b', 'approximately'),
        (r'\bvs\.\b', 'versus'),
        (r'\bdr\.\b', 'Doctor'),
        (r'\bmr\.\b', 'Mister'),
        (r'\bmrs\.\b', 'Missus'),
        (r'\bms\.\b', 'Miss'),
        (r'\bprof\.\b', 'Professor'),
    ]
    for pattern, replacement in abbreviations:
        text = re.sub(pattern, replacement, text, flags=re.IGNORECASE)

    # 9. Foreign Character Transliteration
    text = transliterate_for_tts(text)

    # 10. Roleplay Actions in Asterisks (*giggles*, *smiles softly*) vs Double Asterisk Emphasis
    text = re.sub(r'\*\*(.*?)\*\*|__(.*?)__', lambda m: m.group(1) or m.group(2) or "", text)
    text = re.sub(r'\*([^*]+)\*|_([^_]+)_', '', text)

    # 11. Technical Noise & Symbol Cleanup
    text = re.sub(r"\s*\[(?:tool call|AppID|truncated|SYSTEM)[^\]]*\]", "", text, flags=re.IGNORECASE)
    text = re.sub(r"\s*\((?:AppID:\s*\d+|file_path=[^\)]+|tool_call_id=[^\)]+)\)", "", text, flags=re.IGNORECASE)
    text = text.replace('$', '').replace('{', '').replace('}', '').replace('`', '').replace('~', '').replace('^', '')
    text = text.replace('*', ' ').replace('\\', ' ').replace('/', ' ').replace('|', ' ')

    # 12. Emoji Removal
    emoji_pattern = re.compile(
        '['
        '\U0001f600-\U0001f64f'
        '\U0001f300-\U0001f5ff'
        '\U0001f680-\U0001f6ff'
        '\U0001f1e0-\U0001f1ff'
        '\u2702-\u27b0'
        '\u24c2-\U0001f251'
        '\u2600-\u27BF'
        '\uE000-\uF8FF'
        ']+', flags=re.UNICODE
    )
    text = emoji_pattern.sub('', text)

    # 13. Whitespace Normalization
    text = re.sub(r'\s+', ' ', text).strip()
    return text


async def generate_speech_bytes(text: str, voice: str = None, rate: str = None) -> bytes:
    """
    Generates WAV audio bytes for a given text using Kokoro-ONNX locally.
    """
    text = clean_text_for_tts(text)
    if not text.strip():
        return b""
        
    # Safeguard: limit text length to prevent local ONNX timeouts and CPU thrashing
    MAX_TTS_LEN = 400
    if len(text) > MAX_TTS_LEN:
        truncated = text[:MAX_TTS_LEN]
        last_period = truncated.rfind('.')
        if last_period > 100:  # make sure we don't truncate too much
            text = truncated[:last_period + 1] + "..."
        else:
            text = truncated + "..."

        
    if voice is None:
        voice = config.TTS_VOICE
    if rate is None:
        rate = config.TTS_RATE

    # Map voice selections to local Kokoro voices dynamically
    voice_lower = voice.lower().strip() if voice else ""
    kokoro_voice = "af_sarah"
    lang_code = "en-us"

    if voice_lower:
        if voice_lower.startswith("af_"):
            kokoro_voice = voice_lower
            lang_code = "en-us"
        elif voice_lower.startswith("bf_"):
            kokoro_voice = voice_lower
            lang_code = "en-gb"
        elif voice_lower.startswith("jf_") or voice_lower.startswith("jm_"):
            kokoro_voice = voice_lower
            lang_code = "ja"
        elif "sarah" in voice_lower:
            kokoro_voice = "af_sarah"
            lang_code = "en-us"
        elif "sky" in voice_lower:
            kokoro_voice = "af_sky"
            lang_code = "en-us"
        elif "bella" in voice_lower:
            kokoro_voice = "af_bella"
            lang_code = "en-us"
        elif "isabella" in voice_lower:
            kokoro_voice = "bf_isabella"
            lang_code = "en-gb"
        elif "alice" in voice_lower:
            kokoro_voice = "bf_alice"
            lang_code = "en-gb"
        elif "lily" in voice_lower:
            kokoro_voice = "bf_lily"
            lang_code = "en-gb"
        elif "alpha" in voice_lower:
            kokoro_voice = "jf_alpha"
            lang_code = "ja"
        elif "gongitsune" in voice_lower:
            kokoro_voice = "jf_gongitsune"
            lang_code = "ja"
        elif "nezumi" in voice_lower:
            kokoro_voice = "jf_nezumi"
            lang_code = "ja"
        elif "tebukuro" in voice_lower:
            kokoro_voice = "jf_tebukuro"
            lang_code = "ja"
        else:
            # default fallback if prefix is not matched
            kokoro_voice = voice_lower
            # guess language from prefix
            if voice_lower.startswith("am_") or voice_lower.startswith("ef_") or voice_lower.startswith("em_"):
                lang_code = "en-us"
            elif voice_lower.startswith("bm_"):
                lang_code = "en-gb"
            else:
                lang_code = "en-us"

    # Map percentage rate (e.g. "+15%") or standard string speed to float factor
    speed_factor = 1.0
    if rate is not None:
        if isinstance(rate, str):
            rate_str = rate.strip()
            if "%" in rate_str:
                try:
                    percent_str = re.sub(r'[^\d]', '', rate_str)
                    percent = int(percent_str) if percent_str else 0
                    factor = 1.0 + (percent / 100.0) if "+" in rate_str else 1.0 - (percent / 100.0)
                    speed_factor = max(0.5, min(2.0, factor))
                except Exception:
                    speed_factor = 1.0
            else:
                try:
                    # Clean any non-numeric suffixes like 'x' or 'x speed'
                    cleaned_val = re.sub(r'[^\d.+\-]', '', rate_str)
                    speed_factor = float(cleaned_val)
                except Exception:
                    speed_factor = 1.0
        elif isinstance(rate, (int, float)):
            speed_factor = float(rate)

    try:
        t0 = time.time()
        kokoro = await get_kokoro_async()
        import asyncio
        samples, sample_rate = await asyncio.to_thread(
            kokoro.create, text, voice=kokoro_voice, speed=speed_factor, lang=lang_code
        )
        
        # Write to WAV bytes in-memory
        audio_buffer = io.BytesIO()
        sf.write(audio_buffer, samples, sample_rate, format='WAV')
        return audio_buffer.getvalue()
    except Exception as e:
        print(f"[TTS] Kokoro Generation Error: {e}")
        return b""
