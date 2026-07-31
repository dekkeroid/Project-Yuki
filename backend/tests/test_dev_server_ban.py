import base64
import unittest

from app.tools.system import (
    _contains_banned_dev_server,
    run_python_script,
    run_terminal_command,
)


class DevServerBanTests(unittest.TestCase):
    def test_chained_commands_with_double_ampersand_are_blocked(self):
        self.assertTrue(_contains_banned_dev_server("echo hi && npm run dev"))
        self.assertTrue(_contains_banned_dev_server("cd frontend && yarn dev"))

    def test_chained_commands_with_semicolon_are_blocked(self):
        self.assertTrue(_contains_banned_dev_server("echo hi ; npm run dev"))
        self.assertTrue(_contains_banned_dev_server("cd frontend ; pnpm dev"))

    def test_irregular_whitespace_is_blocked(self):
        self.assertTrue(_contains_banned_dev_server("npm run  dev"))
        self.assertTrue(_contains_banned_dev_server("npm\trun\tdev"))
        self.assertTrue(_contains_banned_dev_server("npm\nrun\ndev"))

    def test_npm_start_variants_are_blocked(self):
        for cmd in ("npm start", "yarn start", "pnpm start", "bun start", "npm run start"):
            self.assertTrue(_contains_banned_dev_server(cmd), cmd)

    def test_vite_launchers_are_blocked(self):
        self.assertTrue(_contains_banned_dev_server("vite"))
        self.assertTrue(_contains_banned_dev_server("echo hi | vite"))
        self.assertTrue(_contains_banned_dev_server("npx -y vite@latest"))
        self.assertTrue(_contains_banned_dev_server("npx vite --port 5173"))
        self.assertTrue(_contains_banned_dev_server("bunx vite"))

    def test_vite_build_is_allowed(self):
        self.assertFalse(_contains_banned_dev_server("npx -y vite build"))
        self.assertFalse(_contains_banned_dev_server("npm run build"))

    def test_encoded_command_payload_is_decoded_and_blocked(self):
        encoded = base64.b64encode("npm run dev".encode("utf-16-le")).decode("ascii")
        self.assertTrue(_contains_banned_dev_server(f"powershell -NoProfile -EncodedCommand {encoded}"))

    def test_terminal_returns_security_error_for_chain(self):
        result = run_terminal_command("echo hi && npm run dev")
        self.assertIn("Security / Execution Error", result)
        self.assertIn("strictly prohibited", result)

    def test_python_os_system_dev_server_is_blocked(self):
        result = run_python_script("import os\nos.system('npm run dev')")
        self.assertIn("Security / Execution Error", result)

    def test_python_subprocess_list_args_dev_server_is_blocked(self):
        result = run_python_script("import subprocess\nsubprocess.run(['npm', 'run', 'dev'])")
        self.assertIn("Security / Execution Error", result)

    def test_safe_python_script_still_runs(self):
        result = run_python_script("print('hello safe world')")
        self.assertIn("hello safe world", result)


if __name__ == "__main__":
    unittest.main()
