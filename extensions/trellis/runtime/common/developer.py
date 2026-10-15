#!/usr/bin/env python3
# SPDX-License-Identifier: AGPL-3.0-only
# Derived from @mindfoldhq/trellis 0.6.16 (Mindfold LLC).
# Maintained/adapted for Pi by pi-trellis; see resources/runtime-baseline.json.
"""
Developer management utilities.

Provides:
    init_developer     - Initialize developer
    ensure_developer   - Ensure developer is initialized (exit if not)
    show_developer_info - Show developer information
"""

from __future__ import annotations

import sys
from datetime import datetime
from pathlib import Path

from .paths import (
    DEVELOPER_HINT,
    DIR_WORKFLOW,
    DIR_WORKSPACE,
    DIR_TASKS,
    FILE_DEVELOPER,
    FILE_JOURNAL_PREFIX,
    get_repo_root,
    get_developer,
    check_developer,
    get_workspace_dir,
)
from .task_records import safe_segment


# =============================================================================
# Developer Initialization
# =============================================================================

def developer_skeleton(name: str, today: str, initialized_at: str) -> dict[str, str]:
    """Pure initial identity/workspace bytes; never binds a session or runs hooks."""
    if not safe_segment(name) or name != name.strip():
        raise ValueError("Developer must be a safe single directory segment")
    journal_content = f"""# Journal - {name} (Part 1)

> AI development session journal
> Started: {today}

---

"""
    index_content = f"""# Workspace Index - {name}

> Journal tracking for AI development sessions.

---

## Current Status

<!-- @@@auto:current-status -->
- **Active File**: `journal-1.md`
- **Total Sessions**: 0
- **Last Active**: -
<!-- @@@/auto:current-status -->

---

## Active Documents

<!-- @@@auto:active-documents -->
| File | Lines | Status |
|------|-------|--------|
| `journal-1.md` | ~0 | Active |
<!-- @@@/auto:active-documents -->

---

## Session History

<!-- @@@auto:session-history -->
| # | Date | Title | Commits | Branch |
|---|------|-------|---------|--------|
<!-- @@@/auto:session-history -->

---

## Notes

- Sessions are appended to journal files
- New journal file created when current exceeds 2000 lines
- Use `add_session.py` to record sessions
"""
    return {".developer": f"name={name}\ninitialized_at={initialized_at}\n",
            "journal-1.md": journal_content, "index.md": index_content}


def init_developer(name: str, repo_root: Path | None = None) -> bool:
    """Initialize developer.

    Creates:
        - .trellis/.developer file with developer info
        - .trellis/workspace/<name>/ directory structure
        - Initial journal file and index.md

    Args:
        name: Developer name.
        repo_root: Repository root path. Defaults to auto-detected.

    Returns:
        True on success, False on error.
    """
    if not safe_segment(name):
        print("Error: developer must be a safe single directory segment", file=sys.stderr)
        return False
    name = name.strip()

    if repo_root is None:
        repo_root = get_repo_root()

    existing = get_developer(repo_root)
    if existing:
        print(f"Effective developer: {existing}")
        if existing != name:
            print(f"Error: Requested {name}; existing identity preserved", file=sys.stderr)
            return False
        return True
    dev_file = repo_root / DIR_WORKFLOW / FILE_DEVELOPER
    workspace_dir = repo_root / DIR_WORKFLOW / DIR_WORKSPACE / name
    base = repo_root.resolve() / DIR_WORKFLOW / DIR_WORKSPACE
    if dev_file.exists() or dev_file.is_symlink():
        print("Error: Existing developer file preserved; inspect identity", file=sys.stderr)
        return False
    if (base.is_symlink() or workspace_dir.is_symlink()
            or not workspace_dir.resolve().is_relative_to(base)):
        print("Error: Workspace must be local, not symlinked", file=sys.stderr)
        return False
    for file in (workspace_dir / "journal-1.md", workspace_dir / "index.md"):
        if file.is_symlink() or (file.exists() and not file.is_file()):
            print("Error: Workspace files must be regular, not symlinked", file=sys.stderr)
            return False

    # Create workspace directory structure
    try:
        workspace_dir.mkdir(parents=True, exist_ok=True)
    except (OSError, IOError) as e:
        print(f"Error: Failed to create workspace directory: {e}", file=sys.stderr)
        return False

    # Create initial journal file
    journal_file = workspace_dir / f"{FILE_JOURNAL_PREFIX}1.md"
    if not journal_file.exists():
        today = datetime.now().strftime("%Y-%m-%d")
        journal_content = developer_skeleton(name, today, "")["journal-1.md"]
        try:
            journal_file.write_text(journal_content, encoding="utf-8")
        except (OSError, IOError) as e:
            print(f"Error: Failed to create journal file: {e}", file=sys.stderr)
            return False

    # Create index.md with markers for auto-update
    index_file = workspace_dir / "index.md"
    if not index_file.exists():
        index_content = developer_skeleton(name, datetime.now().strftime("%Y-%m-%d"), "")["index.md"]
        try:
            index_file.write_text(index_content, encoding="utf-8")
        except (OSError, IOError) as e:
            print(f"Error: Failed to create index.md: {e}", file=sys.stderr)
            return False

    try:
        with dev_file.open("x", encoding="utf-8") as stream:
            stream.write(f"name={name}\ninitialized_at={datetime.now().isoformat()}\n")
    except OSError as error:
        print(f"Error: Identity not published: {error}", file=sys.stderr)
        return False
    effective = get_developer(repo_root)
    if effective != name:
        print(f"Error: Effective developer differs: {effective}", file=sys.stderr)
        return False
    print(f"Developer initialized: {name}")
    print(f"  .developer file: {dev_file}")
    print(f"  Workspace dir: {workspace_dir}")

    return True


def ensure_developer(repo_root: Path | None = None) -> None:
    """Ensure developer is initialized, exit if not.

    Args:
        repo_root: Repository root path. Defaults to auto-detected.
    """
    if repo_root is None:
        repo_root = get_repo_root()

    if not check_developer(repo_root):
        print("Error: Developer not initialized.", file=sys.stderr)
        print(f"Run: python3 ./{DIR_WORKFLOW}/scripts/init_developer.py <your-name>", file=sys.stderr)
        print(DEVELOPER_HINT, file=sys.stderr)
        sys.exit(1)


def show_developer_info(repo_root: Path | None = None) -> None:
    """Show developer information.

    Args:
        repo_root: Repository root path. Defaults to auto-detected.
    """
    if repo_root is None:
        repo_root = get_repo_root()

    developer = get_developer(repo_root)

    if not developer:
        print("Developer: (not initialized)")
    else:
        print(f"Developer: {developer}")
        print(f"Workspace: {DIR_WORKFLOW}/{DIR_WORKSPACE}/{developer}/")
        print(f"Tasks: {DIR_WORKFLOW}/{DIR_TASKS}/")


# =============================================================================
# Main Entry (for testing)
# =============================================================================

if __name__ == "__main__":
    show_developer_info()
