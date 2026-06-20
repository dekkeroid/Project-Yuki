import ast
import unittest
from pathlib import Path


MAIN_PATH = Path(__file__).resolve().parents[1] / "app" / "main.py"


class OpenPlayRequestContractTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.source = MAIN_PATH.read_text(encoding="utf-8")
        cls.tree = ast.parse(cls.source)
        cls.class_node = next(
            node
            for node in cls.tree.body
            if isinstance(node, ast.ClassDef) and node.name == "OpenPlayRequest"
        )

    def _annotated_fields(self):
        return {
            node.target.id
            for node in self.class_node.body
            if isinstance(node, ast.AnnAssign) and isinstance(node.target, ast.Name)
        }

    def test_rest_contract_accepts_pending_confirmation_only(self):
        fields = self._annotated_fields()

        self.assertIn("pending_confirmation_id", fields)
        self.assertNotIn("confirmation_grant_id", fields)

    def test_rest_contract_forbids_legacy_extra_fields(self):
        config_assignments = [
            node
            for node in self.class_node.body
            if isinstance(node, ast.Assign)
            and any(isinstance(target, ast.Name) and target.id == "model_config" for target in node.targets)
        ]

        self.assertEqual(1, len(config_assignments))
        config_call = config_assignments[0].value
        self.assertIsInstance(config_call, ast.Call)
        self.assertTrue(
            any(
                kw.arg == "extra" and isinstance(kw.value, ast.Constant) and kw.value.value == "forbid"
                for kw in config_call.keywords
            ),
            "OpenPlayRequest must forbid public legacy grant fields instead of silently ignoring them.",
        )

    def test_open_or_play_endpoint_does_not_read_public_executable_grants(self):
        function_node = next(
            node
            for node in self.tree.body
            if isinstance(node, ast.FunctionDef) and node.name == "post_open_or_play"
        )
        function_source = ast.get_source_segment(self.source, function_node)

        self.assertIn("pending_confirmation_id", function_source)
        self.assertNotIn("req.confirmation_grant_id", function_source)


if __name__ == "__main__":
    unittest.main()
