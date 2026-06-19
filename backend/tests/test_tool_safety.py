import asyncio
import tempfile
import unittest
from pathlib import Path

from app import config
from app.tools.safety import (
    approve_pending_confirmation,
    authorize_tool_call,
    issue_confirmation_grant,
    issue_pending_confirmation,
)


class ToolSafetyTests(unittest.TestCase):
    def setUp(self):
        self.tmpdir = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmpdir.cleanup)
        self.old_grant_file = config.TOOL_CONFIRMATION_GRANT_FILE
        self.old_blocked_power = config.TOOL_SANDBOX_BLOCKED_POWER_ACTIONS
        self.old_blocked_patterns = config.TOOL_SANDBOX_BLOCKED_TERMINAL_PATTERNS
        self.old_sandbox = config.TOOL_SANDBOX_ENABLED
        config.TOOL_CONFIRMATION_GRANT_FILE = Path(self.tmpdir.name) / "grants.json"
        config.TOOL_SANDBOX_BLOCKED_POWER_ACTIONS = "shutdown,restart"
        config.TOOL_SANDBOX_BLOCKED_TERMINAL_PATTERNS = ""
        config.TOOL_SANDBOX_ENABLED = True

    def tearDown(self):
        config.TOOL_CONFIRMATION_GRANT_FILE = self.old_grant_file
        config.TOOL_SANDBOX_BLOCKED_POWER_ACTIONS = self.old_blocked_power
        config.TOOL_SANDBOX_BLOCKED_TERMINAL_PATTERNS = self.old_blocked_patterns
        config.TOOL_SANDBOX_ENABLED = self.old_sandbox

    def test_model_confirmed_flag_alone_cannot_authorize_delete(self):
        target = Path(self.tmpdir.name) / "delete-me.txt"
        target.write_text("x", encoding="utf-8")

        decision = authorize_tool_call(
            "delete_file",
            {"file_path": str(target), "confirmed": True},
        )

        self.assertFalse(decision.allowed)
        self.assertTrue(decision.requires_confirmation)
        self.assertIn("CONFIRM_REQUIRED", decision.message)
        self.assertTrue(target.exists())

    def test_pending_confirmation_is_not_executable_until_approved(self):
        args = {"file_path": "one.txt"}
        pending_id = issue_pending_confirmation("delete_file", args, target="one.txt")

        pending_as_grant = authorize_tool_call(
            "delete_file",
            {**args, "confirmation_grant_id": pending_id},
        )
        approved, grant_id = approve_pending_confirmation(pending_id, "delete_file", args)
        executable = authorize_tool_call(
            "delete_file",
            {**args, "confirmation_grant_id": grant_id},
        )

        self.assertFalse(pending_as_grant.allowed)
        self.assertIn("not an executable grant", pending_as_grant.message)
        self.assertTrue(approved)
        self.assertTrue(executable.allowed)

    def test_confirmation_grant_is_bound_and_one_time(self):
        target = Path(self.tmpdir.name) / "delete-me.txt"
        target.write_text("x", encoding="utf-8")
        args = {"file_path": str(target)}
        grant_id = issue_confirmation_grant("delete_file", args, target=str(target))

        first = authorize_tool_call(
            "delete_file",
            {**args, "confirmation_grant_id": grant_id},
        )
        second = authorize_tool_call(
            "delete_file",
            {**args, "confirmation_grant_id": grant_id},
        )

        self.assertTrue(first.allowed)
        self.assertTrue(first.arguments.get("confirmed"))
        self.assertFalse(second.allowed)
        self.assertTrue(second.requires_confirmation)

    def test_confirmation_grant_rejects_argument_mismatch(self):
        grant_id = issue_confirmation_grant("delete_file", {"file_path": "one.txt"}, target="one.txt")
        decision = authorize_tool_call(
            "delete_file",
            {"file_path": "two.txt", "confirmation_grant_id": grant_id},
        )

        self.assertFalse(decision.allowed)
        self.assertIn("argument mismatch", decision.message)

    def test_mcp_wrapper_defaults_match_canonical_confirmation_grants(self):
        cases = [
            ("launch_app", {"app_name": "notepad"}, {"app_name": "notepad", "args": None, "run_as_admin": False}),
            ("run_terminal_command", {"command": "echo safe"}, {"command": "echo safe", "use_powershell": True}),
            ("run_python_script", {"code": "print('safe')"}, {"code": "print('safe')"}),
            ("control_window", {"action": "close", "window_title": "notepad"}, {"action": "close", "window_title": "notepad", "x": None, "y": None}),
            ("manage_process", {"action": "kill", "name": "fake.exe"}, {"action": "kill", "name": "fake.exe", "pid": None}),
            ("keyboard_mouse_input", {"action": "type", "text": "hello"}, {"action": "type", "text": "hello", "keys": None, "x": None, "y": None, "amount": None}),
        ]
        for tool_name, granted_args, mcp_args in cases:
            with self.subTest(tool_name=tool_name):
                grant_id = issue_confirmation_grant(tool_name, granted_args, target=tool_name)
                decision = authorize_tool_call(
                    tool_name,
                    {**mcp_args, "confirmation_grant_id": grant_id},
                )
                self.assertTrue(decision.allowed, decision.message)

    def test_terminal_blacklist_blocks_destructive_commands_before_confirmation(self):
        commands = [
            "shutdown /s /t 0",
            "shutdown.exe /s /t 0",
            "shutdown -s -t 0",
            "rm -fr /",
            "rm -rf /",
            "Remove-Item C:\\ -Force -Recurse",
            "rmdir /s /q C:\\",
            "rd /s /q C:\\",
        ]
        for command in commands:
            with self.subTest(command=command):
                decision = authorize_tool_call(
                    "run_terminal_command",
                    {"command": command, "use_powershell": False},
                )

                self.assertFalse(decision.allowed)
                self.assertTrue(decision.blocked)
                self.assertIn("blocked pattern", decision.message)

    def test_custom_terminal_blacklist_adds_to_built_ins(self):
        config.TOOL_SANDBOX_BLOCKED_TERMINAL_PATTERNS = r"custombad"

        default_block = authorize_tool_call("run_terminal_command", {"command": "shutdown /s /t 0"})
        custom_block = authorize_tool_call("run_terminal_command", {"command": "echo custombad"})

        self.assertTrue(default_block.blocked)
        self.assertTrue(custom_block.blocked)

    def test_shutdown_and_restart_power_actions_are_blocked_by_default(self):
        decision = authorize_tool_call(
            "system_power_control",
            {"action": "shutdown", "confirmed": True},
        )

        self.assertFalse(decision.allowed)
        self.assertTrue(decision.blocked)
        self.assertIn("shutdown", decision.message)

    def test_safe_read_only_tool_is_allowed_without_grant(self):
        decision = authorize_tool_call("get_current_datetime", {})
        self.assertTrue(decision.allowed)
        self.assertEqual(decision.arguments, {})

    def test_mcp_server_wrapper_rejects_confirmed_true_without_grant(self):
        from app import mcp_server

        target = Path(self.tmpdir.name) / "delete-me.txt"
        target.write_text("x", encoding="utf-8")
        result = asyncio.run(mcp_server.delete_file(str(target), confirmed=True))

        self.assertIn("CONFIRM_REQUIRED", result)
        self.assertTrue(target.exists())

    def test_mcp_server_wrapper_consumes_grant_to_execute_delete(self):
        from app import mcp_server

        target = Path(self.tmpdir.name) / "delete-me.txt"
        target.write_text("x", encoding="utf-8")
        args = {"file_path": str(target)}
        grant_id = issue_confirmation_grant("delete_file", args, target=str(target))

        result = asyncio.run(mcp_server.delete_file(str(target), confirmation_grant_id=grant_id))

        self.assertIn("Success", result)
        self.assertFalse(target.exists())


if __name__ == "__main__":
    unittest.main()
