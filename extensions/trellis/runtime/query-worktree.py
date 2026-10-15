#!/usr/bin/env python3
"""Private read-only host query; does not acquire the source lock."""
import sys
sys.dont_write_bytecode = True
from pi_trellis_worktree.cli import query_main
sys.exit(query_main())
