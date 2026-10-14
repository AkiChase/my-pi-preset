#!/usr/bin/env python3
# SPDX-License-Identifier: AGPL-3.0-only
# Derived from @mindfoldhq/trellis 0.6.16 (Mindfold LLC).
# Maintained/adapted for Pi by pi-trellis; see resources/runtime-baseline.json.
"""
Get Session Context for AI Agent.

Usage:
    python3 get_context.py           Output context in text format
    python3 get_context.py --json    Output context in JSON format
"""

from __future__ import annotations

import sys
sys.dont_write_bytecode = True

from common.git_context import main


if __name__ == "__main__":
    main()
