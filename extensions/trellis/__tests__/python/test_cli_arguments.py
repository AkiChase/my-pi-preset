import argparse
import contextlib
import io
import json
import os
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "runtime"))
from pi_trellis_worktree.cli import main


class CliArguments(unittest.TestCase):
    def test_invalid_arguments_never_reach_management(self):
        task = ".trellis/tasks/native"
        cases = [
            ("refresh", []), ("collect", []),
            ("prepare", ["--file", task + "/prd.md"]),
            ("prepare", ["--role", "invalid"]),
            ("prepare", ["--role", "implement", "--role", "check"]),
            ("refresh", ["--base", "HEAD"]), ("refresh", ["--file", task + "/prd.md"]),
            ("collect", ["--file", ""]), ("collect", ["--all"]), ("collect", ["--expect", "token"]),
            ("create", ["--path", "somewhere"]), ("status", ["--confirm"]),
            ("prepare", ["--base", "HEAD"]), ("recover", ["--branch", "x"]),
            ("adopt", []), ("create", ["--unknown"]), ("create", ["--br", "x"]),
            ("create", ["--task", task]), ("create", ["--json"]),
            ("create", ["--confirm", "--confirm"]), ("create", ["--base"]),
            ("create", ["--base", ""]), ("create", ["--base", "   "]),
            ("create", ["--branch", "bad\tname"]),
            ("remove", ["--integrated-into", "bad\nref"]), ("create", ["--cwd", ""]),
        ]
        with tempfile.TemporaryDirectory() as root, patch("pi_trellis_worktree.cli.manage") as manage:
            for action, flags in cases:
                with self.subTest(action=action, flags=flags):
                    output, errors = io.StringIO(), io.StringIO()
                    with contextlib.redirect_stdout(output), contextlib.redirect_stderr(errors):
                        result = main([action, "--task", task, "--cwd", root, "--json", *flags])
                    self.assertNotEqual(result, 0)
                    self.assertFalse(json.loads(output.getvalue())["ok"])
                    self.assertTrue(errors.getvalue())
                    self.assertEqual(list(Path(root).iterdir()), [])
                    manage.assert_not_called()


if __name__ == "__main__":
    unittest.main()
