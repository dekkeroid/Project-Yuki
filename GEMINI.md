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

## New Tool Integration Protocol (Foolproof 8-Step Checklist)

Whenever adding a new AI action tool or system capability to Project Yuki, **ALWAYS** follow this end-to-end 8-step checklist to ensure proper schema exposure, executor routing, safety checks, MCP compatibility, and prompt formatting:

### 1. Tool Implementation (`backend/app/tools/<module>.py` or `AgentExecutor`)
- **Standalone / System Tools**: Implement the function in a tool module (e.g. `backend/app/tools/system.py`, `files.py`, `web.py`, or a new dedicated module).
- **State- / Memory-Bound Tools**: If the tool requires access to `AgentExecutor` state (`self.memory`, session IDs, active turn ID, etc.), implement it as a helper method on `AgentExecutor` in `backend/app/agent/executor.py` (e.g. `def _execute_<name>(self, **kwargs) -> str:`). *Remember the class indentation rule: indent by 4 spaces and include `self`!*
- **Signatures & Typing**: Accept explicit typed parameters or `**kwargs` with robust fallbacks for argument aliases (e.g. `kwargs.get("path") or kwargs.get("file_path")`).
- **Return Contract**:
  - **Always return a string** (or JSON string).
  - On failure, prefix the return string with `"Error: ..."` or `"Failed: ..."`. The agent executor detects errors via `lower_res.startswith("error:")` to register failures and update Yuki's mood (`react_mood_outcome(..., success=False)`).
- **Canvas / UI Broadcasts**: If the tool interacts with floating visual windows (Canvas, HTML viewer, notifications), emit WebSocket events or use `_broadcast_canvas_ws()`.

### 2. Tool Schema Definitions (`backend/app/tools/definitions.py`)
- **Schema Declaration**: Add the OpenAI-compatible function schema into:
  - `get_advanced_jarvis_tools_definition()` (Jarvis / Autonomous Mode).
  - `get_basic_tools_definition()` (Basic / Assistant Mode, if applicable).
  - `get_codegraph_tool_definitions()` (Code navigation tools, if applicable).
- **Schema Structure**:
  - `type: "function"` with `function.name`, `function.description`, `function.parameters` (`type: "object"`, `properties`, and `required`).
- **Disambiguation**: Write precise descriptions specifying what the tool does, parameter constraints, and explicit contrast against similar tools (e.g. vector diagrams vs. image diffusion, content search vs. file name search).

### 3. Agent Dispatcher & Execution Routing (`backend/app/agent/executor.py`)
- **Lazy Import**: Lazy-import the function inside `AgentExecutor.__init__` (under `# Lazy-import tool modules`, lines ~301–325).
- **Register in `self.tools`**: Map the tool name in `self.tools = { ... }` (lines ~330–596). Use a lambda for argument normalization:
  ```python
  "my_tool": lambda **kwargs: my_tool(
      kwargs.get("target") or kwargs.get("name") or "",
      count=int(kwargs.get("count", 1))
  ),
  ```
- **CRITICAL Basic Mode Allowlist (`basic_allowed`)**:
  - If the tool is intended for Basic Mode, **you MUST add its name to `basic_allowed`** inside `_get_tool_definitions_for_messages()` (around line 2483). If omitted, `filtered_tools` silently drops it in Basic Mode!
- **Voice-Mode Safety (`_VOICE_CONFIRM_TOOLS`)**:
  - If the tool modifies files, executes terminal commands, or runs code, add its name to `_VOICE_CONFIRM_TOOLS` (around line 3452) so voice STT commands trigger explicit confirmation dialogs.
- **Basic Mode Post-Tool Follow-Up Loops**:
  - In Basic Mode, the executor uses categorization sets to guide the LLM after tool completion (around line 3579):
    - `_INFO_TOOLS` (e.g. web search, read file): forces hard-stop; LLM summarizes in <3 sentences without chaining tools.
    - `_DATA_TOOLS` (e.g. file search, system stats): conditional; allows 1 follow-up action if requested.
    - `_MEMORY_TOOLS` (e.g. remember facts): forces hard-stop; silent conversational reply without mentioning memory updates.
    - Default Action tools: confirms action in 1 short sentence and stops.
    *(Autonomous Jarvis and Coder modes loop freely until task completion).*

### 4. Semantic Tool Selector & Keywords (`backend/app/tools/selector.py`)
- **Relevance Hints (`_TOOL_HINTS`)**:
  - Add mapping in `_TOOL_HINTS`: `"my_tool": ("keyword1", "keyword2", "synonym")` to grant high-confidence semantic matching bonus (`+0.12` / `+0.22`) when dynamic tool calling matches user query tokens.
- **Query Expansions (`_QUERY_EXPANSIONS`)**:
  - Add common user slang or synonyms to `_QUERY_EXPANSIONS` if the tool concept is described with colloquial terms.
- **Coder Mode Allowlist (`_DEFAULT_CODING_TOOLS`)**:
  - If the tool is for Coder Mode, include it in `_DEFAULT_CODING_TOOLS`. This automatically populates the "Included Coder Tools" UI list.
- **Always-Included Tools**:
  - If the tool must NEVER be omitted by dynamic tool selection, include it in `_ALWAYS_INCLUDED_JARVIS_TOOLS` or `_ALWAYS_INCLUDED_BASIC_TOOLS`.

### 5. System Prompt Directives & Scrubbing Syntax (`backend/app/agent/prompts.py`)
- **Jarvis / Autonomous Mode**:
  - Add a guideline bullet under `2. JARVIS TOOLSET GUIDELINES` in `get_advanced_jarvis_system_prompt()`.
  - **CRITICAL SCRUBBING REGEX SYNTAX**: The line MUST start with a bullet, backticked name, and arrow:
    `   • \`my_tool\` → Usage instructions, required parameters, and best practices.`
    *Why?* `_scrub_blocked_tools()` uses regex `^[•\-*]?\s*`?([a-zA-Z0-9_]+)`?` to cleanly strip the entire line from the system prompt if the user blacklists or disables the tool!
- **Basic Mode**: If applicable, add usage notes in `get_system_prompt()`.
- **Coder Mode**: If applicable, add instructions in `get_coding_agent_system_prompt()`.

### 6. Safety Policies, Confirmation Grants & Aliases (`backend/app/tools/safety.py`)
- **Destructive Action Confirmation**:
  - If the tool performs destructive, irreversible, or sensitive actions (killing processes, modifying system power, formatting, deleting files), add checks in `_requires_confirmation()`.
- **Blocked Arguments / Commands**:
  - If certain command patterns or critical targets must be blocked unconditionally (e.g. terminating Windows critical processes), add rules to `_blocked_reason()`.
- **Tool Aliases (`_TOOL_ALIASES`)**:
  - If the tool has both a Jarvis name (`jarvis_my_tool`) and a canonical base name (`my_tool`), map it in `_TOOL_ALIASES` so security policies apply symmetrically.
- **Confirmation Target Formatting**:
  - Ensure `describe_tool_target()` can extract a clean target string for display in confirmation dialogs (e.g. `[Safety Confirmation] Run 'my_tool' on 'file.txt'?`).

### 7. Stdio FastMCP Server Registration (`backend/app/mcp_server.py`)
- When `TOOL_TRANSPORT == "mcp-stdio"`, Yuki runs tools via FastMCP over stdio JSON-RPC.
- Register the tool with `@mcp.tool()` in `backend/app/mcp_server.py` using `_guarded_tool_call()`:
  ```python
  @mcp.tool()
  async def my_tool(param1: str, run_flag: bool = False, confirmation_grant_id: str | None = None) -> str:
      """Tool description matching definitions.py."""
      return await _guarded_tool_call("my_tool", tool_module.my_tool, {"param1": param1, "run_flag": run_flag, "confirmation_grant_id": confirmation_grant_id})
  ```
- *Note*: If omitted from `mcp_server.py`, the stdio MCP bridge will fail and fall back to in-process execution. Registering it ensures native MCP support.

### 8. Diagnostics, Testing & Packaging (`main.py`, `resolver.py`, `yuki-backend.spec`)
- **API Categorization (`backend/app/main.py`)**:
  - In `get_tools_list()` (`/api/tools`), add the tool name to the appropriate category (e.g. `"Code & Filesystem"`, `"System & OS"`, `"Media & Control"`) so the diagnostics tool tester (`testing/tool_tester.html`) and frontend dashboard categorize it cleanly.
  - Test the tool directly via `POST /api/tools/run`.
- **Zero-Latency Resolver (`backend/app/agent/resolver.py`)** *(Optional)*:
  - If the tool handles deterministic, instant user commands without needing LLM reasoning (like volume, mute, screenshot, time), add a regex rule in `resolve_command()`. Add announcement text in `executor.py` (`announcements` dict) if it steals focus.
- **Autonomous Scheduled Tasks (`backend/app/tools/definitions.py`)** *(Optional)*:
  - If the tool can be invoked by background watchers/intervals, add its name to `get_scheduled_task_schema()` under `run_tool` description.
- **PyInstaller Hidden Imports (`backend/yuki-backend.spec`)**:
  - If you created a new tool module (e.g. `backend/app/tools/my_tool.py`) or introduced new packages/libraries, add `'app.tools.my_tool'` to `manual_hidden`. If binary DLLs or assets are needed, follow the **Packaging & Installer Bundling Protocol**.

---

## New 3D Avatar Animation Integration Protocol (End-to-End Checklist)

Whenever creating or adding a new 3D avatar animation, bodily gesture, or physical expression trigger to Project Yuki, **ALWAYS** follow this end-to-end 5-step checklist to ensure procedural playback, slash command binding, settings toggle exposure, dynamic prompt propagation, and TTS sanitization:

### 1. Procedural Pose vs. VRMA Motion Capture
- **Option A: Procedural Pose & Animation Logic (`frontend/src/components/AvatarViewer.jsx`)**:
  - Inside `AvatarViewer.jsx`'s Three.js animation loop (`animate()`), handle `idleAnimState === 'my_anim'`.
  - Use `idleAnimProgress / idleAnimDuration` to interpolate VRM bone rotations using `THREE.MathUtils.lerp()` or sinusoidal curves (`Math.sin(...)`).
  - Adjust facial blend shapes if needed (e.g. `setExpressionValue(vrm, 'happy', 0.5)`).
- **Option B: Motion Capture `.vrma` (VRM Animation) File**:
  - Place `.vrma` file inside `frontend/public/animations/<name>.vrma`.
  - No procedural bone code needed! `AvatarViewer` automatically loads, retargets, and plays the clip using `@pixiv/three-vrm-animation` and `AnimationMixer` while blending audio lip-sync and eye blinks.

### 2. Animation Registry Definition & Tag Alias (`frontend/src/animationsRegistry.js`)
- **Register Animation**: Add an entry into `ANIMATIONS`:
  ```javascript
  {
    name: 'my_anim',                     // Internal animation ID used in AvatarViewer
    alias: 'my_tag',                     // Tag name without namespace: <yuki_anim:my_tag/>
    type: 'vrma',                        // Optional: 'vrma' for mocap, or omit/procedural
    vrmaUrl: '/animations/my_mocap.vrma',// Required if type is 'vrma'
    duration: 3.0,                       // Duration in seconds
    excludeFromRandomIdle: true,         // True = only on demand/tag; False = can play randomly when idle
    llmTag: '<yuki_anim:my_tag/>',
    commands: [
      { cmd: '/ani-my_tag', description: 'Perform my_tag animation' }
    ],
    responseText: '*performs action*',
    blendShapes: { happy: 0.4, relaxed: 0.5 }
  }
  ```
- **Tag Mapping**: Add alias mapping in `LLM_ANIMATION_MAP`:
  ```javascript
  my_tag: 'my_anim',
  my_anim: 'my_anim',
  ```
- **Automatic Settings Toggle**: Adding to `ANIMATIONS` automatically renders a toggle under **Settings > Avatar > Animations Toggle**!

### 3. Backend Canonical Registry & Situational Cues (`backend/app/agent/prompts.py`)
- **Add to `AVAILABLE_AVATAR_ANIMATIONS`**:
  ```python
  {"name": "my_anim", "tag": "my_tag", "desc": "Action summary"},
  ```
- **Add Situational Prompt Trigger**: Inside `build_animation_expression_prompt_block()`, add an entry to `cue_map`:
  ```python
  "my_tag": "When situation occurs -> `<yuki_anim:my_tag/>`",
  ```
  *(The dynamic builder will automatically omit `<yuki_anim:my_tag/>` from system prompts whenever the user toggles it off in Settings).*

### 4. Spoken TTS & Response Stripping Verification (`responseParser.js` & `tts.py`)
- Generic regex handles `<yuki_anim:my_tag/>` and `[yuki_anim:my_tag]` automatically.
- Verify `stripAnimationTags()` in `frontend/src/utils/responseParser.js` and `clean_text_for_tts()` in `backend/app/voice/tts.py` to ensure the tag never leaks into voice output or visible chat bubbles.

### 5. Validation & Verification
- **Frontend Build**: Run `npm run build` inside `frontend/` to ensure bundle compilation succeeds.
- **Backend Import & Prompt Verification**: Run:
  ```powershell
  backend\venv\Scripts\python.exe -c "import app.agent.prompts as p; assert 'my_tag' in p.build_animation_expression_prompt_block(); assert 'my_tag' not in p.build_animation_expression_prompt_block(['my_anim']); print('Animation verification passed!')"
  ```

---

## Python Class Indentation & Module-Level Helper Rule

In Python, unindented code (column 0) terminates the preceding class definition. Whenever adding utility functions, connection pools, or module variables to large classes like `AgentExecutor` (`backend/app/agent/executor.py`):

- **NEVER** declare module-level helper functions, global variables, or unindented `def` / assignments in the middle of `class AgentExecutor:`.
- **CRITICAL CONSEQUENCE**: An unindented `def` at column 0 silently closes the `class AgentExecutor:` body. All subsequent class methods (`execute_chat_turn_stream`, `_query_llm_stream`, etc.) become detached, causing catastrophic runtime errors: `'AgentExecutor' object has no attribute 'execute_chat_turn_stream'`.
- **RULE**:
  1. Place all module-level caches, HTTP connection pools, regex patterns, and global helper functions at the **top of the file** (before `class AgentExecutor:`).
  2. If a helper belongs to the class, indent it by 4 spaces and give it a `self` or `@staticmethod` decorator.

---

## Python Import Hygiene & Undefined Name Validation Rule

Whenever adding, updating, or editing any Python code across the backend (`backend/app/...`):

- **Explicit Imports**: Never assume standard library or common modules (e.g. `re`, `json`, `os`, `sys`, `time`, `datetime`, `asyncio`, `math`, `typing`, `psutil`, `Path`) are already imported in the target file. Always verify imports at the top of the file before using them in functions, helpers, or classes.
- **The `py_compile` Trap**: `python -m py_compile` ONLY checks Python grammar and byte-compilation. It **CANNOT** catch `NameError` (such as `name 're' is not defined` or `name 'json' is not defined`) because unbound identifiers are only evaluated when bytecode executes.
- **Mandatory Import & Runtime Verification**:
  1. **Direct Module Import Check**: After editing any backend module, always test importing it with the virtual environment Python:
     ```powershell
     backend\venv\Scripts\python.exe -c "import sys; sys.path.insert(0, 'backend'); import app.<submodule>"
     ```
  2. **Execution Test**: If new functions or helpers were added (e.g. parsers, regex cleaners, state transformers), invoke them directly in a one-line test snippet to verify runtime execution paths and ensure all symbols exist in scope.

---

## SQLite Schema Migrations & DB Init Rule

Whenever making changes to any database structure or table (`vectors.db`, `yuki_files.db`, etc.), **ALWAYS** update the corresponding initialization function (`init_vector_db`, `init_db`, etc.) to automatically migrate older databases:

- `CREATE TABLE IF NOT EXISTS` only runs for brand-new files and does not update existing databases.
- Always inspect existing columns (e.g. using `PRAGMA table_info`) and execute `ALTER TABLE ... ADD COLUMN` for any missing columns so existing databases upgrade seamlessly without crashing.
- Ensure any new indexes use `CREATE INDEX IF NOT EXISTS`.

---

## Frontend UI & Design System Rules (No Emojis in UI)

- **NEVER use colored emojis in the UI**: Do **NOT** use emojis (e.g., ⭐, 🚀, 💡, 🔥, 🎉, 🤖, ⚠️, ❌, etc.) in user interface components, buttons, dropdown options, badges, titles, or status labels. Emojis render inconsistently across operating systems and clash with Project Yuki's modern dark glassmorphic anime aesthetic.
- **Use Lucide Icons or Styled Text Badges Instead**:
  - For icons, always use vector icons from `lucide-react` (e.g., `<Star className="w-3.5 h-3.5" />`, `<Sparkles />`, `<Check />`, `<AlertCircle />`, `<Trash2 />`).
  - For status indicators, use clean styled text badges (e.g., `(Custom)`, `(Global)`, `(Customized)`).
  - Minimalist standard glyphs (like `✓`, `✕`, `↺`, `+`) are acceptable only for compact inline action buttons.

---

## Production / Installed App Location & Sync Boundary

- **Build Pipeline**: Created by running `start_build.bat` (which builds frontend, PyInstaller backend, Electron packaging, and Inno Setup installer into `frontend\installer-output\`).
- **Installed Location**: After running the installer created by `start_build.bat`, Yuki AI is installed at:
  `C:\Users\ihars\AppData\Local\Programs\Yuki AI\` (or `%LOCALAPPDATA%\Programs\Yuki AI\`).
- **Packaged Backend**: The bundled backend executable and internal resources reside at:
  `C:\Users\ihars\AppData\Local\Programs\Yuki AI\resources\backend\`.
- **STRICT PROD SYNC RULE (NEVER Robocopy to Installed Location)**:
  - **NEVER** run `robocopy`, `Copy-Item`, `npx asar pack`, or any file copy commands targeting the installed production directory (`%LOCALAPPDATA%\Programs\Yuki AI\` or `C:\Users\ihars\AppData\Local\Programs\Yuki AI\`).
  - Deploying, fast-syncing, or updating the installed production app is **strictly reserved for the user** (who runs `update_installed.ps1` or `start_build.bat` when ready).
  - All AI modifications, builds (`npm run build`), and testing must strictly remain within the project workspace repository (`d:\Projects New\Projects Misc\Projects C\Project Yuki\`).

---

## Yuki Blender Projects & 3D Asset Source Directory

- **Canonical Path**: `D:\ProjectsNew\blenderProjects\Yuki3dAssets\` (and parent `D:\ProjectsNew\blenderProjects\`).
- **Description**: The primary source directory for Yuki's 3D `.blend` scenes, stage maps, props, and asset pipelines (e.g., `cute_cafe_scene_final.blend`).
- **Blender MCP Integration**: `blender-mcp` is active and connected to the user's running Blender instance. When debugging lighting, PBR materials, cameras, or transforms, query Blender directly via `execute_blender_code` or `get_scene_info`.

---

## Packaging & Installer Bundling Protocol (`start_build.bat`)

Whenever adding new dependencies, external binaries, AI models, or C-extensions to Project Yuki, **ALWAYS** follow this checklist to ensure they package into the Inno Setup installer and load cleanly at runtime:

### 1. Dynamic / Unlinked DLLs (NVIDIA CUDA, cuDNN, Audio / Video Codecs)
- **The Pitfall**: PyInstaller's static binary scanner only detects DLLs listed in the Portable Executable (PE) import table at compile-time. Libraries that load DLLs dynamically at runtime via `LoadLibraryW()` or `ctypes.CDLL` (e.g. `onnxruntime-gpu`, `ctranslate2`, `torch`, `soundfile`, `imageio-ffmpeg`, `av`) will **silently fail** to package those DLLs.
- **Spec Mapping (`backend/yuki-backend.spec`)**:
  - Locate native `.dll` files in `backend/venv/Lib/site-packages/<package>/...`
  - Explicitly append them to `manual_datas` or `all_binaries` (similar to how `_nvidia_dlls` and `av.libs` are bundled).
- **Windows DLL Search Directory (`backend/run.py`)**:
  - On Windows with Python 3.8+, Python no longer searches `PATH` or the working directory for DLLs loaded by Python/extensions.
  - If DLLs are placed in a subfolder (e.g. `_internal/nvidia/.../bin` or custom tool directories), you **must** register that path using `os.add_dll_directory(str(dir_path))` early in `backend/run.py` before any module imports the C-extension.

### 2. Dynamic / String-Based Python Imports
- **The Pitfall**: Modules loaded via `importlib.import_module()`, dynamic dispatch (e.g., `app.tools.*`, `app.channels.*`), or conditional ASGI server adapters (Uvicorn protocols/lifespan) are invisible to PyInstaller's AST parser.
- **Spec Hidden Imports (`backend/yuki-backend.spec`)**:
  - Add the full module name string to `manual_hidden` or use `collect_all('<package>')` / `collect_submodules('<package>')`.

### 3. Non-Code Runtime Data, Dictionaries & AI Models
- **The Pitfall**: Non-Python files (`.onnx`, `.bin`, `.pt`, `.json`, `.html`, `.dic`, `.dat`) are completely ignored unless declared.
- **Backend Model Assets**: Add to `manual_datas` in `backend/yuki-backend.spec` (e.g., Kokoro ONNX, Whisper base weights, pykakasi data).
- **Frontend / 3D Avatar Models (`.vrm`)**: Add to `extraResources` in `frontend/electron-builder.yml` under `./bundled-models` so they remain outside the Electron `app.asar` archive and can be served directly.

### 4. Standalone Binaries & Language Servers
- If introducing standalone executables (e.g., LSP language servers `pyright`, `typescript-language-server`, or CLI tools):
  - Place portable versions in `backend/app/bin/<tool>/`.
  - Include the directory in `manual_datas` in `yuki-backend.spec`.
  - Access them at runtime using path resolution that checks both development mode (`Path(__file__).parent...`) and frozen mode (`sys._MEIPASS` or `sys.executable` parent).

### 5. Installer Upgrade Hygiene (`frontend/installer.iss`)
- Inno Setup must not leave behind stale or conflicting `.dll` / `.pyd` files from older builds when a user updates.
- Check `[InstallDelete]` in `installer.iss`: ensure `{app}\resources\backend\_internal` is wiped during installation so incompatible binary mixtures never occur.

---

## React Hook Initialization Order & Temporal Dead Zone (TDZ) Rule

JavaScript `const` and `let` variables are not hoisted. In large React components like `App.jsx`, referencing state, refs, or variables before their declaration line inside hook dependencies, hook bodies, or initializers causes a fatal runtime crash:
`ReferenceError: Cannot access '<variable>' before initialization` (which in production minified bundles renders as `Cannot access 'N' before initialization` or similar single-letter names caught by the React ErrorBoundary).

### 1. The Build Trap
- Tools like Vite, ESBuild, and Rollup only check syntactic validity during `npm run build` and byte compilation. They **CANNOT** catch runtime Temporal Dead Zone (TDZ) evaluations if code references a variable that is declared lower down in the component function body.
- The build will exit with code 0, but the packaged or installed app will immediately crash on boot into the ErrorBoundary modal.

### 2. Mandatory Rules for Hook Placement
- **Strict Declaration Order**: Always declare all foundational state hooks (`useState`, `useRef`) at the very top of the component before any `useEffect`, `useMemo`, `useCallback`, or custom hooks that read them in dependency arrays or initializers.
- **Dependencies Must Exist**: Before adding any state variable (e.g. `profile`, `settings`, `disabledAnimations`) to a `useEffect` or `useMemo` dependency array `[profile?.settings?.xyz]`, verify that the `const [profile, setProfile] = useState(...)` declaration physically precedes it in the file.
- **Pre-Commit / Build Verification**: Whenever editing state hooks or effects in `App.jsx` or other core components, verify with a static check that no hook evaluates a variable before its declaration line.

---

## Frontend Undefined Identifier & Ref-Naming Validation Rule (`ReferenceError: <x> is not defined`)

Whenever adding or renaming state variables, `useRef` handles, animation mixers, math utilities, or physics velocities in large React components (`DateModeApp.jsx`, `AvatarViewer.jsx`, `App.jsx`):

### 1. The Vite / ESBuild Global Variable Trap
- **The Blindspot**: During `npm run build` (and development hot-reloading), Vite / ESBuild / Rollup treat undeclared identifiers as potential global variables on `window` or external ambient variables. They do **NOT** throw build-time syntax errors for undeclared identifiers like `playerVerticalVelRef` or `isPromenade`.
- **The Failure**: The build exits with `code 0` (e.g. `✓ built in 53s`), but the moment that execution path runs at runtime (such as entering a scene, jumping, or triggering an animation loop), the browser / Electron crashes with:
  `ReferenceError: <variable> is not defined` caught by the React ErrorBoundary modal.

### 2. Common Causes in Project Yuki
1. **Ref Naming Mismatches During Refactoring**:
   - Declaring `const playerJumpVelRef = useRef(0.0)` at the top of the component, but writing `playerVerticalVelRef.current` in the animation loop.
   - Declaring `const yukiJumpVelRef = useRef(0.0)`, but accessing `yukiVerticalVelRef.current`.
2. **Scope Boundaries in Event Listeners vs. Render Loops**:
   - Referencing render-loop scoped constants (like `isPromenade`, `transitionLocomotion`, `delta`) inside window event handlers (`handleKeyDown`, `handleResize`) declared outside `animate()`.
3. **Property vs. Variable Confusion**:
   - Accessing `isPromenade` instead of `currentDestId === 'marine_drive_night'`, or `vrmRef` instead of `vrmRef.current`.

### 3. Mandatory Pre-Commit Validation Protocol
Before concluding any frontend change involving new state, refs, or event listeners:
1. **Direct Identifier Declaration Audit**:
   - For every new ref or variable used in render loops or callbacks, grep or verify that `const <variable> = ...` is explicitly declared in the component body above its use.
2. **Automated Verification Snippet**:
   - Run a one-line Node check on the modified file to verify that all newly introduced identifier tokens exist as explicit declarations:
     ```powershell
     node -e "const fs = require('fs'); const content = fs.readFileSync('src/DateModeApp.jsx', 'utf-8'); ['var1', 'var2'].forEach(v => { if (!content.includes('const ' + v) && !content.includes('let ' + v)) throw new Error('Missing declaration: ' + v); }); console.log('All identifiers declared!');"
     ```

---

## Blender MCP Access

Live Blender sessions can be accessed directly via the `blender-mcp` MCP server:

- **Setup / Status**: Enabled via Blender's `Interface: Blender MCP` addon (`Preferences -> Add-ons -> Start MCP Server` in N-panel sidebar).
- **Tool Access**: Call lazy-loaded tools under server `blender-mcp` (e.g. `get_scene_info`, `get_object_info`, `get_viewport_screenshot`, `execute_blender_code`).
- **Convention**: Pass the user's verbatim request string in `user_prompt` where required.

---

## 3D Scene & Asset Modeling Protocol (Blender & Three.js)

When creating or modifying 3D environments, rooms, or props for Project Yuki (e.g. Date Mode scenes):

### 1. Compound & Cloned Asset Hierarchy (Parenting Rule)
- **Single Parent / Unified Mesh**: For any composite asset (e.g. potted plants, coffee mugs with crema/art, cakes, machines), join geometry into a single multi-material mesh or create **ONE** root parent asset with all constituents parented under it (`child.parent = parent`, `matrix_parent_inverse`).
- **Cloning & Duplication**: When duplicating assets (tables, chairs, cups, plants), **ALWAYS clone the root parent asset** (`Shift+D`). Never spawn independent loose constituent parts into the scene outliner.
- **Base Pivots**: Set root origins at the bottom contact surface (Z=0 on floor/table/sill) so props snap and sit flush without clipping.

### 2. Watertight Room Architecture
- Maintain continuous, sealed geometry across walls, ceilings, floors, baseboards, and window casings. Snapping coordinates must match exactly to avoid light leaks, floating gaps, or Z-fighting when the camera orbits.

### 3. Celestial Environment & Sky Parallax
- **Sky Backdrop**: Place the sky dome/backdrop at true astronomical distance (radius 50m–100m) fully enclosing the building.
- **Single Sun**: Place a single celestial Sun at distance/elevation so sunlight angles naturally through windows; do not stick flat disks on window panes.
- **Shadowless Clouds & Rotation**: 3D clouds must be shadow-free (unlit/pure diffuse) and parented under a dedicated root node (`Sky_Clouds_Root`) so Three.js can animate continuous sky drift via Y-axis rotation (`skyCloudsRoot.rotation.y += delta * speed`).

### 4. GLTF / Three.js Material Compatibility
- **Transparent Glass**: Use `Transmission Weight = 1.0`, `Alpha < 0.2`, `Roughness = 0.05`, and Blender blend mode `blend_method = 'BLEND'` (not OPAQUE) to prevent glass exporting as opaque plastic.
- **PBR Materials**: Keep materials clean and simple with Principled BSDF for optimal WebGL performance and predictable Three.js rendering.

### 5. Blender Project Source Files vs. Runtime GLB Assets
- **External Storage Policy**: All master Blender project source files (`.blend`, `.blend1`, `.blend2`) MUST be saved in the dedicated external directory:
  `D:\projectsNew\blenderProjects\Yuki3dAssets\` (or `D:\Projects New\blenderProjects\Yuki3dAssets\`).
- **NEVER Store `.blend` Files in Repository**: Never save `.blend` files in `frontend/public/` or anywhere inside the project workspace. The web/Three.js frontend strictly consumes optimized `.glb` binary assets. Storing `.blend` files in the workspace causes `update_installed.ps1` to sync multi-megabyte binary bloat into production installations and risks git tracking accidents.
- **Git & Robocopy Enforcement**: `.gitignore` and `update_installed.ps1` explicitly ignore and exclude `*.blend*`.

### 6. Asset Optimization & Procedural Geometry Rule
- Avoid multi-megabyte sample models (e.g. heavy sample models like `SheenChair.glb` ~4.1MB) for basic furniture.
- Prefer lightweight custom low-poly `.glb` models (<100KB) or procedural Three.js geometry (`THREE.Group` with PBR materials). Procedural geometry incurs **zero bandwidth, zero download delay, and zero file bloat**.

---

## Internet & Downloaded Assets Licensing & Attribution Protocol

Whenever importing or downloading assets from the internet (3D models, textures, audio/sound effects, fonts, icons, code libraries, or datasets):

### 1. License Verification Before Ingestion
- **Check License Type**: Explicitly inspect the source license before saving or bundling any external asset (e.g. CC0, CC-BY, CC-BY-SA, MIT, Apache 2.0, Royalty-Free, or proprietary/editorial restrictions).
- **Prohibited / Restrictive Licenses**: Never import assets with non-commercial (NC) or share-alike (SA) restrictions into core redistributable bundles unless explicitly approved by the user. Editorial-use-only assets must not be used in production builds.

### 2. Attribution & Credit Requirements (CC-BY, etc.)
- If an asset requires attribution (e.g., Creative Commons Attribution / CC-BY):
  - Record the **Asset Name / Title**, **Author / Creator**, **Source URL**, and **Exact License with Link** (e.g., `CC-BY 4.0`).
  - Note whether modifications were made to the original asset.
  - Maintain credits in the appropriate project notices/credits file (e.g., `THIRD_PARTY_LICENSES.md`, `ATTRIBUTION.md`, or asset-adjacent `README.txt` / metadata JSON).

### 3. Clean Packaging & Distribution
- When committing or packaging downloaded assets into `frontend/public/` or `backend/app/`:
  - Retain original license notices, copyright headers, or vendor credit files provided with the asset.
  - Keep models and textures optimized (prefer compressed glTF/GLB and web-ready formats) without stripping mandatory licensing metadata.


