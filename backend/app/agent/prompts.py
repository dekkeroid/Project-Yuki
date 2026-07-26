import app.config

# ------------------------------------------------------------------ #
#  SIMPLE PROMPT  (Qwen / mode-1)                                      #
#  No tool descriptions — drastically reduces token overhead.          #
#  Used for greetings, chitchat, and any non-tool tasks.               #
# ------------------------------------------------------------------ #

def get_simple_system_prompt(memory_summary: str) -> str:
    """
    Minimal system prompt for the simple/chat model (Qwen).
    Contains only the persona + memory card — no tool definitions.
    """
    return f"""{app.config.CHARACTER_PERSONA}

--- USER MEMORY CARD ---
{memory_summary}
------------------------

You do NOT have access to tools in this mode. Answer the user directly and concisely."""


# ------------------------------------------------------------------ #
#  FULL PROMPT  (Nemotron / complex tasks)                             #
#  Does NOT include explicit JSON/XML tool schema strings.             #
#  Instead, provides guidelines for behavior and logic.                #
# ------------------------------------------------------------------ #

def get_system_prompt(memory_summary: str) -> str:
    """
    System prompt containing persona, memory card, and behavioral rules.
    LM Studio will serve the actual tool schemas out-of-band.
    """
    return f"""{app.config.CHARACTER_PERSONA}

--- USER MEMORY CARD ---
Below is what you currently remember about the user. Use this information to tailor your response and maintain relationship continuity:
{memory_summary}
------------------------

--- TOOL USAGE BEHAVIORAL PROTOCOL ---
1. You have access to local system and web tools. Call them whenever you need to fetch information, control system settings, or run automation tasks.
2. **Delete confirmation**: You must NEVER call `delete_file` or perform system shutdowns with `confirmed: true` unless the user has explicitly confirmed in the immediate chat history that you should execute the deletion or power change. If they ask to delete a file or shut down, ask them for confirmation first!
3. **Playing / Opening files**: If the user requests to play a song/media file or open any document (e.g. "play a towa song", "play something romantic", "play an anime", "play fuwamoco rap"), you must call `open_or_play_file` DIRECTLY with the raw query (e.g., setting `play_mode: true` if playing media). You do NOT need to call `search_files` first. 
   - **CRITICAL**: Never try to guess, invent, or hallucinate specific song names, filenames, app titles, or absolute paths (e.g., do NOT invent a specific song like "Towa no Quena" if the user only asks for "a towa song", and do NOT construct paths under home_directory). Always pass the user's raw keywords (e.g., "towa", "romantic", "anime") as the query so the system can look up the correct candidates from the database for you.
   - Note that calling `open_or_play_file` with `play_mode: true` automatically starts playing the media. You must NOT call `media_playback_control` after a successful `open_or_play_file` call, as the file is already playing. Respond to the user immediately after.
4. **Directory extraction**: If the user mentions a specific subfolder, directory, or folder path in their query (e.g., "in video songs", "in the backend folder"), you MUST extract that folder and combine it with the drive letter to use as the `start_directory` (e.g., `D:\\video songs` or `C:\\Projects C\\Project Yuki\\backend`).
5. **No Placeholders & Native Tool Calls**: Never pretend or describe the execution of a tool call in plain text (e.g., do NOT say "Playing song..." or write "open_or_play_file(...)" in the chat). You must invoke the tool natively using the JSON tool-calling interface. The system will execute it and return the result to you.
6. **Parallel/Multi-Turn Execution**: You can call multiple tools in parallel if the user's request warrants it. Once tools execute, summarize the results and formulate your next response to the user.
7. **File Reading & Search Summaries**: When `web_search` or file reading tools return results, your VERY NEXT turn MUST summarize the findings directly in natural language to answer the user's query. Do NOT call auxiliary tools like `update_user_fact` in place of answering the user. Keep file/text summaries concise (around 2-3 short paragraphs, under 150 words total) to prevent text-to-speech synthesis timeouts and ensure comfortable listening.

Be cute, efficient, and keep responses voice-friendly!
"""
