#!/usr/bin/env python3
# SPDX-License-Identifier: AGPL-3.0-only
# Derived from @mindfoldhq/trellis 0.6.16 (Mindfold LLC).
# Maintained/adapted for Pi by pi-trellis; see resources/runtime-baseline.json.
"""
Initialize developer for workflow.

Usage:
    python3 init_developer.py <developer-name>

This creates:
    - .trellis/.developer file with developer info
    - .trellis/workspace/<name>/ directory structure
"""

from __future__ import annotations

import sys
sys.dont_write_bytecode = True


from common.paths import (
    DIR_WORKFLOW,
    FILE_DEVELOPER,
    get_developer,
)
from common.developer import init_developer


def main() -> None:
    """CLI entry point."""
    if len(sys.argv) != 2:
        print(f"Usage: {sys.argv[0]} <developer-name>")
        print()
        print("Example:")
        print(f"  {sys.argv[0]} john")
        sys.exit(1)

    name = sys.argv[1]

    if init_developer(name):
        sys.exit(0)
    else:
        sys.exit(1)


if __name__ == "__main__":
    main()
