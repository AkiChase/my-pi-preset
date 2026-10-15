import contextlib
import io
import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

sys.dont_write_bytecode = True
sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'runtime'))
from common import config
from common.paths import developer_from_text, _read_developer_file
from common.trellis_config import parse_simple_yaml
from common.workflow_phase import phase_index_from_text, get_phase_index
import diagnostics


class DiagnosticsTests(unittest.TestCase):
    def test_snapshot_getters_match_actual_default_getters_without_reopen(self):
        text = '''context_injection:
  max_file_bytes: 0
  max_artifact_bytes: '+1'
  max_total_bytes: -1
max_journal_lines: -9
session_auto_commit: yes
packages:
  good:
    path: src
  ignored: scalar
default_package: missing
hooks:
  after_start:
    - private-command
  after_archive: invalid
session:
  spec_scope: active_task
'''
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / '.trellis').mkdir()
            (root / '.trellis/config.yaml').write_text(text)
            snapshot = parse_simple_yaml(text)
            for getter in (config.get_max_journal_lines, config.get_session_auto_commit,
                           config.get_context_injection_limits, config.get_packages,
                           config.get_default_package, config.get_spec_scope):
                with contextlib.redirect_stderr(io.StringIO()):
                    ordinary = getter(root)
                    with patch.object(Path, 'read_text', side_effect=AssertionError('snapshot must not reopen')):
                        self.assertEqual(ordinary, getter(root, snapshot=snapshot))
            with contextlib.redirect_stderr(io.StringIO()):
                self.assertEqual(config.get_hooks('after_start', root), config.get_hooks('after_start', snapshot=snapshot))
                self.assertEqual([], config.get_hooks('after_archive', snapshot=snapshot))

    def test_identity_and_phase_pure_helpers_preserve_ordinary_semantics(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            identity = root / '.developer'
            identity.write_text('initialized_at=old\nname=Name Unicode 李\nname=historical duplicate\n')
            self.assertEqual(_read_developer_file(identity), developer_from_text(identity.read_text()))
            self.assertEqual('Env Name', developer_from_text('name=Local\n', 'Env Name'))
            with self.assertRaises(ValueError): developer_from_text(None, '../bad')
            text = 'heading\n## Phase Index\n1. Plan\n## Phase 1: Plan\nbody\n'
            with patch('common.workflow_phase._read_workflow', return_value=text):
                self.assertEqual(get_phase_index(), phase_index_from_text(text))

    def test_consumer_runs_no_disk_subprocess_hook_history_or_material_read(self):
        row = lambda value: {'text': value, 'error': None}
        snapshots = {'config': row('hooks:\n  after_start:\n    - SECRET\nunknown: harmless\n'), 'identity': row('name=Fixture\n'),
                     'workflow': row('## Phase Index\nPlan\n## Phase 1: Plan\n'), 'workspace': row('index')}
        with patch.object(Path, 'open', side_effect=AssertionError('no file opens')), patch.object(Path, 'read_text', side_effect=AssertionError('no reopen')), patch('subprocess.run', side_effect=AssertionError('no subprocess')), patch('tempfile.TemporaryFile', side_effect=AssertionError('no tempfile')):
            value = diagnostics.collect(snapshots, None)
        self.assertNotIn('current', value)
        self.assertEqual(1, value['configuration']['hooks']['after_start'])
        self.assertNotIn('SECRET', json.dumps(value))
        self.assertGreater(value['workflow']['phaseBytes'], 0)

    def test_subset_metadata_reports_duplicate_and_unsupported_without_raw_text(self):
        issues = []
        with contextlib.redirect_stderr(io.StringIO()):
            parsed = parse_simple_yaml('x: 1\nx: 2\nsecret: [private]\ninvalid-line\n', issues=issues)
        self.assertEqual('2', parsed['x'])
        self.assertNotIn('secret', parsed)
        self.assertEqual(3, len(issues))
        self.assertNotIn('private', json.dumps(issues))


if __name__ == '__main__': unittest.main()
