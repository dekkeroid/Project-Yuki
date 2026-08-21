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
_kokoro_lock = threading.RLock()
_last_tts_request_time = 0.0
_kokoro_using_gpu = False
_tts_used_since_load = False

def update_last_tts_time():
    global _last_tts_request_time, _tts_used_since_load
    _last_tts_request_time = time.time()
    _tts_used_since_load = True

def get_last_tts_time() -> float:
    return _last_tts_request_time

def is_kokoro_on_gpu() -> bool:
    return _kokoro_using_gpu and _kokoro_instance is not None

def has_tts_been_used_since_load() -> bool:
    return _tts_used_since_load

def recycle_kokoro_if_idle(idle_threshold: float = 60.0, force: bool = False):
    """
    If Kokoro was used to synthesize speech in this cycle and has been idle for >= 60 seconds (or forced),
    unload the old session to flush any accumulated ONNX CUDA memory/arena, then reload and warm it up
    so it's clean, fresh, and ready for instant <100ms response without recurring loops.
    """
    global _kokoro_instance, _kokoro_using_gpu, _tts_used_since_load
    with _kokoro_lock:
        if _kokoro_instance is None:
            return
        idle_time = time.time() - _last_tts_request_time
        # Only recycle if speech was actually produced since last load, AND it's been idle >= threshold
        if force or (_tts_used_since_load and idle_time >= idle_threshold):
            print(f"[TTS] Recycling Kokoro session after speech use (idle for {int(idle_time)}s) to flush accumulated VRAM arena...")
            _kokoro_instance = None
            _kokoro_using_gpu = False
            _tts_used_since_load = False
            import gc
            gc.collect()
            try:
                get_kokoro()
                print("[TTS] Kokoro cleanly reloaded and warmed up for next turn.")
            except Exception as e:
                print(f"[TTS] Warning during Kokoro warm reload: {e}")

def unload_kokoro_if_idle(force: bool = False):
    global _kokoro_instance, _kokoro_using_gpu, _tts_used_since_load
    with _kokoro_lock:
        if _kokoro_instance is None:
            return
        idle_time = time.time() - _last_tts_request_time
        timeout = getattr(config, "TTS_IDLE_TIMEOUT", 300)
        auto_unload = getattr(config, "TTS_AUTO_UNLOAD", False)
        if force or (auto_unload and idle_time > timeout):
            print(f"[TTS] Kokoro model unloaded ({'forced by memory pressure' if force else f'idle for {int(idle_time)}s'}).")
            _kokoro_instance = None
            _kokoro_using_gpu = False
            _tts_used_since_load = False
            import gc
            gc.collect()

def reset_kokoro():
    """Clear the cached Kokoro instance so the next call re-initializes with current config."""
    global _kokoro_instance, _kokoro_using_gpu, _tts_used_since_load
    with _kokoro_lock:
        _kokoro_instance = None
        _kokoro_using_gpu = False
        _tts_used_since_load = False
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
    global _kokoro_instance, _kokoro_using_gpu
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
            _kokoro_using_gpu = False
            _tts_used_since_load = False
            _last_tts_request_time = time.time()
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
            if gpu_provider == "CUDAExecutionProvider":
                cuda_options = {
                    "device_id": "0",
                    "arena_extend_strategy": "kNextPowerOfTwo",
                    "cudnn_conv_algo_search": "HEURISTIC",
                    "do_copy_in_default_stream": "1",
                }
                gpu_entry = (gpu_provider, cuda_options)
            else:
                gpu_entry = gpu_provider

            providers = [gpu_entry, "CPUExecutionProvider"] if device_pref == "auto" else [gpu_entry]
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
                    _kokoro_instance = kokoro
                    _kokoro_using_gpu = True
                    _tts_used_since_load = False
                    _last_tts_request_time = time.time()
                    print(f"[TTS] {gpu_provider} warm-up OK in {int((time.time() - t_warm)*1000)}ms - GPU is active (dynamic VRAM arena).")
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
        _kokoro_using_gpu = False
        update_last_tts_time()
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


_ONES = [
    "", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine",
    "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen",
    "seventeen", "eighteen", "nineteen"
]
_TENS = [
    "", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"
]
_DIGIT_WORDS = {
    "0": "zero", "1": "one", "2": "two", "3": "three", "4": "four",
    "5": "five", "6": "six", "7": "seven", "8": "eight", "9": "nine"
}

def _below_1000_to_words(n: int) -> str:
    res = []
    if n >= 100:
        res.append(_ONES[n // 100] + " hundred")
        n %= 100
    if n >= 20:
        t = _TENS[n // 10]
        rem = n % 10
        if rem > 0:
            res.append(f"{t}-{_ONES[rem]}")
        else:
            res.append(t)
    elif n > 0:
        res.append(_ONES[n])
    return " ".join(res)

def int_to_words_international(n: int) -> str:
    """Converts an integer to English words using the International standard (millions, billions, etc.)."""
    if n == 0:
        return "zero"
    chunks = [
        (10**18, "quintillion"),
        (10**15, "quadrillion"),
        (10**12, "trillion"),
        (10**9, "billion"),
        (10**6, "million"),
        (10**3, "thousand"),
        (1, "")
    ]
    parts = []
    rem = n
    for unit_val, unit_name in chunks:
        if rem >= unit_val:
            c = rem // unit_val
            rem %= unit_val
            words = _below_1000_to_words(c)
            if words:
                if unit_name:
                    parts.append(f"{words} {unit_name}")
                else:
                    parts.append(words)
    return " ".join(parts)

def int_to_words_indian(n: int) -> str:
    """Converts an integer to English words using the Indian numbering system (lakhs, crores, etc.)."""
    if n == 0:
        return "zero"
    chunks = [
        (10**17, "shankh"),
        (10**15, "padma"),
        (10**13, "neel"),
        (10**11, "kharab"),
        (10**9, "arab"),
        (10**7, "crore"),
        (10**5, "lakh"),
        (10**3, "thousand"),
        (1, "")
    ]
    parts = []
    rem = n
    for unit_val, unit_name in chunks:
        if rem >= unit_val:
            c = rem // unit_val
            rem %= unit_val
            words = _below_1000_to_words(c)
            if words:
                if unit_name:
                    parts.append(f"{words} {unit_name}")
                else:
                    parts.append(words)
    return " ".join(parts)

def normalize_numbers_for_speech(text: str) -> str:
    """
    Normalizes numbers in text into spoken English words.
    - Numbers with Indian commas (e.g. 5,01,123 or 60,23,123) -> Indian standard (lakhs, crores).
    - Numbers with International commas (e.g. 5,231,232) -> International standard (millions, etc.).
    - Numbers without commas (e.g. 500000) -> International standard.
    - Decimals (e.g. 5.23, 5,01,123.75) -> Spoken whole number + 'point' + digits.
    """
    if not text:
        return ""

    # 1. Indian formatted numbers: 1-2 digits, one or more 2-digit groups, ending with 3-digit group (e.g. 5,01,123 or 60,23,123 or 1,50,00,000)
    indian_comma_regex = re.compile(r'\b(\d{1,2}(?:,\d{2})+,\d{3})(?:\.(\d+))?\b')
    def replace_indian(m):
        num_str = m.group(1).replace(',', '')
        dec_part = m.group(2)
        try:
            n = int(num_str)
            spoken = int_to_words_indian(n)
            if dec_part:
                dec_spoken = " ".join(_DIGIT_WORDS.get(d, d) for d in dec_part)
                spoken = f"{spoken} point {dec_spoken}"
            return spoken
        except Exception:
            return m.group(0)

    text = indian_comma_regex.sub(replace_indian, text)

    # 2. International formatted numbers: 1-3 digits, one or more 3-digit groups (e.g. 5,231,232 or 1,000,000)
    intl_comma_regex = re.compile(r'\b(\d{1,3}(?:,\d{3})+)(?:\.(\d+))?\b')
    def replace_intl(m):
        num_str = m.group(1).replace(',', '')
        dec_part = m.group(2)
        try:
            n = int(num_str)
            spoken = int_to_words_international(n)
            if dec_part:
                dec_spoken = " ".join(_DIGIT_WORDS.get(d, d) for d in dec_part)
                spoken = f"{spoken} point {dec_spoken}"
            return spoken
        except Exception:
            return m.group(0)

    text = intl_comma_regex.sub(replace_intl, text)

    # 3. Standalone decimals (e.g. 12.34 or 500000.5)
    decimal_regex = re.compile(r'(?<![\d.])\b(\d+)\.(\d+)\b(?![\d.])')
    def replace_decimal(m):
        try:
            int_part = int(m.group(1))
            dec_part = m.group(2)
            spoken = int_to_words_international(int_part)
            dec_spoken = " ".join(_DIGIT_WORDS.get(d, d) for d in dec_part)
            return f"{spoken} point {dec_spoken}"
        except Exception:
            return m.group(0)

    text = decimal_regex.sub(replace_decimal, text)

    # 4. Standalone unformatted integers (e.g. 500000, 100, 42)
    plain_int_regex = re.compile(r'(?<![\d:/\-])\b(\d{1,18})\b(?![\d:/\-])')
    def replace_plain_int(m):
        try:
            n = int(m.group(1))
            return int_to_words_international(n)
        except Exception:
            return m.group(0)

    text = plain_int_regex.sub(replace_plain_int, text)

    return text


def clean_text_for_tts(text: str) -> str:
    import re
    if not text:
        return ""

    # 0. Pre-decode HTML entities
    text = text.replace('&lt;', '<').replace('&gt;', '>')

    # 0.5 Strip common text emoticons / kaomojis to prevent voice engine noise
    emoticon_pattern = r'(?::[-~]?[)DPOopd(\[\]\\/|]|;[-~]?[)D]|<3|>_<|>_>|<_<|>_~|T_T|o_O|O_o|>\.<)'
    text = re.sub(emoticon_pattern, ' ', text)

    # 1. Strip thought / reasoning / think blocks (including unclosed tags)
    text = re.sub(r'<(thought|think|reasoning)>[\s\S]*?</\1>', '', text, flags=re.IGNORECASE)
    text = re.sub(r'<(thought|think|reasoning)>[\s\S]*$', '', text, flags=re.IGNORECASE)

    # 2. Strip unique animation and emotion tags (<yuki_anim:.../>, <yuki_emotion:.../>, [anim:...], [emotion:...])
    text = re.sub(r'<(?:yuki_)?(?:anim|emotion):[a-zA-Z0-9_\-]+\/?>|\[(?:anim|emotion):\s*[a-zA-Z0-9_\-]+\]', '', text, flags=re.IGNORECASE)

    # 3. Selective Tag Stripping (only structural elements)
    # Replaces actual HTML tags (e.g. <div>, <br/>, <span ...>) but preserves <Enter>, <Ctrl>, etc.
    structural_tags = r'</?(?:div|span|p|br|b|i|strong|em|code|pre|a|li|ul|ol|table|tr|td|th)(?:\s+[^>]*)?>'
    text = re.sub(structural_tags, ' ', text, flags=re.IGNORECASE)
    # Strip any remaining unclosed angle brackets only if they look like HTML (e.g. <div)
    text = re.sub(r'<[a-zA-Z]+(?:\s+[^>]*)?$', '', text)

    # Convert bracket-enclosed key names (e.g. <Enter> -> Enter, <Ctrl> -> Ctrl)
    # This must run before comparison symbol normalization to prevent them from matching as math comparison.
    text = re.sub(r'<([a-zA-Z0-9_\-+]+)>', r' \1 ', text)

    # 4. Code Block & Table Speech Filtering (Replace visual elements with clean spoken transitions)
    text = re.sub(r'```[a-zA-Z0-9_\-]*\n[\s\S]*?```', ' I have provided the code on your screen. ', text)
    text = re.sub(r'```[\s\S]*?```', ' I have provided the code on your screen. ', text)
    # Replace multi-row markdown tables with a natural spoken bridge
    text = re.sub(r'(\n|^)(?:\s*\|[^\n]+\|\s*\n)+', '\n I have displayed the detailed table on your screen. \n', text)

    # 4.5 Strip standalone Sources / References / Footnotes sections at the bottom from voice
    text = re.sub(r'(?i)\n+\s*(?:\*\*)?(?:sources?|references?|citations?)(?:\*\*)?:?\s*[\s\S]*$', '', text)

    # 4.6 Convert inline markdown links [Label](URL) to just Label before stripping raw URLs
    text = re.sub(r'\[([^\]]+)\]\([^\)]+\)', r'\1', text)

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

    # 7. KaTeX Math Formulas & Delimiter Cleanup
    text = re.sub(r'\\frac\{([^}]+)\}\{([^}]+)\}', r'\1 over \2', text)
    text = re.sub(r'\\sqrt\{([^}]+)\}', r'square root of \1', text)
    text = re.sub(r'\\sqrt\s+([a-zA-Z0-9]+)', r'square root of \1', text)
    text = text.replace(r'\times', ' times ').replace(r'\cdot', ' times ')
    text = text.replace(r'\neq', ' is not equal to ').replace(r'\approx', ' is approximately ')
    text = text.replace(r'\infty', ' infinity ').replace(r'\pi', ' pi ')
    text = text.replace(r'\sum', ' sum ').replace(r'\prod', ' product ')
    text = re.sub(r'([a-zA-Z0-9)]+)\^2', r'\1 squared', text)
    text = re.sub(r'([a-zA-Z0-9)]+)\^3', r'\1 cubed', text)
    text = re.sub(r'([a-zA-Z0-9)]+)\^\{([^}]+)\}', r'\1 to the power of \2', text)
    text = re.sub(r'([a-zA-Z0-9)]+)\^([a-zA-Z0-9]+)', r'\1 to the power of \2', text)
    text = re.sub(r'\$\$(.*?)\$\$|\\\[(.*?)\\\]', lambda m: m.group(1) or m.group(2) or "", text, flags=re.DOTALL)
    text = re.sub(r'\\\((.*?)\\\)|\$(.*?)\$', lambda m: m.group(1) or m.group(2) or "", text, flags=re.DOTALL)

    # --- ADVANCED MATH COMPARISON SYMBOL RESOLUTIONS ---
    # Convert arrows (-> / <-)
    text = re.sub(r'->|-->', ' to ', text)
    text = re.sub(r'<-|<--', ' from ', text)

    # Much less/greater than (<< / >>)
    text = re.sub(r'<<', ' much less than ', text)
    text = re.sub(r'>>', ' much greater than ', text)

    # Less/greater than or equal to (<= / >= / =< / =>)
    text = re.sub(r'<=\s*|==<\s*|=<\s*', ' is less than or equal to ', text)
    text = re.sub(r'>=\s*|==>\s*|=>\s*', ' is greater than or equal to ', text)

    # Standalone inequalities adjacent to numbers, decimals, or variables
    # Exclude common emoticons like >_<, >_>, <_<, etc. by requiring variables or digits
    digit_or_var = r'(?:[a-zA-Z0-9\-+]+(?:\.\d+)?(?:e-?\d+)?)'

    # Left-operand comparisons: x < y
    text = re.sub(rf'({digit_or_var})\s*<\s*({digit_or_var})', r'\1 is less than \2', text)
    text = re.sub(rf'({digit_or_var})\s*>\s*({digit_or_var})', r'\1 is greater than \2', text)

    # Prefix comparisons: < 10 (excluding emoticons like <3, so we verify digit/minus context)
    text = re.sub(r'<\s*(-?(?:[0-24-9]\d*(?:\.\d+)?|3\d+\.?\d*|3\.\d+))(?![a-zA-Z0-9_]*>)', r'less than \1', text)
    text = re.sub(r'>\s*(\d+(?:\.\d+)?)', r'greater than \1', text)

    # Code equality / inequality logical operators
    text = re.sub(r'==', ' equals ', text)
    text = re.sub(r'!=', ' is not equal to ', text)

    # Slashes Fraction Division (only matches A/B if not preceded by a slash and not followed by "/number")
    text = re.sub(r'(?<!/)\b(\d+)/([1-9]\d*)\b(?!/\d)', r'\1 over \2', text)

    # Range dashes (matches positive ranges like 10-20, excluding negative bounds lookbehind)
    text = re.sub(r'\b(\d+(?:\.\d+)?)\s*[-–—]\s*(?!\s*-)(\d+(?:\.\d+)?)\b', r'\1 to \2', text)

    # Metric unit abbreviations when following digits
    text = re.sub(r'\b(\d+(?:\.\d+)?)\s*μm\b', r'\1 micrometers', text)
    text = re.sub(r'\b(\d+(?:\.\d+)?)\s*μs\b', r'\1 microseconds', text)
    text = re.sub(r'\b(\d+(?:\.\d+)?)\s*m/s²\b|\b(\d+(?:\.\d+)?)\s*m/s\^2\b', r'\1 meters per second squared', text)
    text = re.sub(r'\b(\d+(?:\.\d+)?)\s*m/s\b', r'\1 meters per second', text)

    # Unicode Greek letters, math symbols & superscripts (pre-transliteration conversion)
    text = re.sub(r'\b(\d+(?:\.\d+)?)\s*μ\b', r'\1 micro', text)
    text = text.replace('μ', ' mu ').replace('π', ' pi ').replace('Ω', ' ohms ')
    text = text.replace('²', ' squared').replace('³', ' cubed')

    # Spelled-out file extensions
    text = re.sub(r'\b\.py\b', ' dot p y ', text)
    text = re.sub(r'\b\.js\b', ' dot j s ', text)
    text = re.sub(r'\b\.json\b', ' dot jay son ', text)
    text = re.sub(r'\b\.css\b', ' dot c s s ', text)
    text = re.sub(r'\b\.html\b', ' dot h t m l ', text)
    text = re.sub(r'\b\.md\b', ' dot m d ', text)
    # ---------------------------------------------------

    # 8. Industry-Standard ITN: Currency & Unit Symbols
    text = re.sub(r'₹([\d,]+(?:\.\d+)?)', r'\1 rupees', text)
    text = re.sub(r'\$([\d,]+(?:\.\d+)?)', r'\1 dollars', text)
    text = re.sub(r'£([\d,]+(?:\.\d+)?)', r'\1 pounds', text)
    text = re.sub(r'€([\d,]+(?:\.\d+)?)', r'\1 euros', text)
    text = re.sub(r'¥([\d,]+(?:\.\d+)?)', r'\1 yen', text)
    text = re.sub(r'\b(?:Rs\.?|INR)\s*([\d,]+(?:\.\d+)?)', r'\1 rupees', text, flags=re.IGNORECASE)
    text = re.sub(r'(\d+(?:\.\d+)?)\s*yuan\b', r'\1 yuan', text, flags=re.IGNORECASE)
    text = re.sub(r'\$', ' dollars', text) # Safe fallback for remaining dollar signs

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

    # 8.5 Full Spoken Number Normalization (Indian & International numbering formats)
    text = normalize_numbers_for_speech(text)

    # 9. Foreign Character Transliteration
    text = transliterate_for_tts(text)

    # 10. Roleplay Actions in Asterisks (strip gesture actions, preserve emphasis text)
    text = re.sub(r'\*\*(.*?)\*\*|__(.*?)__', lambda m: m.group(1) or m.group(2) or "", text)
    action_stems = [
        'wink', 'smile', 'giggle', 'laugh', 'sigh', 'pout', 'wave', 'nod',
        'shrug', 'chuckle', 'blush', 'cry', 'gasp', 'yawn', 'look', 'reset',
        'facepalm', 'point', 'cough', 'scream', 'whisper'
    ]
    def replace_single(m):
        inner = (m.group(1) or m.group(2) or "").strip()
        if not inner:
            return ""
        inner_lower = inner.lower()
        if any(stem in inner_lower for stem in action_stems):
            return ""
        return inner
    text = re.sub(r'\*([^*]+)\*|_([^_]+)_', replace_single, text)

    # 11. Technical Noise & Symbol Cleanup
    text = re.sub(r"\s*\[(?:tool call|AppID|truncated|SYSTEM)[^\]]*\]", "", text, flags=re.IGNORECASE)
    text = re.sub(r"\s*\((?:AppID:\s*\d+|file_path=[^\)]+|tool_call_id=[^\)]+)\)", "", text, flags=re.IGNORECASE)
    text = re.sub(r'\(\s*\)', '', text)  # Clean up empty parenthesis left behind by emoticons

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
    update_last_tts_time()
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
        print(f"[TTS] Kokoro Generation Error on GPU session: {e}")
        # If GPU failed (e.g. temporary VRAM pressure or allocation spike), attempt CPU fallback
        if _kokoro_using_gpu:
            try:
                print("[TTS] Attempting instant CPU fallback synthesis for text chunk...")
                import onnxruntime as ort
                from kokoro_onnx import Kokoro
                session_cpu = _build_session(["CPUExecutionProvider"])
                kokoro_cpu = Kokoro.from_session(session_cpu, str(VOICES_PATH))
                samples, sample_rate = await asyncio.to_thread(
                    kokoro_cpu.create, text, voice=kokoro_voice, speed=speed_factor, lang=lang_code
                )
                audio_buffer = io.BytesIO()
                sf.write(audio_buffer, samples, sample_rate, format='WAV')
                print("[TTS] CPU fallback synthesis succeeded!")
                return audio_buffer.getvalue()
            except Exception as cpu_err:
                print(f"[TTS] CPU fallback also failed: {cpu_err}")
        return b""
