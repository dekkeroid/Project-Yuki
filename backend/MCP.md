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
- `YUKI_TOOL_SANDBOX_REQUIRE_CONFIRMATION_TOOLS=` comma-separated sensitive tools
- `YUKI_TOOL_SANDBOX_BLOCKED_POWER_ACTIONS=shutdown,restart` by default
- `YUKI_TOOL_SANDBOX_BLOCKED_TERMINAL_PATTERNS=` optional `||`-separated regex list; these add to the built-in destructive command patterns
- `YUKI_TOOL_CONFIRMATION_GRANT_FILE=` optional file path override

Default sensitive actions include app launch, file create/edit/delete, terminal/Python execution, keyboard/mouse injection, process kill, window close, and system power controls. Shutdown and restart are blocked by default even if a model tries to set `confirmed: true`.

External MCP hosts can safely discover all Yuki tools, but sensitive tools will return `CONFIRM_REQUIRED` unless the local backend has issued a matching grant or the sandbox is explicitly disabled.
