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

## Python Class Indentation & Module-Level Helper Rule

In Python, unindented code (column 0) terminates the preceding class definition. Whenever adding utility functions, connection pools, or module variables to large classes like `AgentExecutor` (`backend/app/agent/executor.py`):

- **NEVER** declare module-level helper functions, global variables, or unindented `def` / assignments in the middle of `class AgentExecutor:`.
- **CRITICAL CONSEQUENCE**: An unindented `def` at column 0 silently closes the `class AgentExecutor:` body. All subsequent class methods (`execute_chat_turn_stream`, `_query_llm_stream`, etc.) become detached, causing catastrophic runtime errors: `'AgentExecutor' object has no attribute 'execute_chat_turn_stream'`.
- **RULE**:
  1. Place all module-level caches, HTTP connection pools, regex patterns, and global helper functions at the **top of the file** (before `class AgentExecutor:`).
  2. If a helper belongs to the class, indent it by 4 spaces and give it a `self` or `@staticmethod` decorator.

---

## SQLite Database Schema Migration Protocol (`init_*_db`)

`CREATE TABLE IF NOT EXISTS` only runs when creating a brand-new database file. It **DOES NOT** update or add columns to an existing database. Whenever adding a column or modifying tables in `vectors.db`, `yuki_files.db`, or any SQLite database:

### 1. Dynamic Column Migration Check
Always inspect existing table columns using `PRAGMA table_info`:
```python
cursor.execute("PRAGMA table_info(table_name)")
existing_cols = {row[1] for row in cursor.fetchall()}

if "new_column" not in existing_cols:
    cursor.execute("ALTER TABLE table_name ADD COLUMN new_column TEXT DEFAULT NULL")
    print("[DB] Auto-migrated: added missing column 'new_column'")
```

### 2. Idempotent Index Creation
Always create indexes using `IF NOT EXISTS`:
```python
cursor.execute("CREATE INDEX IF NOT EXISTS idx_table_col ON table_name(new_column)")
```
