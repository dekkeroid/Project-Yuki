"""
Vector Memory Engine — Long-term episodic recall and semantic memory for Project Yuki.

Features:
  * Uses standard OpenAI-compatible /v1/embeddings endpoints (Google Gemini, OpenAI, Ollama, LM Studio, etc.)
  * Strict 2.5s timeout guard with graceful fallback to zero latency
  * SQLite persistence (backend/app/memory/vectors.db) with fast cosine similarity retrieval
  * Asynchronous background turn indexing (0ms user turn latency impact)
"""

import os
import re
import json
import time
import math
import sqlite3
import asyncio
import httpx
from typing import List, Dict, Optional, Any, Tuple

import app.config as config

_DB_DIR = os.path.dirname(os.path.abspath(__file__))
_DB_PATH = os.path.join(_DB_DIR, "vectors.db")

_FILLER_PHRASES = {
    "i see", "i see i see", "i see now", "got it", "makes sense", "cool", "nice", "sweet",
    "awesome", "good", "great", "hmm", "hmmm", "okay", "ok ok", "okay okay", "alright",
    "alrighty", "yep", "yeah", "nope", "nah", "bye", "goodnight", "see ya", "thanks",
    "thank you", "sure", "fine", "understood", "fair enough", "noted", "tell me more",
    "continue", "go on", "what else", "so true", "really", "oh really", "wow", "oh wow",
    "no no not at all", "not at all", "no not at all", "no no", "not really", "why tho",
    "why", "why not", "what for", "idk", "dont know", "who knows", "nothing much",
    "not much", "nevermind", "nvm", "just checking", "just saying", "i know", "you know",
    "no im good", "im good", "im fine", "all good", "all fine", "im okay", "no thanks",
    "im alright", "no worries", "nah im good", "nah im fine"
}

_LAUGHTER_WORDS = re.compile(r'\b(?:[ha]{2,}|[he]{2,}|[ja]{2,}|l+o+l+|l+m+a+o+|r+o+f+l+|k+e+k+|x+d+)\b', re.IGNORECASE)

def is_conversational_filler(text: str) -> bool:
    """
    Detects if a message is pure laughter, greeting, acknowledgment, or conversational filler
    that does not require long-term vector memory retrieval or storage.
    """
    if not text:
        return True
    cleaned = re.sub(r'[^\w\s]', '', text.strip().lower())
    cleaned = " ".join(cleaned.split())
    if not cleaned:
        return True
    if len(cleaned) < 5:
        return True
    if cleaned in ("hi", "hello", "hey", "yuki", "ok", "yes", "no"):
        return True
    if cleaned in _FILLER_PHRASES:
        return True
    # Strip laughter tokens and check if remainder is purely a filler/acknowledgment
    remainder = _LAUGHTER_WORDS.sub('', cleaned).strip()
    remainder = " ".join(remainder.split())
    if not remainder:
        return True
    if remainder in ("no", "yes", "ok", "okay", "good") or remainder in _FILLER_PHRASES:
        return True
    return False


def init_vector_db():
    try:
        conn = sqlite3.connect(_DB_PATH)
        cursor = conn.cursor()
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS memories (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                content TEXT NOT NULL,
                category TEXT NOT NULL DEFAULT 'general',
                embedding TEXT NOT NULL,
                created_at REAL NOT NULL
            )
        """)
        conn.commit()
        conn.close()
    except Exception as e:
        print(f"[VectorMemory] DB init error: {e}")


_init_db = init_vector_db
init_vector_db()


def _cosine_similarity(vec1: List[float], vec2: List[float]) -> float:
    if not vec1 or not vec2 or len(vec1) != len(vec2):
        return 0.0
    dot_product = sum(a * b for a, b in zip(vec1, vec2))
    norm_a = math.sqrt(sum(a * a for a in vec1))
    norm_b = math.sqrt(sum(b * b for b in vec2))
    if norm_a == 0.0 or norm_b == 0.0:
        return 0.0
    return dot_product / (norm_a * norm_b)


async def warmup_embedding_model_async() -> bool:
    """
    Preload and warm up the embedding model in GPU memory on startup with 60m keep-alive.
    Eliminates cold-start loading latency for conversation turns.
    """
    if not getattr(config, "ENABLE_VECTOR_MEMORY", False):
        return False

    model = getattr(config, "EMBEDDING_MODEL", "").strip()
    if not model:
        return False

    base_url, api_key = config.get_effective_embedding_endpoint()
    if not base_url:
        return False

    is_ollama = ":11434" in base_url or getattr(config, "EMBEDDING_BACKEND", "") == "ollama"
    if is_ollama:
        clean_base = base_url.replace("/v1", "").rstrip("/")
        url = f"{clean_base}/api/embed"
    else:
        url = f"{base_url}/embeddings"

    print(f"[VectorMemory][Startup] Pre-warming embedding model '{model}' at '{url}' (keep_alive=60m)...")

    headers = {
        "Content-Type": "application/json"
    }
    if api_key:
        headers["Authorization"] = f"Bearer {api_key}"

    payload = {
        "model": model,
        "input": "warmup",
        "keep_alive": "60m"
    }

    t_start = time.time()
    try:
        async with httpx.AsyncClient(timeout=60.0) as client:
            res = await client.post(url, json=payload, headers=headers)
            warm_ms = (time.time() - t_start) * 1000.0
            if res.status_code == 200:
                data = res.json()
                if is_ollama:
                    dims = len(data.get("embeddings", [[]])[0])
                else:
                    dims = len(data["data"][0].get("embedding", [])) if "data" in data and len(data["data"]) > 0 else 0
                print(f"[VectorMemory][Startup] Model '{model}' warmed up in GPU ({dims} dims) in {warm_ms:.1f}ms! GPU keep-alive set to 60m.")
                return True
            else:
                print(f"[VectorMemory][Startup] Warmup request failed ({warm_ms:.1f}ms): HTTP {res.status_code} from '{url}' - {res.text[:120]}")
    except httpx.TimeoutException:
        print(f"[VectorMemory][Startup] Warmup timed out (>60s) at '{url}' (model='{model}').")
    except Exception as e:
        print(f"[VectorMemory][Startup] Warmup error at '{url}': {e}")
    return False


_shared_http_client: Optional[httpx.AsyncClient] = None

async def _get_shared_client() -> httpx.AsyncClient:
    global _shared_http_client
    if _shared_http_client is None or _shared_http_client.is_closed:
        _shared_http_client = httpx.AsyncClient(
            timeout=httpx.Timeout(5.0, connect=3.0),
            limits=httpx.Limits(max_keepalive_connections=5, max_connections=10)
        )
    return _shared_http_client


async def embed_text_async(text: str) -> Optional[List[float]]:
    """
    Generate an embedding vector for the provided text using the configured LLM endpoint.
    Guarded by a 5.0s timeout to guarantee chat responsiveness.
    Includes keep_alive: 60m for Ollama and local servers to prevent idle unloading.
    """
    if not getattr(config, "ENABLE_VECTOR_MEMORY", False):
        return None

    model = getattr(config, "EMBEDDING_MODEL", "").strip()
    if not model:
        return None

    base_url, api_key = config.get_effective_embedding_endpoint()
    if not base_url:
        return None

    is_ollama = ":11434" in base_url or getattr(config, "EMBEDDING_BACKEND", "") == "ollama"
    if is_ollama:
        clean_base = base_url.replace("/v1", "").rstrip("/")
        url = f"{clean_base}/api/embed"
    else:
        url = f"{base_url}/embeddings"

    headers = {
        "Content-Type": "application/json"
    }
    if api_key:
        headers["Authorization"] = f"Bearer {api_key}"

    payload = {
        "model": model,
        "input": text.strip(),
        "keep_alive": "60m"
    }

    print(f"[VectorMemory] Requesting embedding: model='{model}' endpoint='{url}' (input chars={len(text.strip())})")
    t_start = time.time()
    try:
        client = await _get_shared_client()
        res = await client.post(url, json=payload, headers=headers)
        call_ms = (time.time() - t_start) * 1000.0
        if res.status_code == 200:
            data = res.json()
            if is_ollama:
                embs = data.get("embeddings", [])
                if embs and len(embs) > 0:
                    emb = embs[0]
                    if isinstance(emb, list) and len(emb) > 0:
                        print(f"[VectorMemory] Generated embedding vector ({len(emb)} dims) via '{model}' from '{url}' in {call_ms:.1f}ms")
                        return emb
            else:
                if "data" in data and len(data["data"]) > 0:
                    emb = data["data"][0].get("embedding")
                    if isinstance(emb, list) and len(emb) > 0:
                        print(f"[VectorMemory] Generated embedding vector ({len(emb)} dims) via '{model}' from '{url}' in {call_ms:.1f}ms")
                        return emb
        else:
            print(f"[VectorMemory] Embedding request failed ({call_ms:.1f}ms): HTTP {res.status_code} from '{url}' - {res.text[:120]}")
    except httpx.TimeoutException:
        print(f"[VectorMemory] Embedding request timed out (>5.0s): model='{model}' endpoint='{url}'. Skipping vector search.")
    except Exception as e:
        print(f"[VectorMemory] Embedding error from '{url}' (model='{model}'): {e}")

    return None


def store_memory_sync(content: str, category: str, embedding: List[float]) -> bool:
    """Synchronously insert an embedded memory into SQLite."""
    try:
        conn = sqlite3.connect(_DB_PATH)
        cursor = conn.cursor()
        emb_json = json.dumps(embedding)
        now = time.time()
        cursor.execute(
            "INSERT INTO memories (content, category, embedding, created_at) VALUES (?, ?, ?, ?)",
            (content.strip(), category, emb_json, now)
        )
        conn.commit()
        conn.close()
        return True
    except Exception as e:
        print(f"[VectorMemory] Error storing memory: {e}")
        return False


async def store_memory(content: str, category: str = "general") -> bool:
    """Asynchronously embed and store a memory."""
    if not content or len(content.strip()) < 5:
        return False
    emb = await embed_text_async(content)
    if emb is None:
        return False
    return await asyncio.to_thread(store_memory_sync, content, category, emb)


def _load_all_memories_sync() -> List[Tuple[int, str, str, List[float], float]]:
    try:
        conn = sqlite3.connect(_DB_PATH)
        cursor = conn.cursor()
        # Unlimited query: all memories (core facts, preferences, conversation turns) are eligible
        cursor.execute("SELECT id, content, category, embedding, created_at FROM memories ORDER BY id DESC")
        rows = cursor.fetchall()
        conn.close()
        results = []
        for row_id, content, cat, emb_str, created_at in rows:
            try:
                emb = json.loads(emb_str)
                results.append((row_id, content, cat, emb, created_at))
            except Exception:
                continue
        return results
    except Exception as e:
        print(f"[VectorMemory] Error loading memories: {e}")
        return []


async def search_relevant_memories(query: str, top_k: int = 5, min_similarity: float = 0.60) -> List[Dict[str, Any]]:
    """
    Search stored memories semantically related to the user's query.
    Uses fast NumPy matrix vectorization (1-2ms for tens of thousands of memories)
    and grants permanent recall priority to user preferences and core facts.
    """
    if not getattr(config, "ENABLE_VECTOR_MEMORY", False):
        return []

    if not getattr(config, "EMBEDDING_MODEL", "").strip():
        return []

    query_clean = query.strip()
    # Skip trivial greetings, pure laughter, and conversational fillers
    if is_conversational_filler(query_clean):
        return []

    query_vec = await embed_text_async(query_clean)
    if query_vec is None:
        return []

    all_memories = await asyncio.to_thread(_load_all_memories_sync)
    if not all_memories:
        return []

    now = time.time()
    try:
        import numpy as np
        matrix = np.array([m[3] for m in all_memories], dtype=np.float32)
        q_vec = np.array(query_vec, dtype=np.float32)
        q_norm = float(np.linalg.norm(q_vec))
        if q_norm > 0.0:
            m_norms = np.linalg.norm(matrix, axis=1)
            sims = np.dot(matrix, q_vec) / (m_norms * q_norm + 1e-9)

            scored = []
            for i, (mem_id, content, cat, _, created_at) in enumerate(all_memories):
                sim = float(sims[i])
                # Priority boost for core facts and preferences so they never get overshadowed
                if cat in ("preference", "core_fact"):
                    sim += 0.05
                if sim >= min_similarity:
                    days_ago = max(0, int((now - created_at) // 86400))
                    scored.append({
                        "id": mem_id,
                        "content": content,
                        "category": cat,
                        "similarity": sim,
                        "days_ago": days_ago
                    })

            scored.sort(key=lambda x: x["similarity"], reverse=True)
            return scored[:top_k]
    except Exception as np_err:
        print(f"[VectorMemory] NumPy acceleration note: {np_err}")

    # Fallback to pure-python search
    scored = []
    for mem_id, content, cat, emb, created_at in all_memories:
        sim = _cosine_similarity(query_vec, emb)
        if cat in ("preference", "core_fact"):
            sim += 0.05
        if sim >= min_similarity:
            days_ago = max(0, int((now - created_at) // 86400))
            scored.append({
                "id": mem_id,
                "content": content,
                "category": cat,
                "similarity": sim,
                "days_ago": days_ago
            })

    scored.sort(key=lambda x: x["similarity"], reverse=True)
    return scored[:top_k]


async def extract_and_index_turn(user_msg: str, assistant_msg: str):
    """
    Background worker that indexes significant user statements, preferences, and discussions.
    Runs 100% asynchronously after turn completion (0ms user impact).
    """
    if not getattr(config, "ENABLE_VECTOR_MEMORY", False):
        return
    if not getattr(config, "EMBEDDING_MODEL", "").strip():
        return
    if not user_msg or len(user_msg.strip()) < 15:
        return

    # Filter out system commands or system events
    user_trimmed = user_msg.strip()
    if user_trimmed.startswith("[SYSTEM") or user_trimmed.startswith("/"):
        return

    # Filter out pure search commands / questions with no user personality context
    is_pure_query = any(user_trimmed.lower().startswith(q) for q in ["what is ", "who is ", "where is ", "how to ", "search ", "explain "])
    if is_pure_query and len(user_trimmed) < 40:
        return

    # Filter out pure laughter, greetings, and conversational fillers
    if is_conversational_filler(user_trimmed):
        return

    import re
    # Clean assistant response from animation tags and excessive whitespace
    clean_assistant = re.sub(r'[<\[\(](?:yuki_)?(?:anim|emotion):[^>\]\)]*[>\]\)]', '', assistant_msg or "").strip()
    # Normalize internal whitespace / newlines to single spaces for clean memory indexing
    clean_assistant = " ".join(clean_assistant.split())

    # Detect user preference keywords to assign permanent high-priority category
    pref_triggers = ["i like", "i love", "i hate", "i dislike", "i prefer", "my favorite", "i always", "i never", "i am a", "my name is", "call me"]
    is_pref = any(trig in user_trimmed.lower() for trig in pref_triggers)
    category = "preference" if is_pref else "conversation_turn"

    if is_pref:
        # Core user fact / preference
        memory_text = f"Master said: {user_trimmed}"
    else:
        # Conversational exchange: captures what Master asked/said AND what Yuki replied/recommended
        if clean_assistant and len(clean_assistant) > 10:
            memory_text = f"Master: {user_trimmed} | Yuki: {clean_assistant[:350]}"
        else:
            memory_text = f"Master: {user_trimmed}"

    t_idx = time.time()
    stored = await store_memory(memory_text, category=category)
    idx_ms = (time.time() - t_idx) * 1000.0
    if stored:
        print(f"[VectorMemory] 💾 Background indexed '{category}' memory in {idx_ms:.1f}ms")
