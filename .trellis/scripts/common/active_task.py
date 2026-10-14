#!/usr/bin/env python3
# SPDX-License-Identifier: AGPL-3.0-only
# Derived from @mindfoldhq/trellis 0.6.16 (Mindfold LLC).
# Maintained/adapted for Pi by pi-trellis; see resources/runtime-baseline.json.
"""Session-scoped active task resolution.

The user-facing concept is a single "active task". Trellis stores that pointer
per AI session/window under `.trellis/.runtime/sessions/`; without a stable
session key there is no active task.
"""

from __future__ import annotations

import os
import re
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from .io import write_json as _io_write_json

DIR_WORKFLOW = ".trellis"
DIR_TASKS = "tasks"
DIR_RUNTIME = ".runtime"
DIR_SESSIONS = "sessions"
_SESSION_KEYS = ("session_id", "sessionId", "sessionID")
_CONVERSATION_KEYS = ("conversation_id", "conversationId", "conversationID")
_TRANSCRIPT_KEYS = ("transcript_path", "transcriptPath", "transcript")
_NESTED_KEYS = ("input", "properties", "event", "hook_input", "hookInput")
_KNOWN_PLATFORMS = {
    "claude",
    "codex",
    "cursor",
    "opencode",
    "gemini",
    "droid",
    "qoder",
    "codebuddy",
    "kiro",
    "copilot",
    "pi",
    "trae",
    "grok",
    "kimi",
    "zcode",
    "snow",
    "dsh",
}

@dataclass(frozen=True)
class ActiveTask:
    """Resolved active task state."""

    task_path: str | None
    source_type: str
    context_key: str | None = None
    stale: bool = False
    error: str | None = None
    raw_ref: str | None = None
    state: str = "valid"

    @property
    def valid(self) -> bool:
        return bool(self.task_path) and not self.stale and not self.error

    @property
    def source(self) -> str:
        """Human-readable source label."""
        if self.source_type == "session" and self.context_key:
            return f"session:{self.context_key}"
        if self.source_type == "session-fallback" and self.context_key:
            return f"session-fallback:{self.context_key}"
        return self.source_type


def normalize_task_ref(task_ref: str) -> str:
    """Normalize a task ref for stable storage and comparison."""
    normalized = task_ref.strip()
    if not normalized:
        return ""

    path_obj = Path(normalized)
    if path_obj.is_absolute():
        return str(path_obj)

    normalized = normalized.replace("\\", "/")
    while normalized.startswith("./"):
        normalized = normalized[2:]

    if normalized.startswith(f"{DIR_TASKS}/"):
        return f"{DIR_WORKFLOW}/{normalized}"

    return normalized


def resolve_task_ref(task_ref: str, repo_root: Path) -> Path | None:
    from .task_records import resolve_task_ref as resolve
    return resolve(task_ref, repo_root)


def _runtime_sessions_dir(repo_root: Path) -> Path:
    """Session state is local, unlike the explicit source task-store exception."""
    root = repo_root.resolve()
    directory = root
    for part in (DIR_WORKFLOW, DIR_RUNTIME, DIR_SESSIONS):
        directory = directory / part
        if directory.is_symlink() or (directory.exists() and not directory.is_dir()):
            raise ValueError("Session runtime directories must be local, not symlinked")
        if not directory.resolve().is_relative_to(root):
            raise ValueError("Session runtime leaves its project")
    return directory


def _sanitize_key(raw: str) -> str:
    safe = re.sub(r"[^A-Za-z0-9._-]+", "_", raw.strip())
    safe = safe.strip("._-")
    return safe[:160] if safe else ""


def _as_dict(value: Any) -> dict[str, Any] | None:
    return value if isinstance(value, dict) else None


def _string_value(value: Any) -> str | None:
    if isinstance(value, str):
        stripped = value.strip()
        return stripped or None
    return None


def _lookup_string(data: dict[str, Any], keys: tuple[str, ...]) -> str | None:
    for key in keys:
        value = _string_value(data.get(key))
        if value:
            return value

    for nested_key in _NESTED_KEYS:
        nested = _as_dict(data.get(nested_key))
        if not nested:
            continue
        value = _lookup_string(nested, keys)
        if value:
            return value

    return None


def _detect_platform(platform_input: dict[str, Any] | None, platform: str | None) -> str:
    if platform:
        return _sanitize_key(platform) or "session"
    if platform_input:
        for key in ("_trellis_platform", "trellis_platform", "platform", "source"):
            value = _string_value(platform_input.get(key))
            if value:
                return _sanitize_key(value) or "session"
        if _string_value(platform_input.get("cursor_version")):
            return "cursor"
    return "session"


def _remove_file(path: Path) -> bool:
    try:
        path.unlink()
        return True
    except OSError:
        return False


def resolve_context_key(
    platform_input: dict[str, Any] | None = None,
    platform: str | None = None,
    *,
    allow_environment_context: bool = True,
) -> str | None:
    """Resolve a stable session/window context key, if one is available.

    Pi derives and supplies TRELLIS_CONTEXT_ID to every CLI/subprocess.
    This fixed runtime never infers other platforms, tickets or sessions.
    The override does not store the task itself.
    """
    if allow_environment_context:
        raw_override = os.environ.get("TRELLIS_CONTEXT_ID")
        if raw_override is not None:
            override = raw_override.strip()
            if not override:
                return None
            if not re.fullmatch(r"[A-Za-z0-9_-]{1,128}", override):
                raise ValueError("Invalid TRELLIS_CONTEXT_ID; expected [A-Za-z0-9_-]{1,128}")
            return override

    return None


def _read_json(path: Path) -> dict[str, Any] | None:
    """Tolerant read of a session runtime file, non-objects included."""
    try:
        if path.is_symlink() or not path.is_file():
            return None
        import json
        with path.open("rb") as stream:
            raw = stream.read(1024 * 1024 + 1)
        if len(raw) > 1024 * 1024:
            return None
        data = json.loads(raw.decode("utf-8"))
        return data if isinstance(data, dict) else None
    except (OSError, ValueError, UnicodeError, RecursionError):
        return None


def _write_json(path: Path, data: dict[str, Any]) -> bool:
    """Write a session runtime file atomically, creating the runtime dir.

    Routes through io.write_json so session pointers get the same
    temp-file-then-rename treatment as task.json (#429). A plain write_text
    truncates the target first, so a crash mid-write would leave a session
    file that reads back as no active task.
    """
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
    except OSError:
        return False
    return _io_write_json(path, data)


def _canonical_task_ref(task_path: str, repo_root: Path) -> str | None:
    normalized = normalize_task_ref(task_path)
    if not normalized:
        return None
    full_path = resolve_task_ref(normalized, repo_root)
    if full_path is None:
        return None
    from .task_records import read_task_record
    if read_task_record(full_path, repo_root)[0] is None:
        return None
    try:
        return full_path.relative_to(repo_root.resolve()).as_posix()
    except ValueError:
        # resolve_task_ref already refused everything outside the repo, so this
        # is unreachable. Refuse rather than fall back to an absolute path —
        # that fallback is how an out-of-repo ref used to reach the session
        # pointer and get replayed on every later turn.
        return None


def _relative_task_ref(task_path: str, repo_root: Path) -> str:
    """Repo-relative posix ref for a task path that need not exist.

    `_canonical_task_ref` resolves through the filesystem and so refuses a task
    directory that has been moved away. Rename needs to name both sides of the
    move, one of which is always absent.
    """
    normalized = normalize_task_ref(task_path)
    if not normalized:
        return ""
    candidate = Path(normalized)
    if not candidate.is_absolute():
        return normalized
    try:
        resolved = candidate.resolve()
        root = repo_root.resolve()
        workflow_real = (root / DIR_WORKFLOW).resolve()
    except OSError:
        return ""
    try:
        return resolved.relative_to(root).as_posix()
    except ValueError:
        pass
    # Same dual-base containment as resolve_task_ref: a path through a
    # symlinked `.trellis` (#567) maps back to its in-repo form; anything
    # outside both bases is refused rather than stored as an absolute pointer.
    try:
        rel = resolved.relative_to(workflow_real)
    except ValueError:
        return ""
    return (Path(DIR_WORKFLOW) / rel).as_posix()


def _active_from_ref(task_ref: str | None, repo_root: Path, source_type: str,
                     context_key: str | None = None) -> ActiveTask | None:
    if not task_ref:
        return None
    from .task_records import read_task_record
    resolved = resolve_task_ref(task_ref, repo_root)
    if resolved is None:
        return ActiveTask(None, source_type, context_key, True,
                          "Task reference leaves its task store", task_ref, "invalid-task")
    data, error = read_task_record(resolved, repo_root)
    if error:
        return ActiveTask(None, source_type, context_key, True, error, task_ref, "invalid-task")
    canonical = resolved.relative_to(repo_root.resolve()).as_posix()
    return ActiveTask(canonical, source_type, context_key, raw_ref=task_ref)


def _context_path(repo_root: Path, context_key: str) -> Path:
    return _runtime_sessions_dir(repo_root) / f"{context_key}.json"


def resolve_active_task(repo_root: Path, platform_input: dict[str, Any] | None = None,
                        platform: str | None = None, *,
                        allow_single_session_fallback: bool = False,
                        allow_environment_context: bool = True) -> ActiveTask:
    """Strict own-key resolution. Compatibility flags never permit inference."""
    try:
        key = resolve_context_key(platform_input, platform,
                                  allow_environment_context=allow_environment_context)
    except ValueError as error:
        return ActiveTask(None, "none", error=str(error), state="invalid-identity")
    if not key:
        return ActiveTask(None, "none", state="no-identity")
    try:
        path = _context_path(repo_root, key)
    except (OSError, ValueError, RuntimeError) as error:
        return ActiveTask(None, "session", key, error=str(error), state="invalid-pointer")
    if not path.exists() and not path.is_symlink():
        return ActiveTask(None, "session", key, state="no-task")
    try:
        if path.is_symlink() or not path.is_file():
            raise ValueError("Session pointer must be a local regular file")
        import json
        with path.open("rb") as stream:
            raw = stream.read(1024 * 1024 + 1)
        if len(raw) > 1024 * 1024:
            raise ValueError("Session pointer exceeds 1 MiB")
        context = json.loads(raw.decode("utf-8"))
        if not isinstance(context, dict):
            raise ValueError("Session pointer must contain an object")
        ref = context.get("current_task")
        if ref is None or ref == "":
            return ActiveTask(None, "session", key, state="no-task")
        if not isinstance(ref, str):
            raise ValueError("Session current_task must be a string or null")
    except (OSError, ValueError, UnicodeError, RecursionError) as error:
        return ActiveTask(None, "session", key, error=str(error), state="invalid-pointer")
    return _active_from_ref(ref, repo_root, "session", key)


def _utc_now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def _context_metadata(
    platform_input: dict[str, Any] | None,
    platform: str | None,
    context_key: str | None = None,
) -> dict[str, Any]:
    data = _as_dict(platform_input) or {}
    platform_name = _detect_platform(data, platform)
    if platform_name == "session" and context_key:
        prefix = context_key.split("_", 1)[0]
        if prefix in _KNOWN_PLATFORMS:
            platform_name = prefix
    metadata: dict[str, Any] = {
        "platform": platform_name,
        "last_seen_at": _utc_now(),
    }
    for key in (*_SESSION_KEYS, *_CONVERSATION_KEYS, *_TRANSCRIPT_KEYS):
        value = _lookup_string(data, (key,))
        if value:
            metadata[key] = value
    return metadata


def set_active_task(
    task_path: str,
    repo_root: Path,
    platform_input: dict[str, Any] | None = None,
    platform: str | None = None,
) -> ActiveTask | None:
    """Set the active task in session scope.

    Returns None when no context key is available; callers should surface a
    user-facing error that explains how to provide session identity.
    """
    canonical = _canonical_task_ref(task_path, repo_root)
    if canonical is None:
        return None

    context_key = resolve_context_key(platform_input, platform)
    if not context_key:
        return None

    try:
        context_path = _context_path(repo_root, context_key)
    except (OSError, ValueError, RuntimeError):
        return None
    if context_path.is_symlink() or (context_path.exists() and not context_path.is_file()):
        return None
    context = _read_json(context_path) or {}
    context.update(_context_metadata(platform_input, platform, context_key))
    context["current_task"] = canonical
    context.setdefault("current_run", None)
    if not _write_json(context_path, context):
        return None
    return ActiveTask(canonical, "session", context_key)


def clear_active_task(repo_root: Path, platform_input: dict[str, Any] | None = None,
                      platform: str | None = None) -> ActiveTask:
    """Unlink only own key; return authorization only after successful removal."""
    key = resolve_context_key(platform_input, platform)
    if not key:
        return ActiveTask(None, "none", state="no-identity")
    previous = resolve_active_task(repo_root, platform_input, platform)
    path = _context_path(repo_root, key)
    try:
        path.unlink()
    except FileNotFoundError:
        return ActiveTask(None, "session", key, state="no-task")
    except OSError as error:
        raise RuntimeError(f"Failed to clear own session pointer: {error}") from error
    return previous


def clear_task_from_sessions(task_path: str, repo_root: Path) -> int:
    """Delete all session runtime files that point at a task."""
    target = _canonical_task_ref(task_path, repo_root) or normalize_task_ref(task_path)
    if not target:
        return 0

    cleared = 0
    sessions_dir = _runtime_sessions_dir(repo_root)
    if not sessions_dir.is_dir():
        return cleared

    for session_path in sessions_dir.glob("*.json"):
        context = _read_json(session_path) or {}
        current = _string_value(context.get("current_task"))
        if not current:
            continue
        current_ref = _canonical_task_ref(current, repo_root) or normalize_task_ref(current)
        if current_ref != target:
            continue
        if session_path.is_file() and _remove_file(session_path):
            cleared += 1

    return cleared


def repoint_task_in_sessions(old_path: str, new_path: str, repo_root: Path) -> int:
    """Move every session pointer from `old_path` to `new_path`.

    Rename is the one lifecycle step where the task survives under a different
    name, so clearing the pointers (what archive does) would be wrong: the user
    would silently lose their active task and have to run `task.py start`
    again to get context injection back. Repointing keeps the session valid
    across the rename.
    """
    # Not `_canonical_task_ref`: the caller repoints *after* moving the
    # directory, so `old_path` no longer exists and canonicalization — which
    # requires an existing directory — would return None for exactly the ref we
    # need to match.
    target = _relative_task_ref(old_path, repo_root)
    replacement = _relative_task_ref(new_path, repo_root)
    if not target or not replacement:
        return 0

    moved = 0
    sessions_dir = _runtime_sessions_dir(repo_root)
    if not sessions_dir.is_dir():
        return moved

    for session_path in sorted(sessions_dir.glob("*.json")):
        context = _read_json(session_path)
        if not context:
            continue
        current = _string_value(context.get("current_task"))
        if not current:
            continue
        current_ref = _canonical_task_ref(current, repo_root) or _relative_task_ref(
            current, repo_root
        )
        if current_ref != target:
            continue
        context["current_task"] = replacement
        if _write_json(session_path, context):
            moved += 1

    return moved


def get_current_task_source(
    repo_root: Path,
    platform_input: dict[str, Any] | None = None,
    platform: str | None = None,
) -> tuple[str, str | None, str | None]:
    """Return (`source_type`, `context_key`, `task_path`) for compatibility."""
    active = resolve_active_task(repo_root, platform_input, platform)
    return active.source_type, active.context_key, active.task_path
