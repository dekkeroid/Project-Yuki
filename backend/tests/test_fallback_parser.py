import json
import sys
import os

# Add backend to path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

from app.agent.executor import AgentExecutor


class TestFallbackParser:
    def setup_method(self):
        self.executor = AgentExecutor(None)

    def test_unified_format_single(self):
        text = '{"tool_calls": [{"name": "web_search", "arguments": {"query": "test"}}]}'
        result = self.executor._try_parse_json_tool_call(text)
        assert result is not None, "Should parse unified format"
        assert len(result) == 1
        assert result[0]["function"]["name"] == "web_search"
        assert json.loads(result[0]["function"]["arguments"]) == {"query": "test"}

    def test_unified_format_multiple(self):
        text = '{"tool_calls": [{"name": "web_search", "arguments": {"query": "test"}}, {"name": "launch_app", "arguments": {"app_name": "chrome"}}]}'
        result = self.executor._try_parse_json_tool_call(text)
        assert result is not None
        assert len(result) == 2
        assert result[0]["function"]["name"] == "web_search"
        assert result[1]["function"]["name"] == "launch_app"

    def test_openai_wrapper_function_object(self):
        text = '{"type": "function", "function": {"name": "web_search", "parameters": {"query": "test"}}}'
        result = self.executor._try_parse_json_tool_call(text)
        assert result is not None
        assert len(result) == 1
        assert result[0]["function"]["name"] == "web_search"
        assert json.loads(result[0]["function"]["arguments"]) == {"query": "test"}

    def test_openai_wrapper_function_string(self):
        text = '{"type": "function", "function": "web_search", "parameters": {"query": "test"}}'
        result = self.executor._try_parse_json_tool_call(text)
        assert result is not None
        assert len(result) == 1
        assert result[0]["function"]["name"] == "web_search"

    def test_openai_wrapper_direct_name(self):
        text = '{"type": "function", "name": "web_search", "parameters": {"query": "test"}}'
        result = self.executor._try_parse_json_tool_call(text)
        assert result is not None
        assert len(result) == 1
        assert result[0]["function"]["name"] == "web_search"

    def test_multiple_semicolon_separated(self):
        text = '{"type": "function", "function": {"name": "web_search", "parameters": {"query": "test"}}}; {"type": "function", "function": {"name": "launch_app", "parameters": {"app_name": "chrome"}}}'
        result = self.executor._try_parse_json_tool_call(text)
        assert result is not None, f"Should parse semicolon-separated, got: {result}"
        assert len(result) == 2

    def test_multiple_newline_separated(self):
        text = '{"type": "function", "function": {"name": "web_search", "parameters": {"query": "test"}}}\n{"type": "function", "function": {"name": "launch_app", "parameters": {"app_name": "chrome"}}}'
        result = self.executor._try_parse_json_tool_call(text)
        assert result is not None, f"Should parse newline-separated, got: {result}"
        assert len(result) == 2

    def test_markdown_code_block(self):
        text = '```json\n{"tool_calls": [{"name": "web_search", "arguments": {"query": "test"}}]}\n```'
        result = self.executor._try_parse_json_tool_call(text)
        assert result is not None
        assert len(result) == 1

    def test_trailing_text(self):
        text = '{"tool_calls": [{"name": "web_search", "arguments": {"query": "test"}}]} some trailing text'
        result = self.executor._try_parse_json_tool_call(text)
        assert result is not None
        assert len(result) == 1

    def test_invalid_json_returns_none(self):
        text = 'not json at all'
        result = self.executor._try_parse_json_tool_call(text)
        assert result is None

    def test_parameters_converted_to_arguments(self):
        text = '{"type": "function", "function": {"name": "web_search", "parameters": {"query": "test"}}}'
        result = self.executor._try_parse_json_tool_call(text)
        assert result is not None
        args = json.loads(result[0]["function"]["arguments"])
        assert "query" in args
        assert "parameters" not in result[0]["function"]

    def test_control_window_minimize_all(self):
        text = '{"tool_calls": [{"name": "control_window", "arguments": {"action": "minimize", "window_title": "all"}}]}'
        result = self.executor._try_parse_json_tool_call(text)
        assert result is not None
        assert len(result) == 1
        assert result[0]["function"]["name"] == "control_window"
        args = json.loads(result[0]["function"]["arguments"])
        assert args["action"] == "minimize"
        assert args["window_title"] == "all"

    def test_mixed_formats(self):
        text = '{"type": "function", "function": {"name": "web_search", "parameters": {"query": "test"}}}; {"name": "launch_app", "arguments": {"app_name": "chrome"}}'
        result = self.executor._try_parse_json_tool_call(text)
        assert result is not None
        assert len(result) == 2

    def test_pseudo_code_with_action_prefix(self):
        text = 'Action: launch_app(app_name="firefox", args="https://www.oneplus.com")'
        result = self.executor._try_parse_json_tool_call(text)
        assert result is not None, "Should parse pseudo-code with Action: prefix"
        assert len(result) == 1
        assert result[0]["function"]["name"] == "launch_app"
        args = json.loads(result[0]["function"]["arguments"])
        assert args["app_name"] == "firefox"
        assert args["args"] == "https://www.oneplus.com"

    def test_pseudo_code_without_action_prefix(self):
        text = 'web_search(query="oneplus nord 5 vs nord 6")'
        result = self.executor._try_parse_json_tool_call(text)
        assert result is not None, "Should parse pseudo-code without Action: prefix"
        assert len(result) == 1
        assert result[0]["function"]["name"] == "web_search"
        args = json.loads(result[0]["function"]["arguments"])
        assert args["query"] == "oneplus nord 5 vs nord 6"

    def test_pseudo_code_with_boolean_args(self):
        text = 'launch_app(app_name="chrome", run_as_admin=true)'
        result = self.executor._try_parse_json_tool_call(text)
        assert result is not None
        args = json.loads(result[0]["function"]["arguments"])
        assert args["run_as_admin"] is True


def run_tests():
    test = TestFallbackParser()
    test.setup_method()
    
    tests = [
        ("unified_format_single", test.test_unified_format_single),
        ("unified_format_multiple", test.test_unified_format_multiple),
        ("openai_wrapper_function_object", test.test_openai_wrapper_function_object),
        ("openai_wrapper_function_string", test.test_openai_wrapper_function_string),
        ("openai_wrapper_direct_name", test.test_openai_wrapper_direct_name),
        ("multiple_semicolon_separated", test.test_multiple_semicolon_separated),
        ("multiple_newline_separated", test.test_multiple_newline_separated),
        ("markdown_code_block", test.test_markdown_code_block),
        ("trailing_text", test.test_trailing_text),
        ("invalid_json_returns_none", test.test_invalid_json_returns_none),
        ("parameters_converted_to_arguments", test.test_parameters_converted_to_arguments),
        ("control_window_minimize_all", test.test_control_window_minimize_all),
        ("mixed_formats", test.test_mixed_formats),
        ("pseudo_code_with_action_prefix", test.test_pseudo_code_with_action_prefix),
        ("pseudo_code_without_action_prefix", test.test_pseudo_code_without_action_prefix),
        ("pseudo_code_with_boolean_args", test.test_pseudo_code_with_boolean_args),
    ]
    
    passed = 0
    failed = 0
    
    for name, test_func in tests:
        try:
            test_func()
            print(f"PASS {name}")
            passed += 1
        except AssertionError as e:
            print(f"FAIL {name}: {e}")
            failed += 1
        except Exception as e:
            print(f"ERROR {name}: {e}")
            failed += 1
    
    print(f"\n{'='*50}")
    print(f"Passed: {passed}, Failed: {failed}")
    return failed == 0


if __name__ == "__main__":
    success = run_tests()
    sys.exit(0 if success else 1)