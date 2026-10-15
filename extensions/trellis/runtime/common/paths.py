#!/usr/bin/env python3
# SPDX-License-Identifier: AGPL-3.0-only
# Derived from @mindfoldhq/trellis 0.6.16 (Mindfold LLC).
# Maintained/adapted for Pi by pi-trellis; see resources/runtime-baseline.json.
"""
Common path utilities for Trellis workflow.

Provides:
    get_repo_root          - Get repository root directory
    get_developer          - Get developer name
    get_workspace_dir      - Get developer workspace directory
    get_tasks_dir          - Get tasks directory
    get_active_journal_file - Get current journal file
"""

from __future__ import annotations

import os
import re
from datetime import datetime
from pathlib import Path

from .git import main_worktree_root
from .task_records import safe_segment


# =============================================================================
# Path Constants (change here to rename directories)
# =============================================================================

# Directory names
DIR_WORKFLOW = ".trellis"
DIR_WORKSPACE = "workspace"
DIR_TASKS = "tasks"
DIR_ARCHIVE = "archive"
DIR_SPEC = "spec"
DIR_SCRIPTS = "scripts"

# File names
FILE_DEVELOPER = ".developer"
FILE_CURRENT_TASK = ".current-task"
FILE_TASK_JSON = "task.json"
FILE_JOURNAL_PREFIX = "journal-"

# Environment override for the developer identity, ahead of the .developer file.
ENV_DEVELOPER = "TRELLIS_DEVELOPER"

# Appended to every "no developer set" error so the two non-obvious sources are
# discoverable from the failure itself.
DEVELOPER_HINT = (
    f"  Or set {ENV_DEVELOPER}=<your-name> in the environment.\n"
    f"  A linked git worktree inherits {DIR_WORKFLOW}/{FILE_DEVELOPER} from its "
    f"main checkout — run init_developer.py there to cover every worktree."
)


# =============================================================================
# Repository Root
# =============================================================================

def get_repo_root(start_path: Path | None = None) -> Path:
    """Find the nearest directory containing .trellis/ folder.

    This handles nested git repos correctly (e.g., test project inside another repo).

    Args:
        start_path: Starting directory to search from. Defaults to current directory.

    Returns:
        Path to repository root, or current directory if no .trellis/ found.
    """
    current = (start_path or Path.cwd()).resolve()

    while current != current.parent:
        if (current / DIR_WORKFLOW).is_dir():
            return current
        current = current.parent

    # Fallback to current directory if no .trellis/ found
    return Path.cwd().resolve()


# =============================================================================
# Developer
# =============================================================================

def _read_developer_file(dev_file: Path) -> str | None:
    """Read the `name=` field out of a .developer file, or None."""
    if dev_file.is_symlink() or (dev_file.exists() and not dev_file.is_file()):
        raise ValueError("Developer identity must be a regular file, not symlinked")
    if not dev_file.is_file():
        return None

    try:
        content = dev_file.read_text(encoding="utf-8")
    except (OSError, IOError):
        return None

    return developer_from_text(content)


def developer_from_text(content: str | None, env_name: str = "") -> str | None:
    """Parse an identity snapshot with the ordinary runtime precedence."""
    if env_name:
        if not safe_segment(env_name):
            raise ValueError("Invalid TRELLIS_DEVELOPER; expected a safe single directory segment")
        return env_name.strip()
    if content is None:
        return None
    for line in content.splitlines():
        if line.startswith("name="):
            name = line.split("=", 1)[1]
            if not safe_segment(name):
                raise ValueError("Invalid developer identity; expected a safe single directory segment")
            return name.strip()

    return None


def get_developer(repo_root: Path | None = None) -> str | None:
    """Get the developer name for this checkout.

    Resolution order, first hit wins (a CLI `--assignee` flag overrides all of
    it, before this function is ever called):

        1. The ``TRELLIS_DEVELOPER`` environment variable.
        2. ``.trellis/.developer`` in this checkout.
        3. ``.trellis/.developer`` in the main checkout, when this checkout is a
           linked git worktree.

    Step 3 exists because `.developer` is gitignored on purpose — it carries a
    personal identity and no tracked file should. A fresh `git worktree add`
    therefore starts with no identity file of its own, which used to make every
    task.py command fail until init_developer.py was re-run per worktree. The
    main checkout's file is read, never copied: a copy would go stale and shadow
    later changes made in the main checkout.

    Args:
        repo_root: Repository root path. Defaults to auto-detected.

    Returns:
        Developer name or None if not initialized.
    """
    env_name = os.environ.get(ENV_DEVELOPER, "")
    if env_name:
        return developer_from_text(None, env_name)

    if repo_root is None:
        repo_root = get_repo_root()

    local = _read_developer_file(repo_root / DIR_WORKFLOW / FILE_DEVELOPER)
    if local:
        return local

    main_root = main_worktree_root(repo_root)
    if main_root is None:
        return None

    return _read_developer_file(main_root / DIR_WORKFLOW / FILE_DEVELOPER)


def check_developer(repo_root: Path | None = None) -> bool:
    """Check if developer is initialized.

    Args:
        repo_root: Repository root path. Defaults to auto-detected.

    Returns:
        True if developer is initialized.
    """
    return get_developer(repo_root) is not None


# =============================================================================
# Tasks Directory
# =============================================================================

def get_tasks_dir(repo_root: Path | None = None) -> Path:
    """Get tasks directory path.

    Args:
        repo_root: Repository root path. Defaults to auto-detected.

    Returns:
        Path to tasks directory.
    """
    if repo_root is None:
        repo_root = get_repo_root()
    return repo_root / DIR_WORKFLOW / DIR_TASKS


# =============================================================================
# Workspace Directory
# =============================================================================

def get_workspace_dir(repo_root: Path | None = None) -> Path | None:
    """Get developer workspace directory.

    Args:
        repo_root: Repository root path. Defaults to auto-detected.

    Returns:
        Path to workspace directory or None if developer not set.
    """
    if repo_root is None:
        repo_root = get_repo_root()

    developer = get_developer(repo_root)
    if developer:
        workspace = repo_root / DIR_WORKFLOW / DIR_WORKSPACE / developer
        base = repo_root.resolve() / DIR_WORKFLOW / DIR_WORKSPACE
        if workspace.is_symlink() or not workspace.resolve().is_relative_to(base):
            raise ValueError("Developer workspace must be local, not symlinked")
        return workspace
    return None


# =============================================================================
# Journal File
# =============================================================================

def get_active_journal_file(repo_root: Path | None = None) -> Path | None:
    """Get the current active journal file.

    Args:
        repo_root: Repository root path. Defaults to auto-detected.

    Returns:
        Path to active journal file or None if not found.
    """
    if repo_root is None:
        repo_root = get_repo_root()

    workspace_dir = get_workspace_dir(repo_root)
    if workspace_dir is None or not workspace_dir.is_dir():
        return None

    latest: Path | None = None
    highest = 0

    for f in workspace_dir.glob(f"{FILE_JOURNAL_PREFIX}*.md"):
        if not f.is_file():
            continue

        # Extract number from filename
        name = f.stem  # e.g., "journal-1"
        match = re.search(r"(\d+)$", name)
        if match:
            num = int(match.group(1))
            if num > highest:
                highest = num
                latest = f

    return latest


def count_lines(file_path: Path) -> int:
    """Count lines in a file.

    Args:
        file_path: Path to file.

    Returns:
        Number of lines, or 0 if file doesn't exist.
    """
    if not file_path.is_file():
        return 0

    try:
        return len(file_path.read_text(encoding="utf-8").splitlines())
    except (OSError, IOError):
        return 0


# =============================================================================
# Current Task Management
# =============================================================================

def normalize_task_ref(task_ref: str) -> str:
    """Normalize a task ref for stable runtime storage.

    Stored refs should prefer repo-relative POSIX paths like
    `.trellis/tasks/03-27-my-task`, even on Windows. Absolute paths are preserved
    unless they can later be converted back to repo-relative form by callers.
    """
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


def resolve_task_ref(task_ref: str, repo_root: Path | None = None) -> Path | None:
    """Resolve through the shared lexical/resolved task-store boundary."""
    from .task_records import resolve_task_ref as resolve
    return resolve(task_ref, repo_root or get_repo_root())

def get_current_task(
    repo_root: Path | None = None,
    platform_input: dict | None = None,
    platform: str | None = None,
) -> str | None:
    """Get current task directory path (relative to repo_root).

    Args:
        repo_root: Repository root path. Defaults to auto-detected.

    Returns:
        Relative path to current task directory or None.
    """
    if repo_root is None:
        repo_root = get_repo_root()

    from .active_task import resolve_active_task

    active = resolve_active_task(repo_root, platform_input, platform)
    return active.task_path if active.valid else None


def get_current_task_abs(
    repo_root: Path | None = None,
    platform_input: dict | None = None,
    platform: str | None = None,
) -> Path | None:
    """Get current task directory absolute path.

    Args:
        repo_root: Repository root path. Defaults to auto-detected.

    Returns:
        Absolute path to current task directory or None.
    """
    if repo_root is None:
        repo_root = get_repo_root()

    relative = get_current_task(repo_root, platform_input, platform)
    if relative:
        return resolve_task_ref(relative, repo_root)
    return None


def get_current_task_source(
    repo_root: Path | None = None,
    platform_input: dict | None = None,
    platform: str | None = None,
) -> tuple[str, str | None, str | None]:
    """Get active task source as (`source`, `context_key`, `task_path`)."""
    if repo_root is None:
        repo_root = get_repo_root()

    from .active_task import get_current_task_source as _get_source

    return _get_source(repo_root, platform_input, platform)


def set_current_task(
    task_path: str,
    repo_root: Path | None = None,
    platform_input: dict | None = None,
    platform: str | None = None,
) -> bool:
    """Set current task in session scope.

    Args:
        task_path: Task directory path (relative to repo_root).
        repo_root: Repository root path. Defaults to auto-detected.

    Returns:
        True on success, False on error.
    """
    if repo_root is None:
        repo_root = get_repo_root()

    from .active_task import set_active_task

    return set_active_task(
        task_path,
        repo_root,
        platform_input=platform_input,
        platform=platform,
    ) is not None


def clear_current_task(
    repo_root: Path | None = None,
    platform_input: dict | None = None,
    platform: str | None = None,
) -> bool:
    """Clear current task in session scope.

    Args:
        repo_root: Repository root path. Defaults to auto-detected.

    Returns:
        True on success.
    """
    if repo_root is None:
        repo_root = get_repo_root()

    from .active_task import clear_active_task

    clear_active_task(
        repo_root,
        platform_input=platform_input,
        platform=platform,
    )
    return True


def has_current_task(repo_root: Path | None = None) -> bool:
    """Check if has current task.

    Args:
        repo_root: Repository root path. Defaults to auto-detected.

    Returns:
        True if current task is set.
    """
    return get_current_task(repo_root) is not None


# =============================================================================
# Task ID Generation
# =============================================================================

def generate_task_date_prefix() -> str:
    """Generate task ID based on date (MM-DD format).

    Returns:
        Date prefix string (e.g., "01-21").
    """
    return datetime.now().strftime("%m-%d")


# =============================================================================
# Monorepo / Package Paths
# =============================================================================


def get_spec_dir(package: str | None = None, repo_root: Path | None = None) -> Path:
    """Get the spec directory path.

    Single-repo: .trellis/spec
    Monorepo with package: .trellis/spec/<package>

    Uses lazy import to avoid circular dependency with config.py.
    """
    if repo_root is None:
        repo_root = get_repo_root()

    from .config import get_spec_base

    base = get_spec_base(package, repo_root)
    return repo_root / DIR_WORKFLOW / base


def get_package_path(package: str, repo_root: Path | None = None) -> Path | None:
    """Get a package's source directory absolute path from config.

    Returns:
        Absolute path to the package directory, or None if not found.
    """
    if repo_root is None:
        repo_root = get_repo_root()

    from .config import get_packages

    packages = get_packages(repo_root)
    if not packages or package not in packages:
        return None

    info = packages[package]
    if isinstance(info, dict):
        rel_path = info.get("path", package)
    else:
        rel_path = str(info)

    return repo_root / rel_path


# =============================================================================
# Main Entry (for testing)
# =============================================================================

if __name__ == "__main__":
    repo = get_repo_root()
    print(f"Repository root: {repo}")
    print(f"Developer: {get_developer(repo)}")
    print(f"Tasks dir: {get_tasks_dir(repo)}")
    print(f"Workspace dir: {get_workspace_dir(repo)}")
    print(f"Journal file: {get_active_journal_file(repo)}")
    print(f"Current task: {get_current_task(repo)}")
