import app.config as config
from app.tools.selector import select_relevant_tools


def get_scheduled_task_schema(name: str = "manage_scheduled_task") -> dict:
    """Shared JSON schema for the scheduled-task tool (basic and advanced modes)."""
    return {
        "type": "function",
        "function": {
            "name": name,
            "description": "Schedule background automation: delayed one-shot actions, repeating intervals, and condition watchers. "
                           "Not for user-visible timers/alarms — use manage_timer_stopwatch_alarms for those.",
            "parameters": {
                "type": "object",
                "properties": {
                    "action": {
                        "type": "string",
                        "enum": ["watch", "set_delayed", "set_interval", "list", "cancel", "pause", "resume"],
                        "description": "The scheduling action to perform."
                    },
                    "target": {
                        "type": "string",
                        "description": "App, window, or process name to monitor (e.g. 'antigravity', 'Task Manager', 'Spotify'). Also supports hardware metrics: 'battery', 'storage', 'network'."
                    },
                    "condition": {
                        "type": "string",
                        "description": "Condition that triggers the action: 'closed' (when an app/window/process closes), 'opened' (when launched), 'minimized', 'maximized', 'focused', 'unfocused', 'battery_low', 'battery_charging', 'storage_low', 'network_disconnected', 'network_connected'."
                    },
                    "run_tool": {
                        "type": "string",
                        "description": "Name of the Yuki tool to execute when triggered (e.g. 'launch_app' to open an app, 'close_app' to close an app, 'take_screenshot', 'open_or_play_file')."
                    },
                    "run_args": {
                        "type": "object",
                        "description": "Key-value arguments for run_tool (e.g. {'app_name': 'Firefox'} for launch_app, {'app_name': 'Yuki AI.exe'} for close_app)."
                    },
                    "run_builtin": {
                        "type": "string",
                        "enum": ["shutdown", "restart", "sleep", "lock", "sound:tada", "sound:chime", "sound:beep"],
                        "description": "Built-in system power or audio chime to execute."
                    },
                    "run_notify": {
                        "type": "string",
                        "description": "Message to show in a Windows popup dialog or notification toast (e.g. 'Take a break!')."
                    },
                    "run_command": {
                        "type": "string",
                        "description": "Raw shell command to execute."
                    },
                    "seconds": {
                        "type": "number",
                        "description": "Delay duration, repeat interval, or watcher poll rate in seconds (defaults to 1.5s for watchers)."
                    },
                    "count": {
                        "type": "integer",
                        "description": "Max fires (intervals default to unlimited; watchers default to 1)."
                    },
                    "item_id": {
                        "type": "integer",
                        "description": "Task ID (for action='cancel' | 'pause' | 'resume')."
                    },
                    "do": {
                        "type": "string",
                        "description": "Optional compact shorthand (e.g. 'power:shutdown', 'popup:Hello', 'sound:tada'). Structured fields above are preferred."
                    }
                },
                "required": ["action"]
            }
        }
    }


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
                "description": "Launch a desktop application or open a URL. By default, if the app is already open, it brings the existing window to the front.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "app_name": {"type": "string", "description": "App name to launch/switch to, or URL to open."},
                        "args": {"type": "string", "description": "Optional CLI arguments or URL."},
                        "run_as_admin": {"type": "boolean", "description": "Run as administrator."},
                        "new_window": {"type": "boolean", "description": "Set to true ONLY if the user explicitly asks for a new or separate window instance of an already running app. Defaults to false."}
                    },
                    "required": ["app_name"]
                }
            }
        },
        {
            "type": "function",
            "function": {
                "name": "web_search",
                "description": "Search the internet for real-time information, facts, documentation, or news. Returns 8 search result snippets and automatically deep-scrapes the top 2 pages.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "query": {
                            "description": "Specific search query string, OR a list/array of multiple entity names (e.g. ['Eiffel Tower Paris', 'Colosseum Rome', 'Taj Mahal Agra'] or ['Brazil football team', 'Germany football team']) to search all entities concurrently in parallel in a single call."
                        },
                        "image_search": {"type": "boolean", "description": "Set to true ONLY when you need visual photos/diagrams exclusively (returns direct image URLs and SKIPS deep article text reading). Leave false (default) when researching facts, topics, news, documentation, coding solutions, or recipes."}
                    },
                    "required": ["query"]
                }
            }
        },
        {
            "type": "function",
            "function": {
                "name": "generate_image",
                "description": "Generates AI diffusion images using models like FLUX, Imagen, or DALL-E and opens the image in the system's default photo viewer. ONLY use this tool when the user EXPLICITLY asks to 'generate an image' using AI diffusion. For real photos, looking up real pictures, drawing, pixel art, or visual cards, use jarvis_html_graphics instead.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "prompt": {"type": "string", "description": "Detailed text prompt describing the image."},
                        "aspect_ratio": {"type": "string", "enum": ["1:1", "16:9", "9:16", "4:3", "3:4"], "description": "Aspect ratio for the generated image. Defaults to '1:1'."},
                        "style": {"type": "string", "enum": ["auto", "flux", "flux-anime", "flux-realism", "flux-3d", "turbo"], "description": "Visual style preset. Defaults to 'auto'."}
                    },
                    "required": ["prompt"]
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
                "description": "WHEN TO USE: Find a file stored on the user's local computer by its NAME or keyword (media, documents, downloads) — like jarvis_query_file_db. DON'T USE: to search text inside code files (use jarvis_grep_files).",
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
                "name": "manage_timer_stopwatch_alarms",
                "description": "Set countdown timers, schedule alarms/reminders for a specific time, and start/stop/check stopwatches. Use THIS tool — not manage_scheduled_task — whenever the user says 'remind me', 'set a timer', 'start a stopwatch', 'alarm at 5 PM', or anything time/countdown related.",
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
        },
        get_scheduled_task_schema(),
        {
            "type": "function",
            "function": {
                "name": "ask_user",
                "description": "Ask the user a clarifying question with structured options when you cannot proceed without a decision between materially different tradeoffs. Blocks until the user responds. Do NOT use for questions answerable from context, trivial choices, or destructive-action confirmation (the safety confirmation flow handles that). Always set 'recommended' to the most conservative option when one exists.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "questions": {
                            "type": "array",
                            "minItems": 1,
                            "items": {
                                "type": "object",
                                "properties": {
                                    "id":          {"type": "string", "description": "Stable id; the result is keyed by this."},
                                    "question":     {"type": "string", "description": "The question to ask."},
                                    "options": {
                                        "type": "array",
                                        "minItems": 2,
                                        "items": {
                                            "type": "object",
                                            "properties": {
                                                "label":      {"type": "string", "description": "Short option label."},
                                                "description": {"type": "string", "description": "Explanatory tradeoff shown below the label."},
                                                "preview":     {"type": "string", "description": "Optional rich preview (code/config snippet)."}
                                            },
                                            "required": ["label"]
                                        }
                                    },
                                    "recommended": {"type": "integer", "description": "0-based index of the default option."},
                                    "multi":  {"type": "boolean", "description": "Allow multiple selections. Default false."}
                                },
                                "required": ["id", "question", "options"]
                            }
                        }
                    },
                    "required": ["questions"]
                }
            }
        },
        {
            "type": "function",
            "function": {
                "name": "telegram_send_screenshot",
                "description": "Captures the current desktop monitor screen of the user's PC and immediately uploads and sends the screenshot image directly to the user's Telegram chat on their phone. ONLY use this when the user is chatting from Telegram and wants to receive a screenshot on their phone.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "caption": {"type": "string", "description": "Optional caption for the screenshot image on Telegram."}
                    }
                }
            }
        },
        {
            "type": "function",
            "function": {
                "name": "telegram_send_file",
                "description": "Uploads and sends any file, image, document, script, or compressed folder (.zip) from the user's PC directly to the user's Telegram chat on their phone. Call this whenever the remote user asks for a file, or after you create a file that the user needs on their phone.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "file_or_folder_path": {"type": "string", "description": "Path to the file or folder on the PC to upload to Telegram."},
                        "caption": {"type": "string", "description": "Optional message caption on Telegram."}
                    },
                    "required": ["file_or_folder_path"]
                }
            }
        },
        {
            "type": "function",
            "function": {
                "name": "manage_personal_list",
                "description": "WHEN TO USE: Manage personal everyday lists and agendas for the user (shopping lists, groceries, things to do today, errands, wishlist, packing list). Supports adding items, viewing lists, checking off completed items, removing items, and clearing finished tasks. Persists globally across all conversation turns. NOT FOR CODE TASKS.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "action": {
                            "type": "string",
                            "enum": ["add", "show", "check", "uncheck", "remove", "clear_completed", "lists", "export"],
                            "description": "Action to perform: 'add' (add items), 'show' (view list), 'check' (mark item done), 'uncheck' (reopen item), 'remove' (delete item), 'clear_completed' (purge completed items), 'lists' (overview of all active lists), 'export' (save to Desktop Markdown)."
                        },
                        "list_name": {
                            "type": "string",
                            "description": "Name of the list: 'shopping', 'to do today', 'errands', 'wishlist', 'ideas', etc. Defaults to 'shopping'."
                        },
                        "items": {
                            "type": "array",
                            "items": {"type": "string"},
                            "description": "One or more item names to add, check off, or remove (e.g. ['Whole milk', 'Eggs', 'Avocados']). Can also pass a single string."
                        },
                        "include_completed": {
                            "type": "boolean",
                            "description": "Whether to include completed items when viewing the list. Default is false."
                        },
                        "quantity": {
                            "type": "string",
                            "description": "Optional quantity or detail (e.g. '2 cartons', '1 lb')."
                        },
                        "clear_old": {
                            "type": "boolean",
                            "description": "Set to true when the user wants to start fresh, create a brand-new list, or replace the previous list of that name (e.g. 'make a new shopping list', 'replace my shopping list'). Wipes the previous list before adding. Default is false."
                        }
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
    tools = [
        {
            "type": "function",
            "function": {
                "name": "jarvis_query_file_db",
                "description": "WHEN TO USE: Find a FILE anywhere on the PC by its NAME, folder, or metadata — especially media (anime/movies/music), downloads, documents, games, or files you can't see in the workspace. Searches the SQLite indexed database (yuki_files.db) across all drives (names, parent folders, full paths, Romaji/Pinyin, tags). RETRY STRATEGY (use BEFORE giving up): (1) if the first search returns no or poor results, try again by changing the query — drop episode/part numbers and search the core title only, or switch search_scope='folder_only' with a path_hint to narrow location; (2) if it STILL fails, increase limit to 50 for broader matches; (3) if that still fails, fall back to jarvis_find_files_by_glob to list files in a folder the user mentioned (e.g. '*.mp4' in a Downloads path); (4) only after all of those fail, ask the user for a better folder path or more details. DON'T USE: for searching text INSIDE code files (use jarvis_grep_files) or listing files matching a known pattern in the workspace (use jarvis_find_files_by_glob). The density scorer ranks best when all query words appear together in the filename.",
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
                "description": "Perform web search for news, real-time facts, documentation, or solutions. Returns 8 organic search snippets with URLs and automatically deep-scrapes the top 2 pages. If a specific URL snippet looks promising for deeper details, follow up by calling jarvis_web_scrape with that URL.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "query": {
                            "description": "Search query string, OR a list/array of multiple entity names (e.g. ['Eiffel Tower Paris', 'Colosseum Rome', 'Taj Mahal Agra'] or ['Brazil football team', 'Germany football team']) to search all entities concurrently in parallel in a single call."
                        },
                        "image_search": {"type": "boolean", "description": "Set to true ONLY when you need visual photos/diagrams exclusively (returns direct image URLs and SKIPS deep article text reading). Leave false (default) when researching facts, topics, news, documentation, coding solutions, or recipes."}
                    },
                    "required": ["query"]
                }
            }
        },
        {
            "type": "function",
            "function": {
                "name": "jarvis_web_scrape",
                "description": "Fetch a web page URL and extract clean text/markdown content for deep reading (up to max_chars, default 15000 in Advanced Mode, 5000 in Basic Mode). Use this for deep reading of articles, documentation, or promising URLs found via jarvis_web_search.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "url": {"type": "string", "description": "Web URL to fetch and scrape."},
                        "max_chars": {"type": "integer", "description": "Max text characters to extract (defaults to 15,000 in Advanced Mode, 5,000 in Basic Mode)."}
                    },
                    "required": ["url"]
                }
            }
        },
        {
            "type": "function",
            "function": {
                "name": "jarvis_launch_app",
                "description": "Launch a desktop application or open a web URL. By default, if the app is already open, it brings the existing window to the front.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "app_name": {"type": "string", "description": "Application name or URL to launch/switch to."},
                        "args": {"type": "string", "description": "Optional CLI arguments or URL parameters."},
                        "new_window": {"type": "boolean", "description": "Set to true ONLY if the user explicitly asks for a new or separate window instance. Defaults to false."}
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
                "name": "jarvis_manage_timer_stopwatch_alarms",
                "description": "Set countdown timers, schedule alarms/reminders for a specific time, and start/stop/check stopwatch. Use THIS tool — not manage_scheduled_task — whenever the user says 'remind me', 'set a timer', 'start a stopwatch', 'alarm at 5 PM', or anything time/countdown related.",
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
        get_scheduled_task_schema("manage_scheduled_task"),
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
                "name": "manage_yuki_settings",
                "description": "Programmatically view, update, or reset Yuki runtime app settings (no_llm_mode, llm_mode, tts_voice, tts_volume, blocked_tools, always_included_tools, endpoint_strategy, etc.).",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "action": {
                            "type": "string",
                            "enum": ["get_settings", "update_setting", "reset_setting"],
                            "description": "Action to perform: 'get_settings' to view settings, 'update_setting' to set a setting key-value pair, or 'reset_setting' to reset a setting key."
                        },
                        "key": {
                            "type": "string",
                            "description": "Setting key name (e.g. 'no_llm_mode', 'llm_mode', 'tts_voice', 'tts_volume', 'blocked_tools', etc.)."
                        },
                        "value": {
                            "description": "New value to assign when updating a setting."
                        }
                    },
                    "required": ["action"]
                }
            }
        },
        {
            "type": "function",
            "function": {
                "name": "jarvis_manage_yuki_settings",
                "description": "Programmatically view, update, or reset Yuki runtime app settings (no_llm_mode, llm_mode, tts_voice, tts_volume, blocked_tools, always_included_tools, endpoint_strategy, etc.).",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "action": {
                            "type": "string",
                            "enum": ["get_settings", "update_setting", "reset_setting"],
                            "description": "Action to perform: 'get_settings' to view settings, 'update_setting' to set a setting key-value pair, or 'reset_setting' to reset a setting key."
                        },
                        "key": {
                            "type": "string",
                            "description": "Setting key name (e.g. 'no_llm_mode', 'llm_mode', 'tts_voice', 'tts_volume', 'blocked_tools', etc.)."
                        },
                        "value": {
                            "description": "New value to assign when updating a setting."
                        }
                    },
                    "required": ["action"]
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
                "name": "manage_todo",
"description": "Manage a persistent TODO task list with subtasks that is unique to the current session. Use 'sync' to create/update/delete many tasks in a single call by passing a full items list; use 'create'/'list'/'update'/'complete'/'delete' for individual tweaks; 'render_md' writes a visible TODO.md. Invalid status/priority values now return an error instead of being silently coerced — correct the value and retry. Only one task may be in_progress per session; completing a task auto-advances its next pending sibling. Pass block_reason when setting status='blocked'. clear_completed archives (does not hard-delete) so the done-history is preserved.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "action": {
                            "type": "string",
                            "enum": ["sync", "create", "list", "update", "complete", "reopen", "add_subtask", "list_subtasks", "delete", "clear_completed", "render_md"]
                        },
                        "title": {"type": "string", "description": "Title of the task or subtask."},
                        "todo_id": {"type": "integer", "description": "ID of an existing todo to update/complete/delete."},
                        "parent_id": {"type": "integer", "description": "Parent todo ID when creating a subtask or listing its subtasks."},
                        "status": {"type": "string", "description": "Status to set: pending, in_progress, completed, blocked. When 'blocked', pass block_reason explaining why. Invalid values return an error."},
                        "priority": {"type": "string", "description": "Priority: low, normal, high, critical. Invalid values return an error."},
                        "include_completed": {"type": "boolean", "description": "Whether to include completed tasks when listing. Default true."},
                        "include_archived": {"type": "boolean", "description": "Include archived tasks when listing. Default false."},
                        "block_reason": {"type": "string", "description": "Reason the task is blocked. Set when status='blocked'; cleared otherwise."},
                        "items": {
                            "type": "array",
                            "description": "For action 'sync': the full desired list of items to reconcile. Each item has optional id (existing task to update), title (required for new tasks), status, priority, parent_id, and delete (true to remove).",
                            "items": {
                                "type": "object",
                                "properties": {
                                    "id": {"type": "integer", "description": "Existing todo id to update; omit to create."},
                                    "title": {"type": "string", "description": "Task title."},
                                    "status": {"type": "string", "enum": ["pending", "in_progress", "completed", "blocked"], "description": "Status to set."},
                                    "priority": {"type": "string", "enum": ["low", "normal", "high", "critical"], "description": "Priority to set."},
                                    "parent_id": {"type": "integer", "description": "Parent todo id for subtasks."},
                                    "delete": {"type": "boolean", "description": "Set true to delete this item (and its subtasks)."}
                                }
                            }
                        }
                    },
                    "required": ["action"]
                }
            }
        },
        {
            "type": "function",
            "function": {
                "name": "jarvis_find_files_by_glob",
                "description": "WHEN TO USE: List the FILES whose names match a glob pattern inside a folder — you want filenames, not content. Pass `search_dir` as the absolute folder path to search in (defaults to the active workspace); the pattern is evaluated relative to that folder, so do NOT put an absolute path in the pattern. Glob syntax: '*' matches any name within one level, '**/' means any depth, and 'src/**/*.jsx' scopes to a subfolder. IMPORTANT: a bare pattern like '*.py' already matches files at ANY depth (recursion is automatic — you do NOT need '**/'). Examples: '*.py', 'package*.json', 'src/**/*.jsx', 'sub/*.ts'. RETRY STRATEGY: if no files match, first broaden the pattern (e.g. '*.tsx' -> '*.ts' or '*' ), or if the folder path seems wrong, ask the user for a better/known directory path before guessing. DON'T USE: to search text INSIDE files (use jarvis_grep_files) or to find a file by natural-language name across the whole PC (use jarvis_query_file_db). Excludes node_modules, .git, dist, build, venv.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "pattern": {"type": "string", "description": "Glob pattern string relative to search_dir (e.g. '*.py', '**/*.py', 'src/**/*.jsx', 'package*.json'). Bare patterns like '*.py' are recursive automatically."},
                        "search_dir": {"type": "string", "description": "Optional absolute folder path to search inside (e.g. 'D:/proj/src'). Defaults to the active workspace directory."}
                    },
                    "required": ["pattern"]
                }
            }
        },
        {
            "type": "function",
            "function": {
                "name": "jarvis_grep_files",
                "description": "WHEN TO USE: Search file CONTENTS for a regex pattern and return every match as 'path:line: <matching line>' — find every place a symbol, function, variable, string, or keyword appears in code (e.g. pattern='def .*search', file_pattern='*.py'). The go-to tool for code review, refactoring, and debugging. DON'T USE: to find a file by its NAME (use jarvis_query_file_db for whole-PC name search, or jarvis_find_files_by_glob for a name glob). Skips node_modules, .git, venv, dist, build, and binary files.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "pattern": {"type": "string", "description": "Regex pattern to search for in file contents (e.g. 'jarvis_grep_files', 'def .*search', 'TODO')."},
                        "file_pattern": {"type": "string", "description": "Optional glob filter restricting which files are scanned, e.g. '*.py', '*.jsx', '**/*.ts'. Defaults to all text files."},
                        "search_dir": {"type": "string", "description": "Optional absolute directory path to search in. Defaults to the active workspace directory."},
                        "case_sensitive": {"type": "boolean", "description": "Whether matching should be case-sensitive. Default false."},
                        "max_results": {"type": "integer", "description": "Max matches to return (default 100)."}
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
                "name": "jarvis_analyze_image",
                "description": "Scans and analyzes an image file on disk using a vision API or vision engine. Reads screenshots, UI mockups, diagrams, and image files.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "image_path": {"type": "string", "description": "Absolute file path to the target image file on disk."},
                        "prompt": {"type": "string", "description": "Specific question or analysis prompt for the vision model."}
                    },
                    "required": ["image_path"]
                }
            }
        },
        {
            "type": "function",
            "function": {
                "name": "jarvis_see_screen",
                "description": "Automatically captures the current screen (or a specific app window via window_title) and sends the screenshot directly to a Vision Multimodal LLM. Returns a detailed visual breakdown and verbatim transcription of visible text, code, or UI elements. Use this whenever you need to SEE what is on the user's screen.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "prompt": {"type": "string", "description": "Visual analysis instructions/questions sent directly to the Vision LLM analyzing the captured screen. DO NOT write 'take a screenshot' (capture is 100% automatic). Instead, specify what to inspect, transcribe, locate, or explain in the image."},
                        "window_title": {"type": "string", "description": "Optional window title substring. If provided, only that app window is captured instead of the full screen."}
                    },
                    "required": ["prompt"]
                }
            }
        },
        {
            "type": "function",
            "function": {
                "name": "jarvis_generate_image",
                "description": "Generates AI diffusion images using image models (FLUX, Imagen, DALL-E) and opens them in the default system photo viewer. ONLY use this tool when the user EXPLICITLY asks to 'generate an image' using AI diffusion. NEVER use this to show what a real-world object/dish/place looks like. For real pictures, looking up images, drawings, graphics, pixel art, diagrams, visual cards, or illustrations, use jarvis_html_graphics instead.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "prompt": {"type": "string", "description": "Detailed text prompt describing the image, scene, subject, style, lighting, and composition."},
                        "aspect_ratio": {"type": "string", "enum": ["1:1", "16:9", "9:16", "4:3", "3:4"], "description": "Aspect ratio for the generated image. Defaults to '1:1'."},
                        "style": {"type": "string", "enum": ["auto", "flux", "flux-anime", "flux-realism", "flux-3d", "turbo"], "description": "Visual style preset ('flux-anime' for Japanese anime/manga, 'flux-realism' for photorealistic portraits/photos, 'flux-3d' for 3D CGI/Pixar/Unreal renders, 'turbo' for 1-second generation, 'flux' for general artwork, or 'auto'). Defaults to 'auto'."}
                    },
                    "required": ["prompt"]
                }
            }
        },
        {
            "type": "function",
            "function": {
                "name": "jarvis_run_python",
                "description": "Execute Python code for calculations, math, stats, data processing (CSV/JSON/XML), file operations (batch rename, find duplicates, hash), text processing, format conversion, system interrogation, web API calls, encryption/hashing, code analysis/lint, and any custom logic. Full Python stdlib + numpy/pandas available. Supports on-the-fly package self-healing via [sys.executable, '-m', 'pip', 'install', 'pkg']. Returns stdout output.",
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
                "name": "jarvis_keyboard_mouse_input",
                "description": "Send keyboard and mouse input to the desktop app currently in focus. Prefer keyboard actions (type, press_keys with Tab/Enter/shortcuts) to avoid coordinate guessing. Only use click/double_click/move_to with x,y after reading the coordinates from jarvis_see_screen, and re-check the screen if a click misses. For websites, use the browser tools instead.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "action": {
                            "type": "string",
                            "enum": ["type", "press_keys", "click", "double_click", "move_to", "scroll"],
                            "description": "Action: 'type' text, 'press_keys' a combo (e.g. ['ctrl','c']), 'click'/'double_click' at x,y, 'move_to' x,y, or 'scroll' by amount."
                        },
                        "text": {"type": "string", "description": "Text string to type (for 'type' action)."},
                        "keys": {"type": "array", "items": {"type": "string"}, "description": "Keys to press together (for 'press_keys'), e.g. ['ctrl','c'], ['alt','tab'], ['win','d']."},
                        "x": {"type": "integer", "description": "Screen x coordinate (for click/double_click/move_to)."},
                        "y": {"type": "integer", "description": "Screen y coordinate (for click/double_click/move_to)."},
                        "amount": {"type": "integer", "description": "Scroll amount in notches (for 'scroll'; positive up, negative down)."}
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
        },
        {
            "type": "function",
            "function": {
                "name": "jarvis_html_graphics",
                "description": "Renders interactive HTML/SVG/Canvas visual graphics, drawings, pixel art, diagrams, UI mockups, visual cards, and real picture displays in a floating Canvas window. Supports: (1) Vector SVG markup (<svg>...</svg>); (2) HTML5 <canvas> with inline <script>; (3) Stylized HTML/CSS graphics, pixel art grids, and composite visual cards with embedded web or local images (<img src=\"...\">). Use this tool whenever the user asks to draw, make graphics, create pixel art, design a visual card, render diagrams, or pull up/show real photos and pictures from the internet of real-world things.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "svg_or_canvas": {
                            "type": "string",
                            "description": "Raw SVG markup (<svg>...</svg>), HTML5 <canvas> element with inline <script>, or a styled HTML/CSS graphics block with optional embedded <img> elements."
                        }
                    },
                    "required": ["svg_or_canvas"]
                }
            }
        },
        {
            "type": "function",
            "function": {
                "name": "jarvis_html_viewer",
                "description": "Render an HTML page in a standard window with title bar and native controls (like a browser). Two modes: (1) provide file_path to open an existing .html file from disk — the file is served from its original location so relative paths for CSS/JS/images work correctly; (2) provide html_content to render a complete HTML document inline. All CSS/JS must be inline when using html_content. The window behaves like a normal app window.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "file_path": {
                            "type": "string",
                            "description": "Absolute path to an existing .html file on disk. The file is opened from its original location so relative dependencies (CSS, JS, images) load correctly. Mutually exclusive with html_content."
                        },
                        "html_content": {
                            "type": "string",
                            "description": "Complete HTML document. Should start with <!DOCTYPE html> and include <html>, <head>, <body>. All CSS/JS must be inline. Mutually exclusive with file_path."
                        }
                    }
                }
            }
        },
        {
            "type": "function",
            "function": {
                "name": "ask_user",
                "description": "Ask the user a clarifying question with structured options when you cannot proceed without a decision between materially different tradeoffs. Blocks until the user responds. Do NOT use for questions answerable from context, trivial choices, or destructive-action confirmation (the safety confirmation flow handles that). Always set 'recommended' to the most conservative option when one exists.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "questions": {
                            "type": "array",
                            "minItems": 1,
                            "items": {
                                "type": "object",
                                "properties": {
                                    "id":          {"type": "string", "description": "Stable id; the result is keyed by this."},
                                    "question":     {"type": "string", "description": "The question to ask."},
                                    "options": {
                                        "type": "array",
                                        "minItems": 2,
                                        "items": {
                                            "type": "object",
                                            "properties": {
                                                "label":      {"type": "string", "description": "Short option label."},
                                                "description": {"type": "string", "description": "Explanatory tradeoff shown below the label."},
                                                "preview":     {"type": "string", "description": "Optional rich preview (code/config snippet)."}
                                            },
                                            "required": ["label"]
                                        }
                                    },
                                    "recommended": {"type": "integer", "description": "0-based index of the default option."},
                                    "multi":  {"type": "boolean", "description": "Allow multiple selections. Default false."}
                                },
                                "required": ["id", "question", "options"]
                            }
                        }
                    },
                    "required": ["questions"]
                }
            }
        },
        {
            "type": "function",
            "function": {
                "name": "telegram_send_screenshot",
                "description": "WHEN TO USE: The user is chatting with you from Telegram on their mobile phone and explicitly asks you to send them a screenshot of their PC or wants to see what's on their desktop screen. Captures the primary desktop monitor and uploads the screenshot image directly to their Telegram chat. DO NOT USE jarvis_see_screen when the user wants to receive the screenshot image themselves — jarvis_see_screen is only for your internal AI vision inspection.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "caption": {"type": "string", "description": "Optional caption message to include with the photo on Telegram."}
                    }
                }
            }
        },
        {
            "type": "function",
            "function": {
                "name": "telegram_send_file",
                "description": "WHEN TO USE: Upload and send any file, document, photo, code script, or auto-zipped folder (.zip) from the user's PC directly to their Telegram chat. Use this whenever the remote user asks you to send a file to their phone, or after you create/edit/download a file that the remote user wants to receive.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "file_or_folder_path": {"type": "string", "description": "Path to the file or directory on the PC to upload and send to Telegram."},
                        "caption": {"type": "string", "description": "Optional message caption on Telegram."}
                    },
                    "required": ["file_or_folder_path"]
                }
            }
        },
        {
            "type": "function",
            "function": {
                "name": "jarvis_manage_personal_list",
                "description": "WHEN TO USE: Manage personal everyday lists and agendas for the user (shopping lists, groceries, things to do today, errands, wishlist, packing list, memos). Supports adding items, viewing lists, checking off completed items, removing items, clearing finished tasks, and exporting to Desktop Markdown. Persists globally across all conversation turns. NOT FOR CODE IMPLEMENTATION TASKS.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "action": {
                            "type": "string",
                            "enum": ["add", "show", "check", "uncheck", "remove", "clear_completed", "lists", "export"],
                            "description": "Action to perform: 'add' (add items), 'show' (view list), 'check' (mark item done), 'uncheck' (reopen item), 'remove' (delete item), 'clear_completed' (purge completed items), 'lists' (overview of all active lists), 'export' (save to Desktop Markdown)."
                        },
                        "list_name": {
                            "type": "string",
                            "description": "Name of the list: 'shopping', 'to do today', 'errands', 'wishlist', 'ideas', etc. Defaults to 'shopping'."
                        },
                        "items": {
                            "type": "array",
                            "items": {"type": "string"},
                            "description": "One or more item names to add, check off, or remove (e.g. ['Whole milk', 'Eggs', 'Avocados']). Can also pass a single string."
                        },
                        "include_completed": {
                            "type": "boolean",
                            "description": "Whether to include completed items when viewing the list. Default is false."
                        },
                        "quantity": {
                            "type": "string",
                            "description": "Optional quantity or detail (e.g. '2 cartons', '1 lb')."
                        },
                        "clear_old": {
                            "type": "boolean",
                            "description": "Set to true when the user wants to start fresh, create a brand-new list, or replace the previous list of that name (e.g. 'make a new shopping list', 'replace my shopping list', 'start fresh'). Wipes the previous list before adding. Default is false."
                        }
                    },
                    "required": ["action"]
                }
            }
        },
        {
            "type": "function",
            "function": {
                "name": "manage_personal_list",
                "description": "Alias for jarvis_manage_personal_list. Manage everyday personal checklists and agendas (shopping, to do today, errands, wishlist).",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "action": {
                            "type": "string",
                            "enum": ["add", "show", "check", "uncheck", "remove", "clear_completed", "lists", "export"],
                            "description": "Action to perform: 'add', 'show', 'check', 'uncheck', 'remove', 'clear_completed', 'lists', 'export'."
                        },
                        "list_name": {
                            "type": "string",
                            "description": "Name of the list: 'shopping', 'to do today', 'errands', 'wishlist', 'ideas', etc. Defaults to 'shopping'."
                        },
                        "items": {
                            "type": "array",
                            "items": {"type": "string"},
                            "description": "One or more item names to add, check off, or remove."
                        },
                        "include_completed": {
                            "type": "boolean",
                            "description": "Whether to include completed items when viewing the list. Default is false."
                        },
                        "quantity": {
                            "type": "string",
                            "description": "Optional quantity or detail."
                        },
                        "clear_old": {
                            "type": "boolean",
                            "description": "Set to true when the user asks for a new list or to replace/reset the existing list."
                        }
                    },
                    "required": ["action"]
                }
            }
        }
    ]

    # Codegraph is opt-in: only shipped in advanced mode when the user enables it.
    if getattr(config, "CODEGRAPH_ADVANCED_ENABLED", False):
        tools.extend(get_codegraph_tool_definitions())
    return tools


def get_codegraph_tool_definitions() -> list:
    """Codegraph (code intelligence) tool schemas. Read-only, opt-in via settings."""
    return [
        {
            "type": "function",
            "function": {
                "name": "codegraph_explore",
                "description": "Explore an area of a codebase in one shot: the relevant symbols' verbatim source PLUS the call paths between them (including dynamic-dispatch hops like callbacks that grep can't follow). Use this BEFORE grep/read when you need to understand how code works, find where a symbol is used, or survey an area. Name a file, symbol, or natural-language question as the query.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "query": {"type": "string", "description": "Symbol names, file names, or a short natural-language question (e.g. 'AuthService loginUser', 'how does the MCP bridge connect')"},
                        "max_files": {"type": "integer", "description": "Maximum number of files to include source from (optional, default varies by project size)."},
                        "project_path": {"type": "string", "description": "Optional absolute path to the indexed project. Defaults to Yuki's workspace."}
                    },
                    "required": ["query"]
                }
            }
        },
        {
            "type": "function",
            "function": {
                "name": "codegraph_search",
                "description": "Search the codebase index for symbols (functions, classes, methods, etc.) by name or keywords. Returns matching symbol locations. Use to locate where a thing is defined before reading files.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "query": {"type": "string", "description": "Symbol name or keywords to search for."},
                        "limit": {"type": "integer", "description": "Max results to return (default 10)."},
                        "project_path": {"type": "string", "description": "Optional absolute path to the indexed project. Defaults to Yuki's workspace."}
                    },
                    "required": ["query"]
                }
            }
        },
        {
            "type": "function",
            "function": {
                "name": "codegraph_node",
                "description": "Read one symbol's verbatim source plus its caller/callee trail in a single call. Use to inspect a specific function/class definition with its call graph without separate greps.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "name": {"type": "string", "description": "The exact symbol name (or file path) to inspect."},
                        "project_path": {"type": "string", "description": "Optional absolute path to the indexed project. Defaults to Yuki's workspace."}
                    },
                    "required": ["name"]
                }
            }
        },
        {
            "type": "function",
            "function": {
                "name": "codegraph_files",
                "description": "Show the project file structure from the codegraph index. Use to understand the overall layout of a repository.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "project_path": {"type": "string", "description": "Optional absolute path to the indexed project. Defaults to Yuki's workspace."}
                    }
                }
            }
        },
        {
            "type": "function",
            "function": {
                "name": "codegraph_callers",
                "description": "Find all functions/methods that call a specific symbol. Use to understand what depends on a function before refactoring or changing it.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "symbol": {"type": "string", "description": "The symbol name to find callers of."},
                        "limit": {"type": "integer", "description": "Max results (default 20)."},
                        "project_path": {"type": "string", "description": "Optional absolute path to the indexed project. Defaults to Yuki's workspace."}
                    },
                    "required": ["symbol"]
                }
            }
        },
        {
            "type": "function",
            "function": {
                "name": "codegraph_callees",
                "description": "Find all functions/methods that a specific symbol calls. Use to understand what a function depends on.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "symbol": {"type": "string", "description": "The symbol name to find callees of."},
                        "limit": {"type": "integer", "description": "Max results (default 20)."},
                        "project_path": {"type": "string", "description": "Optional absolute path to the indexed project. Defaults to Yuki's workspace."}
                    },
                    "required": ["symbol"]
                }
            }
        },
        {
            "type": "function",
            "function": {
                "name": "codegraph_impact",
                "description": "Analyze what code is affected by changing a specific symbol. Use before proposing a refactor to see the blast radius.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "symbol": {"type": "string", "description": "The symbol name to analyze impact for."},
                        "project_path": {"type": "string", "description": "Optional absolute path to the indexed project. Defaults to Yuki's workspace."}
                    },
                    "required": ["symbol"]
                }
            }
        },
        {
            "type": "function",
            "function": {
                "name": "codegraph_status",
                "description": "Show codegraph index status and statistics for a project. Use to verify the index exists and how up-to-date it is.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "project_path": {"type": "string", "description": "Optional absolute path to the indexed project. Defaults to Yuki's workspace."}
                    }
                }
            }
        },
        {
            "type": "function",
            "function": {
                "name": "codegraph_set_workspace_directory",
                "description": "Register a directory as the active coder workspace. Persists it as the session workspace directory and makes codegraph (and other coder tools) target it. Use when the user provides or picks a project directory that is not yet the active workspace.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "path": {"type": "string", "description": "Absolute path to the directory to set as the active workspace (must exist on this PC)."}
                    },
                    "required": ["path"]
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
