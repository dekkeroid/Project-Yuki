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
                "description": "Get system CPU, RAM, disk usage, active IP, OS version, and current date/time.",
                "parameters": {"type": "object", "properties": {}}
            }
        },
        {
            "type": "function",
            "function": {
                "name": "launch_app",
                "description": "Launch desktop app or open URL in browser.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "app_name": {"type": "string", "description": "App to launch (e.g. 'chrome', 'notepad', 'kdeconnect') or browser to open URL."},
                        "args": {"type": "string", "description": "CLI arguments or URL to open (e.g. 'https://kdeconnect.kde.org')."},
                        "run_as_admin": {"type": "boolean", "description": "Run as admin."}
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
                "description": "Search Google for info.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "query": {"type": "string", "description": "Search keywords (e.g. 'KDE Connect official website download'). Be specific."}
                    },
                    "required": ["query"]
                }
            }
        },
        {
            "type": "function",
            "function": {
                "name": "update_user_fact",
                "description": "Save facts, name, or interests about user.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "key": {"type": "string", "description": "Topic or key (e.g. 'name', 'interest', 'favorite_color')."},
                        "value": {"type": "string", "description": "Information detail."}
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
                "description": "Search local files.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "query": {"type": "string", "description": "Search query."},
                        "start_directory": {"type": "string", "description": "Base directory."}
                    },
                    "required": ["query"]
                }
            }
        },
        {
            "type": "function",
            "function": {
                "name": "open_or_play_file",
                "description": "Open file or play song.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "file_path_or_query": {"type": "string", "description": "File path/name/query."},
                        "play_mode": {"type": "boolean", "description": "Set true to play media."}
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
                "description": "Run CLI shell command.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "command": {"type": "string", "description": "Command string."},
                        "use_powershell": {"type": "boolean", "description": "True for powershell, false for cmd."}
                    },
                    "required": ["command"]
                }
            }
        },
        {
            "type": "function",
            "function": {
                "name": "run_python_script",
                "description": "Run Python script.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "code": {"type": "string", "description": "Python source code."}
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
