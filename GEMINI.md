# Project Yuki Architectural Rules & Settings Protocol

## Settings & Config Propagation Checklist

Whenever adding, updating, or modifying any configuration setting, VAD parameter, STT parameter, or feature toggle in Project Yuki, **ALWAYS** follow this end-to-end 6-step checklist to ensure setting persistence and prevent parameter reversion across conversation turns:

### 1. Backend Config Default (`backend/app/config.py`)
- Declare setting default & environment variable lookup (e.g. `MY_SETTING = os.environ.get("MY_SETTING", "default_val")`).

### 2. Backend Memory & Profile Defaults (`backend/app/memory/local_mem.py`)
- **Default Profile**: Add key-value pair to `default_profile["settings"]` inside `_load_profile()`.
- **Runtime Load**: Add mapping inside `_load_profile()` to set `config.MY_SETTING = data["settings"].get("my_setting", ...)` on backend startup.
- **Setting Update**: Add handler inside `update_setting()` if dynamic runtime re-initialization is needed.

### 3. Backend Settings Endpoint (`backend/app/main.py`)
- **Schema**: Add `my_setting: Optional[type] = None` to `SettingsUpdateRequest`.
- **API Handler**: Inside `update_settings()`, update `config.MY_SETTING` AND call `memory_manager.update_setting("my_setting", val)`.
- **Collision Check**: Ensure key names do NOT collide (e.g., browser RMS `vad_threshold` vs. backend AI `silero_vad_threshold`).

### 4. Dashboard Settings State & Inputs (`frontend/src/components/ControlDashboard.jsx`)
- **Initial State**: Add `my_setting: defaultValue` to `settings` initial `useState` object.
- **Input Binding**: Render UI input using `settings.my_setting ?? defaultValue` and trigger `handleUpdateSetting('my_setting', val)`.

### 5. App State Integration (`frontend/src/App.jsx` & `frontend/src/SettingsApp.jsx`)
- Destructure setting from `profile?.settings` or relevant custom hook.
- Pass setting and update handler props down to `ControlDashboard`.

### 6. Client Hook / Logic Consumption (`frontend/src/hooks/useSpeechRecognition.js`, etc.)
- Use setting inside target React hook or audio loop with live `useRef` updates for immediate effect without restarting services.

---

## New Tool Integration Protocol (5-Step Checklist)

Whenever adding a new AI action tool or system capability to Project Yuki, **ALWAYS** follow this end-to-end 5-step checklist:

### 1. Tool Implementation (`backend/app/tools/<module>.py`)
- Implement the async or sync tool function with robust error handling, type conversion, and descriptive string output for the LLM.
- If the tool interacts with visual windows (Canvas, HTML viewer, notifications), use `_broadcast_canvas_ws()` or WebSocket emitters.

### 2. Tool Schema Definitions (`backend/app/tools/definitions.py`)
- **Schema Declaration**: Add the OpenAI-compatible function schema into `get_advanced_jarvis_tools_definition()` (Jarvis Mode) and/or `get_basic_tools_definition()` (Basic Mode).
- **Disambiguation**: Write precise descriptions specifying what the tool does, parameter constraints, and explicit contrast against similar tools (e.g. vector diagrams vs. image diffusion).

### 3. Agent Dispatcher & Execution (`backend/app/agent/executor.py`)
- **Import**: Import the new tool function inside `execute_tool()` / `_execute_single_tool()`.
- **Dispatch Mapping**: Register the tool name in the execution dictionary to route tool call arguments to the Python function.

### 4. Semantic Tool Selector & Keywords (`backend/app/tools/selector.py`)
- **Hints**: Add colloquial trigger keywords to `_TOOL_HINTS` (e.g. `"paint"`, `"wallpaper"`, `"render"`) to grant high-confidence semantic matching bonus (`+0.12` / `+0.22`).
- **Query Expansions**: Add common user slang or synonyms to `_QUERY_EXPANSIONS`.
- **Allowlists**: If the tool is a core coding utility, include it in `_DEFAULT_CODING_TOOLS` or `_ALWAYS_INCLUDED_JARVIS_TOOLS`.

### 5. System Prompt Directives (`backend/app/agent/prompts.py`)
- Add a bullet under `2. JARVIS TOOLSET GUIDELINES` in `generate_jarvis_system_prompt()` instructing the AI on exact usage boundaries, required parameters, and best practices.

---

## Vector Memory, Database Migrations & Session Protocol

Whenever working on long-term memory, vector search, or SQLite storage in Project Yuki, **ALWAYS** observe these architectural standards:

### 1. Schema & Auto-Migration (`backend/app/memory/vector_memory.py`)
- **Table Schema**: `memories` table consists of:
  `id (INTEGER PK)`, `content (TEXT)`, `category (TEXT)`, `embedding (TEXT JSON)`, `created_at (REAL)`, and `session_id (TEXT NULLABLE)`.
- **Dynamic Migration**: Never rely solely on `CREATE TABLE IF NOT EXISTS` for existing user databases. `init_vector_db()` must inspect `PRAGMA table_info(memories)` and auto-apply `ALTER TABLE memories ADD COLUMN <name> <type>` if columns are missing.
- **Indexes**: Maintain performance indexes on `category`, `created_at`, and `session_id`.

### 2. Coder Mode Isolation (`backend/app/agent/executor.py`)
- **Pre-Turn Search**: If `is_coder_mode` (`overrides.get("coding_mode")` or `resolved_backend in ("coder", "complex_coder")`), **bypass** `search_relevant_memories` entirely and set `self.last_vector_timing["status"] = "disabled_coder_mode"`.
- **Post-Turn Indexing**: **Bypass** `extract_and_index_turn` in Coder Mode. This prevents multi-line code diffs, terminal stack traces, and compiler errors from polluting `vectors.db`.
- **Rationale**: Keeps coding turns at 0ms vector latency and eliminates the risk of recalling superseded or outdated code signatures from earlier sessions.

### 3. Temporal Context & Formatting (`backend/app/agent/prompts.py`)
- Recalled episodic memories injected into the LLM system prompt must pass through `_format_memory_time(created_at, days_ago)`.
- Always format memories with intuitive temporal labels (e.g., `[Just now (11:07 PM)]`, `[Today at 10:39 PM (15m ago)]`, `[Yesterday at 4:20 PM]`, `[Saturday at 9:55 PM (4d ago)]`) to grant the model precise chronological grounding.

### 4. Chat Turn Timestamps & SQLite Persistence (`db.py` & UI)
- All message objects (`final_history`, `App.jsx`, `ChatOverlay.jsx`) must carry a float UNIX `timestamp`.
- In `backend/app/memory/db.py` (`save_chat_session_if_eligible`), always persist `m.get("timestamp") or now` so each message maintains its true creation time when reloaded from SQLite.

### 5. Packaging & Installed App Data Safety (`update_installed.ps1`)
- **Robocopy Exclusion**: Fast-sync commands must explicitly exclude `*.db`, `*.db-wal`, and `*.db-shm` to ensure user memories and files are never overwritten from development templates.
- **Full Rebuild Backup**: On PyInstaller rebuilds, `vectors.db` must be temporarily backed up to `$env:TEMP\yuki_vectors_backup` and restored after new binaries are laid down.

### 6. Code Structure Integrity in `executor.py`
- **Class Indentation Rule**: **NEVER** declare module-level helper functions at column 0 in the middle of `class AgentExecutor`. In Python, an unindented `def` terminates the class body and detaches all subsequent methods (`execute_chat_turn_stream`, etc.). Keep all module-level helpers at the top of the file above the class.
