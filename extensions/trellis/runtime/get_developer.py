#!/usr/bin/env python3
# SPDX-License-Identifier: AGPL-3.0-only
# Derived from @mindfoldhq/trellis 0.6.16 (Mindfold LLC).
# Maintained/adapted for Pi by pi-trellis; see resources/runtime-baseline.json.
"""
Get current developer name.

This is a wrapper that uses common/paths.py
"""

from __future__ import annotations

import sys
sys.dont_write_bytecode = True


from common.paths import get_developer


def main() -> None:
    """CLI entry point."""
    developer = get_developer()
    if developer:
        print(developer)
    else:
        print("Developer not initialized", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
