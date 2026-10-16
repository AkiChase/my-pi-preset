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
import task
from common.developer import init_developer


class RuntimeAdmission(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name).resolve()
        self.env = patch.dict(os.environ, {"TRELLIS_CONTEXT_ID": "own"}, clear=True)
        self.env.start()
        self.addCleanup(self.env.stop)
        self.cwd = Path.cwd()
        os.chdir(self.root)
        self.addCleanup(os.chdir, self.cwd)
        self.path = ".trellis/tasks/own"
        self.target = ".trellis/tasks/target"
        for path in (self.path, self.target):
            self.put(path + "/task.json", json.dumps({"id": path.rsplit("/", 1)[1], "title": "test", "status": "planning", "children": []}))
            self.put(path + "/prd.md", "Requirements")
        self.pointer = ".trellis/.runtime/sessions/own.json"
        self.put(self.pointer, json.dumps({"current_task": self.path}))
        self.put(".trellis/.runtime/sessions/foreign.json", json.dumps({"current_task": self.target}))

    def put(self, path, text):
        file = self.root / path
        file.parent.mkdir(parents=True, exist_ok=True)
        file.write_text(text, encoding="utf8")

    def bytes(self, path):
        return (self.root / path).read_bytes()

    def call(self, handler, path):
        with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
            return handler(argparse.Namespace(dir=path, allow_empty_context=True))

    def test_active_invalid_context_and_refs_preserve_records_and_hooks(self):
        own, foreign, record = self.bytes(self.pointer), self.bytes(".trellis/.runtime/sessions/foreign.json"), self.bytes(self.target + "/task.json")
        with patch.object(task, "run_task_hooks") as hooks:
            for key in ("", "own!", "own/../own", "x" * 129):
                with self.subTest(key=key), patch.dict(os.environ, TRELLIS_CONTEXT_ID=key):
                    self.assertNotEqual(self.call(task.cmd_active, self.target), 0)
                    self.assertEqual(self.bytes(self.pointer), own)
            for ref in ("missing", "../victim", ".trellis/tasks/../../victim", str(self.root)):
                with self.subTest(ref=ref):
                    self.assertNotEqual(self.call(task.cmd_active, ref), 0)
                    self.assertEqual(self.bytes(self.pointer), own)
            hooks.assert_not_called()
        self.assertEqual(self.bytes(".trellis/.runtime/sessions/foreign.json"), foreign)
        self.assertEqual(self.bytes(self.target + "/task.json"), record)

    def test_active_corrupt_pointer_and_task_preserve_existing_bytes(self):
        own = self.bytes(self.pointer)
        foreign = self.bytes(".trellis/.runtime/sessions/foreign.json")
        record = self.bytes(self.target + "/task.json")
        with patch.object(task, "run_task_hooks") as hooks:
            for content in ("broken", "[]", '{"current_task":42}', json.dumps({"current_task": ".trellis/tasks/missing"})):
                with self.subTest(pointer=content):
                    self.put(self.pointer, content)
                    self.assertNotEqual(self.call(task.cmd_active, self.target), 0)
                    self.assertEqual(self.bytes(self.pointer), content.encode())
            self.put(self.pointer, own.decode())
            for content in ("broken", "[]", "{}", '{"status":{}}'):
                with self.subTest(record=content):
                    self.put(self.target + "/task.json", content)
                    self.assertNotEqual(self.call(task.cmd_active, self.target), 0)
                    self.assertEqual(self.bytes(self.pointer), own)
                    self.assertEqual(self.bytes(self.target + "/task.json"), content.encode())
            hooks.assert_not_called()
        self.assertEqual(self.bytes(".trellis/.runtime/sessions/foreign.json"), foreign)
        self.put(self.target + "/task.json", record.decode())

    def test_start_invalid_records_cannot_bind_or_run_hooks(self):
        (self.root / self.pointer).unlink()
        with patch.object(task, "run_task_hooks") as hooks:
            for content in ("broken", "[]", "{}", '{"status":{}}', '{"title":42}', json.dumps({"status": "a" * 9000})):
                with self.subTest(content=content[:60]):
                    self.put(self.path + "/task.json", content)
                    self.assertNotEqual(self.call(task.cmd_start, self.path), 0)
                    self.assertFalse((self.root / self.pointer).exists())
                    self.assertEqual(self.bytes(self.path + "/task.json"), content.encode())
            (self.root / self.path / "task.json").unlink()
            for ref in (self.path, ".trellis/tasks/absent"):
                self.assertNotEqual(self.call(task.cmd_start, ref), 0)
                self.assertFalse((self.root / self.pointer).exists())
            hooks.assert_not_called()

    def test_developer_invalid_names_never_create_identity_or_workspace(self):
        names = ("..", ".", "../victim", "a/b", "a\\b", "bad\nname", "edge\n", "\tbad", "bad\x00name", "   ", " . ", " .. ", "\u3000.\u3000", "\u00a0..\u00a0")
        for name in names:
            with self.subTest(name=name), contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
                self.assertFalse(init_developer(name, self.root))
                self.assertFalse((self.root / ".trellis/.developer").exists())
                self.assertFalse((self.root / ".trellis/workspace").exists())


if __name__ == "__main__":
    unittest.main()
