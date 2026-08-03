"""Native codegraph tools for Yuki.

These tools shell out to the `codegraph` CLI (the `@colbymchenry/codegraph` npm
package). The CLI reads the project's `.codegraph/` index directly, so no MCP
server is required. Each function mirrors one of the codegraph MCP tools but
runs as a regular local Yuki tool.

Prerequisites:
  - `codegraph` installed and on PATH (`npm i -g @colbymchenry/codegraph`)
  - the target project indexed (`codegraph init` in that folder)

If the binary is missing or the project is not indexed, the tools return a
friendly message instead of raising.
"""

from __future__ import annotations

import os
import shutil
import subprocess
from typing import Optional

from app import config

_CODEGRAPH_MISSING = (
    "Codegraph is not installed on this PC (or is not on PATH). "
    "Install it with: npm i -g @colbymchenry/codegraph"
)
_NOT_INDEXED = (
    "Codegraph has no index for this project. Run `codegraph init` in the project "
    "folder to build one, then try again."
)
_DEFAULT_TIMEOUT = 90


def _project_path(project_path: Optional[str]) -> str:
    return project_path or getattr(config, "CODEGRAPH_PROJECT", "") or ""


def _run(subcommand: str, *args: str, timeout: int = _DEFAULT_TIMEOUT) -> str:
    """Run `codegraph <subcommand>` and return stdout, or a friendly error."""
    binary = shutil.which("codegraph")
    if not binary:
        return _CODEGRAPH_MISSING

    if os.name == "nt":
        # `codegraph` resolves to a `.cmd` shim that CreateProcess cannot run
        # directly, so route through cmd.exe with /d /s /c (subprocess quotes
        # args containing spaces automatically via list2cmdline).
        cmd = ["cmd", "/d", "/s", "/c", binary, subcommand, *[str(a) for a in args]]
    else:
        cmd = [binary, subcommand, *[str(a) for a in args]]

    try:
        proc = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=timeout,
        )
    except FileNotFoundError:
        return _CODEGRAPH_MISSING
    except subprocess.TimeoutExpired:
        return f"Error: codegraph {subcommand} timed out after {timeout}s."

    if proc.returncode != 0:
        stderr = (proc.stderr or "").strip()
        if stderr and "no such file" in stderr.lower():
            return _NOT_INDEXED
        return f"Error running codegraph {subcommand}: {stderr or proc.stdout.strip() or proc.returncode}"

    return (proc.stdout or "").strip() or "(no output)"


def _path_flag(project_path: Optional[str]) -> list[str]:
    resolved = _project_path(project_path)
    return ["-p", resolved] if resolved else []


def codegraph_explore(query: str, max_files: Optional[int] = None, project_path: Optional[str] = None) -> str:
    """Explore an area of the codebase: relevant symbols' source plus the call paths between them in one shot."""
    args = _path_flag(project_path)
    if max_files:
        args.extend(["--max-files", str(int(max_files))])
    args.append(query or "")
    return _run("explore", *args)


def codegraph_search(query: str, limit: Optional[int] = None, project_path: Optional[str] = None) -> str:
    """Search for symbols (functions, classes, etc.) by name or keywords in the codebase."""
    args = _path_flag(project_path)
    if limit:
        args.extend(["-l", str(int(limit))])
    args.append(query or "")
    return _run("query", *args)


def codegraph_node(name: str, project_path: Optional[str] = None) -> str:
    """Read one symbol's source plus its caller/callee trail."""
    return _run("node", *_path_flag(project_path), name or "")


def codegraph_files(project_path: Optional[str] = None) -> str:
    """Show the project file structure from the codegraph index."""
    return _run("files", *_path_flag(project_path))


def codegraph_callers(symbol: str, limit: Optional[int] = None, project_path: Optional[str] = None) -> str:
    """Find all functions/methods that call a specific symbol."""
    args = _path_flag(project_path)
    if limit:
        args.extend(["-l", str(int(limit))])
    args.append(symbol or "")
    return _run("callers", *args)


def codegraph_callees(symbol: str, limit: Optional[int] = None, project_path: Optional[str] = None) -> str:
    """Find all functions/methods that a specific symbol calls."""
    args = _path_flag(project_path)
    if limit:
        args.extend(["-l", str(int(limit))])
    args.append(symbol or "")
    return _run("callees", *args)


def codegraph_impact(symbol: str, project_path: Optional[str] = None) -> str:
    """Analyze what code is affected by changing a specific symbol."""
    return _run("impact", *_path_flag(project_path), symbol or "")


def codegraph_status(project_path: Optional[str] = None) -> str:
    """Show codegraph index status and statistics for the project."""
    return _run("status", _project_path(project_path))
