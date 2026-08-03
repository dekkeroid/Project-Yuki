# Yuki MCP stdio tool transport

Yuki now exposes its local desktop, file, web, and memory tools through a Model Context Protocol (MCP) server over stdio. The FastAPI backend also uses that same stdio server by default, so the local app and external MCP hosts share one tool boundary.

## Run as an MCP server

From the `backend` directory:

```bash
python -m app.mcp_server
```

For MCP hosts such as Claude Desktop, Codex, or other local MCP clients, configure the server as a subprocess. Example:

```json
{
  "mcpServers": {
    "yuki": {
      "command": "python",
      "args": ["-m", "app.mcp_server"],
      "cwd": "C:/ABSOLUTE/PATH/TO/Project-Yuki/backend"
    }
  }
}
```

Use the absolute Python executable path if your MCP host cannot find `python`.

## Backend tool execution

By default, the FastAPI backend discovers and calls Yuki's tools through stdio MCP:

- `YUKI_TOOL_TRANSPORT=mcp-stdio` (default): discover and call tools through `app.mcp_server`.
- `YUKI_TOOL_TRANSPORT=local`: use the legacy in-process Python dispatcher.
- `YUKI_MCP_FALLBACK_TO_LOCAL=true` (default): fall back to the legacy dispatcher if MCP startup fails.
- `YUKI_MCP_SEND_ALL_TOOLS=false` (default): use the schema-text selector instead of always sending every tool.
- `YUKI_TOOL_SELECTION_MODE=auto` (default): rank tool schemas by name, description, argument names, and argument descriptions.
- `YUKI_TOOL_SELECTION_MODE=keyword`: use the older filtered-tool compatibility path.
- `YUKI_TOOL_SELECTION_MODE=all` or `YUKI_MCP_SEND_ALL_TOOLS=true`: send the full tool list.
- `YUKI_TOOL_SELECTION_MAX_TOOLS=8`: maximum selected tools before fallback.
- `YUKI_TOOL_SELECTION_FALLBACK_THRESHOLD=0.08`: if confidence is weak, send all tools so the selector does not hide a needed tool.

Advanced subprocess overrides:

- `YUKI_MCP_SERVER_COMMAND`: command used to start the MCP server. Defaults to the current Python executable.
- `YUKI_MCP_SERVER_ARGS`: shell-style argument string. Defaults to `-m app.mcp_server`.
- `YUKI_MCP_SERVER_CWD`: working directory. Defaults to `backend`.

## Stdio safety rule

MCP stdio uses JSON-RPC messages over stdout. Do not write ordinary logs to stdout from the MCP server. `app.mcp_server` redirects existing tool `print()` output to stderr during tool calls so logs do not corrupt the MCP stream.

## Safety sandbox and confirmation grants

Risky tools are not authorized by model-supplied booleans. If the model calls `delete_file` with `confirmed: true`, or an external MCP host sends `confirmed: true`, the backend still rejects the call unless there is a valid backend-issued confirmation grant.

The grant is:

- created only after the local UI/backend asks for user confirmation,
- bound to tool name + normalized arguments,
- short-lived (`YUKI_TOOL_CONFIRMATION_GRANT_TTL_SECONDS`, default 120 seconds),
- consumed once at the final execution boundary,
- stored in `backend/.yuki_confirmation_grants.json` so the FastAPI process and MCP subprocess enforce the same authorization.

For direct REST actions such as `/api/system/open_or_play`, the first response
returns a non-executable `pending_confirmation_id`. The executable grant is
created server-side only after the frontend sends that pending ID back from the
user's confirmation dialog, and it is consumed immediately.

Sandbox configuration:

- `YUKI_TOOL_SANDBOX_ENABLED=true` (default)
- `YUKI_TOOL_SANDBOX_BLOCKED_TOOLS=` comma-separated deny-list for whole tools
- `YUKI_TOOL_SANDBOX_REQUIRE_CONFIRMATION_TOOLS=` comma-separated sensitive tools (empty = config.py defaults, which include the `jarvis_*` wrappers)
- `YUKI_TOOL_SANDBOX_CODER_MODE_BLOCKED_TOOLS=` tools blocked outright in Coder Mode / Advanced (autonomous) mode — no confirmation prompts (default `system_power_control,jarvis_system_power`); Coder Mode additionally enforces a workspace path sandbox on file create/edit/delete, while Advanced mode runs file operations freely
- `YUKI_TOOL_SANDBOX_BLOCKED_POWER_ACTIONS=shutdown,restart` by default
- `YUKI_TOOL_SANDBOX_BLOCKED_TERMINAL_PATTERNS=` optional `||`-separated regex list; these add to the built-in destructive command patterns
- `YUKI_TOOL_CONFIRMATION_GRANT_FILE=` optional file path override

Default sensitive actions include app launch, file create/edit/delete, terminal/Python execution, keyboard/mouse injection, process kill, window close, and system power controls. Shutdown and restart are blocked by default even if a model tries to set `confirmed: true`.

External MCP hosts can safely discover all Yuki tools, but sensitive tools will return `CONFIRM_REQUIRED` unless the local backend has issued a matching grant or the sandbox is explicitly disabled.

## Codegraph tools (local, opt-in)

Yuki can ship 9 code-intelligence tools to the LLM: the read-only `codegraph_explore`, `codegraph_search`, `codegraph_node`, `codegraph_files`, `codegraph_callers`, `codegraph_callees`, `codegraph_impact`, `codegraph_status`, plus `codegraph_set_workspace_directory` (registers a directory as the active coder workspace). They run the `codegraph` CLI locally as subprocesses — not through MCP — and are disabled by default.

Prerequisites:

- Install the CLI globally: `npm i -g @colbymchenry/codegraph`
- Index the target project: run `codegraph init` inside the project (creates a `.codegraph/` index). The default project is the repo root; override with `YUKI_CODEGRAPH_PROJECT` (absolute path).

Toggles (both default OFF):

- `YUKI_CODEGRAPH_CODER_ENABLED` / settings key `codegraph_coder_enabled` — ships codegraph tools in Coder mode. Exposed in AI Brain (main app), desktop Brain & AI Settings, and Agentic Workspace preferences.
- `YUKI_CODEGRAPH_ADVANCED_ENABLED` / settings key `codegraph_advanced_enabled` — also adds the codegraph tools to the Advanced (Autonomous Jarvis) tool suite. Only rendered/enabled when the coder toggle is on.

Caution text shown next to the toggles: "Codegraph must be installed on your PC for this tool to work." If the CLI or index is missing, the tools return a helpful error string instead of crashing the request.

### Coder-mode first-time setup flow

When `codegraph_coder_enabled` is on, the coder-mode system prompt instructs the agent to prefer codegraph for code navigation and adds a `ask_user`-gated setup flow for un-indexed workspaces:

1. The agent runs `codegraph_status` to check for an index.
2. If none exists, it asks the user via `ask_user` with three options: run `codegraph init` at the active workspace path (recommended), use a different path (typed in the dialog), or "I will do it myself".
3. On approval it runs `codegraph init "<path>"` through `jarvis_run_terminal`, and registers a user-supplied custom path via the `codegraph_set_workspace_directory(path)` tool, which persists it to `settings.session_directories` (making it the active coder workspace) and flips `set_active_workspace_directory`.


