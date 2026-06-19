import unittest

from app.tools.definitions import get_tools_definition
from app.tools.selector import select_relevant_tools


class ToolSelectorTests(unittest.TestCase):
    def test_selects_relevant_action_tools_without_keyword_buckets(self):
        tools = get_tools_definition()
        selected = select_relevant_tools(
            tools,
            "can you pull up my anime folder and start something to watch",
            max_tools=6,
            fallback_threshold=0.05,
        )
        names = [tool["function"]["name"] for tool in selected]
        self.assertIn("open_or_play_file", names)
        self.assertIn("search_files", names)
        self.assertLessEqual(len(names), 6)

    def test_low_signal_query_falls_back_to_full_tool_list(self):
        tools = get_tools_definition()
        selected = select_relevant_tools(
            tools,
            "hmm maybe later",
            max_tools=5,
            fallback_threshold=0.5,
        )
        self.assertEqual(
            [tool["function"]["name"] for tool in selected],
            [tool["function"]["name"] for tool in tools],
        )


if __name__ == "__main__":
    unittest.main()
