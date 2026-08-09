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
