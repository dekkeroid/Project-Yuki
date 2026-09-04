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
_NON_LATIN_CHUNK_RE = re.compile(r'([^\u0000-\u024F\u2000-\u206F\u2E00-\u2E7F\s]+)')


def _transliterate_non_latin_chunk(chunk: str) -> str:
    """Helper to transliterate non-Latin chunks (Japanese, Chinese, Cyrillic, etc.) to Latin/Romaji/Pinyin."""
    global _kks_instance
    # 1. Try pykakasi (covers Japanese Kanji, Hiragana, Katakana)
    try:
        if _kks_instance is None:
            import pykakasi
            _kks_instance = pykakasi.kakasi()
        res_kakasi = _kks_instance.convert(chunk)
        hepburn = [item['hepburn'] for item in res_kakasi if item.get('hepburn')]
        if hepburn and any(item.get('orig') != item.get('hepburn') for item in res_kakasi):
            return f" {' '.join(hepburn)} "
    except Exception:
        pass

    # 2. Try pypinyin for Chinese/Hanzi
    try:
        import pypinyin
        py_list = []
        for char in chunk:
            if 0x4E00 <= ord(char) <= 0x9FFF:
                py = pypinyin.lazy_pinyin(char)
                if py:
                    py_list.append(py[0])
                else:
                    py_list.append(char)
            else:
                py_list.append(char)
        if py_list and any(c != p for c, p in zip(chunk, py_list)):
            return f" {' '.join(py_list)} "
    except Exception:
        pass

    # 3. Fallback to anyascii for Cyrillic, Korean Hangul, Arabic, etc.
    try:
        from anyascii import anyascii
        return f" {anyascii(chunk)} "
    except Exception:
        return chunk


def transliterate_for_tts(text: str) -> str:
    """
    Transliterates non-Latin scripts (Japanese Kana/Kanji to Romaji, Chinese to Pinyin,
    Cyrillic to Latin) for Kokoro TTS.
    
    CRITICAL: Preserves all Latin characters including Latin-1 Supplement and Latin Extended
    accents (é, è, ê, à, á, ñ, ü, ö, ç, etc.). Kokoro's eSpeak engine natively understands
    accented Latin loanwords (e.g. café -> 'ka-fay', résumé -> 're-zoo-may', touché -> 'too-shay').
    We must NEVER run pykakasi or anyascii on Latin accented words, which would split them into
    isolated letters (e.g. 'café' -> 'caf e' -> 'cafi').
    """
    if not text:
        return ""

    # Fast path: If all characters are Latin (Basic Latin + Latin-1 + Latin Extended)
    # and standard punctuation/spaces, Kokoro natively handles them with 100% accuracy.
    if not re.search(r'[^\u0000-\u024F\u2000-\u206F\u2E00-\u2E7F\s]', text):
        return text

    # Transliterate only the non-Latin chunks, keeping all Latin words with accents completely intact
    parts = _NON_LATIN_CHUNK_RE.split(text)
    out = []
    for part in parts:
        if not part:
            continue
        if re.search(r'[^\u0000-\u024F\u2000-\u206F\u2E00-\u2E7F\s]', part):
            out.append(_transliterate_non_latin_chunk(part))
        else:
            out.append(part)

    return re.sub(r'\s+', ' ', "".join(out)).strip()


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


def year_to_words(year: int) -> str:
    """Converts a calendar year (e.g. 1995, 2023, 2026) into spoken English words."""
    if year < 1000 or year > 2999:
        return int_to_words_international(year)
    century = year // 100
    rem = year % 100
    if century == 20:
        if rem == 0:
            return "two thousand"
        elif rem < 10:
            return f"twenty oh-{_ONES[rem]}"
        else:
            return f"twenty {_below_1000_to_words(rem)}"
    else:
        c_words = _below_1000_to_words(century)
        if rem == 0:
            return f"{c_words} hundred"
        elif rem < 10:
            return f"{c_words} oh-{_ONES[rem]}"
        else:
            return f"{c_words} {_below_1000_to_words(rem)}"


_ORDINAL_SPECIAL = {
    1: "first", 2: "second", 3: "third", 4: "fourth", 5: "fifth",
    6: "sixth", 7: "seventh", 8: "eighth", 9: "ninth", 10: "tenth",
    11: "eleventh", 12: "twelfth", 13: "thirteenth", 14: "fourteenth",
    15: "fifteenth", 16: "sixteenth", 17: "seventeenth", 18: "eighteenth",
    19: "nineteenth", 20: "twentieth", 30: "thirtieth", 40: "fortieth",
    50: "fiftieth", 60: "sixtieth", 70: "seventieth", 80: "eightieth",
    90: "ninetieth"
}

def int_to_ordinal_words(n: int) -> str:
    """Converts an integer (e.g. 1, 2, 21, 100) into spoken ordinal words ('first', 'twenty-first')."""
    if n <= 0:
        return str(n)
    if n in _ORDINAL_SPECIAL:
        return _ORDINAL_SPECIAL[n]
    if n < 100:
        tens = (n // 10) * 10
        ones = n % 10
        return f"{_TENS[n // 10]}-{_ORDINAL_SPECIAL[ones]}"
    cardinal = int_to_words_international(n)
    words = cardinal.split()
    last = words[-1]
    if "-" in last:
        prefix, sub = last.split("-", 1)
        sub_n = {v: k for k, v in enumerate(_ONES)}.get(sub, 0)
        if sub_n in _ORDINAL_SPECIAL:
            words[-1] = f"{prefix}-{_ORDINAL_SPECIAL[sub_n]}"
            return " ".join(words)
    unit_map = {
        "one": "first", "two": "second", "three": "third", "four": "fourth",
        "five": "fifth", "six": "sixth", "seven": "seventh", "eight": "eighth",
        "nine": "ninth", "ten": "tenth", "eleven": "eleventh", "twelve": "twelfth",
        "hundred": "hundredth", "thousand": "thousandth", "million": "millionth",
        "billion": "billionth", "trillion": "trillionth"
    }
    if last in unit_map:
        words[-1] = unit_map[last]
        return " ".join(words)
    return cardinal + "th"


def normalize_ordinals_for_speech(text: str) -> str:
    """Converts written ordinals (e.g. 1st, 2nd, 3rd, 4th, 21st) into spoken words."""
    if not text:
        return ""
    def replace_ord(m):
        try:
            num = int(m.group(1))
            return int_to_ordinal_words(num)
        except Exception:
            return m.group(0)
    return re.sub(r'\b(\d{1,6})(?:st|nd|rd|th)\b', replace_ord, text, flags=re.IGNORECASE)


def normalize_times_for_speech(text: str) -> str:
    """
    Normalizes time formats into spoken English words.
    - 12-hour: 1:00 AM -> one AM, 1:05 PM -> one oh-five PM, 1:30 PM -> one thirty PM
    - 24-hour: 14:30 -> fourteen thirty, 08:00 -> eight hundred hours
    - Timestamps: 01:23:45 -> one hour twenty-three minutes forty-five seconds
    """
    if not text:
        return ""

    # 1. 12-hour format with AM / PM: 1:00 AM, 12:30 pm, 11:05 a.m., 1:00:30 PM
    def replace_12h(m):
        try:
            h = int(m.group(1))
            mins = int(m.group(2))
            sec_str = m.group(3)
            ampm_raw = m.group(4).replace('.', '').upper()

            h_words = _below_1000_to_words(h)
            if mins == 0:
                time_spoken = f"{h_words} {ampm_raw}"
            elif mins < 10:
                time_spoken = f"{h_words} oh-{_ONES[mins]} {ampm_raw}"
            else:
                time_spoken = f"{h_words} {_below_1000_to_words(mins)} {ampm_raw}"

            if sec_str:
                secs = int(sec_str)
                if secs > 0:
                    time_spoken += f" and {int_to_words_international(secs)} seconds"
            return time_spoken
        except Exception:
            return m.group(0)

    time_12h_regex = re.compile(r'\b([01]?\d|2[0-3]):([0-5]\d)(?::([0-5]\d))?\s*([ap]\.?m\.?)\b', re.IGNORECASE)
    text = time_12h_regex.sub(replace_12h, text)

    # 2. 3-part video/elapsed timestamps: 01:23:45 or 2:15:30
    def replace_timestamp(m):
        try:
            h = int(m.group(1))
            mins = int(m.group(2))
            secs = int(m.group(3))
            parts = []
            if h > 0:
                parts.append(f"{int_to_words_international(h)} hours" if h > 1 else "one hour")
            if mins > 0:
                parts.append(f"{int_to_words_international(mins)} minutes" if mins > 1 else "one minute")
            if secs > 0:
                parts.append(f"{int_to_words_international(secs)} seconds" if secs > 1 else "one second")
            return " ".join(parts) if parts else "zero seconds"
        except Exception:
            return m.group(0)

    timestamp_regex = re.compile(r'\b(\d{1,2}):([0-5]\d):([0-5]\d)\b')
    text = timestamp_regex.sub(replace_timestamp, text)

    # 3. 24-hour time or digital clock without AM/PM: 14:30, 08:00, 3:30 (avoiding ratios like 16:9)
    def replace_clock(m):
        try:
            h_str = m.group(1)
            h = int(h_str)
            mins = int(m.group(2))

            h_words = _below_1000_to_words(h)
            if mins == 0:
                if h >= 13 or (h_str.startswith('0') and len(h_str) == 2):
                    return f"{h_words} hundred hours"
                return f"{h_words} o'clock"
            elif mins < 10:
                return f"{h_words} oh-{_ONES[mins]}"
            else:
                return f"{h_words} {_below_1000_to_words(mins)}"
        except Exception:
            return m.group(0)

    clock_regex = re.compile(r'(?<![:\w])\b([01]?\d|2[0-3]):([0-5]\d)\b(?![:\w])')
    text = clock_regex.sub(replace_clock, text)

    return text


_MONTH_NAMES = {
    1: "January", 2: "February", 3: "March", 4: "April",
    5: "May", 6: "June", 7: "July", 8: "August",
    9: "September", 10: "October", 11: "November", 12: "December"
}

_MONTH_ABBR_MAP = {
    "jan": 1, "january": 1, "feb": 2, "february": 2,
    "mar": 3, "march": 3, "apr": 4, "april": 4,
    "may": 5, "jun": 6, "june": 6, "jul": 7, "july": 7,
    "aug": 8, "august": 8, "sep": 9, "sept": 9, "september": 9,
    "oct": 10, "october": 10, "nov": 11, "november": 11,
    "dec": 12, "december": 12
}

def normalize_dates_for_speech(text: str) -> str:
    """
    Normalizes dates for speech safely without guessing ambiguous formats:
    - ISO 8601: 2023-11-03 -> November third, twenty twenty-three
    - Named months: Nov 3, 2023 -> November third, twenty twenty-three
    - Unambiguous numeric (>12): 25/11/2023 -> twenty-fifth of November, twenty twenty-three
    - Ambiguous numeric (<=12): 11/03/2023 -> eleven slash three, twenty twenty-three (Zero Risk)
    - Years in context: in 2024 -> in twenty twenty-four
    """
    if not text:
        return ""

    # 1. ISO 8601 Date: YYYY-MM-DD (e.g. 2023-11-03)
    def replace_iso(m):
        try:
            year = int(m.group(1))
            month = int(m.group(2))
            day = int(m.group(3))
            m_name = _MONTH_NAMES.get(month, "")
            if m_name and 1 <= day <= 31:
                return f"{m_name} {int_to_ordinal_words(day)}, {year_to_words(year)}"
            return m.group(0)
        except Exception:
            return m.group(0)

    text = re.sub(r'\b(\d{4})-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])\b', replace_iso, text)

    # 2. Named Months: e.g. Nov 3, 2023 or November 3rd, 2023 or Nov 3
    def replace_named_month(m):
        try:
            m_str = m.group(1).lower()
            m_num = _MONTH_ABBR_MAP.get(m_str)
            if not m_num:
                return m.group(0)
            day = int(m.group(2))
            year_str = m.group(3)
            res = f"{_MONTH_NAMES[m_num]} {int_to_ordinal_words(day)}"
            if year_str:
                res += f", {year_to_words(int(year_str))}"
            return res
        except Exception:
            return m.group(0)

    named_month_regex = re.compile(
        r'\b(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\.?\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s+(\d{4}))?\b',
        re.IGNORECASE
    )
    text = named_month_regex.sub(replace_named_month, text)

    # 2b. Day of Named Month: e.g. 3rd of November 2023 or 15 March 2024
    def replace_day_named_month(m):
        try:
            day = int(m.group(1))
            m_str = m.group(2).lower()
            m_num = _MONTH_ABBR_MAP.get(m_str)
            if not m_num:
                return m.group(0)
            year_str = m.group(3)
            res = f"{int_to_ordinal_words(day)} of {_MONTH_NAMES[m_num]}"
            if year_str:
                res += f", {year_to_words(int(year_str))}"
            return res
        except Exception:
            return m.group(0)

    day_named_regex = re.compile(
        r'\b(\d{1,2})(?:st|nd|rd|th)?\s+(?:of\s+)?(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\.?(?:,?\s+(\d{4}))?\b',
        re.IGNORECASE
    )
    text = day_named_regex.sub(replace_day_named_month, text)

    # 3. Numeric dates: DD/MM/YYYY or MM/DD/YYYY or ambiguous 11/03/2023
    def replace_numeric_date(m):
        try:
            n1 = int(m.group(1))
            sep = m.group(2)
            n2 = int(m.group(3))
            year_val = int(m.group(4))
            if year_val < 100:
                year_val += 2000 if year_val < 50 else 1900

            # Case A: n1 > 12 and n2 <= 12 -> Unambiguously DD/MM/YYYY
            if n1 > 12 and 1 <= n2 <= 12 and n1 <= 31:
                return f"{int_to_ordinal_words(n1)} of {_MONTH_NAMES[n2]}, {year_to_words(year_val)}"

            # Case B: n1 <= 12 and n2 > 12 -> Unambiguously MM/DD/YYYY
            if 1 <= n1 <= 12 and n2 > 12 and n2 <= 31:
                return f"{_MONTH_NAMES[n1]} {int_to_ordinal_words(n2)}, {year_to_words(year_val)}"

            # Case C: Both <= 12 -> AMBIGUOUS! Do NOT take risk!
            if 1 <= n1 <= 12 and 1 <= n2 <= 12:
                sep_word = "slash" if sep == "/" else ("dash" if sep == "-" else "dot")
                return f"{int_to_words_international(n1)} {sep_word} {int_to_words_international(n2)}, {year_to_words(year_val)}"

            return m.group(0)
        except Exception:
            return m.group(0)

    numeric_date_regex = re.compile(r'\b(\d{1,2})([/\-\.])(\d{1,2})\2(\d{4}|\d{2})\b')
    text = numeric_date_regex.sub(replace_numeric_date, text)

    # 3b. 2-part dates: DD/MM or MM/DD (e.g. 11/03, 05/06, or preceded by date prepositions)
    def replace_2part_date(m):
        try:
            prefix = m.group(1) or ""
            n1 = int(m.group(2))
            sep = m.group(3)
            s2 = m.group(4)
            n2 = int(s2)

            is_date = bool(prefix.strip()) or m.group(2).startswith('0') or s2.startswith('0') or n1 > 12 or n2 > 12
            if not is_date:
                return m.group(0)

            # Case A: n1 > 12 and 1 <= n2 <= 12 (e.g. 25/11)
            if n1 > 12 and 1 <= n2 <= 12 and n1 <= 31:
                return f"{prefix}{int_to_ordinal_words(n1)} of {_MONTH_NAMES[n2]}"

            # Case B: 1 <= n1 <= 12 and n2 > 12 (e.g. 11/25)
            if 1 <= n1 <= 12 and n2 > 12 and n2 <= 31:
                return f"{prefix}{_MONTH_NAMES[n1]} {int_to_ordinal_words(n2)}"

            # Case C: Both <= 12 -> AMBIGUOUS! Option 1: Safe spoken slash/dash/dot
            if 1 <= n1 <= 12 and 1 <= n2 <= 12:
                sep_word = "slash" if sep == "/" else ("dash" if sep == "-" else "dot")
                return f"{prefix}{int_to_words_international(n1)} {sep_word} {int_to_words_international(n2)}"

            return m.group(0)
        except Exception:
            return m.group(0)

    two_part_date_regex = re.compile(
        r'(?i)(\b(?:on|by|date:?|dated|until|due)\s+)?\b(\d{1,2})([/\-\.])(\d{1,2})\b(?![/\-\.]\d)'
    )
    text = two_part_date_regex.sub(replace_2part_date, text)

    # 4. Spoken Years when explicitly preceded by prepositions: "in 2024", "since 1998"
    def replace_prep_year(m):
        try:
            prep = m.group(1)
            y = int(m.group(2))
            return f"{prep} {year_to_words(y)}"
        except Exception:
            return m.group(0)

    text = re.sub(r'\b(in|since|from|year|during|circa)\s+(19\d\d|20\d\d)\b', replace_prep_year, text, flags=re.IGNORECASE)

    return text


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


# ─────────────────────────────────────────────────────────────────────────────
# Declarative Pronunciation Lexicon (W3C PLS Tier 2 Overrides)
# ─────────────────────────────────────────────────────────────────────────────
# Centralized dictionary for words that eSpeak-ng mispronounces due to dictionary
# gaps (e.g. missing diacritic entries), tech acronyms, libraries, or proper nouns.
PRONUNCIATION_LEXICON: dict[str, str] = {
    # ── eSpeak-ng English Loanword Dictionary Gaps ───────────────────────────
    # eSpeak indexed the plain-ASCII spelling with authentic /h/ and /nj/,
    # but omitted the diacritic spelling, falling back to English /dʒ/ ("j").
    "jalapeño": "jalapeno",
    "jalapeños": "jalapenos",
    "habanero": "habanero",
    "habañero": "habanero",

    # ── Initialisms & Short Forms (Spelled letter-by-letter) ────────────────
    # Prevent eSpeak from reading abbreviations with vowels as phonetic words (e.g. 'upsk')
    "upsc": "U.P.S.C.",
    "iocl": "I.O.C.L.",
    "obc": "O.B.C.",
    "vad": "V.A.D.",

    # ── Conversational & Chat Shorthand (Expanded to spoken words) ───────────
    "btw": "by the way",
    "tbh": "to be honest",
    "idk": "I don't know",
    "imo": "in my opinion",
    "imho": "in my humble opinion",
    "aka": "also known as",
    "asap": "as soon as possible",
    "afaik": "as far as I know",
    "iirc": "if I recall correctly",
    "bff": "best friend forever",
    "bffs": "best friends forever",
    "gf": "girlfriend",
    "gfs": "girlfriends",
    "bf": "boyfriend",
    "bfs": "boyfriends",
    "brb": "be right back",
    "np": "no problem",
    "omg": "oh my god",
    "pov": "point of view",
    "wip": "work in progress",
    "tbd": "to be determined",
    "tba": "to be announced",
    "eta": "E.T.A.",
    "fyi": "for your information",
    "poc": "proof of concept",
    "dm": "D.M.",
    "dms": "D.M.s",

    # ── Tech Terms, Libraries & Acronyms ─────────────────────────────────────
    "sqlite": "sequel lite",
    "fastapi": "fast A P I",
    "regex": "reg ex",
    "regexes": "reg exes",
    "pytorch": "pie torch",
    "github": "git hub",
    "gitlab": "git lab",
    "npm": "N P M",
    "stdout": "standard out",
    "stdin": "standard in",
    "stderr": "standard error",
    "wifi": "why fye",
    "wi-fi": "why fye",
}


def apply_pronunciation_lexicon(text: str) -> str:
    """
    Applies the declarative PRONUNCIATION_LEXICON to text with case-preserving replacements.
    Uses regex word boundaries so substrings inside other words are never accidentally altered.
    """
    import re
    if not text:
        return text

    for word, replacement in PRONUNCIATION_LEXICON.items():
        pattern = rf'\b{re.escape(word)}\b'
        def _match_case(m):
            matched = m.group(0)
            if matched.isupper() and not any(c.isspace() for c in replacement):
                return replacement.upper()
            if matched[0].isupper() and not matched.islower():
                # Capitalize first letter while preserving inner acronym casing (e.g. "Fast A P I")
                return replacement[0].upper() + replacement[1:]
            return replacement
        text = re.sub(pattern, _match_case, text, flags=re.IGNORECASE)

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

    # 0.6 Collapse repeated character elongations (e.g. "soooo" -> "soo", "noooo" -> "noo", "hmmmm" -> "hmm")
    # This prevents G2P models from stuttering or spelling out words letter-by-letter.
    text = re.sub(r'([a-zA-Z])\1{2,}', r'\1\1', text)
    # Strip sleep/snore tokens like zzz / zzzz
    text = re.sub(r'\b[zZ]{2,}\b', '', text)
    # Normalize 3+ multi-dots into standard ellipsis
    text = re.sub(r'\.{3,}', '...', text)

    # 1. Strip thought / reasoning / think blocks (including unclosed tags)
    text = re.sub(r'<(thought|think|reasoning)>[\s\S]*?</\1>', '', text, flags=re.IGNORECASE)
    text = re.sub(r'<(thought|think|reasoning)>[\s\S]*$', '', text, flags=re.IGNORECASE)

    # 2. Strip unique animation and emotion tags (<yuki_anim:.../>, <yuki_anim eer >, [yuki_anim:...], [anim:...], etc.)
    text = re.sub(r'[<\[\(](?:yuki_)?(?:anim|emotion)[:\s]+[a-zA-Z0-9_\-\s]*?(?:\/?>|[\]\)])', '', text, flags=re.IGNORECASE)
    text = re.sub(r'<yuki_[^>]*>', '', text, flags=re.IGNORECASE)

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

    # 7.5 Times & Dates Normalization (Runs before slash fraction and range dash replacements)
    text = normalize_times_for_speech(text)
    text = normalize_dates_for_speech(text)

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
    text = re.sub(r'(-)?\s*(\d+(?:\.\d+)?)\s*°[CC]', lambda m: f"{'minus ' if m.group(1) else ''}{m.group(2)} degrees Celsius", text)
    text = re.sub(r'(-)?\s*(\d+(?:\.\d+)?)\s*°[FF]', lambda m: f"{'minus ' if m.group(1) else ''}{m.group(2)} degrees Fahrenheit", text)
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

    # 8.1 Tech, Hardware & Performance Units
    text = re.sub(r'(\d+(?:\.\d+)?)\s*(?:fps|FPS)\b', r'\1 frames per second', text)
    text = re.sub(r'(\d+(?:\.\d+)?)\s*(?:Hz|hz)\b', r'\1 hertz', text)
    text = re.sub(r'(\d+(?:\.\d+)?)\s*(?:kHz|khz)\b', r'\1 kilohertz', text)
    text = re.sub(r'(\d+(?:\.\d+)?)\s*(?:MHz|mhz)\b', r'\1 megahertz', text)
    text = re.sub(r'(\d+(?:\.\d+)?)\s*(?:GHz|ghz)\b', r'\1 gigahertz', text)
    text = re.sub(r'(\d+(?:\.\d+)?)\s*ms\b', r'\1 milliseconds', text)
    text = re.sub(r'(\d+(?:\.\d+)?)\s*ns\b', r'\1 nanoseconds', text)
    text = re.sub(r'(\d+(?:\.\d+)?)\s*(?:px|PX)\b', r'\1 pixels', text)
    text = re.sub(r'(\d+(?:\.\d+)?)\s*(?:kbps|Kbps)\b', r'\1 kilobits per second', text)
    text = re.sub(r'(\d+(?:\.\d+)?)\s*(?:mbps|Mbps)\b', r'\1 megabits per second', text)
    text = re.sub(r'(\d+(?:\.\d+)?)\s*(?:gbps|Gbps)\b', r'\1 gigabits per second', text)
    text = re.sub(r'(\d+(?:\.\d+)?)\s*(?:kW|kw)\b', r'\1 kilowatts', text)
    text = re.sub(r'(\d+(?:\.\d+)?)\s*(?:kWh|kwh)\b', r'\1 kilowatt hours', text)
    text = re.sub(r'(\d+(?:\.\d+)?)\s*W\b', r'\1 watts', text)
    text = re.sub(r'(\d+(?:\.\d+)?)\s*V\b', r'\1 volts', text)
    text = re.sub(r'\b4[kK]\b', 'four K', text)
    text = re.sub(r'\b8[kK]\b', 'eight K', text)

    # 8.2 Standalone Negative Numbers (e.g. -5 outside of units)
    text = re.sub(r'(^|[\s(])-\s*(\d+(?:\.\d+)?)', r'\1minus \2', text)

    # 8.3 Aspect Ratios & Dimensions (e.g. 1920x1080, 4x4, 16:9)
    aspect_ratios = {
        "16:9": "sixteen by nine", "4:3": "four by three",
        "21:9": "twenty-one by nine", "3:2": "three by two",
        "1:1": "one to one"
    }
    for ar, ar_words in aspect_ratios.items():
        text = re.sub(rf'\b{ar}\b', ar_words, text)

    def replace_dim(m):
        w_str, h_str = m.group(1), m.group(2)
        dim_map = {
            "1920": "nineteen twenty", "1080": "ten eighty",
            "1440": "fourteen forty", "3840": "thirty-eight forty",
            "2160": "twenty-one sixty", "2560": "twenty-five sixty",
            "1280": "twelve eighty", "720": "seven twenty"
        }
        w_spoken = dim_map.get(w_str, int_to_words_international(int(w_str)))
        h_spoken = dim_map.get(h_str, int_to_words_international(int(h_str)))
        return f"{w_spoken} by {h_spoken}"
    text = re.sub(r'\b(\d{1,5})\s*[xX×]\s*(\d{1,5})\b', replace_dim, text)

    # 8.4 Ordinal Numbers (1st, 2nd, 3rd, 21st, etc.)
    text = normalize_ordinals_for_speech(text)

    # 8.7 Software Multi-dot versions (e.g. v1.2.3 -> version one point two point three)
    text = re.sub(r'\bv(\d+(?:\.\d+)+)\b', r'version \1', text, flags=re.IGNORECASE)
    def replace_multidot(m):
        parts = m.group(1).split('.')
        spoken_parts = [int_to_words_international(int(p)) for p in parts]
        return " point ".join(spoken_parts)
    text = re.sub(r'\b(\d+(?:\.\d+){2,})\b', replace_multidot, text)

    # 8.8 AI & Tech Acronyms
    acronyms = [
        (r'\bGPT-4o\b', 'GPT four oh'),
        (r'\bGPT-4\b', 'GPT four'),
        (r'\bLLMs\b', 'L L Ms'),
        (r'\bLLM\b', 'L L M'),
        (r'\bAPIs\b', 'A P Is'),
        (r'\bAPI\b', 'A P I'),
        (r'\bCLIs\b', 'C L Is'),
        (r'\bCLI\b', 'C L I'),
        (r'\bGUI\b', 'G U I'),
        (r'\bUI/UX\b', 'U I, U X'),
        (r'\bPRs\b', 'P Rs'),
        (r'\bPR\b', 'P R'),
        (r'\bFAQs\b', 'F A Qs'),
        (r'\bFAQ\b', 'F A Q'),
        (r'\bTL;?DR\b', 'T L D R'),
        (r'(^|\s)w/(?=\s|$)', r'\1with'),
        (r'(^|\s)w/o(?=\s|$)', r'\1without'),
    ]
    for pat, rep in acronyms:
        text = re.sub(pat, rep, text)

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

    # 9.5 Declarative Pronunciation Lexicon (loanword gaps & tech terms)
    text = apply_pronunciation_lexicon(text)

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


# ─────────────────────────────────────────────────────────────────────────────
# Kokoro Expressive Interjections: Direct IPA Injections
# ─────────────────────────────────────────────────────────────────────────────
KOKORO_IPA_INTERJECTIONS = [
    # Sleepy sounds, groans & vocal murmurs
    (r'\b[Mm]+r+g+h*\b', 'mɚːɡ'),                 # Mmrgh, mrgh -> "mrrg" (sleepy groan)
    (r'\b[Mm]+g+h+\b', 'mː'),                      # Mgh, mmgh -> "mmm" (closed mouth mutter)
    (r'\b[Hh]+m+p+h+!*\b', 'hˈəmf!'),              # Hmph, hmph! -> "humph!" (sassy scoff)
    (r'\b[Uu]+g+h+\b', 'ˈʌɡ'),                     # Ugh -> "ugh" (exasperated sigh)
    (r'\b[Gg]+u+h+\b|\b[Gg]+a+h+\b', 'ɡˈʌ'),       # Guh, gah -> "guh" (flustered choke)
    (r'\b[Bb]+l+e+h+\b', 'blˈɛ'),                  # Bleh -> "bleh" (playful tongue-out)
    (r'\b[Ee]+w+\b', 'ˈiːjuː'),                    # Eww, ew -> "ee-yoo" (disgusted cringe)
    (r'\b[Oo]{2,}f+\b', 'ˈuːf'),                   # Oof, ooff -> "oof" (requires >=2 o's, never matches "off")
    
    # Hums, fillers & contemplation
    (r'\b[Mm]+-[Hh]+m+\b|\b[Mm]+h+m+\b', 'mˈhm̩'), # Mm-hmm, mmhmm, mhm -> affirmative nod
    (r'\b[Hh]+m+\b\?', 'hmˈ↗?'),                  # Hmm? -> inquisitive rising hum
    (r'\b[Hh]+m+\b', 'hmː'),                      # Hmmm, hmm -> smooth closed-mouth hum without 'uh' vowel
    (r'\b[Mm]{2,}\b\?', 'mˈ↗?'),                   # Mm? -> inquisitive rising closed-mouth hum
    (r'\b[Mm]{2,}\b', 'mː'),                       # Mm, Mmm, Mmmm -> gentle closed-mouth humming murmur
    (r'\b[Mm]+h+\b', 'mː'),                        # Mmh, mmh -> soft hum
    (r'\b[Nn]{2,}\b', 'nː'),                       # Nn, Nnn -> soft nasal hum
    (r'\b[Uu]+h+-[Hh]+u+h+\b', 'ˈʌhˈʌ'),          # Uh-huh -> casual affirmative
    (r'\b[Uu]+h+-[Oo]+h+!*\b|\b[Uu]+h+o+h+!*\b', 'ˈʌˈoʊ!'), # Uh-oh -> playful melodic alarm
    (r'\b[Uu]+m+\b', 'ˈʌmː'),                      # Ummm, um -> thinking hesitation filler
    
    # Whispers, scoffs & non-verbal sounds
    (r'\b[Pp]+f+t+\b', 'pˈfət'),                   # Pfft -> dismissive puff / snort
    (r'\b[Ss]+h{2,}\b', 'ʃː'),                     # Shh, shhh -> sustained hush whisper
    (r'\b[Tt]+s+k+(?:-[Tt]+s+k+)*\b', 'tˈəsk'),    # Tsk, tsk-tsk -> tongue-clicking reprimand
    (r'\b[Aa]+r+g+h*\b', 'ˈɑːɹɡ'),                # Argh, arghhh -> dramatic frustrated outburst
    (r'\b[Aa]+w+\b', 'ˈɔːː'),                      # Aww, awww -> soft coo
    
    # Anime persona expressive sounds
    (r'\b[Ff]+u+f+u+f+u+\b', 'həhəhə'),           # Fufufu -> aristocratic anime chuckles
    (r'\b[Ff]+u+e{2,}\b', 'fjˈuːː'),              # Fueee -> flustered anime whine
    (r'\b[Ee]+-[Ee]+h+\b\??', 'ˈeːːʔ?!'),          # E-Ehh?! -> surprised high-pitched gasp
    (r'\b[Nn]+y+a+h*\b', 'njˈɑː'),                # Nya, nyah -> crisp anime cat sound
    (r'\b[Hh]+e+h+e+\b', 'hˈɛhɛ'),                # Hehe -> chuckle
    (r'\b[Hh]+e+h+\b', 'hˈɛ'),                     # Heh -> quiet smirk
]

# ─────────────────────────────────────────────────────────────────────────────
# Clean Text Fallbacks (When Direct IPA Injection is OFF)
# Replaces non-dictionary groans/fillers with clean spoken words so Kokoro
# never spells out letters like "M-M-R-G-H" or "P-E-E-F-F-T".
# ─────────────────────────────────────────────────────────────────────────────
KOKORO_CLEAN_TEXT_FALLBACKS = [
    # Sleepy sounds, groans & vocal murmurs
    (r'\b[Mm]+r+g+h*\b', 'Ugh'),                  # Mmrgh, mrgh -> Ugh
    (r'\b[Mm]+g+h+\b', 'Mmh'),                    # Mgh, mmgh -> Mmh
    (r'\b[Hh]+m+p+h+!*\b', 'Humph!'),              # Hmph, hmph! -> Humph!
    (r'\b[Uu]+g+h+\b', 'Ugh'),                    # Ugh -> Ugh
    (r'\b[Gg]+u+h+\b|\b[Gg]+a+h+\b', 'Gah'),      # Guh, gah -> Gah
    (r'\b[Bb]+l+e+h+\b', 'Bleh'),                 # Bleh -> Bleh
    (r'\b[Ee]+w+\b', 'Ew'),                       # Eww, ewww -> Ew
    (r'\b[Oo]{2,}f+\b', 'Oof'),                   # Oof, ooff -> Oof (requires >=2 o's, never matches "off")
    
    # Hums, fillers & contemplation
    (r'\b[Mm]+-[Hh]+m+\b|\b[Mm]+h+m+\b', 'Uh-huh'), # Mm-hmm, mmhmm, mhm -> Uh-huh
    (r'\b[Hh]+m+\b\?', 'Hm?'),                    # Hmm? -> Hm?
    (r'\b[Hh]+m+\b', 'Hmm'),                      # Hmmmm, hmm -> Hmm
    (r'\b[Mm]{2,}\b\?', 'Hm?'),                   # Mm? -> Hm?
    (r'\b[Mm]{2,}\b', 'Hmm'),                     # Mm, Mmm -> Hmm (spoken as "hum" instead of spelling "M-M")
    (r'\b[Mm]+h+\b', 'Hmm'),                      # Mmh -> Hmm
    (r'\b[Nn]{2,}\b', 'Hmm'),                     # Nn, Nnn -> Hmm
    (r'\b[Uu]+h+-[Hh]+u+h+\b', 'Uh-huh'),         # Uh-huh -> Uh-huh
    (r'\b[Uu]+h+-[Oo]+h+!*\b|\b[Uu]+h+o+h+!*\b', 'Uh-oh!'), # Uh-oh -> Uh-oh!
    (r'\b[Uu]+m+\b', 'Um'),                       # Ummm, um -> Um
    
    # Whispers, scoffs & non-verbal sounds
    (r'\b[Pp]+f+t+\b', 'Hah'),                    # Pfft -> Hah
    (r'\b[Ss]+h{2,}\b', 'Hush'),                  # Shh, shhh -> Hush
    (r'\b[Tt]+s+k+(?:-[Tt]+s+k+)*\b', 'Tsk'),     # Tsk, tsk-tsk -> Tsk
    (r'\b[Aa]+r+g+h*\b', 'Ah'),                   # Argh, arghhh -> Ah
    (r'\b[Aa]+w+\b', 'Aw'),                       # Aww, awww -> Aw
    
    # Anime persona expressive sounds
    (r'\b[Ff]+u+f+u+f+u+\b', 'Hehehe'),           # Fufufu -> Hehehe
    (r'\b[Ff]+u+e{2,}\b', 'Whaa'),                # Fueee -> Whaa
    (r'\b[Ee]+-[Ee]+h+\b\??', 'Eh?!'),            # E-Ehh?! -> Eh?!
    (r'\b[Nn]+y+a+h*\b', 'Nya'),                  # Nya, nyah -> Nya
    (r'\b[Hh]+e+h+e+\b', 'Hehe'),                 # Hehe -> Hehe
    (r'\b[Hh]+e+h+\b', 'Heh'),                    # Heh -> Heh
]


def clean_text_fallback_interjections(text: str) -> str:
    """
    Substitutes non-dictionary conversational vocalizations with standard
    dictionary English words so standard TTS produces natural speech without
    spelling out abbreviations or acronyms letter-by-letter.
    """
    if not text:
        return ""
    modified = text
    for pattern, fallback_word in KOKORO_CLEAN_TEXT_FALLBACKS:
        def _repl(match):
            raw_punc = match.group('trailing_punc') or ''
            if fallback_word.endswith(('!', '?')) and raw_punc.startswith(('!', '?')):
                raw_punc = ''
            return f" {fallback_word}{raw_punc} "
        full_pattern = pattern + r'(?P<trailing_punc>\.{3,}|…|[.,!?;])?'
        modified = re.sub(full_pattern, _repl, modified, flags=re.IGNORECASE)
    return re.sub(r'\s+', ' ', modified).strip()

_IPA_PLACEHOLDER_WORDS = [
    'xyzalpha', 'xyzbravo', 'xyzcharlie', 'xyzdelta', 'xyzecho',
    'xyzfoxtrot', 'xyzgolf', 'xyzhotel', 'xyzindia', 'xyzjuliet'
]
_IPA_TAG_PHONEME_CACHE = {}


def _get_placeholder_phoneme(tag: str, tokenizer, lang: str) -> str:
    key = (tag, lang)
    if key not in _IPA_TAG_PHONEME_CACHE:
        _IPA_TAG_PHONEME_CACHE[key] = tokenizer.phonemize(tag, lang)
    return _IPA_TAG_PHONEME_CACHE[key]


def phonemize_with_ipa_interjections(text: str, tokenizer, lang: str = "en-us") -> str:
    """
    Substitutes non-dictionary conversational vocalizations and anime expressions
    with exact Kokoro IPA symbols, bypassing espeak letter-by-letter spelling.
    Uses cached placeholder tokens and preserves sentence punctuation to achieve
    zero latency penalty compared to raw synthesis.
    """
    if not text or not tokenizer:
        return text

    placeholders = {}
    counter = 0
    modified_text = text

    for pattern, ipa_val in KOKORO_IPA_INTERJECTIONS:
        def _repl(match):
            nonlocal counter
            tag = _IPA_PLACEHOLDER_WORDS[counter % len(_IPA_PLACEHOLDER_WORDS)]
            raw_punc = match.group('trailing_punc')
            if raw_punc:
                if ipa_val.endswith(('!', '?')) and raw_punc.startswith(('!', '?')):
                    punc = ''
                else:
                    punc = raw_punc
            else:
                punc = '' if ipa_val.endswith(('!', '?')) else ','
            placeholders[tag] = f"{ipa_val}{punc}"
            counter += 1
            return f" {tag} "
        # Capture optional trailing punctuation (. , ! ? ... etc.)
        full_pattern = pattern + r'(?P<trailing_punc>\.{3,}|…|[.,!?;])?'
        modified_text = re.sub(full_pattern, _repl, modified_text, flags=re.IGNORECASE)

    if not placeholders:
        return tokenizer.phonemize(text, lang)

    # Exactly ONE single espeak phonemization pass for the entire text
    phonemes = tokenizer.phonemize(modified_text, lang)

    # Instant in-memory substitution using cached tag phonemes
    for tag, ipa_replacement in placeholders.items():
        tag_phoneme = _get_placeholder_phoneme(tag, tokenizer, lang)
        phonemes = phonemes.replace(tag_phoneme, ipa_replacement)

    # Clean any accidental double punctuation or spacing
    phonemes = re.sub(r',[,.]+', ',', phonemes)
    phonemes = re.sub(r'\s+', ' ', phonemes).strip()
    if phonemes.endswith(','):
        phonemes = phonemes[:-1].strip()
    return phonemes


async def generate_speech_bytes(
    text: str,
    voice: str = None,
    rate: str = None,
    ipa_enhancement: bool = None,
) -> bytes:
    """
    Generates WAV audio bytes for a given text using Kokoro-ONNX locally.
    Supports ipa_enhancement (Direct IPA Interjections) for natural conversational filler sounds.
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

        effective_ipa = ipa_enhancement if ipa_enhancement is not None else getattr(config, "KOKORO_IPA_INTERJECTIONS", False)
        target_payload = text
        is_pho = False

        if effective_ipa and lang_code.startswith("en") and hasattr(kokoro, "tokenizer"):
            try:
                target_payload = phonemize_with_ipa_interjections(text, kokoro.tokenizer, lang=lang_code)
                is_pho = True
            except Exception as pe:
                print(f"[TTS] IPA interjections phonemization fallback: {pe}")
                target_payload = clean_text_fallback_interjections(text)
                is_pho = False
        else:
            # When IPA injection is OFF: apply Clean Text Fallback to avoid letter-by-letter spelling
            target_payload = clean_text_fallback_interjections(text)
            is_pho = False

        samples, sample_rate = await asyncio.to_thread(
            kokoro.create, target_payload, voice=kokoro_voice, speed=speed_factor, lang=lang_code, is_phonemes=is_pho
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
                    kokoro_cpu.create, target_payload, voice=kokoro_voice, speed=speed_factor, lang=lang_code, is_phonemes=is_pho
                )
                audio_buffer = io.BytesIO()
                sf.write(audio_buffer, samples, sample_rate, format='WAV')
                print("[TTS] CPU fallback synthesis succeeded!")
                return audio_buffer.getvalue()
            except Exception as cpu_err:
                print(f"[TTS] CPU fallback also failed: {cpu_err}")
        return b""
