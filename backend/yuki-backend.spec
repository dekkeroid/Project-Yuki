# -*- mode: python ; coding: utf-8 -*-
# PyInstaller spec for Yuki Backend
# Build: pyinstaller yuki-backend.spec

import os
import sys

block_cipher = None

# Paths
SPEC_DIR = os.path.dirname(os.path.abspath(SPECPATH))
BACKEND_DIR = SPEC_DIR

a = Analysis(
    [os.path.join(BACKEND_DIR, 'run.py')],
    pathex=[BACKEND_DIR],
    binaries=[],
    datas=[
        # Include .env as default config (next to the exe)
        (os.path.join(BACKEND_DIR, '.env'), '.'),
    ],
    hiddenimports=[
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
        'kokoro_onnx',
        'soundfile',

        # Whisper / STT
        'faster_whisper',

        # Web / crawling
        'bs4',
        'beautifulsoup4',
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

        # MCP
        'mcp',
        'mcp.client',
        'mcp.client.stdio',

        # Misc
        'dotenv',
        'requests',
        'multipart',
        'pypdf',
        'pykakasi',
        'pypinyin',
        'anyascii',
        'tinytag',
    ],
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
