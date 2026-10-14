"""Operation-specific argparse entry point. Parsing never accesses the repository."""
import argparse
import json
import os
import sys

from .manager import manage, query
from .records import text


class Once(argparse.Action):
    def __call__(self, parser, namespace, values, option_string=None):
        seen = getattr(namespace, "_seen", set())
        if self.dest in seen:
            parser.error(f"duplicate option: {option_string}")
        seen.add(self.dest)
        namespace._seen = seen
        setattr(namespace, self.dest, values if self.nargs != 0 else True)


class Parser(argparse.ArgumentParser):
    def __init__(self, *args, **kwargs):
        kwargs["allow_abbrev"] = False
        super().__init__(*args, **kwargs)


def value(raw):
    try:
        return text(raw, "option")
    except ValueError as error:
        raise argparse.ArgumentTypeError(str(error)) from error


def parser():
    p = Parser(description="Persistent task worktrees: create → prepare → trellis_dispatch (Pi host). Mutations preview by default; --confirm requires prior user approval.")
    sub = p.add_subparsers(dest="action", required=True, parser_class=Parser)
    help_text = dict(create="Create a directory from a pinned commit, leave unprepared", adopt="Adopt an existing registered branch-backed worktree", status="Inspect binding, preparation and execution (read-only)", prepare="Copy selected task materials and run target start/hooks", refresh="Reconcile source task materials using hash-only B/S/T; no start/hooks", collect="Explicitly collect selected target task files; never task.json", recover="Reset preparation/release only dead-owner execution", remove="Remove a clean integrated worktree without force/branch deletion")
    for action, description in help_text.items():
        s = sub.add_parser(action, help=description, description=description)
        s.add_argument("--task", required=True, type=value, action=Once, help="Existing .trellis/tasks/<full-slug> (explicit; no pointer fallback)")
        s.add_argument("--cwd", default=os.getcwd(), type=value, action=Once, help="Project directory (default process cwd; never switches parent Pi)")
        s.add_argument("--json", nargs=0, default=False, action=Once, help="One machine-readable object on stdout")
        if action != "status":
            s.add_argument("--confirm", nargs=0, default=False, action=Once, help="Execute only after user approval of preview")
        if action in ("create", "adopt"):
            s.add_argument("--base", type=value, action=Once, help="Commit reference (default source HEAD / adopted target HEAD)")
            s.add_argument("--branch", type=value, action=Once)
        if action == "adopt":
            s.add_argument("--path", required=True, type=value, action=Once, help="Existing registered worktree, source-relative or absolute")
        if action == 'collect':
            s.add_argument('--file', dest='files', type=value, action='append', help='Explicit current-task project-relative regular file; repeat for dependencies (no glob/all/deletions)')
        if action == "remove":
            s.add_argument("--integrated-into", type=value, action=Once, help="User-approved commit reference preserving target HEAD; required for existing target")
    return p


def main(argv=None):
    argv = sys.argv[1:] if argv is None else argv
    machine = "--json" in argv
    try:
        args = vars(parser().parse_args(argv))
        args.pop("_seen", None)
        args.pop("json", None)
        result = manage(**args)
        if machine:
            print(json.dumps(dict(ok=True, **result), ensure_ascii=False))
        else:
            plan = result.get("plan") or result.get("binding")
            if plan:
                for key in ("taskDir", "sourceRoot", "worktreePath", "branch", "baseCommit"):
                    print(f"{key}: {plan[key]}")
            print(result["note"])
            if result.get('actions') or result.get('candidates'):
                print(json.dumps({k: result[k] for k in ('actions', 'omitted', 'conflicts', 'errors', 'candidates') if k in result}, ensure_ascii=False, indent=2))
        return 0
    except SystemExit as error:
        if error.code and machine:
            print(json.dumps(dict(ok=False, error="Invalid CLI arguments; see stderr/help")))
        return error.code
    except Exception as error:
        print(str(error), file=sys.stderr)
        if machine:
            print(json.dumps(dict(ok=False, error=str(error)), ensure_ascii=False))
        return 1


def query_main():
    # Private host protocol; deliberately absent from user command help.
    p = Parser()
    p.add_argument("--cwd", required=True, type=value, action=Once)
    p.add_argument("--task", type=value, action=Once)
    p.add_argument("--ready", action="store_true")
    try:
        args = p.parse_args()
        print(json.dumps(dict(ok=True, **query(args.cwd, args.task, args.ready))))
        return 0
    except Exception as error:
        print(str(error), file=sys.stderr)
        print(json.dumps(dict(ok=False, error=str(error))))
        return 1
