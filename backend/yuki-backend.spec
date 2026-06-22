# -*- mode: python ; coding: utf-8 -*-
# PyInstaller spec for Yuki Backend
# Build: cd backend && pyinstaller yuki-backend.spec --noconfirm

import os
import sys
from PyInstaller.utils.hooks import collect_all, collect_submodules

block_cipher = None

# The spec file lives in backend/, so resolve relative to it
BACKEND_DIR = os.getcwd()
SITE = os.path.join(BACKEND_DIR, 'venv', 'Lib', 'site-packages')

# ---------------------------------------------------------------------------
# Auto-collect data files, binaries and submodules for heavy dependencies
# ---------------------------------------------------------------------------
_kokoro_datas, _kokoro_bins, _kokoro_hidden = collect_all('kokoro_onnx')
_espeak_datas, _espeak_bins, _espeak_hidden = collect_all('espeakng_loader')
_phonemizer_datas, _phonemizer_bins, _phonemizer_hidden = collect_all('phonemizer')
_segments_datas, _segments_bins, _segments_hidden = collect_all('segments')
_csvw_datas, _csvw_bins, _csvw_hidden = collect_all('csvw')
_langtags_datas, _langtags_bins, _langtags_hidden = collect_all('language_tags')
_faster_datas, _faster_bins, _faster_hidden = collect_all('faster_whisper')
_ct2_datas, _ct2_bins, _ct2_hidden = collect_all('ctranslate2')
_ort_datas, _ort_bins, _ort_hidden = collect_all('onnxruntime')
_hf_datas, _hf_bins, _hf_hidden = collect_all('huggingface_hub')

# NVIDIA CUDA DLLs only (skip headers, .lib, Python files to save ~2GB)
_nvidia_dlls = []
_nvidia_subpkgs = ['cublas', 'cuda_runtime', 'cudnn', 'cufft', 'curand', 'cuda_nvrtc', 'nvjitlink']
for _subpkg in _nvidia_subpkgs:
    _bin_dir = os.path.join(SITE, 'nvidia', _subpkg, 'bin')
    if os.path.isdir(_bin_dir):
        for _f in os.listdir(_bin_dir):
            if _f.lower().endswith('.dll'):
                _nvidia_dlls.append((os.path.join(_bin_dir, _f), os.path.join('nvidia', _subpkg, 'bin')))
_nvidia_datas = []
_nvidia_bins = _nvidia_dlls
_nvidia_hidden = ['nvidia']

# ---------------------------------------------------------------------------
# Manual data / binary additions for packages PyInstaller can't auto-detect
# ---------------------------------------------------------------------------
manual_datas = [
    # pykakasi: kanji romanization dictionary
    (os.path.join(SITE, 'pykakasi', 'data'), os.path.join('pykakasi', 'data')),
    # Setup UI
    (os.path.join(BACKEND_DIR, 'app', 'setup.html'), os.path.join('app')),
    # Kokoro TTS models (~337MB) — bundled so setup skips download
    (os.path.join(BACKEND_DIR, 'app', 'voice', 'kokoro-v1.0.onnx'), os.path.join('app', 'voice')),
    (os.path.join(BACKEND_DIR, 'app', 'voice', 'voices-v1.0.bin'), os.path.join('app', 'voice')),
    # Whisper STT model (~141MB) — bundled so first use skips download
    (os.path.join(BACKEND_DIR, 'app', 'voice', 'whisper-base'), os.path.join('app', 'voice', 'whisper-base')),
    # soundfile: libsndfile DLL (soundfile is a .py file, not a package)
    (os.path.join(SITE, '_soundfile_data'), '_soundfile_data'),
    # av: FFmpeg DLLs for audio decoding (faster-whisper dependency)
    (os.path.join(SITE, 'av.libs'), 'av.libs'),
    # pywin32: COM support DLLs (pycaw, comtypes)
    (os.path.join(SITE, 'pywin32_system32'), 'pywin32_system32'),
]

manual_binaries = []

manual_hidden = [
    # FastAPI / uvicorn
    'uvicorn',
    'uvicorn.logging',
    'uvicorn.loops',
    'uvicorn.loops.auto',
    'uvicorn.protocols',
    'uvicorn.protocols.http',
    'uvicorn.protocols.http.auto',
    'uvicorn.protocols.websockets',
    'uvicorn.protocols.websockets.auto',
    'uvicorn.lifespan',
    'uvicorn.lifespan.on',
    'fastapi',
    'pydantic',

    # ONNX / TTS
    'onnxruntime',
    'soundfile',
    'espeakng_loader',

    # Whisper / STT
    'faster_whisper',
    'huggingface_hub',
    'huggingface_hub.file_download',
    'huggingface_hub.hf_api',
    'fsspec',

    # Web / crawling
    'bs4',
    'httpx',
    'aiohttp',

    # System
    'psutil',
    'watchdog',
    'watchdog.observers',
    'watchdog.events',
    'pyautogui',
    'PIL',

    # Windows audio
    'pycaw',
    'comtypes',

    # MCP (server + client + protocol types)
    'mcp',
    'mcp.client',
    'mcp.client.stdio',
    'mcp.server',
    'mcp.server.fastmcp',
    'mcp.types',
    'mcp.shared',
    'mcp.shared.session',

    # Misc
    'dotenv',
    'requests',
    'multipart',
    'pypdf',
    'pykakasi',
    'pypinyin',
    'anyascii',
    'tinytag',
    'colorlog',
    'anyio',
]

# ---------------------------------------------------------------------------
# Merge everything
# ---------------------------------------------------------------------------
all_datas = (
    manual_datas
    + _kokoro_datas + _espeak_datas + _phonemizer_datas
    + _segments_datas + _csvw_datas + _langtags_datas
    + _faster_datas + _ct2_datas + _ort_datas
    + _nvidia_datas + _hf_datas
)
all_binaries = (
    manual_binaries
    + _kokoro_bins + _espeak_bins + _phonemizer_bins
    + _segments_bins + _csvw_bins + _langtags_bins
    + _faster_bins + _ct2_bins + _ort_bins
    + _nvidia_bins + _hf_bins
)
all_hidden = (
    manual_hidden
    + _kokoro_hidden + _espeak_hidden + _phonemizer_hidden
    + _segments_hidden + _csvw_hidden + _langtags_hidden
    + _faster_hidden + _ct2_hidden + _ort_hidden
    + _nvidia_hidden + _hf_hidden
)

a = Analysis(
    [os.path.join(BACKEND_DIR, 'run.py')],
    pathex=[BACKEND_DIR],
    binaries=all_binaries,
    datas=all_datas,
    hiddenimports=all_hidden,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[
        'tkinter',
        'matplotlib',
        'numpy.random._examples',
    ],
    win_no_prefer_redirects=False,
    win_private_assemblies=False,
    cipher=block_cipher,
    noarchive=False,
)

pyz = PYZ(a.pure, a.zipped_data, cipher=block_cipher)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name='backend',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    console=True,
)

coll = COLLECT(
    exe,
    a.binaries,
    a.zipfiles,
    a.datas,
    strip=False,
    upx=True,
    upx_exclude=[],
    name='backend',
)
