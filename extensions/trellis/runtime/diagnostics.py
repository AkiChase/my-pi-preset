# SPDX-License-Identifier: AGPL-3.0-only
# Composes pi-trellis-maintained Trellis 0.6.16 shared consumers.
"""Internal deployment diagnostics. No disk reads, subprocesses or lifecycle."""
from __future__ import annotations

import contextlib
from common.paths import developer_from_text
from common import config as consumer
from common.trellis_config import parse_simple_yaml
from common.workflow_phase import phase_index_from_text, filter_platform


class _DiscardWarnings:
    def write(self, text): return len(text)
    def flush(self): pass


def collect(snapshots: dict, env_developer: str | None) -> dict:
    """Safely captured text is passed to the actual production leaf consumers."""
    if set(snapshots) != {'config', 'identity', 'workflow', 'workspace'}:
        raise ValueError('Invalid consumer snapshot schema')
    def text(name):
        row = snapshots[name]
        if not isinstance(row, dict) or set(row) != {'text', 'error'}:
            raise ValueError('Invalid text snapshot')
        if row['text'] is not None and (not isinstance(row['text'], str) or len(row['text'].encode('utf-8')) > 4 * 1024 * 1024):
            raise ValueError('Invalid bounded snapshot text')
        if row['error'] is not None and not isinstance(row['error'], str):
            raise ValueError('Invalid snapshot error')
        return row['text'], row['error']
    cfg_text, cfg_error = text('config')
    parser_issues = []
    # Existing parser/getters warn with raw values. Diagnostics retains only shape/line metadata,
    # never stderr text, hook bodies, journal messages or arbitrary config values.
    with contextlib.redirect_stderr(_DiscardWarnings()):
        try:
            cfg = parse_simple_yaml(cfg_text or '', issues=parser_issues)
        except Exception:
            cfg, cfg_error = {}, 'YAML subset parse failed; defaults used'
        limits = consumer.get_context_injection_limits(snapshot=cfg)
        journal = consumer.get_max_journal_lines(snapshot=cfg)
        auto_commit = consumer.get_session_auto_commit(snapshot=cfg)
        packages = consumer.get_packages(snapshot=cfg)
        default_package = consumer.get_default_package(snapshot=cfg)
        spec_scope = consumer.get_spec_scope(snapshot=cfg)
        hooks = {event: len(consumer.get_hooks(event, snapshot=cfg)) for event in ('after_create', 'after_start', 'after_deactivate', 'after_archive')}
    ignored = []
    section = cfg.get('context_injection')
    defaults = {'max_file_bytes': 32768, 'max_artifact_bytes': 65536, 'max_total_bytes': 131072}
    if section is not None and not isinstance(section, dict):
        ignored.append('context_injection: expected mapping; defaults used')
    elif isinstance(section, dict):
        for field in defaults:
            if field not in section: continue
            try: valid = int(section[field]) >= 0
            except (ValueError, TypeError): valid = False
            if not valid: ignored.append('context_injection.' + field + ': ignored; default used')
    raw_bool = cfg.get('session_auto_commit', True)
    if not isinstance(raw_bool, bool) and str(raw_bool).strip().lower() not in consumer.TRUE_CONFIG_VALUES + consumer.FALSE_CONFIG_VALUES:
        ignored.append('session_auto_commit: ignored; default used')
    hook_cfg = cfg.get('hooks')
    if hook_cfg is not None and not isinstance(hook_cfg, dict): ignored.append('hooks: expected mapping; ignored')
    elif isinstance(hook_cfg, dict):
        for event in hooks:
            if event in hook_cfg and not isinstance(hook_cfg[event], list): ignored.append('hooks.' + event + ': expected list; ignored')
    if default_package and (not packages or default_package not in packages): ignored.append('default_package: not declared; inferred selection ignored')
    identity_text, identity_error = text('identity')
    developer = None
    if not identity_error or env_developer:
        try: developer = developer_from_text(identity_text, env_developer or '')
        except ValueError: identity_error = 'Invalid developer identity'
    workflow_text, workflow_error = text('workflow')
    phase = filter_platform(phase_index_from_text(workflow_text or ''), 'pi')
    workspace_text, workspace_error = text('workspace')
    return {
        'configuration': {'readError': cfg_error, 'parserIssues': parser_issues[:64], 'ignored': ignored[:64], 'limits': limits,
                          'journalLines': journal, 'autoCommit': auto_commit, 'packageCount': len(packages or {}),
                          'specScopeKind': 'list' if isinstance(spec_scope, list) else 'string' if isinstance(spec_scope, str) else 'default', 'hooks': hooks},
        'identity': {'developer': developer, 'source': 'environment' if env_developer else 'local' if developer else 'unresolved',
                     'error': identity_error, 'workspace': bool(workspace_text), 'workspaceError': workspace_error},
        'workflow': {'phaseBytes': len(phase.encode('utf-8')) if phase_index_from_text(workflow_text or '') else 0, 'error': workflow_error},
    }
