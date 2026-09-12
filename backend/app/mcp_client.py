"""MCP stdio client bridge for Yuki's local tool server."""

from __future__ import annotations

import json
import os
import shlex
import sys
from copy import deepcopy
from contextlib import AsyncExitStack
from dataclasses import dataclass
from typing import Any, Callable, Dict, Iterable, List, Optional, Tuple

from app import config
from app.tools.selector import select_relevant_tools

try:  # Import lazily enough to keep local fallback usable during partial installs.
    from mcp import ClientSession, StdioServerParameters
    from mcp.client.stdio import stdio_client
except Exception:  # pragma: no cover - exercised only when dependency is absent.
    ClientSession = None  # type: ignore[assignment]
    StdioServerParameters = None  # type: ignore[assignment]
    stdio_client = None  # type: ignore[assignment]


ToolDefinitionProvider = Callable[[], list]
FilteredToolProvider = Callable[[str], list]
_INTERNAL_TOOL_SCHEMA_FIELDS = {
    "confirmed",
    "confirm",
    "_host_confirmed",
    "confirmation_grant_id",
    "_host_confirmation_grant_id",
}


@dataclass
class ToolCallResult:
    handled: bool
    result: str


class StdioMCPToolBridge:
    """Connects AgentExecutor to Yuki's stdio MCP server.

    The bridge owns one subprocess/session and converts MCP tool metadata into
    the OpenAI-compatible tool schema that LM Studio already accepts. If the MCP
    subprocess cannot start, callers can fall back to the existing local tool
    dispatcher unless strict mode is enabled.
    """

    def __init__(
        self,
        all_local_definitions: ToolDefinitionProvider,
        filtered_local_definitions: FilteredToolProvider,
    ) -> None:
        self._all_local_definitions = all_local_definitions
        self._filtered_local_definitions = filtered_local_definitions
        self._exit_stack: AsyncExitStack | None = None
        self._session: Any | None = None
        self._tool_names: set[str] = set()
        self._tool_definitions: list[dict[str, Any]] = []
        self._connect_error: str | None = None

    @property
    def enabled(self) -> bool:
        return config.TOOL_TRANSPORT == "mcp-stdio"

    @property
    def is_enabled(self) -> bool:
        return config.TOOL_TRANSPORT == "mcp-stdio"

    @property
    def fallback_enabled(self) -> bool:
        return config.MCP_FALLBACK_TO_LOCAL

    @property
    def last_error(self) -> str | None:
        return self._connect_error

    async def aclose(self) -> None:
        if self._exit_stack is not None:
            await self._exit_stack.aclose()
        self._exit_stack = None
        self._session = None
        self._tool_names = set()
        self._tool_definitions = []

    async def ensure_connected(self) -> bool:
        if not self.enabled:
            return False
        if self._session is not None:
            return True
        if ClientSession is None or StdioServerParameters is None or stdio_client is None:
            self._connect_error = "Python package 'mcp' is not installed."
            return False

        command = config.MCP_SERVER_COMMAND or sys.executable
        args = _server_args()
        env = os.environ.copy()
        env.update(config.MCP_SERVER_ENV)
        backend_dir = str(config.BASE_DIR)
        env["PYTHONPATH"] = _prepend_path(env.get("PYTHONPATH"), backend_dir)

        stack = AsyncExitStack()
        try:
            params = StdioServerParameters(
                command=command,
                args=args,
                env=env,
                cwd=str(config.MCP_SERVER_CWD or config.BASE_DIR),
            )
            read, write = await stack.enter_async_context(stdio_client(params))
            session = await stack.enter_async_context(ClientSession(read, write))
            await session.initialize()
            tools_response = await session.list_tools()
            tools = list(getattr(tools_response, "tools", []) or [])

            self._session = session
            self._exit_stack = stack
            self._tool_definitions = [_to_openai_tool(tool) for tool in tools]
            self._tool_names = {
                tool_def["function"]["name"] for tool_def in self._tool_definitions
            }
            self._connect_error = None
            print(f"[MCP] Connected to stdio tool server with {len(self._tool_names)} tools.")
            return True
        except Exception as exc:
            await stack.aclose()
            self._connect_error = str(exc)
            print(f"[MCP] Failed to connect to stdio tool server: {exc}")
            return False

    async def get_tool_definitions(
        self,
        user_message: str = "",
        dynamic: bool = True,
        is_date_mode: bool = False,
    ) -> list:
        if await self.ensure_connected():
            if (not dynamic or config.MCP_SEND_ALL_TOOLS or config.TOOL_SELECTION_MODE == "all") and not is_date_mode:
                return list(self._tool_definitions)
            if config.TOOL_SELECTION_MODE == "keyword" and not is_date_mode:
                wanted_names = _tool_names(self._filtered_local_definitions(user_message))
                filtered = [
                    tool for tool in self._tool_definitions
                    if tool["function"]["name"] in wanted_names
                ]
                if filtered:
                    return filtered
                return list(self._tool_definitions)
            return select_relevant_tools(
                self._tool_definitions,
                user_message,
                max_tools=8 if is_date_mode else config.TOOL_SELECTION_MAX_TOOLS,
                fallback_threshold=config.TOOL_SELECTION_FALLBACK_THRESHOLD,
                is_date_mode=is_date_mode,
            )

        if self.enabled and not self.fallback_enabled:
            reason = self._connect_error or "MCP stdio tool server is unavailable."
            raise RuntimeError(reason)

        if dynamic or is_date_mode:
            defs = self._filtered_local_definitions(user_message)
            if is_date_mode:
                from app.tools.selector import select_relevant_tools
                defs = select_relevant_tools(self._all_local_definitions(), user_message, max_tools=8, is_date_mode=True)
            return defs
        return self._all_local_definitions()

    async def call_tool(self, tool_name: str, tool_args: Dict[str, Any]) -> ToolCallResult:
        if not await self.ensure_connected():
            if self.enabled and not self.fallback_enabled:
                reason = self._connect_error or "MCP stdio tool server is unavailable."
                return ToolCallResult(True, f"Error: {reason}")
            return ToolCallResult(False, "")

        if tool_name not in self._tool_names:
            return ToolCallResult(False, "")

        try:
            result = await self._session.call_tool(tool_name, tool_args or {})
            return ToolCallResult(True, _stringify_mcp_result(result))
        except Exception as exc:
            await self.aclose()
            self._connect_error = f"Tool call failed; MCP session reset: {exc}"
            return ToolCallResult(True, f"Error executing MCP tool '{tool_name}': {exc}")


def _server_args() -> list[str]:
    if config.MCP_SERVER_ARGS:
        return shlex.split(config.MCP_SERVER_ARGS)
    return ["-m", "app.mcp_server"]


def _prepend_path(existing: str | None, new_path: str) -> str:
    if not existing:
        return new_path
    parts = existing.split(os.pathsep)
    if new_path in parts:
        return existing
    return os.pathsep.join([new_path, existing])


def _tool_names(tool_defs: Iterable[dict[str, Any]]) -> set[str]:
    names: set[str] = set()
    for tool in tool_defs:
        try:
            names.add(tool["function"]["name"])
        except Exception:
            continue
    return names


def _to_openai_tool(tool: Any) -> dict[str, Any]:
    name = _field(tool, "name")
    description = _field(tool, "description") or ""
    input_schema = _field(tool, "inputSchema") or _field(tool, "input_schema") or {}
    if hasattr(input_schema, "model_dump"):
        input_schema = input_schema.model_dump(exclude_none=True)
    if not isinstance(input_schema, dict):
        input_schema = {"type": "object", "properties": {}}
    input_schema = _sanitize_model_visible_schema(input_schema)
    input_schema.setdefault("type", "object")
    input_schema.setdefault("properties", {})
    return {
        "type": "function",
        "function": {
            "name": name,
            "description": description,
            "parameters": input_schema,
        },
    }


def _field(obj: Any, name: str) -> Any:
    if isinstance(obj, dict):
        return obj.get(name)
    return getattr(obj, name, None)


def _sanitize_model_visible_schema(input_schema: dict[str, Any]) -> dict[str, Any]:
    """Hide host-only authorization fields from LM Studio tool schemas."""
    schema = deepcopy(input_schema)
    properties = schema.get("properties")
    if isinstance(properties, dict):
        for field in _INTERNAL_TOOL_SCHEMA_FIELDS:
            properties.pop(field, None)
    required = schema.get("required")
    if isinstance(required, list):
        schema["required"] = [field for field in required if field not in _INTERNAL_TOOL_SCHEMA_FIELDS]
    return schema


def _stringify_mcp_result(result: Any) -> str:
    if result is None:
        return ""

    structured = _field(result, "structuredContent") or _field(result, "structured_content")
    content = _field(result, "content")
    if content:
        parts: list[str] = []
        for item in content:
            text = _field(item, "text")
            if text is not None:
                parts.append(str(text))
                continue
            data = _field(item, "data")
            if data is not None:
                parts.append(str(data))
        if parts:
            return "\n".join(parts)

    if structured is not None:
        try:
            return json.dumps(structured, ensure_ascii=False)
        except TypeError:
            return str(structured)

    return str(result)
