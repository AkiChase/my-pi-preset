#!/usr/bin/env python3
"""Fixed project-local pi-trellis management entry point; no Node dependency."""
import sys

sys.dont_write_bytecode = True
try:
    from pi_trellis_worktree.cli import main
except ImportError as error:
    print(f"pi-trellis worktree modules missing/incompatible: {error}. Explicitly install/update the project CLI; no automatic repair.", file=sys.stderr)
    if "--json" in sys.argv:
        print('{"ok":false,"error":"Missing/incompatible pi-trellis worktree modules"}')
    sys.exit(1)

if __name__ == "__main__":
    sys.exit(main())
