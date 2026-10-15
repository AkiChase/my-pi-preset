import json
import os
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "runtime"))
from pi_trellis_worktree.records import canonical, parse_binding, text, owner_alive, source_lock, now, read_json, json_value
from pi_trellis_worktree.materials import references, projection, digest, source_materials, read_material, safe_path
from pi_trellis_worktree.diagnostics import DiagnosticError, issues_for
from pi_trellis_worktree.cli import parser


class NativeContracts(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name).resolve()
        self.task = ".trellis/tasks/test"
        self.put(self.task + "/task.json", "{}")
        self.put(self.task + "/prd.md", "requirements")
        self.put(self.task + "/implement.jsonl", json.dumps({"file": self.task + "/prd.md"}))
        self.put(".trellis/workflow.md", "workflow")
        (self.root / ".trellis/spec").mkdir()

    def put(self, path, data):
        file = self.root / path
        file.parent.mkdir(parents=True, exist_ok=True)
        file.write_bytes(data if isinstance(data, bytes) else data.encode("utf-8"))

    def test_canonical_dangling_symlink_is_not_free_destination(self):
        (self.root / "link").symlink_to(self.root / "missing")
        with self.assertRaises(FileNotFoundError):
            canonical(self.root / "link/new")

    def test_v2_identity_strict_unknown_and_old_records_rejected(self):
        b = dict(version=2, bindingId="id", taskDir=self.task, sourceRoot=str(self.root), worktreePath=str(self.root / "target"), repositoryIdentity=str(self.root), branch="task", baseCommit="a" * 40, contextId="pi-wt-id", createdAt=now(), preparationState="ready")
        self.assertEqual(parse_binding(b), b)
        for field, value in (("sourceRoot", "relative"), ("contextId", "../escape"), ("baseCommit", "HEAD"), ("preparationState", "invalid"), ("version", 1), ("version", True), ("preparedFiles", {}), ("materials", {}), ("custom", "unknown")):
            with self.subTest(field=field), self.assertRaises(ValueError):
                parse_binding(dict(b, **{field: value}))

    def test_parser_values_and_removed_operations(self):
        args = parser().parse_args(["create", "--task", self.task, "--base", " HEAD "])
        self.assertEqual(args.base, " HEAD ")
        self.assertEqual(parser().parse_args(["prepare", "--task", self.task, "--role", "research"]).role, "research")
        for raw in ("", "  ", "a\t", "a\x7f"):
            with self.assertRaises(ValueError):
                text(raw, "value")
        for action in ("refresh", "collect"):
            with self.assertRaises(SystemExit):
                parser().parse_args([action, "--task", self.task])

    def test_jsonl_bound_and_directory_entry_bound(self):
        self.put(self.task + "/implement.jsonl", (json.dumps({"file": self.task + "/prd.md"}) + "\n") * 513)
        with self.assertRaisesRegex(ValueError, "reference limit"):
            references(self.root, self.task, "implement")
        for i in range(513):
            self.put(self.task + f"/research/{i}.md", "x")
        self.put(self.task + "/implement.jsonl", json.dumps({"file": self.task + "/research", "type": "directory"}))
        with self.assertRaisesRegex(ValueError, "entry limit"):
            references(self.root, self.task, "implement")

    def test_streaming_utf8_across_chunks_and_nonempty_prd(self):
        self.put(self.task + "/prd.md", "a" * 65535 + "🙂")
        self.assertEqual(references(self.root, self.task, "implement"), [self.task + "/prd.md"])
        self.put(self.task + "/prd.md", "")
        with self.assertRaisesRegex(ValueError, "PRD is empty"):
            references(self.root, self.task, "implement")

    def test_utf8_nul_bounds_apply_to_all_files_and_stream_growth(self):
        for label in (self.task + "/task.json", self.task + "/implement.jsonl", self.task + "/prd.md", ".trellis/workflow.md"):
            original = (self.root / label).read_bytes()
            for data in (b"\xff", b"valid\0text"):
                self.put(label, data)
                with self.assertRaises(DiagnosticError):
                    source_materials(self.root, self.task, "implement")
            self.put(label, original)
        self.put(".trellis/spec/huge.md", b"x" * (16 * 1024 * 1024 + 1))
        self.put(self.task + "/implement.jsonl", json.dumps({"file": ".trellis/spec/huge.md"}))
        with self.assertRaisesRegex(ValueError, "16 MiB"):
            references(self.root, self.task, "implement")
        with self.assertRaisesRegex(ValueError, "path/control bounds"):
            safe_path(self.root, self.task, "x" * 4097)

    def test_read_fence_detects_concurrent_replacement_not_access_time(self):
        label = self.task + "/prd.md"
        original_fdopen = os.fdopen
        class MutatingStream:
            def __init__(self, stream):
                self.stream = stream
                self.changed = False
            def __enter__(self):
                return self
            def __exit__(self, *args):
                self.stream.close()
            def fileno(self):
                return self.stream.fileno()
            def read(self, size):
                chunk = self.stream.read(size)
                if not self.changed:
                    self.changed = True
                    self_path = self.root / label
                    replacement = self_path.with_suffix(".new")
                    replacement.write_bytes(b"changed source")
                    replacement.replace(self_path)
                return chunk
        # Bind fixture roots explicitly so the wrapper does not discover a source.
        MutatingStream.root = self.root
        def opened(fd, *args, **kwargs):
            stream = original_fdopen(fd, *args, **kwargs)
            return MutatingStream(stream)
        with patch.object(os, "fdopen", opened), self.assertRaisesRegex(ValueError, "changed while reading"):
            read_material(self.root, self.task, label)
        self.assertEqual((self.root / label).read_bytes(), b"changed source")

    def test_read_fence_rejects_opened_file_when_ancestor_restored(self):
        label = self.task + "/prd.md"
        task_path = self.root / self.task
        saved = task_path.with_name("saved-task")
        original_open = os.open
        def raced(path, *args, **kwargs):
            if path == self.root / label:
                # Moving an ancestor preserves the original file's full stat.
                task_path.rename(saved)
                task_path.mkdir()
                path.write_bytes(b"alien requirements")
                stream = original_open(path, *args, **kwargs)
                path.unlink()
                task_path.rmdir()
                saved.rename(task_path)
                return stream
            return original_open(path, *args, **kwargs)
        with patch.object(os, "open", raced), self.assertRaises(DiagnosticError) as caught:
            read_material(self.root, self.task, label)
        self.assertEqual(caught.exception.issue["code"], "material_changed")
        self.assertEqual((self.root / label).read_bytes(), b"requirements")

    def test_graph_fence_rejects_earlier_common_reference_and_manifest_edits(self):
        from pi_trellis_worktree import materials
        late = self.task + "/research/late.md"
        self.put(late, "late")
        self.put(".trellis/spec/first.md", "first")
        manifest = self.task + "/implement.jsonl"
        original_manifest = json.dumps({"file": ".trellis/spec/first.md"}) + "\n" + json.dumps({"file": late})
        for changed in (self.task + "/task.json", self.task + "/prd.md", ".trellis/workflow.md", ".trellis/spec/first.md", manifest):
            with self.subTest(changed=changed):
                self.put(manifest, original_manifest)
                prior = (self.root / changed).read_bytes()
                read = materials.read_material
                triggered = False
                def raced(root, task, label, *args, **kwargs):
                    nonlocal triggered
                    value = read(root, task, label, *args, **kwargs)
                    if label == late and not triggered:
                        triggered = True
                        self.put(changed, '{"status":"planning"}' if changed.endswith("task.json") else "changed")
                    return value
                with patch.object(materials, "read_material", raced), self.assertRaises(DiagnosticError) as caught:
                    source_materials(self.root, self.task, "implement")
                self.assertEqual(caught.exception.issue["code"], "material_changed")
                self.put(changed, prior)

    def test_graph_fence_rejects_added_optional_artifact_and_directory_entry(self):
        from pi_trellis_worktree import materials
        late = self.task + "/research/late.md"
        self.put(late, "late")
        self.put(self.task + "/implement.jsonl", json.dumps({"file": self.task + "/research", "type": "directory"}))
        read = materials.read_material
        for added in (self.task + "/design.md", self.task + "/research/new.md"):
            triggered = False
            def raced(root, task, label, *args, **kwargs):
                nonlocal triggered
                value = read(root, task, label, *args, **kwargs)
                if label == late and not triggered:
                    triggered = True
                    self.put(added, "new requirement")
                return value
            with patch.object(materials, "read_material", raced), self.assertRaises(DiagnosticError) as caught:
                source_materials(self.root, self.task, "implement")
            self.assertEqual(caught.exception.issue["code"], "material_changed")
            (self.root / added).unlink()

    def test_approval_comes_from_same_task_record_as_fingerprint(self):
        self.put(self.task + "/task.json", '{"status":"planning","requirement":"new"}')
        with self.assertRaises(DiagnosticError) as caught:
            source_materials(self.root, self.task, "implement", approved=True)
        self.assertEqual(caught.exception.issue["code"], "source_not_approved")
        self.put(self.task + "/task.json", '{"status":"in_progress","requirement":"new"}')
        self.assertEqual(source_materials(self.root, self.task, "implement", approved=True)["state"], "valid")

    def test_internal_spec_file_directory_and_workflow_aliases_rejected(self):
        self.put(".trellis/spec/real.md", "real spec")
        (self.root / ".trellis/spec/alias.md").symlink_to("real.md")
        (self.root / ".trellis/spec/alias-directory").symlink_to(self.root / ".trellis/spec", target_is_directory=True)
        for row in ({"file": ".trellis/spec/alias.md"}, {"file": ".trellis/spec/alias-directory", "type": "directory"}):
            self.put(self.task + "/implement.jsonl", json.dumps(row))
            with self.assertRaises(DiagnosticError) as caught:
                source_materials(self.root, self.task, "implement")
            self.assertEqual(caught.exception.issue["code"], "material_path_unsafe")
        self.put(self.task + "/implement.jsonl", json.dumps({"file": self.task + "/prd.md"}))
        workflow = self.root / ".trellis/workflow.md"
        workflow.unlink()
        workflow.symlink_to("spec/real.md")
        with self.assertRaises(DiagnosticError):
            source_materials(self.root, self.task, "research")

    def test_external_task_store_outside_root_remains_the_only_route(self):
        with tempfile.TemporaryDirectory() as external:
            store = Path(external).resolve() / "tasks"
            (self.root / ".trellis/tasks").rename(store)
            (self.root / ".trellis/tasks").symlink_to(store, target_is_directory=True)
            self.assertEqual(source_materials(self.root, self.task, "implement")["taskPath"], str(store / "test"))
            (store / "test/alias.md").symlink_to(store / "test/prd.md")
            self.put(self.task + "/implement.jsonl", json.dumps({"file": self.task + "/alias.md"}))
            with self.assertRaises(DiagnosticError):
                source_materials(self.root, self.task, "implement")

    def test_reference_hash_is_raw_bytes_even_for_projected_task_record(self):
        import hashlib
        label = self.task + "/task.json"
        self.put(label, '{"status":"in_progress","requirement":"x"}')
        self.put(self.task + "/implement.jsonl", json.dumps({"file": label}))
        result = source_materials(self.root, self.task, "implement")
        self.assertEqual(result["references"][0]["sha256"], hashlib.sha256((self.root / label).read_bytes()).hexdigest())
        original = result["sourceFingerprint"]
        self.put(label, '{"status":"completed","requirement":"x"}')
        self.assertEqual(source_materials(self.root, self.task, "implement")["sourceFingerprint"], original)

    @unittest.skipUnless(hasattr(os, "mkfifo"), "POSIX special-file fixture")
    def test_replacement_with_fifo_cannot_block_open(self):
        label = self.task + "/prd.md"
        original_open = os.open
        def raced(path, flags, *args, **kwargs):
            if path == self.root / label:
                path.unlink()
                os.mkfifo(path)
            return original_open(path, flags, *args, **kwargs)
        with patch.object(os, "open", raced), self.assertRaises(DiagnosticError) as caught:
            read_material(self.root, self.task, label)
        self.assertEqual(caught.exception.issue["code"], "material_changed")

    def test_empty_directory_reference_cannot_be_complete_context(self):
        label = self.task + "/research"
        (self.root / label).mkdir()
        self.put(self.task + "/implement.jsonl", json.dumps({"file": label, "type": "directory"}))
        with self.assertRaises(DiagnosticError) as caught:
            source_materials(self.root, self.task, "implement")
        self.assertEqual(caught.exception.issue["code"], "manifest_reference_invalid")
        self.assertEqual(caught.exception.issue["line"], 1)
        self.assertEqual(caught.exception.issue["path"], str(self.root / label))
        # Empty nested folders do not invalidate an otherwise complete selection.
        (self.root / label / "empty-child").mkdir()
        self.put(label + "/file.md", "selected")
        self.assertEqual(len(source_materials(self.root, self.task, "implement")["references"]), 1)

    def test_bare_cr_is_not_a_jsonl_row_separator(self):
        row = json.dumps({"file": self.task + "/prd.md"})
        self.put(self.task + "/implement.jsonl", row + "\r" + row)
        with self.assertRaises(ValueError):
            references(self.root, self.task, "implement")
        self.put(self.task + "/implement.jsonl", row + "\r\n" + row)
        self.assertEqual(references(self.root, self.task, "implement"), [self.task + "/prd.md"])

    def test_structured_manifest_path_and_line_not_message_guessing(self):
        label = self.task + "/implement.jsonl"
        self.put(label, '\n{"reason":"seed"}\n{"file":".trellis/spec/missing.md"}')
        with self.assertRaises(DiagnosticError) as caught:
            references(self.root, self.task, "implement")
        issue = caught.exception.issue
        self.assertEqual(issue["code"], "material_missing")
        self.assertEqual(issue["role"], "implement")
        self.assertEqual(issue["manifest"], str(self.root / label))
        self.assertEqual(issue["line"], 3)
        self.assertEqual(issue["path"], str(self.root / ".trellis/spec/missing.md"))
        self.assertIn("repair the source manifest", issue["nextAction"])
        self.assertIn("existing maintenance authorization", issue["nextAction"])
        self.assertEqual(issues_for(ValueError("contains magic UTF missing keywords"))[0]["code"], "operation_failed")

    def test_role_isolation_and_research_needs_no_manifest(self):
        self.put(self.task + "/check.jsonl", "invalid")
        valid = source_materials(self.root, self.task, "implement")
        self.assertEqual(valid["state"], "valid")
        research = source_materials(self.root, self.task, "research")
        self.assertIsNone(research["manifest"])
        self.assertEqual(research["references"], [])
        self.assertEqual(research["taskPath"], str(self.root / self.task))
        self.assertEqual(research["revision"], research["sourceFingerprint"])
        self.assertNotEqual(valid["sourceFingerprint"], research["sourceFingerprint"])
        with self.assertRaises(ValueError):
            source_materials(self.root, self.task, "check")

    def test_fingerprint_current_source_role_graph_and_lifecycle_projection(self):
        original = source_materials(self.root, self.task, "implement")["sourceFingerprint"]
        self.put(self.task + "/task.json", '{"status":"in_progress","branch":"different"}')
        self.put(self.task + "/check.jsonl", "unrelated")
        self.assertEqual(source_materials(self.root, self.task, "implement")["sourceFingerprint"], original)
        self.put(self.task + "/task.json", '{"unknown_requirement":true}')
        self.assertNotEqual(source_materials(self.root, self.task, "implement")["sourceFingerprint"], original)
        self.assertEqual(digest(projection('{"branch":"x","meta":{"x":1}}')), digest(projection('{"meta":{"x":1}}')))

    def test_present_null_record_and_non_json_constants_are_not_missing(self):
        file = self.root / "record.json"
        self.assertIsNone(read_json(file, 100))
        for data in ("null", "[]", "false", '{"ownerPid":NaN}', '{"x":Infinity}', b'"\xff"', b'{"x":"\0"}'):
            file.write_bytes(data if isinstance(data, bytes) else data.encode())
            with self.assertRaises(ValueError):
                read_json(file, 100)
        with self.assertRaises(ValueError):
            json_value('{"status":NaN}')

    def test_pid_uncertainty_permission_and_nonposix_never_prove_death(self):
        for pid in (0, -2147483647, True, "1"):
            with patch("os.kill", side_effect=ProcessLookupError) as kill:
                self.assertTrue(owner_alive({"ownerPid": pid}))
                kill.assert_not_called()
        with patch("os.kill", side_effect=PermissionError):
            self.assertTrue(owner_alive({"ownerPid": 123}))
        with patch("os.kill", side_effect=ProcessLookupError):
            self.assertFalse(owner_alive({"ownerPid": 123}))
        with patch("os.name", "nt"), patch("os.kill") as kill:
            self.assertTrue(owner_alive({"ownerPid": 123}))
            kill.assert_not_called()

    def test_record_and_directory_byte_count_bounds(self):
        for label in ("task.json", "implement.jsonl"):
            original = (self.root / self.task / label).read_bytes()
            self.put(self.task + "/" + label, " " * (1024 * 1024 + 1))
            with self.assertRaisesRegex(ValueError, "1 MiB"):
                references(self.root, self.task, "implement")
            self.put(self.task + "/" + label, original)
        for i in range(129):
            (self.root / self.task / "research" / str(i)).mkdir(parents=True)
        self.put(self.task + "/implement.jsonl", json.dumps({"file": self.task + "/research", "type": "directory"}))
        with self.assertRaisesRegex(ValueError, "Directory expansion limit"):
            references(self.root, self.task, "implement")

    def test_historical_research_text_is_readable_not_collectible_policy(self):
        for suffix in (".txt", ".json", ".jsonl", ".csv", ".log"):
            self.put(self.task + "/research/history" + suffix, "historical text")
        self.put(self.task + "/implement.jsonl", json.dumps({"file": self.task + "/research", "type": "directory"}))
        self.assertEqual(len(references(self.root, self.task, "implement")), 5)

    def test_task_alias_directory_cycle_and_escape_rejected_without_writes(self):
        task_dir = self.root / self.task
        alias = self.root / ".trellis/tasks/other"
        task_dir.rename(alias)
        task_dir.symlink_to(alias, target_is_directory=True)
        with self.assertRaisesRegex(ValueError, "symlink"):
            source_materials(self.root, self.task, "implement")
        task_dir.unlink()
        alias.rename(task_dir)
        self.put(self.task + "/research/x.md", "x")
        (task_dir / "research/cycle").symlink_to(task_dir / "research", target_is_directory=True)
        self.put(self.task + "/implement.jsonl", json.dumps({"file": self.task + "/research", "type": "directory"}))
        with self.assertRaisesRegex(ValueError, "symlink"):
            references(self.root, self.task, "implement")
        self.assertEqual((task_dir / "research/x.md").read_text(), "x")

    def test_external_top_level_task_store_only(self):
        external = self.root / "external"
        (self.root / ".trellis/tasks").rename(external)
        (self.root / ".trellis/tasks").symlink_to(external, target_is_directory=True)
        self.assertEqual(source_materials(self.root, self.task, "implement")["taskPath"], str(external / "test"))
        self.assertEqual((external / "test/prd.md").read_text(), "requirements")

    @unittest.skipUnless(hasattr(os, "mkfifo"), "POSIX special-file fixture")
    def test_reader_rejects_special_file_before_open(self):
        label = self.task + "/research/pipe.md"
        path = self.root / label
        path.parent.mkdir(parents=True, exist_ok=True)
        os.mkfifo(path)
        with self.assertRaisesRegex(ValueError, "regular file"):
            read_material(self.root, self.task, label)

    def test_live_owner_and_lock_are_conservative(self):
        self.assertTrue(owner_alive({"ownerPid": os.getpid()}))
        with source_lock(self.root):
            with self.assertRaisesRegex(ValueError, "locked"):
                with source_lock(self.root):
                    self.fail("must not enter")
        self.assertFalse((self.root / ".trellis/.runtime/pi-trellis/worktrees.lock").exists())


if __name__ == "__main__":
    unittest.main()
