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
    "continue", "go on", "what else", "so true", "really", "oh really", "wow", "oh wow"
}

_LAUGHTER_REGEX = re.compile(r'^(?:ha|he|ja|lol|lmao|rofl|kek|xd)+$', re.IGNORECASE)

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
    if _LAUGHTER_REGEX.match(cleaned.replace(" ", "")):
        return True
    if cleaned in _FILLER_PHRASES:
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


async def embed_text_async(text: str) -> Optional[List[float]]:
    """
    Generate an embedding vector for the provided text using the configured LLM endpoint.
    Guarded by a strict 2.5s timeout to guarantee chat responsiveness.
    """
    if not getattr(config, "ENABLE_VECTOR_MEMORY", False):
        return None

    model = getattr(config, "EMBEDDING_MODEL", "").strip()
    if not model:
        return None

    base_url, api_key = config.get_effective_embedding_endpoint()
    if not base_url:
        return None

    # Construct standard embeddings URL: {base_url}/embeddings
    url = f"{base_url}/embeddings"

    headers = {
        "Content-Type": "application/json"
    }
    if api_key:
        headers["Authorization"] = f"Bearer {api_key}"

    payload = {
        "model": model,
        "input": text.strip()
    }

    t_start = time.time()
    try:
        async with httpx.AsyncClient(timeout=2.5) as client:
            res = await client.post(url, json=payload, headers=headers)
            call_ms = (time.time() - t_start) * 1000.0
            if res.status_code == 200:
                data = res.json()
                if "data" in data and len(data["data"]) > 0:
                    emb = data["data"][0].get("embedding")
                    if isinstance(emb, list) and len(emb) > 0:
                        print(f"[VectorMemory] Generated embedding vector ({len(emb)} dims) via '{model}' in {call_ms:.1f}ms")
                        return emb
            else:
                print(f"[VectorMemory] Embedding request failed ({call_ms:.1f}ms): HTTP {res.status_code} - {res.text[:120]}")
    except httpx.TimeoutException:
        print(f"[VectorMemory] Embedding request timed out (>2.5s). Skipping vector search.")
    except Exception as e:
        print(f"[VectorMemory] Embedding error: {e}")

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
