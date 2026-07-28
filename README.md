# Project Yuki

Project Yuki is an Electron + React desktop companion with a FastAPI backend, local LM Studio chat completions, speech/TTS support, file search, and desktop-control tools.

## Architecture overview

```text
Electron/React UI
  ├─ WebSocket chat stream + confirmation dialogs
  ├─ /open and /play quick commands
  └─ VRM avatar + desktop chat bubble

FastAPI backend (`backend/app/main.py`)
  ├─ AgentExecutor (`backend/app/agent/executor.py`)
  ├─ LM Studio `/v1/chat/completions`
  ├─ StdioMCPToolBridge (`backend/app/mcp_client.py`)
  ├─ Safety policy + one-time grants (`backend/app/tools/safety.py`)
  └─ Local fallback tool dispatcher

Stdio MCP subprocess (`backend/app/mcp_server.py`)
  └─ Existing Yuki tools in `backend/app/tools/*`
```

## MCP migration

Yuki's local tools are now exposed as a stdio MCP server via `python -m app.mcp_server`. The backend defaults to `YUKI_TOOL_TRANSPORT=mcp-stdio`, so tool discovery and execution go through MCP first, then fall back to the legacy in-process dispatcher when `YUKI_MCP_FALLBACK_TO_LOCAL=true`.

See [`backend/MCP.md`](backend/MCP.md) for host configuration, environment variables, and the stdio logging rule.

## Tool selection / tool-search-style routing

Claude's official tool-search tool dynamically loads a small number of relevant tools from a large catalog using deferred tool definitions (`defer_loading: true`) and search result references. The docs describe regex and BM25 variants that search tool names, descriptions, argument names, and argument descriptions: <https://platform.claude.com/docs/en/agents-and-tools/tool-use/tool-search-tool>.

LM Studio/OpenAI-style local tool calling does not provide Claude's `tool_reference` expansion protocol, so Yuki implements the closest compatible pattern locally:

- MCP discovers the full tool catalog.
- `backend/app/tools/selector.py` scores tool names, descriptions, and JSON-schema text against the current user message.
- The backend sends the highest scoring tools to LM Studio.
- If confidence is weak, it sends all tools instead of hiding the tool Yuki might need.

This keeps prompts smaller without the fragile old keyword-only buckets.

## Safety sandbox

Tool execution is guarded twice: before the backend dispatches to MCP/local fallback, and inside the MCP server itself.

Risky actions require a backend-issued, one-time confirmation grant. Model-supplied `confirmed: true`, client-supplied `force: true`, or external MCP host arguments do not authorize execution by themselves. This specifically protects against speech-to-text hallucinations such as a misheard shutdown request.

The frontend receives only a non-executable pending confirmation token before the user approves. The backend creates the executable grant after approval and consumes it immediately at the MCP/local execution boundary.

Default policy:

- Terminal commands are confirmation-gated, with destructive shell patterns blocked.
- Shutdown/restart are blocked by default.
- File create/edit/delete, app launch, process kill, keyboard/mouse input, window close, and non-media open/play actions require user approval.
- Read-only tools such as date/time, system stats, directory listing, search, and web search remain available without confirmation.

## UI improvements

Long desktop chat bubbles are clamped to the Electron window viewport using `frontend/src/utils/desktopBubblePosition.js`. The bubble now has max width/height, scroll handling, and robust word wrapping so longer 4-5 line messages no longer clip through the window.

## Building the app

The build pipeline runs four sequential steps. Each step depends on the previous one completing successfully.

```bash
# 1. Build the React frontend
\frontend > npm run build:frontend

# 2. Bundle the Python backend with PyInstaller
\backend > venv\Scripts\pyinstaller.exe yuki-backend.spec --noconfirm

# 3. Package the Electron app
\frontend > npm run build:electron

# 4. Create the Windows installer with Inno Setup
\frontend > & "$env:LOCALAPPDATA\Programs\Inno Setup 6\ISCC.exe" installer.iss
```

The final installer is output to `frontend/installer-output/`.

**Prerequisites:**
- Node.js and npm (for frontend and Electron builds)
- Python venv with all backend dependencies installed in `backend/venv`
- [Inno Setup 6](https://jrsoftware.org/isinfo.php) installed at the default location

## Development checks

Backend:

```bash
PYTHONPATH=backend python -m unittest discover -s backend/tests
PYTHONPATH=backend python -c "import app.mcp_server"
```

Frontend:

```bash
cd frontend
node src/utils/desktopBubblePosition.test.mjs
npm run build
```
