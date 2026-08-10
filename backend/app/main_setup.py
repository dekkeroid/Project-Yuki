"""
Lightweight setup-only app.
Served when .yuki-ready is missing — no heavy imports (TTS, crawler, MCP).
"""
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.setup import router as setup_router

app = FastAPI(title="Yuki Setup", version="0.3.3-beta")

app.add_middleware(
    CORSMiddleware,
    allow_origin_regex=r".*",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(setup_router)

print("[Yuki] Setup mode - .yuki-ready not found. Serving setup UI.")
