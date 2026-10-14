# SPDX-License-Identifier: AGPL-3.0-only
# Shared validation for the pi-trellis-maintained Trellis runtime.
"""Task authorization and bounded read projections; raw refs are never paths."""
from __future__ import annotations

import json
import os
import unicodedata
from pathlib import Path

MAX_RECORD_BYTES = 1024 * 1024
MAX_FIELD_CHARS = 8192
MAX_CHILDREN = 512


def safe_segment(value: object) -> bool:
    return (isinstance(value, str) and bool(value.strip()) and len(value) <= 255
            and value.strip() not in (".", "..") and not any(c in value for c in "/\\")
            and not any(unicodedata.category(c) in ("Cc", "Cf", "Cs") for c in value))


def resolve_task_ref(task_ref: str, repo_root: Path) -> Path | None:
    """Require both lexical tasks/ route and containment in its resolved store.

    The top-level task store may be external. An absolute external store path
    alone is not authorization; callers must spell the project's tasks/ route.
    Missing descendants are resolved without granting record validity.
    """
    if not isinstance(task_ref, str) or not task_ref.strip() or len(task_ref) > MAX_FIELD_CHARS:
        return None
    if any(unicodedata.category(c) in ("Cc", "Cs") for c in task_ref):
        return None
    ref = task_ref.strip().replace("\\", "/")
    while ref.startswith("./"):
        ref = ref[2:]
    root = repo_root.resolve()
    tasks = root / ".trellis/tasks"
    if ref.startswith("tasks/"):
        ref = ".trellis/" + ref
    candidate = Path(ref)
    if not candidate.is_absolute():
        candidate = root / candidate if ref.startswith(".trellis/") else tasks / candidate
    # abspath is lexical, unlike resolve which follows the task-store symlink.
    candidate = Path(os.path.abspath(candidate))
    try:
        if candidate == tasks or not candidate.is_relative_to(tasks):
            return None
        store = tasks.resolve(strict=True)
        actual = candidate.resolve()
        if actual == store or not actual.is_relative_to(store):
            return None
        return candidate
    except (OSError, RuntimeError, ValueError):
        return None


def read_task_record(task_dir: Path, repo_root: Path) -> tuple[dict | None, str | None]:
    """Read only an authorized task.json (1 MiB), retaining write-back fields."""
    candidate = resolve_task_ref(str(task_dir), repo_root)
    if candidate is None:
        return None, "Task path leaves its task store"
    try:
        if not candidate.is_dir():
            return None, "Task directory is missing"
        file = candidate / "task.json"
        store = (repo_root.resolve() / ".trellis/tasks").resolve(strict=True)
        actual = file.resolve(strict=True)
        if not actual.is_relative_to(store):
            return None, "task.json leaves its task store"
        if not actual.is_file():
            return None, "task.json is not a regular file"
        with actual.open("rb") as stream:
            raw = stream.read(MAX_RECORD_BYTES + 1)
        if len(raw) > MAX_RECORD_BYTES:
            return None, "task.json exceeds 1 MiB"
        data = json.loads(raw.decode("utf-8"))
    except (OSError, RuntimeError, ValueError, UnicodeError, RecursionError) as error:
        return None, f"task.json is missing, unreadable or invalid: {error}"
    if not isinstance(data, dict) or not data:
        return None, "task.json must be a nonempty object"
    if not any(k in data for k in ("id", "name", "title", "status")):
        return None, "task.json has no task identity/status fields"
    for key in ("id", "name", "title", "status"):
        if key in data and (not isinstance(data[key], str) or not data[key].strip()
                            or len(data[key]) > (128 if key == "status" else MAX_FIELD_CHARS)):
            return None, f"task.json has invalid {key}"
    return data, None


def string_field(data: dict, key: str, default=None):
    value = data.get(key)
    return value if isinstance(value, str) and len(value) <= MAX_FIELD_CHARS else default


def children_field(data: dict) -> list[str]:
    value = data.get("children")
    if not isinstance(value, list):
        return []
    return [c for c in value[:MAX_CHILDREN] if safe_segment(c)]


def task_projection(data: dict) -> dict:
    """Optional malformed fields do not break read-only context enumeration."""
    result = {key: string_field(data, key) for key in (
        "id", "name", "title", "status", "branch", "base_branch", "parent", "package",
        "assignee", "priority", "description", "createdAt")}
    for key in ("parent", "package"):
        if not safe_segment(result[key]):
            result[key] = None
    result["children"] = children_field(data)
    return result
