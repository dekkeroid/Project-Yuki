from app.tools.selector import select_relevant_tools

def get_tools_definition() -> list:
    """
    Returns the list of tool schemas for LM Studio native tool calling.
    Optimized for compact token size to prevent exceeding context window limits.
    """
    return [
        {
            "type": "function",
            "function": {
                "name": "get_system_stats",
                "description": "Get live system metrics: CPU %, RAM %, disk %, active IP, OS version, and current date/time. Use for: 'what time is it', 'how is my PC', 'what is my IP', 'check my RAM'.",
                "parameters": {"type": "object", "properties": {}}
            }
        },
        {
            "type": "function",
            "function": {
                "name": "launch_app",
                "description": "Launch a desktop application or open a URL. Use ONLY when the user explicitly asks to open or launch an app (e.g. 'open Chrome', 'launch Spotify', 'open this URL'). Do NOT use for files or media — use open_or_play_file for those.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "app_name": {"type": "string", "description": "App name to launch (e.g. 'chrome', 'notepad', 'spotify') or browser to open URL."},
                        "args": {"type": "string", "description": "Optional CLI arguments or URL (e.g. 'https://example.com')."},
                        "run_as_admin": {"type": "boolean", "description": "Run as administrator."}
                    },
                    "required": ["app_name"]
                }
            }
        },
        {
            "type": "function",
            "function": {
                "name": "set_system_volume",
                "description": "Set speaker volume.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "volume_level": {"type": "integer", "description": "Percent (0-100)."}
                    },
                    "required": ["volume_level"]
                }
            }
        },
        {
            "type": "function",
            "function": {
                "name": "web_search",
                "description": "Search the internet for real-time or unknown information. Use ONLY when the user asks for current news, recent facts, prices, or something you genuinely cannot answer from your training knowledge. Do NOT use for general knowledge, opinions, or conversational questions.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "query": {"type": "string", "description": "Specific search query (e.g. 'red dye 40 safety side effects 2025'). Be specific."}
                    },
                    "required": ["query"]
                }
            }
        },
        {
            "type": "function",
            "function": {
                "name": "update_user_fact",
                "description": "Remember a personal fact the user has EXPLICITLY told you about themselves (e.g. their name, a preference, a hobby they mentioned). Do NOT call this as a side-effect of searches, system actions, or tool results. ONLY call when the user directly shares personal information.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "key": {"type": "string", "description": "Category key (e.g. 'name', 'favorite_color', 'hobby')."},
                        "value": {"type": "string", "description": "The information the user shared."}
                    },
                    "required": ["key", "value"]
                }
            }
        },
        {
            "type": "function",
            "function": {
                "name": "list_directory",
                "description": "List files in folder.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "directory_path": {"type": "string", "description": "Absolute folder path."}
                    }
                }
            }
        },
        {
            "type": "function",
            "function": {
                "name": "search_files",
                "description": "Find files stored on the user's local computer by name or keyword. Use when the user asks to find or locate a specific file or document on their PC.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "query": {"type": "string", "description": "Filename or keyword to search for."},
                        "start_directory": {"type": "string", "description": "Base directory to search within (optional)."}
                    },
                    "required": ["query"]
                }
            }
        },
        {
            "type": "function",
            "function": {
                "name": "open_or_play_file",
                "description": "Open a local file, folder, or play media on the user's computer. Use for any 'play', 'open', 'watch', 'read', or 'show me' request targeting a file or media. Always pass the user's raw query words (e.g. 'towa song', 'romantic anime') — never construct or guess a file path.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "file_path_or_query": {"type": "string", "description": "Raw user query words or absolute file path. Never invent filenames."},
                        "play_mode": {"type": "boolean", "description": "Set true to play media (music, video). Leave false to open documents/folders."}
                    },
                    "required": ["file_path_or_query"]
                }
            }
        },
        {
            "type": "function",
            "function": {
                "name": "create_file",
                "description": "Create text file.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "file_path": {"type": "string", "description": "Absolute path."},
                        "content": {"type": "string", "description": "Text content."}
                    },
                    "required": ["file_path", "content"]
                }
            }
        },
        {
            "type": "function",
            "function": {
                "name": "edit_file",
                "description": "Search and replace text in file.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "file_path": {"type": "string", "description": "Absolute path."},
                        "search_text": {"type": "string", "description": "Target text block."},
                        "replace_text": {"type": "string", "description": "New replacement text."}
                    },
                    "required": ["file_path", "search_text", "replace_text"]
                }
            }
        },
        {
            "type": "function",
            "function": {
                "name": "delete_file",
                "description": "Delete file. Requires a user approval dialog; do not add confirmation flags yourself.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "file_path": {"type": "string", "description": "Absolute path."}
                    },
                    "required": ["file_path"]
                }
            }
        },
        {
            "type": "function",
            "function": {
                "name": "read_file_content",
                "description": "Read the contents of a local text, code, or PDF file.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "file_path": {"type": "string", "description": "Absolute path to the file to read."}
                    },
                    "required": ["file_path"]
                }
            }
        },
        {
            "type": "function",
            "function": {
                "name": "control_window",
                "description": "Manage active windows.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "action": {
                            "type": "string",
                            "description": "Action type.",
                            "enum": ["minimize", "maximize", "restore", "move", "focus", "close", "list"]
                        },
                        "window_title": {"type": "string", "description": "Target window. Use 'all', 'all windows', '*', or 'them all' for all visible windows. Partial match for specific (e.g. 'chrome', 'notepad'). Required except for 'list'."},
                        "x": {"type": "integer", "description": "Move target X (only for 'move' action)."},
                        "y": {"type": "integer", "description": "Move target Y (only for 'move' action)."}
                    },
                    "required": ["action"]
                }
            }
        },
        {
            "type": "function",
            "function": {
                "name": "run_terminal_command",
                "description": "Run a shell command on the user's Windows PC (PowerShell or CMD). Use for system tasks, installs, git operations, or anything requiring a command line. Do NOT use when open_or_play_file or launch_app can handle the request.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "command": {"type": "string", "description": "The command to execute."},
                        "use_powershell": {"type": "boolean", "description": "True for PowerShell, false for CMD."}
                    },
                    "required": ["command"]
                }
            }
        },
        {
            "type": "function",
            "function": {
                "name": "run_python_script",
                "description": "Execute Python code on the user's machine. Use for calculations, data processing, or automation that specifically requires Python — not for file opening or web browsing.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "code": {"type": "string", "description": "Python source code to execute."}
                    },
                    "required": ["code"]
                }
            }
        },
        {
            "type": "function",
            "function": {
                "name": "take_screenshot",
                "description": "Take screen capture.",
                "parameters": {"type": "object", "properties": {}}
            }
        },
        {
            "type": "function",
            "function": {
                "name": "keyboard_mouse_input",
                "description": "Simulate keyboard/mouse inputs.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "action": {
                            "type": "string",
                            "description": "Input action.",
                            "enum": ["type", "press_keys", "click", "double_click", "move_to", "scroll"]
                        },
                        "text": {"type": "string", "description": "Text to type."},
                        "keys": {
                            "type": "array",
                            "items": {"type": "string"},
                            "description": "Keys (e.g. ['ctrl', 'c'])."
                        },
                        "x": {"type": "integer", "description": "Mouse X."},
                        "y": {"type": "integer", "description": "Mouse Y."},
                        "amount": {"type": "integer", "description": "Scroll amount."}
                    },
                    "required": ["action"]
                }
            }
        },
        {
            "type": "function",
            "function": {
                "name": "media_playback_control",
                "description": "Simulate media keys.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "action": {
                            "type": "string",
                            "description": "Playback action.",
                            "enum": ["play_pause", "next", "previous", "volume_up", "volume_down", "mute"]
                        }
                    },
                    "required": ["action"]
                }
            }
        },
        {
            "type": "function",
            "function": {
                "name": "manage_process",
                "description": "List or kill processes.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "action": {
                            "type": "string",
                            "description": "Action type.",
                            "enum": ["list", "kill"]
                        },
                        "name": {"type": "string", "description": "Process name (e.g. notepad.exe)."},
                        "pid": {"type": "integer", "description": "Process ID."}
                    },
                    "required": ["action"]
                }
            }
        },
        {
            "type": "function",
            "function": {
                "name": "system_power_control",
                "description": "Lock PC, sleep PC, or sign out PC after user approval. Shutdown/restart are sandbox-blocked by default.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "action": {
                            "type": "string",
                            "description": "Power action.",
                            "enum": ["lock", "sleep", "sign_out", "shutdown", "restart"]
                        }
                    },
                    "required": ["action"]
                }
            }
        }
    ]


def get_filtered_tools(user_message: str) -> list:
    """Return a compact, schema-ranked tool list for the current user message.

    This replaces the old keyword buckets with a local retrieval step over tool
    names, descriptions, and JSON-schema fields. If the message has weak tool
    signal, the selector returns all tools rather than hiding a needed tool.
    """
    return select_relevant_tools(get_tools_definition(), user_message)
