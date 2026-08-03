# Chat History Pruning & Summarization — Investigation Report

Date: 2026-08-03
Scope: `backend/app/agent/executor.py`, `backend/app/memory/db.py`, `backend/app/main.py`, `backend/app/memory/local_mem.py`
Tests: `backend/tests/test_history_pruning.py` (4 tests, all passing)

---

## TL;DR

- **Yes, the token-size settings in the main app settings DO affect pruning** — `basic_history_token_limit` / `advanced_history_token_limit` (and the matching `*_history_keep_turns`) are read on every turn in `_build_messages`.
- **But the "summarizing" is NOT LLM summarization.** It is a rolling *truncation*: the oldest messages are dropped from the transcript and a small recap system-message is injected with up to 12 one-line snippets (160 chars each). No LLM is invoked to summarize anything.
- **The setting `llm_summary_model` (and the "synthesizer" task that would use it) is dead code** — never dispatched anywhere.
- **The `pruned_context` column in the DB is always `NULL`** — never saved, never read. The whole "LLM budget state" persistence is dead code.
- **It "works" mechanically**, but the budget only governs the *chat-history slice*, not the whole prompt. The system prompt alone is ~4,000 chars (~1,100 tokens) in simple mode and much larger in advanced mode, so the real token footprint sent to the LLM routinely exceeds the configured limit.

---

## 1. Does the token size from main app settings affect pruning?

**Yes, it does.** The wiring:

| Setting | Where exposed (UI) | Where read |
|---|---|---|
| `basic_history_token_limit` | `frontend/src/components/ControlDashboard.jsx:2912` | `executor.py:859` |
| `basic_history_keep_turns` | `ControlDashboard.jsx:2933` | `executor.py:860` |
| `advanced_history_token_limit` | `ControlDashboard.jsx:2965` | `executor.py:856` |
| `advanced_history_keep_turns` | `ControlDashboard.jsx:2986` | `executor.py:857` |
| `llm_summary_model` | `AgenticWorkspaceWindow.jsx:4261` | **never used in practice** (see §4) |

Flow: UI → `POST /api/settings` (`main.py:1141-1146`) → `MemoryManager.update_setting` → stored in `profile["settings"]` → read each turn in `AgentExecutor._build_messages` (`executor.py:855-863`).

The math (`executor.py:851-863`):
- `history_limit = token_limit * 3.5` (chars)
- `pruned_target = token_limit/2 * 3.5` (chars)
- If total history chars > `history_limit`, pop oldest messages until total ≤ `pruned_target` **or** message count ≤ `min_keep_turns`.

Verified by test: dropping `advanced_history_token_limit` from 40000 → 100 flips pruning ON; raising it flips pruning OFF (`test_advanced_tier_uses_advanced_setting`).

### Caveats found

1. **Wrong tier selector.** The prune tier is chosen by `is_advanced = config.TOOL_MODE == "advanced"` (`executor.py:852`) — the *global* config — while the prompt/tool tier uses `effective_tool_mode = overrides.get("tool_mode") or config.TOOL_MODE` (`executor.py:835`). A per-turn `tool_mode` override from the chat window therefore applies to the prompt but NOT to pruning. E.g. global "basic" + per-turn override "advanced" → advanced Jarvis prompt but pruned against the tiny 2,500-token basic budget.

2. **"Turns" are actually messages.** `min_keep_turns` guards `len(pruned_history)`, which counts individual user/assistant/tool messages, not turn pairs. With `min_keep_turns = 6` you can end up retaining only 6 messages (~3 exchanges), and the label over-promises.

3. **Oldest removed context is lost entirely.** The recap keeps only the *last 12* removed snippets (`recap_snippets[-12:]`, `executor.py:906`). If more than 12 messages were pruned in one turn, the very oldest ones appear nowhere — not live, not in the recap (confirmed by test + runtime log: 14 removed → recap held only TURN_1..TURN_6, TURN_0 dropped).

4. **Rough token estimate.** `chars / 3.5` is an approximation (no tokenizer installed). Non-ASCII/CJK text tokenizes far denser, so the estimate can be off by 2-4× for such content.

## 2. Are we actually summarizing parts of chat to reduce prompt size?

**No — it's truncation with a recap, not summarization.**

What actually happens in `_build_messages` when history exceeds budget (`executor.py:868-905`):
1. Oldest messages are `pop(0)`'d (with a guard so a `tool` result is never left orphaned).
2. A recap system message is built from the removed messages: each is regex-stripped of thought blocks, truncated to 160 chars, formatted as `- User/Yuki/Tool: snippet`, capped at 12 lines.
3. The recap is prepended to the transcript as `[EARLIER CONVERSATION RECAP]`.

So the "summary" is just a bulleted list of the first 160 chars of each dropped message. It reduces the *history* footprint (e.g. a 2,460-char history → 415 chars retained + ~1,900-char recap, from runtime logs) but it is not an LLM-generated condensation and it drops the oldest content entirely.

## 3. Is the dead summarization infrastructure real?

**Three pieces of dead code:**

1. **`llm_summary_model`** — saved (`main.py:1207-1208`, `main.py:1762-1763`) and read only inside `_get_backend_and_model_for_task` for `task == "synthesizer"` (`executor.py:1249`). Nothing ever dispatches the `"synthesizer"` task (grep: only definition + router arm exist). The user's configured summary model is never called.

2. **`pruned_context` DB column** — `save_chat_session_if_eligible(session_id, messages, pruned_context, status)` accepts it (`db.py:1071`), but the only call site passes 2 args (`main.py:455`), so the column is always `NULL`. `get_session_pruned_context` (`db.py:1201`) is defined and never called. The "LLM budget state" persistence described in the docstring is never exercised.

3. **The comment itself** — `executor.py:849` calls this the "Dual-Tier Rolling Summarization Pruning Strategy", but no tier ever invokes an LLM.

## 4. Is it even working?

**Mechanically yes; as a budget control it's misleading.**

Working (verified by `test_history_pruning.py`, all 4 pass):
- Pruning triggers above the char budget and stops at the target / keep-count.
- Newest turns survive; oldest are removed; a recap is injected; no orphaned tool messages reach the API.
- Changing the settings changes behavior.

**What it does NOT do:**
- It does not bound the actual prompt size. The budget check measures only `pruned_history` content chars (`executor.py:866`). The final payload also contains the system prompt + recap + current query + JSON/tool-schema overhead. Measured on a real "simple" prompt with a 20-message history: **9,084 payload chars ≈ 2,595 est tokens**, while the *default basic budget is 2,500 tokens* and the history slice alone was only ~1,185 tokens — the system prompt (3,962 chars ≈ 1,130 tokens) blew past the "limit" before pruning even considered the history.
- The system prompt is large even in "simple" mode (full persona + mood spectrum + user memory card); advanced mode embeds the full toolset inline and is several times larger.

### Recommendation (if a real token budget is desired)

- Make the tier selector use `effective_tool_mode` (`overrides.get("tool_mode") or config.TOOL_MODE`) at `executor.py:852` for consistency.
- Optionally bound the *whole* prompt (system + recap + history + user) against the limit, or add a separate system-prompt budget.
- Either actually implement LLM summarization via the `synthesizer`/`llm_summary_model` path, or remove the dead code (synthesizer arm, `pruned_context` column + accessors) so the UI stops implying a feature that isn't wired up.

---

## New feature added alongside this report

**Prompt size logging** (`executor.py`): every time a request payload is built to send to the LLM, terminal output now includes the exact totals:

```
[LLM Send stream] model='llama-3.2-3b-instruct' | 22 messages | 9,084 total chars | ~2,595 est tokens (payload JSON, chars/3.5) | 8,126 chars in message contents
```

- Covers both send paths: streaming (`_stream_request`, `tag="stream"` — the main chat flow) and non-streaming (`_query_lmstudio_model`, `tag="query"`).
- Counts the **entire JSON payload** (messages + tools + params), not just message contents.
- Token count is estimated at ~3.5 chars/token (no tokenizer is installed); the figure is labeled as an estimate.
- Fails gracefully (prints a warning) if a payload can't be JSON-serialized.

## Test summary

New file `backend/tests/test_history_pruning.py` (gitignored per repo convention — `backend/tests/*`):
- `test_no_pruning_when_history_is_small` — under budget, no recap, full history passed through.
- `test_pruning_drops_oldest_turns_and_injects_recap` — oldest dropped, newest kept, recap injected, history slice within budget, oldest pruned turn lost from recap (documents the `[-12:]` cap).
- `test_tool_result_is_never_orphaned_by_pruning` — no raw `tool` role reaches the output.
- `test_advanced_tier_uses_advanced_setting` — advanced budget governs advanced-tier pruning.

All 4 pass. The rest of the suite's pre-existing failures are unrelated (missing `pytest`, missing `send2trash`, and an env-dependent tool-selector assertion).
