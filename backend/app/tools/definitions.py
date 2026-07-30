import app.config as config
from app.tools.selector import select_relevant_tools

def get_basic_tools_definition() -> list:
    """
    Returns the basic tool schemas optimized for weak/local LLMs.
    Compact token size, single-turn execution.
    """
    return [
        {
            "type": "function",
            "function": {
                "name": "get_system_stats",
                "description": "Get live system metrics: CPU %, RAM %, disk %, active IP, OS version, and current date/time.",
                "parameters": {"type": "object", "properties": {}}
            }
        },
        {
            "type": "function",
            "function": {
                "name": "launch_app",
                "description": "Launch a desktop application or open a URL.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "app_name": {"type": "string", "description": "App name to launch or browser to open URL."},
                        "args": {"type": "string", "description": "Optional CLI arguments or URL."},
                        "run_as_admin": {"type": "boolean", "description": "Run as administrator."}
                    },
                    "required": ["app_name"]
                }
            }
        },
        {
            "type": "function",
            "function": {
                "name": "web_search",
                "description": "Search the internet for real-time or unknown information.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "query": {"type": "string", "description": "Specific search query."}
                    },
                    "required": ["query"]
                }
            }
        },
        {
            "type": "function",
            "function": {
                "name": "update_user_fact",
                "description": "Remember a personal fact or preference shared by the user.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "key": {"type": "string", "description": "Category key ('interest', 'hobby', 'like', 'dislike', 'name')."},
                        "value": {"type": "string", "description": "The item or fact shared."}
                    },
                    "required": ["key", "value"]
                }
            }
        },
        {
            "type": "function",
            "function": {
                "name": "search_files",
                "description": "Find files stored on the user's local computer by name or keyword.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "query": {"type": "string", "description": "Filename or keyword to search for."}
                    },
                    "required": ["query"]
                }
            }
        },
        {
            "type": "function",
            "function": {
                "name": "open_or_play_file",
                "description": "Open or play a local file, media, or video.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "file_path_or_query": {"type": "string", "description": "File path or query to open/play."}
                    },
                    "required": ["file_path_or_query"]
                }
            }
        },
        {
            "type": "function",
            "function": {
                "name": "manage_time",
                "description": "Manage timers, scheduled reminders, alarms, and stopwatches.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "action": {
                            "type": "string",
                            "enum": ["set_timer", "set_alarm", "set_reminder", "start_stopwatch", "check_stopwatch", "stop_stopwatch", "list_active", "cancel"]
                        },
                        "duration_seconds": {"type": "integer", "description": "Timer duration in seconds."},
                        "target_time": {"type": "string", "description": "Target time string."},
                        "message": {"type": "string", "description": "Reminder or timer message."}
                    },
                    "required": ["action"]
                }
            }
        }
    ]


def get_advanced_jarvis_tools_definition() -> list:
    """
    Returns the completely independent Advanced Jarvis tool schemas engineered for Frontier Cloud LLMs.
    Supports parallel tool calling, multi-step ReAct reasoning, SQLite DB queries, code review, and PC automation.
    """
    return [
        {
            "type": "function",
            "function": {
                "name": "jarvis_query_file_db",
                "description": "Search the SQLite indexed file database (yuki_files.db) across all PC drives. Matches file names, parent folders, full directory paths, Japanese/Chinese Romaji/Pinyin transliterations, and metadata tags (title, artist, genre). Uses density ranking (/o algorithm).",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "query": {
                            "type": "string",
                            "description": "Search query keywords (e.g. 'fate stay night ep 1', 'elden ring save file', 'python script'). Searches file names AND parent folder paths."
                        },

                        "extension": {
                            "type": "string",
                            "description": "Only use when you are certain of the exact extension the user wants (e.g. '.pdf', '.zip', '.exe'). Do NOT use for music, videos, or images — those are better found by query keywords alone."
                        },
                        "path_hint": {
                            "type": "string",
                            "description": "Optional folder or drive path hint (e.g. 'D:', 'Downloads', 'Anime', 'Desktop', 'Games')."
                        },
                        "search_scope": {
                            "type": "string",
                            "description": "Optional target search scope: 'all' (default), 'folder_only' (search folder names & parent paths), 'file_only' (search file names), 'metadata_only' (search title/artist/tags)."
                        },
                        "limit": {
                            "type": "integer",
                            "description": "Max results to return (default 25)."
                        }
                    },
                    "required": ["query"]
                }
            }
        },
        {
            "type": "function",
            "function": {
                "name": "jarvis_read_file",
                "description": "Read text or code file content with line slicing for analysis, code review, and debugging.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "file_path": {"type": "string", "description": "Absolute path to local text/code file."},
                        "max_lines": {"type": "integer", "description": "Max lines to read (default 250)."},
                        "start_line": {"type": "integer", "description": "Starting line number (default 1)."}
                    },
                    "required": ["file_path"]
                }
            }
        },
        {
            "type": "function",
            "function": {
                "name": "jarvis_create_or_edit_file",
                "description": "Create or edit a text/code file on disk. Mode: 'write' (overwrite) or 'append'.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "file_path": {"type": "string", "description": "Absolute path to file."},
                        "content": {"type": "string", "description": "File content to write."},
                        "mode": {"type": "string", "description": "Write mode ('write' or 'append')."}
                    },
                    "required": ["file_path", "content"]
                }
            }
        },
        {
            "type": "function",
            "function": {
                "name": "jarvis_replace_file_content",
                "description": "Replaces an exact target_content text block with replacement_content in a file. Allows precise code refactoring without rewriting entire files.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "file_path": {"type": "string", "description": "Absolute path to file."},
                        "target_content": {"type": "string", "description": "Exact target string to find and replace."},
                        "replacement_content": {"type": "string", "description": "Replacement string."}
                    },
                    "required": ["file_path", "target_content", "replacement_content"]
                }
            }
        },
        {
            "type": "function",
            "function": {
                "name": "jarvis_list_dir_tree",
                "description": "Inspect directory tree structure and subdirectories.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "dir_path": {"type": "string", "description": "Absolute folder path."},
                        "max_depth": {"type": "integer", "description": "Max directory depth (default 2)."},
                        "limit": {"type": "integer", "description": "Max output lines (default 100). Increase for large directories."}
                    },
                    "required": ["dir_path"]
                }
            }
        },
        {
            "type": "function",
            "function": {
                "name": "jarvis_git_status",
                "description": "Inspect git working tree status, modified files, and recent commit history.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "repo_path": {"type": "string", "description": "Path to git repository folder (optional)."}
                    }
                }
            }
        },
        {
            "type": "function",
            "function": {
                "name": "jarvis_system_diagnostics",
                "description": "Retrieve CPU %, RAM %, disk usage, top resource-heavy processes, local IP, and ping internet status.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "filter_name": {"type": "string", "description": "Optional process name filter (e.g. 'chrome', 'python')."},
                        "top_n": {"type": "integer", "description": "Number of top processes to return (default 10)."}
                    }
                }
            }
        },
        {
            "type": "function",
            "function": {
                "name": "jarvis_web_search",
                "description": "Perform web search for news, real-time facts, documentation, or prices.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "query": {"type": "string", "description": "Search query string."}
                    },
                    "required": ["query"]
                }
            }
        },
        {
            "type": "function",
            "function": {
                "name": "jarvis_web_scrape",
                "description": "Fetch a web page URL and extract clean text/markdown content for deep reading.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "url": {"type": "string", "description": "Web URL to fetch and scrape."},
                        "max_chars": {"type": "integer", "description": "Max text characters to extract (default 4000)."}
                    },
                    "required": ["url"]
                }
            }
        },
        {
            "type": "function",
            "function": {
                "name": "jarvis_launch_app",
                "description": "Launch a desktop application or open a web URL.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "app_name": {"type": "string", "description": "Application name or URL to launch."},
                        "args": {"type": "string", "description": "Optional CLI arguments or URL parameters."}
                    },
                    "required": ["app_name"]
                }
            }
        },
        {
            "type": "function",
            "function": {
                "name": "jarvis_open_or_play_file",
                "description": "Open or play a local file, document, or media.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "file_path_or_query": {"type": "string", "description": "File path or query to open/play."}
                    },
                    "required": ["file_path_or_query"]
                }
            }
        },
        {
            "type": "function",
            "function": {
                "name": "jarvis_window_control",
                "description": "List active desktop windows or query window titles.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "action": {"type": "string", "description": "Action ('list')."},
                        "title_query": {"type": "string", "description": "Window title query."}
                    }
                }
            }
        },
        {
            "type": "function",
            "function": {
                "name": "jarvis_system_volume",
                "description": "Set speaker volume level.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "volume_level": {"type": "integer", "description": "Volume percent (0-100)."}
                    },
                    "required": ["volume_level"]
                }
            }
        },
        {
            "type": "function",
            "function": {
                "name": "jarvis_system_power",
                "description": "Lock PC, sleep PC, or sign out PC.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "action": {
                            "type": "string",
                            "enum": ["lock", "sleep", "sign_out", "shutdown", "restart"]
                        }
                    },
                    "required": ["action"]
                }
            }
        },
        {
            "type": "function",
            "function": {
                "name": "jarvis_manage_time",
                "description": "Manage timers, scheduled reminders, alarms, and stopwatches.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "action": {
                            "type": "string",
                            "enum": ["set_timer", "set_alarm", "set_reminder", "start_stopwatch", "check_stopwatch", "stop_stopwatch", "list_active", "cancel"]
                        },
                        "duration_seconds": {"type": "integer", "description": "Timer duration in seconds."},
                        "target_time": {"type": "string", "description": "Target time string."},
                        "message": {"type": "string", "description": "Timer or reminder message."}
                    },
                    "required": ["action"]
                }
            }
        },
        {
            "type": "function",
            "function": {
                "name": "jarvis_remember_user_fact",
                "description": "Remember a personal fact or preference shared by the user.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "key": {"type": "string", "description": "Category key ('interest', 'hobby', 'like', 'dislike', 'name') or a custom label (e.g. 'favourite drink'). Multiple values for the same key accumulate as a list."},
                        "value": {"type": "string", "description": "Fact or preference value."}
                    },
                    "required": ["key", "value"]
                }
            }
        },
        {
            "type": "function",
            "function": {
                "name": "jarvis_close_app",
                "description": "Close or terminate a running desktop application by name.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "app_name": {"type": "string", "description": "Application name to terminate (e.g. 'chrome', 'notepad', 'spotify')."},
                        "pid": {"type": "integer", "description": "Optional process ID if you want to kill a specific instance."}
                    },
                    "required": ["app_name"]
                }
            }
        },
        {
            "type": "function",
            "function": {
                "name": "jarvis_run_terminal",
                "description": "Run a terminal command in PowerShell or Cmd and return the output. Returns both stdout and stderr.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "command": {"type": "string", "description": "Shell command to execute."},
                        "use_powershell": {"type": "boolean", "description": "Use PowerShell (true) or Cmd (false). Default true."},
                        "cwd": {"type": "string", "description": "Optional working directory path to execute the command in (e.g. 'D:/Projects/App')."},
                        "stdin_input": {"type": "string", "description": "Optional text or newline to write to stdin if command expects interactive prompt input."}
                    },
                    "required": ["command"]
                }
            }
        },
        {
            "type": "function",
            "function": {
                "name": "find_files_by_glob",
                "description": "Find files matching a glob pattern (e.g. 'src/**/*.jsx', '**/*.py', 'package*.json') starting from root_dir. Excludes node_modules, .git, dist, build, venv.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "pattern": {"type": "string", "description": "Glob pattern string (e.g. 'src/**/*.jsx', '**/*.py')."},
                        "root_dir": {"type": "string", "description": "Optional root directory path to start glob search in."}
                    },
                    "required": ["pattern"]
                }
            }
        },
        {
            "type": "function",
            "function": {
                "name": "jarvis_send_stdin",
                "description": "Send keyboard text or newline input directly to standard input (stdin) of an actively running background terminal process.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "input_text": {"type": "string", "description": "Text, number, or newline character to write to the active process's stdin."},
                        "pid": {"type": "integer", "description": "Optional PID of target process. Defaults to the latest active background process."}
                    },
                    "required": ["input_text"]
                }
            }
        },
        {
            "type": "function",
            "function": {
                "name": "jarvis_run_python",
                "description": "Execute Python code for calculations, math, stats, data processing (CSV/JSON/XML), file operations (batch rename, find duplicates, hash), text processing, format conversion, system interrogation, web API calls, encryption/hashing, code analysis/lint, and any custom logic. Full Python stdlib + numpy/pandas available. Returns stdout output.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "code": {"type": "string", "description": "Python code to execute."}
                    },
                    "required": ["code"]
                }
            }
        },
        {
            "type": "function",
            "function": {
                "name": "jarvis_keyboard_input",
                "description": "Simulate keyboard typing or key combinations (e.g. ['ctrl', 'c'], ['alt', 'tab'], ['win', 'd']).",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "action": {
                            "type": "string",
                            "enum": ["type", "press_keys"]
                        },
                        "text": {"type": "string", "description": "Text string to type (for 'type' action)."},
                        "keys": {"type": "array", "items": {"type": "string"}, "description": "List of key strings to press simultaneously (for 'press_keys' action)."}
                    },
                    "required": ["action"]
                }
            }
        },
        {
            "type": "function",
            "function": {
                "name": "jarvis_media_playback_control",
                "description": "Control media playback: play, pause, next track, previous track, or stop across any app. Can target a specific app (e.g. 'VLC', 'Spotify') or pause all known media-player windows.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "action": {
                            "type": "string",
                            "enum": ["play", "pause", "next", "previous", "stop"]
                        },
                        "app_name": {
                            "type": "string",
                            "description": "Optional: Target a specific app by window title substring e.g. 'VLC', 'Spotify', 'YouTube'."
                        },
                        "all": {
                            "type": "boolean",
                            "description": "If true, pause all known media-player windows (VLC, Spotify, etc.)."
                        }
                    },
                    "required": ["action"]
                }
            }
        }
    ]


def get_tools_definition() -> list:
    """
    Dynamically returns tool definitions based on runtime TOOL_MODE.
    """
    if getattr(config, "TOOL_MODE", "basic") == "advanced":
        return get_advanced_jarvis_tools_definition()
    return get_basic_tools_definition()


def get_filtered_tools(user_message: str) -> list:
    """Return a schema-ranked tool list for the current user message."""
    return select_relevant_tools(get_tools_definition(), user_message)
