# SPDX-License-Identifier: AGPL-3.0-only
# Derived from @mindfoldhq/trellis 0.6.16 (Mindfold LLC).
# Maintained/adapted for Pi by pi-trellis; see resources/runtime-baseline.json.
"""
Task data access layer.

Single source of truth for loading and iterating task directories.
Replaces scattered task.json parsing across 9+ files.

Provides:
    load_task          — Load a single task by directory path
    iter_active_tasks  — Iterate all non-archived tasks (sorted)
    get_all_statuses   — Get {dir_name: status} map for children progress
"""

from __future__ import annotations

import sys
from collections.abc import Iterator
from pathlib import Path

from .io import describe_json_read_failure, read_json_checked
from .paths import FILE_TASK_JSON
from .types import TaskInfo
from .task_records import read_task_record, task_projection
from .paths import get_repo_root


def load_task(task_dir: Path, repo_root: Path | None = None) -> TaskInfo | None:
    """Load task from a directory containing task.json.

    Args:
        task_dir: Absolute path to the task directory.

    Returns:
        TaskInfo if task.json exists and is valid, None otherwise.

    A directory without task.json is not a task, so it is skipped silently.
    A task.json that exists but cannot be loaded is different: the task
    disappears from `task.py list` and from every context the iterator feeds.
    Callers stay tolerant, but the skip is announced on stderr so a task
    cannot vanish from the workflow with no diagnostic anywhere.
    """
    task_json = task_dir / FILE_TASK_JSON
    if not task_json.is_file():
        return None

    data, reason = read_task_record(task_dir, repo_root or get_repo_root())
    if data is None:
        problem, hint = describe_json_read_failure(task_json, reason)
        print(f"[WARN] Skipping task '{task_dir.name}': {problem}", file=sys.stderr)
        print(f"       {hint}", file=sys.stderr)
        return None

    view = task_projection(data)
    return TaskInfo(
        dir_name=task_dir.name,
        directory=task_dir,
        title=view.get("title") or view.get("name") or "unknown",
        status=view.get("status") or "unknown",
        assignee=view.get("assignee") or "",
        priority=view.get("priority") or "P2",
        children=tuple(view["children"]),
        parent=view["parent"],
        package=view["package"],
        raw=data,
    )


def iter_active_tasks(tasks_dir: Path) -> Iterator[TaskInfo]:
    """Iterate all active (non-archived) tasks, sorted by directory name.

    Skips the "archive" directory and directories without valid task.json.

    Args:
        tasks_dir: Path to the tasks directory.

    Yields:
        TaskInfo for each valid task.
    """
    if not tasks_dir.is_dir():
        return

    for d in sorted(tasks_dir.iterdir()):
        if not d.is_dir() or d.name == "archive":
            continue
        info = load_task(d, tasks_dir.parent.parent)
        if info is not None:
            yield info


def get_all_statuses(tasks_dir: Path) -> dict[str, str]:
    """Get a {dir_name: status} mapping for all active tasks.

    Useful for computing children progress without loading full TaskInfo.

    Args:
        tasks_dir: Path to the tasks directory.

    Returns:
        Dict mapping directory names to status strings.
    """
    return {t.dir_name: t.status for t in iter_active_tasks(tasks_dir)}


def children_progress(
    children: tuple[str, ...] | list[str],
    all_statuses: dict[str, str],
) -> str:
    """Format children progress string like " [2/3 done]".

    Args:
        children: List of child directory names.
        all_statuses: Status map from get_all_statuses().

    Returns:
        Formatted string, or "" if no children.
    """
    if not children:
        return ""
    # A child missing from active statuses has been archived (cmd_archive
    # sets status=completed before moving the dir). Count it as done so
    # parent progress doesn't regress when children are archived.
    done = sum(
        1 for c in children
        if c not in all_statuses or all_statuses.get(c) in ("completed", "done")
    )
    return f" [{done}/{len(children)} done]"
