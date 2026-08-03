# Chat History Pruning & Summarization — Investigation + Implementation Report

Date: 2026-08-03
Scope: `backend/app/agent/executor.py`, `backend/app/memory/db.py`, `backend/app/main.py`, `backend/app/memory/local_mem.py`, `frontend/src/components/ControlDashboard.jsx`
Tests: `backend/tests/test_history_pruning.py` (7 tests, all passing)

---

## TL;DR

- **Yes, the token-size settings in the main app settings DO affect pruning** — `basic_history_token_limit` / `advanced_history_token_limit` (and the matching `*_history_keep_turns`) are read on every turn in `_build_messages`.
- **The "summarizing" is now REAL LLM summarization.** When the budget is hit, the oldest/middle x% of the conversation is compressed into an LLM summary via the `synthesizer` task / `llm_summary_model`. On any failure it falls back to the old snippet recap + hard trim, and the budget is enforced against the **whole prompt** (system + summary/recap + history + user + tool schemas) with tiktoken when available.
- **The budget now actually bounds the prompt.** Previously the check only measured the history slice (system prompt alone blew past the "limit"); now the full payload footprint is measured and enforced.
- The previously-dead `llm_summary_model` / `"synthesizer"` path is now wired up and used.
- `pruned_context` DB column remains dead code (see §3) — out of scope, noted for cleanup.

---

## 1. Does the token size from main app settings affect pruning?

**Yes, it does.** The wiring:

| Setting | Where exposed (UI) | Where read |
|---|---|---|
| `basic_history_token_limit` | `ControlDashboard.jsx` (Context Pruning & History Limits card) | `executor.py:926` |
| `basic_history_keep_turns` | same card | `executor.py:927` |
| `advanced_history_token_limit` | same card | `executor.py:923` |
| `advanced_history_keep_turns` | same card | `executor.py:924` |
| `history_summary_percent` | `ControlDashboard.jsx:3016` | `executor.py:929` |
| `history_summary_position` | `ControlDashboard.jsx:3035` | `executor.py:930` |
| `llm_summary_model` | AgenticWorkspaceWindow / endpoint mapping | `executor.py:931` → `_summarize_history_chunk` → `_get_backend_and_model_for_task("synthesizer")` |

Flow: UI → `POST /api/settings/update` (`main.py:1163-1168`) → `MemoryManager.update_setting` → stored in `profile["settings"]` (defaults at `local_mem.py:98-100`) → read each turn in `AgentExecutor._build_messages` (`executor.py:867`).

Verified by test: dropping `advanced_history_token_limit` from 40000 → 3000 flips pruning ON; raising it flips pruning OFF (`test_advanced_tier_uses_advanced_setting`).

### Fixed caveats from the original investigation

1. **Wrong tier selector — FIXED.** The prune tier now uses `effective_tool_mode = overrides.get("tool_mode") or config.TOOL_MODE` (`executor.py:898`), the same value that picks the prompt/tool tier, so a per-turn override applies to both consistently.
2. **"Turns" are actually messages — FIXED.** `min_keep_turns` is now treated as turn *pairs*: `min_keep_msgs = max(2, min_keep_turns * 2)` (`executor.py:934`). With `basic_history_keep_turns = 6` you now always retain ≥ 12 messages (≥ 6 exchanges).
3. **Oldest removed context is lost — PARTIALLY FIXED.** The snippet recap still caps at the last 12 removed snippets, but with LLM summarization enabled the *whole* chunk is condensed into the summary first, so nothing is lost before summarization. Only the fallback path (summary failure) drops old snippets beyond the recap's 12-line cap.
4. **Rough token estimate — IMPROVED.** `_count_tokens` lazy-imports `tiktoken` (o200k) when installed and falls back to `chars / 3.5`. Non-ASCII/CJK content still under-counts without tiktoken.

## 2. What actually happens now in `_build_messages`

1. Build the system prompt, current query, and (for tool-enabled backends) the filtered tool schemas → this is the **overhead** term (`executor.py:937-947`).
2. Count the whole history; if `history_tokens + overhead > user_token_limit`:
   - **If `history_summary_percent > 0`:** `_select_summary_chunk` picks the oldest or middle `x%` of messages (by count, nudged so tool results are never orphaned; newest `min_keep_msgs` always stay verbatim) and `_summarize_history_chunk` compresses it via the LLM (synthesizer backend/model → coder model → main model, temp 0.2, `max_tokens=400`, thought blocks stripped). On success the summary is injected as `[CONVERSATION SUMMARY]`.
   - **Fallback / if disabled:** the old snippet recap (`[EARLIER CONVERSATION RECAP]`, ≤12 one-line 160-char snippets) plus a hard trim.
3. **Guarantee-fit loop** (`executor.py:969-986`): the recap's own tokens are subtracted from the history budget and the trim repeats (bounded, 3 passes) until the whole prompt fits — or a WARNING is logged when even the overhead alone exceeds the budget.
4. The final `[History] Final prompt ~N tokens` log line reports the total (system + recap + history + user).

`_summarize_history_chunk` (`executor.py:1145`) is a plain blocking `requests` call, so the stream path invokes `_build_messages` inside `asyncio.to_thread` (`executor.py:2492`) to keep the event loop responsive.

## 3. Dead code that remains (out of scope, noted)

- **`pruned_context` DB column** — `save_chat_session_if_eligible(session_id, messages, pruned_context, status)` accepts it (`db.py`), but the only call site (`main.py`) passes 2 args, so the column stays `NULL`. `get_session_pruned_context` is defined but never called. The "LLM budget state" persistence described in the docstring is never exercised. Recommendation: drop the column + accessors, or actually wire it to the new summarization state.

## 4. Is it working?

**Yes.** Verified by `backend/tests/test_history_pruning.py` (7 tests, all pass):

- `test_no_pruning_when_history_is_small` — under budget, no recap, full history passes through.
- `test_summary_injected_when_over_budget` — LLM summary injected, oldest chunk condensed, newest retained, whole prompt ≤ budget.
- `test_snippet_recap_fallback_when_summary_fails` — summary returns `""` → snippet recap + trim, still within budget.
- `test_summary_disabled_trims_to_budget` — `history_summary_percent=0` → snippet recap + trim path.
- `test_tool_result_is_never_orphaned_by_pruning` — no raw `tool` role ever reaches the LLM.
- `test_middle_position_summarizes_center_window` — `history_summary_position="middle"` condenses the center, keeps oldest+newest verbatim.
- `test_advanced_tier_uses_advanced_setting` — advanced budget governs advanced-tier pruning.

The rest of the suite's pre-existing failures are unrelated (missing `pytest`, missing `send2trash`, and an env-dependent tool-selector assertion).

---

## New feature added alongside this report

**Prompt size logging** (`executor.py:56` `_log_payload_stats`): every time a request payload is built to send to the LLM, terminal output now includes the exact totals:

```
[LLM Send stream] model='llama-3.2-3b-instruct' | 22 messages | 9,084 total chars | ~2,595 est tokens (payload JSON, chars/3.5) | 8,126 chars in message contents
```

- Covers both send paths: streaming (`_stream_request`, `tag="stream"` — the main chat flow) and non-streaming (`_query_lmstudio_model`, `tag="query"`).
- Counts the **entire JSON payload** (messages + tools + params), not just message contents.
- Token count is estimated via tiktoken (o200k) when installed, else ~3.5 chars/token; labeled as an estimate.
- Fails gracefully (prints a warning) if a payload can't be JSON-serialized.

## Token counting

- `_count_tokens(text)` (`executor.py`): lazy-imports `tiktoken` (cached o200k encoding); falls back to `int(len(text) / 3.5)`.
- `_count_messages_tokens(messages)`: sums `_count_tokens` over message contents.
- No tiktoken is currently installed in the backend venv — the heuristic fallback is used until `pip install tiktoken`.
