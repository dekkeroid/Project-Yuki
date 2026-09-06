"""
VRM Model & Multi-Outfit Catalog Manager for Project Yuki.

Discovers bundled and custom VRM models, automatically detects character variants
and outfits (e.g. 'mixup.vrm' and 'mixup with hat.vrm'), manages catalog structures,
and provides the 'change_avatar_outfit' AI action tool.
"""

import os
import re
import json
import logging
import asyncio
from pathlib import Path
from typing import Optional, Dict, List, Any, Tuple

from app import config

logger = logging.getLogger("yuki.vrm_catalog")

# Global broadcast callback and shared memory manager wired from main.py
_broadcast_profile_callback = None
_main_loop = None
_shared_memory_manager = None


def set_profile_broadcast_callback(cb, loop=None):
    """Register the profile broadcast callback (called from main.py at startup)."""
    global _broadcast_profile_callback, _main_loop
    _broadcast_profile_callback = cb
    _main_loop = loop


def set_memory_manager(mgr):
    """Register the shared MemoryManager instance."""
    global _shared_memory_manager
    _shared_memory_manager = mgr


def get_memory_manager():
    """Retrieve the shared MemoryManager instance, falling back to app.main or a fresh instance."""
    global _shared_memory_manager
    if _shared_memory_manager is not None:
        return _shared_memory_manager
    try:
        from app.main import memory_manager
        if memory_manager is not None:
            _shared_memory_manager = memory_manager
            return _shared_memory_manager
    except Exception:
        pass
    try:
        from app.memory.local_mem import MemoryManager
        _shared_memory_manager = MemoryManager()
        return _shared_memory_manager
    except Exception:
        return None


def _broadcast_profile_sync():
    """Trigger a profile update WebSocket broadcast from any sync or async context."""
    if not _broadcast_profile_callback:
        return
    try:
        loop = _main_loop
        if loop is None or loop.is_closed():
            try:
                loop = asyncio.get_running_loop()
            except RuntimeError:
                loop = None

        if loop and loop.is_running():
            asyncio.run_coroutine_threadsafe(_broadcast_profile_callback(), loop)
        else:
            try:
                asyncio.run(_broadcast_profile_callback())
            except RuntimeError:
                # If an event loop is running in this thread but wasn't caught
                try:
                    asyncio.create_task(_broadcast_profile_callback())
                except Exception:
                    pass
    except Exception as e:
        logger.warning("[VRM Catalog] Failed to broadcast profile update: %s", e)


def parse_vrm_version(file_path: Path) -> int:
    """Read GLTF header from VRM file to detect if VRM version is 1 (VRM 1.0) or 0 (VRM 0.x)."""
    try:
        if not file_path.exists():
            return 0
        with open(file_path, "rb") as f:
            header = f.read(20)
            if len(header) < 20 or header[0:4] != b"glTF":
                return 0
            chunk_len = int.from_bytes(header[12:16], byteorder="little")
            chunk_type = header[16:20]
            if chunk_type != b"JSON":
                return 0
            chunk_data = f.read(chunk_len)
            gltf = json.loads(chunk_data.decode("utf-8", errors="ignore"))
            exts = gltf.get("extensionsUsed", []) + list(gltf.get("extensions", {}).keys())
            if any("VRMC_vrm" in str(e) for e in exts):
                return 1
            return 0
    except Exception:
        return 0


def _format_display_name(raw_name: str) -> str:
    """Format a filename stem into a clean display title."""
    cleaned = raw_name.replace("_", " ").replace("-", " ").strip()
    words = cleaned.split()
    return " ".join(w.capitalize() for w in words) if words else raw_name


def _format_outfit_name(raw_suffix: str) -> str:
    """Clean and capitalize an outfit suffix."""
    s = raw_suffix.strip(" _-()[]")
    if not s:
        return "Default"
    # Replace separators
    s = re.sub(r"[_\-]+", " ", s).strip()
    # Strip leading prepositions if present (e.g. 'in chinese dress' -> 'chinese dress')
    s = re.sub(r"^(?:in|wearing)\s+", "", s, flags=re.IGNORECASE).strip()
    words = s.split()
    return " ".join(w.capitalize() for w in words)


OUTFIT_SYNONYMS: Dict[str, List[str]] = {
    "swimsuit": ["bikini", "swimwear", "bathing suit", "swim"],
    "swim": ["bikini", "swimsuit", "swimwear"],
    "swimwear": ["bikini", "swimsuit"],
    "bikini": ["swimsuit", "swimwear"],
    "bunny": ["bunny girl"],
    "sweater": ["turtleneck", "knitwear", "jumper"],
    "turtleneck": ["sweater", "knitwear"],
    "maid": ["chinese maid", "maid dress"],
    "glasses": ["spectacles", "megane"],
}


def get_vrm_storage_dirs() -> List[Path]:
    """Returns candidate directories containing VRM files in priority order."""
    base_dir = config.BASE_DIR
    dirs = [
        base_dir.parent / "models",
        base_dir.parent / "frontend" / "public" / "models",
        base_dir / "models",
        Path(os.environ.get("APPDATA", "")) / "Yuki AI" / "custom_models"
    ]
    return [d for d in dirs if d.exists()]


def build_vrm_catalog(active_model: Optional[str] = None) -> Dict[str, Any]:
    """
    Scans bundled and custom VRM directories, groups related models into Characters
    and Outfits, and returns both hierarchical and flat catalog structures.
    """
    from app.memory.local_mem import MemoryManager
    mem = MemoryManager()
    if not active_model:
        active_model = mem.profile.get("settings", {}).get("active_vrm_model", "default.vrm")

    bundled_models: List[str] = []
    custom_models: List[str] = []
    file_map: Dict[str, Path] = {}

    # Scan bundled dirs
    base_dir = config.BASE_DIR
    for candidate in [
        base_dir.parent / "models",
        base_dir.parent / "frontend" / "public" / "models",
        base_dir / "models",
    ]:
        if candidate.exists():
            try:
                for f in sorted(os.listdir(candidate)):
                    if f.lower().endswith(".vrm"):
                        if f not in bundled_models:
                            bundled_models.append(f)
                            file_map[f] = candidate / f
            except Exception:
                pass
            if bundled_models:
                break

    # Scan custom models
    custom_dir = Path(os.environ.get("APPDATA", "")) / "Yuki AI" / "custom_models"
    if custom_dir.exists():
        try:
            for f in sorted(os.listdir(custom_dir)):
                if f.lower().endswith(".vrm"):
                    if f not in custom_models:
                        custom_models.append(f)
                        file_map[f] = custom_dir / f
        except Exception:
            pass

    # Merge models list
    all_models: List[str] = []
    for name in bundled_models + custom_models:
        if name not in all_models:
            all_models.append(name)
    if "default.vrm" in all_models:
        all_models.remove("default.vrm")
        all_models = ["default.vrm"] + all_models

    # VRM versions
    versions: Dict[str, int] = {}
    for name in all_models:
        fpath = file_map.get(name)
        versions[name] = parse_vrm_version(fpath) if fpath else 0

    # User custom outfit mappings (from profile settings or custom_outfits.json)
    custom_mappings = mem.profile.get("settings", {}).get("custom_outfits", {})
    custom_json_path = Path(os.environ.get("APPDATA", "")) / "Yuki AI" / "custom_outfits.json"
    if custom_json_path.exists():
        try:
            with open(custom_json_path, "r", encoding="utf-8") as f:
                loaded_overrides = json.load(f)
                if isinstance(loaded_overrides, dict):
                    custom_mappings = {**custom_mappings, **loaded_overrides}
        except Exception as e:
            logger.warning("[VRM Catalog] Failed to read custom_outfits.json: %s", e)

    # Smart Auto-Grouping
    stems = sorted([os.path.splitext(f)[0] for f in all_models], key=lambda x: (len(x), x))
    assigned_files = set()
    characters: List[Dict[str, Any]] = []

    # 1. Apply explicit custom overrides if defined
    # custom_mappings format: { "Character Name": ["file1.vrm", "file2.vrm"] }
    # or { "Character Name": { "default": "file1.vrm", "OutFit": "file2.vrm" } }
    for char_name, mapping in custom_mappings.items():
        char_id = re.sub(r"[^a-zA-Z0-9]+", "_", char_name).strip("_").lower()
        outfit_list = []
        if isinstance(mapping, list):
            for idx, fname in enumerate(mapping):
                if fname in all_models:
                    assigned_files.add(fname)
                    o_id = "default" if idx == 0 else f"outfit_{idx}"
                    o_name = "Default" if idx == 0 else _format_outfit_name(os.path.splitext(fname)[0])
                    outfit_list.append({
                        "id": o_id,
                        "name": o_name,
                        "file": fname,
                        "version": versions.get(fname, 0),
                        "is_active": (fname == active_model)
                    })
        elif isinstance(mapping, dict):
            for o_label, fname in mapping.items():
                if fname in all_models:
                    assigned_files.add(fname)
                    outfit_list.append({
                        "id": re.sub(r"[^a-zA-Z0-9]+", "_", o_label).strip("_").lower(),
                        "name": _format_outfit_name(o_label),
                        "file": fname,
                        "version": versions.get(fname, 0),
                        "is_active": (fname == active_model)
                    })
        if outfit_list:
            is_char_active = any(o["is_active"] for o in outfit_list)
            characters.append({
                "id": char_id,
                "name": char_name,
                "is_active": is_char_active,
                "default_file": outfit_list[0]["file"],
                "outfits": outfit_list
            })

    # 2. Heuristic multi-outfit detection
    for base in stems:
        base_file = f"{base}.vrm"
        if base_file in assigned_files:
            continue

        variants: List[Tuple[str, str, str]] = []  # (filename, outfit_id, outfit_display_name)
        for other in stems:
            other_file = f"{other}.vrm"
            if other_file in assigned_files:
                continue

            if other == base:
                variants.append((other_file, "default", "Default"))
            else:
                # Check if other begins with base followed by space, underscore, dash, or bracket
                pattern = r"^" + re.escape(base) + r"[\s_\-\(\[]+(.+?)[\)\]]?$"
                m = re.match(pattern, other, re.IGNORECASE)
                if m:
                    raw_suffix = m.group(1)
                    o_name = _format_outfit_name(raw_suffix)
                    o_id = re.sub(r"[^a-zA-Z0-9]+", "_", raw_suffix).strip("_").lower()
                    variants.append((other_file, o_id, o_name))

        if len(variants) > 1:
            char_id = re.sub(r"[^a-zA-Z0-9]+", "_", base).strip("_").lower()
            char_name = _format_display_name(base)
            outfit_entries = []
            for fname, oid, oname in variants:
                assigned_files.add(fname)
                outfit_entries.append({
                    "id": oid,
                    "name": oname,
                    "file": fname,
                    "version": versions.get(fname, 0),
                    "is_active": (fname == active_model)
                })

            is_char_active = any(o["is_active"] for o in outfit_entries)
            characters.append({
                "id": char_id,
                "name": char_name,
                "is_active": is_char_active,
                "default_file": outfit_entries[0]["file"],
                "outfits": outfit_entries
            })

    # 2b. Anchor-less Prefix-Cluster Auto-Grouping
    # Handles sets of models sharing a character prefix (e.g. 'unagi nami in chinese dress.vrm',
    # 'unagi nami in school dress.vrm') when NO standalone base file (e.g. 'unagi nami.vrm') exists.
    unassigned_stems = [os.path.splitext(f)[0] for f in all_models if f not in assigned_files]
    raw_prefix_clusters: Dict[str, List[Tuple[str, str, str]]] = {}
    prefix_display_map: Dict[str, str] = {}

    for s in unassigned_stems:
        fname = f"{s}.vrm"
        cand_prefix = None
        cand_suffix = None

        # 1. Preposition match: "X in Y", "X with Y", "X wearing Y"
        m = re.match(r"^(.+?)\s+(?:in|with|wearing)\s+(.+)$", s, re.IGNORECASE)
        if m:
            cand_prefix = m.group(1).strip()
            cand_suffix = m.group(2).strip()
        else:
            # 2. Bracket/Parentheses match: "X (Y)", "X [Y]"
            m = re.match(r"^(.+?)\s*[\(\[]([^\)\]]+)[\)\]]$", s)
            if m:
                cand_prefix = m.group(1).strip()
                cand_suffix = m.group(2).strip()
            else:
                # 3. Delimiter match with outfit keyword or multi-word prefix: "X - Y", "X _ Y"
                m = re.match(r"^([a-zA-Z0-9\s]+?)\s*[-_]\s*([a-zA-Z0-9\s]+)$", s)
                if m:
                    p_test, s_test = m.group(1).strip(), m.group(2).strip()
                    outfit_keywords = {
                        "dress", "suit", "bikini", "maid", "swimsuit", "summer", "winter",
                        "school", "casual", "bunny", "kimono", "uniform", "armor", "hoodie",
                        "coat", "hat", "pajama", "sleepwear", "goth", "cyber", "alt",
                        "outfit", "costume", "ver", "v1", "v2", "v3", "hair", "barefoot",
                        "glasses", "sport", "gym", "swim", "sleep"
                    }
                    s_words = set(re.split(r"[\s_\-]+", s_test.lower()))
                    if s_words & outfit_keywords or len(p_test.split()) >= 2:
                        cand_prefix = p_test
                        cand_suffix = s_test

        if cand_prefix and cand_suffix:
            norm_k = cand_prefix.lower()
            o_name = _format_outfit_name(cand_suffix)
            o_id = re.sub(r"[^a-zA-Z0-9]+", "_", cand_suffix).strip("_").lower()
            if not o_id:
                o_id = "default"
            raw_prefix_clusters.setdefault(norm_k, []).append((fname, o_id, o_name))
            if norm_k not in prefix_display_map:
                prefix_display_map[norm_k] = _format_display_name(cand_prefix)

    # Merge similar prefix clusters (e.g. 1-character typo/sound variants: 'unagi nami' vs 'unagi nemi')
    merged_clusters: Dict[str, List[Tuple[str, str, str]]] = {}
    merged_display_names: Dict[str, str] = {}

    for norm_k, items in raw_prefix_clusters.items():
        k_words = norm_k.split()
        matched_target = None
        for target_k in list(merged_clusters.keys()):
            t_words = target_k.split()
            if len(k_words) >= 2 and len(k_words) == len(t_words) and k_words[0] == t_words[0]:
                diff = sum(c1 != c2 for c1, c2 in zip(norm_k, target_k)) + abs(len(norm_k) - len(target_k))
                if diff <= 1:
                    matched_target = target_k
                    break
        if matched_target:
            merged_clusters[matched_target].extend(items)
            if len(items) > len(merged_clusters[matched_target]) - len(items):
                merged_display_names[matched_target] = prefix_display_map.get(norm_k, merged_display_names[matched_target])
        else:
            merged_clusters[norm_k] = list(items)
            merged_display_names[norm_k] = prefix_display_map.get(norm_k, _format_display_name(norm_k))

    # Only create characters for clusters that have 2 or more outfits
    for norm_k, items in merged_clusters.items():
        if len(items) >= 2:
            char_id = re.sub(r"[^a-zA-Z0-9]+", "_", norm_k).strip("_").lower()
            char_name = merged_display_names.get(norm_k, _format_display_name(norm_k))

            default_file = items[0][0]
            for fn, oid, oname in items:
                if fn == active_model:
                    default_file = fn
                    break
                if any(w in fn.lower() or w in oname.lower() for w in ("casual", "normal", "base", "default", "school")):
                    default_file = fn

            outfit_entries = []
            for fname, oid, oname in items:
                assigned_files.add(fname)
                outfit_entries.append({
                    "id": oid,
                    "name": oname,
                    "file": fname,
                    "version": versions.get(fname, 0),
                    "is_active": (fname == active_model)
                })

            is_char_active = any(o["is_active"] for o in outfit_entries)
            characters.append({
                "id": char_id,
                "name": char_name,
                "is_active": is_char_active,
                "default_file": default_file,
                "outfits": outfit_entries
            })

    # 3. Remaining standalone models
    for name in all_models:
        if name in assigned_files:
            continue
        stem = os.path.splitext(name)[0]
        char_id = re.sub(r"[^a-zA-Z0-9]+", "_", stem).strip("_").lower()
        char_name = _format_display_name(stem)
        is_active = (name == active_model)
        characters.append({
            "id": char_id,
            "name": char_name,
            "is_active": is_active,
            "default_file": name,
            "outfits": [
                {
                    "id": "default",
                    "name": "Default",
                    "file": name,
                    "version": versions.get(name, 0),
                    "is_active": is_active
                }
            ]
        })

    # Sort characters: Default/Active first, then multi-outfit characters, then alphabetical
    def sort_key(c):
        if c["id"] in ("default", "yuki"):
            return (0, c["name"].lower())
        if c.get("is_active"):
            return (1, c["name"].lower())
        if len(c.get("outfits", [])) > 1:
            return (2, c["name"].lower())
        return (3, c["name"].lower())

    characters.sort(key=sort_key)

    # Active summary
    active_char = None
    active_outfit = None
    for c in characters:
        for o in c["outfits"]:
            if o["file"] == active_model:
                c["is_active"] = True
                o["is_active"] = True
                active_char = c
                active_outfit = o
                break
        if active_char:
            break

    return {
        "models": all_models,
        "custom": custom_models,
        "versions": versions,
        "characters": characters,
        "active_character": active_char["name"] if active_char else "Default",
        "active_character_id": active_char["id"] if active_char else "default",
        "active_outfit": active_outfit["name"] if active_outfit else "Default",
        "active_outfit_id": active_outfit["id"] if active_outfit else "default",
        "active_vrm_model": active_model
    }


def find_outfit_match(
    target_outfit: str,
    character_hint: Optional[str] = None,
    catalog: Optional[Dict[str, Any]] = None
) -> Tuple[Optional[Dict[str, Any]], Optional[Dict[str, Any]], Optional[str]]:
    """
    Resolves colloquial outfit, model, and character names to a specific character and outfit entry.
    Handles interchangeable use of 'model', 'outfit', 'character' (e.g. 'kind', 'mita kind', 'with hat').
    Returns: (matching_character, matching_outfit, error_message)
    """
    if catalog is None:
        catalog = build_vrm_catalog()

    characters = catalog.get("characters", [])
    active_char_id = catalog.get("active_character_id")
    active_char = next((c for c in characters if c["id"] == active_char_id), None)

    raw_target = (target_outfit or "").strip().lower()
    raw_char = (character_hint or "").strip().lower()

    # If asking for default/normal/reset without a specific character hint, immediately return active character's default!
    if (raw_target in ("default", "normal", "original", "base", "reset", "") and not raw_char) or (raw_char in ("default", "normal", "original", "base", "reset") and not raw_target):
        if active_char:
            return (active_char, active_char["outfits"][0], None)
        elif characters:
            return (characters[0], characters[0]["outfits"][0], None)

    # Referential / cycling commands: "next", "something new", "something else", "another", "surprise me"
    NEXT_OUTFIT_TERMS = {
        "next", "another", "another one", "different", "different outfit",
        "something else", "something new", "something different",
        "new", "new outfit", "surprise", "surprise me", "random", "change it",
        "switch it", "anything", "whatever", "other"
    }
    if raw_target in NEXT_OUTFIT_TERMS or any(raw_target.startswith(p) for p in ("something ", "another ", "different ", "new ")):
        target_c = active_char or (characters[0] if characters else None)
        if target_c and target_c.get("outfits"):
            c_outfits = target_c["outfits"]
            current_file = catalog.get("active_vrm_model", "")
            if len(c_outfits) > 1:
                cur_idx = next((i for i, o in enumerate(c_outfits) if o["file"] == current_file), -1)
                next_idx = (cur_idx + 1) % len(c_outfits)
                return (target_c, c_outfits[next_idx], None)
            else:
                return (target_c, c_outfits[0], None)

    GENERIC_OUTFIT_WORDS = {
        "dress", "outfit", "costume", "suit", "clothes", "version", "model",
        "avatar", "the", "a", "an", "with", "in", "wearing", "style", "look"
    }

    def _score_outfit_match(query: str, outfit_entry: Dict[str, Any]) -> float:
        q_clean = query.strip().lower()
        o_name = outfit_entry.get("name", "").lower()
        o_id = outfit_entry.get("id", "").lower()
        o_file = outfit_entry.get("file", "").lower()

        # Tier 1: Exact match on name, id, or filename
        if q_clean == o_name or q_clean == o_id or q_clean == o_file or f"{q_clean}.vrm" == o_file:
            return 100.0

        # Tier 2: Exact candidate substring containment
        if len(q_clean) >= 3 and (q_clean in o_name or q_clean in o_file):
            return 50.0 + len(q_clean) / max(len(o_name), 1)

        # Tier 3: Distinguishing token overlap
        q_tokens = [t for t in re.split(r"[\s_\-]+", q_clean) if t and t not in GENERIC_OUTFIT_WORDS]
        if not q_tokens:
            q_tokens = [t for t in re.split(r"[\s_\-]+", q_clean) if t]
        if not q_tokens:
            return 0.0

        score = 0.0
        matched_distinguishing = 0
        total_distinguishing = len([t for t in q_tokens if t not in GENERIC_OUTFIT_WORDS])

        for tok in q_tokens:
            is_generic = tok in GENERIC_OUTFIT_WORDS
            synonyms = OUTFIT_SYNONYMS.get(tok, [])
            all_terms = [tok] + synonyms
            tok_matched = any(term in o_name or term in o_file or term in o_id for term in all_terms)
            if tok_matched:
                if is_generic:
                    score += 1.0
                else:
                    score += 10.0
                    matched_distinguishing += 1

        if total_distinguishing > 0 and matched_distinguishing == 0:
            return 0.0

        completeness = matched_distinguishing / max(total_distinguishing, 1) if total_distinguishing > 0 else 0.5
        return score * (1.0 + completeness)

    # Candidate strings to evaluate
    candidates = []
    if raw_target and raw_target not in ("default", "normal", "original", "base", "reset"):
        candidates.append(raw_target)
    if raw_char and raw_target and raw_target not in ("default", "normal"):
        candidates.append(f"{raw_char} {raw_target}")
    if raw_char and raw_char not in ("default", "normal", "original", "base", "reset"):
        candidates.append(raw_char)

    best_entry = None
    best_score = 0.0

    for cand in candidates:
        for c in characters:
            is_char_hint = raw_char and (c["id"] == raw_char or raw_char in c["name"].lower())
            is_active = (c == active_char)

            bonus = 0.0
            if is_char_hint:
                bonus += 15.0
            elif is_active:
                bonus += 5.0

            for o in c.get("outfits", []):
                s = _score_outfit_match(cand, o)
                if s > 0:
                    total_s = s + bonus
                    if total_s > best_score:
                        best_score = total_s
                        best_entry = (c, o)

    if best_entry and best_score > 0:
        return (best_entry[0], best_entry[1], None)

    # Fallback to character name if only character matched
    for cand in candidates:
        for c in characters:
            if c["id"] == cand or c["name"].lower() == cand or cand in c["name"].lower():
                return (c, c["outfits"][0], None)

    # Could not resolve
    avail_outfits = []
    if active_char:
        avail_outfits = [o["name"] for o in active_char.get("outfits", [])]
    return (
        None,
        None,
        f"Could not find model or outfit '{target_outfit or character_hint}'. Available outfits for {active_char['name'] if active_char else 'active avatar'}: {', '.join(avail_outfits) if avail_outfits else 'Default only'}"
    )


def change_avatar_outfit(outfit: str = "default", character: Optional[str] = None, memory_manager: Optional[Any] = None) -> str:
    """
    Action tool for switching the 3D avatar's outfit or model.
    Updates the system setting, broadcasts a live WebSocket event to reload the VRM model,
    and returns an execution summary for Yuki to celebrate with a pose!
    """
    mem = memory_manager or get_memory_manager()
    active_model = None
    if mem and hasattr(mem, "profile") and isinstance(mem.profile, dict):
        active_model = mem.profile.get("settings", {}).get("active_vrm_model")
    catalog = build_vrm_catalog(active_model)

    outfit_str = str(outfit or "default").strip()

    # Listing action
    if outfit_str.lower() in ("list", "show", "help", "all"):
        chars = catalog.get("characters", [])
        active_c = catalog.get("active_character", "Default")
        active_o = catalog.get("active_outfit", "Default")

        lines = [f"Active Avatar: **{active_c}** (Current Outfit: **{active_o}**)"]
        for c in chars:
            if len(c["outfits"]) > 1:
                olist = ", ".join(f"`{o['name']}`" for o in c["outfits"])
                lines.append(f"• **{c['name']}**: {olist}")
            else:
                lines.append(f"• **{c['name']}**: `Default`")
        return "Available Avatar Outfits:\n" + "\n".join(lines)

    # Resolve outfit
    target_char, target_outfit, err = find_outfit_match(outfit_str, character_hint=character, catalog=catalog)
    if err or not target_outfit:
        return f"Error: {err or 'Failed to resolve outfit.'}"

    target_file = target_outfit["file"]
    char_name = target_char["name"]
    outfit_name = target_outfit["name"]

    # Check if already wearing this outfit
    current_active = catalog.get("active_vrm_model", "")
    if target_file == current_active:
        return f"Yuki is already wearing the '{outfit_name}' outfit for {char_name} ({target_file})."

    # Persist in memory manager (live instance)
    if mem:
        mem.update_setting("active_vrm_model", target_file)

    # Optimize memory if needed
    try:
        from app.memory.optimizer import optimize_all_processes
        optimize_all_processes(force=True)
    except Exception:
        pass

    # Trigger live WebSocket broadcast to hot-reload 3D avatar in Electron/Browser
    _broadcast_profile_sync()

    return f"Successfully changed avatar outfit to '{outfit_name}' for {char_name} (loaded {target_file})."
