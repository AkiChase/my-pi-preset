"""Repository, strict v2 bindings and source lock shared with the Pi host."""
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import subprocess
import uuid
import tempfile
from contextlib import contextmanager
from datetime import datetime, timezone

from .diagnostics import DiagnosticError


def now():
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def contains(root, path):
    return Path(path).is_relative_to(Path(root))


def canonical(path):
    path = Path(os.path.abspath(path))
    suffix = []
    while not os.path.lexists(path):
        suffix.append(path.name)
        path = path.parent
    return path.resolve(strict=True).joinpath(*reversed(suffix))


def text(value, label):
    if not isinstance(value, str) or not value.strip() or re.search(r"[\x00-\x1f\x7f]", value):
        raise ValueError(f"{label} must be a non-empty string without control characters")
    return value


def task_slug(task):
    if not isinstance(task, str) or not re.fullmatch(r"\.trellis/tasks/[A-Za-z0-9][A-Za-z0-9._-]*", task):
        raise ValueError("Task must be .trellis/tasks/<safe full task slug>")
    return task.removeprefix(".trellis/tasks/")


def bounded_command(argv, *, env, cwd=None, timeout=30, limit=4 * 1024 * 1024):
    # Spool output rather than allocating unbounded stdout/stderr. Enforce the
    # inherited output bound before decoding/returning; timeout terminates child.
    with tempfile.TemporaryFile() as stdout, tempfile.TemporaryFile() as stderr:
        result = subprocess.run(argv, cwd=cwd, env=env, stdout=stdout, stderr=stderr, timeout=timeout)
        if stdout.tell() > limit or stderr.tell() > limit:
            raise ValueError("Subprocess output exceeds configured byte bound")
        stdout.seek(0)
        stderr.seek(0)
        return result.returncode, stdout.read(), stderr.read()


def git_environment():
    env = {key: value for key, value in os.environ.items() if not key.startswith("GIT_")}
    env["GIT_OPTIONAL_LOCKS"] = "0"
    return env


def git(root, args, allowed=(0,)):
    env = git_environment()
    code, stdout, stderr = bounded_command(["git", "-C", str(root), *args], env=env)
    if code not in allowed:
        raise ValueError(f"git {args[0]} failed: {stderr.decode('utf-8', 'replace').strip()}")
    return stdout.decode("utf-8").strip()


def repository(cwd):
    root = canonical(git(cwd, ["rev-parse", "--show-toplevel"]))
    common = canonical(root / git(root, ["rev-parse", "--git-common-dir"]))
    rows = []
    for field in git(root, ["worktree", "list", "--porcelain", "-z"]).split("\0"):
        if field.startswith("worktree "):
            rows.append(dict(path=str(canonical(field[9:])), head="", branch=None, bare=False))
        elif rows and field.startswith("HEAD "):
            rows[-1]["head"] = field[5:]
        elif rows and field.startswith("branch refs/heads/"):
            rows[-1]["branch"] = field[18:]
        elif rows and field == "bare":
            rows[-1]["bare"] = True
    return dict(root=str(root), commonDir=str(common), worktrees=rows)


def resolve_base(root, base="HEAD"):
    text(base, "base")
    sha = git(root, ["rev-parse", "--verify", "--end-of-options", f"{base}^{{commit}}"])
    if not re.fullmatch(r"[a-f0-9]{40,64}", sha):
        raise ValueError("base did not resolve to a full commit id")
    return sha


def validate_branch(root, branch):
    text(branch, "branch")
    if branch.startswith("-") or "@{" in branch or branch == "HEAD":
        raise ValueError("Invalid branch name")
    git(root, ["check-ref-format", "--branch", branch])


def require_ignored(root, path):
    if not contains(root, path) or Path(root) == Path(path):
        raise ValueError("Ignore check must be beneath the project root")
    if not git(root, ["check-ignore", "--", str(path)], (0, 1)):
        raise ValueError(f"Git must ignore {path}; add an ignore rule explicitly (pi-trellis will not edit .gitignore)")
    if git(root, ["ls-files", "--", str(path)]):
        raise ValueError(f"Runtime/managed directory contains tracked files: {path}")


def worktree_directory(root):
    file = Path(root) / ".pi/pi-trellis.json"
    if not os.path.lexists(file):
        return canonical(Path(root) / ".worktree")
    config = read_json(file, 1024 * 1024)
    if not isinstance(config, dict):
        raise ValueError("pi-trellis.json must contain an object")
    section = config.get("worktree", {})
    if not isinstance(section, dict):
        raise ValueError("worktree config must be an object")
    directory = section.get("directory", ".worktree")
    text(directory, "worktree.directory")
    managed = canonical(Path(root) / directory)
    if contains(managed, root):
        raise ValueError("worktree.directory cannot equal or contain the source root")
    return managed


def runtime(root):
    root = canonical(root)
    path = root / ".trellis/.runtime/pi-trellis"
    if not contains(root, canonical(path)):
        raise ValueError("pi-trellis runtime cannot symlink outside the project")
    return path


def binding_file(root, task):
    task_slug(task)
    directory = runtime(root)
    file = directory / "bindings" / (hashlib.sha256(task.encode()).hexdigest() + ".json")
    if not contains(directory, canonical(file)):
        raise ValueError("Binding file cannot symlink outside pi-trellis runtime")
    return file


def marker_file(root):
    return runtime(root) / "binding.json"


IDENTITY = ("version", "bindingId", "taskDir", "sourceRoot", "worktreePath", "repositoryIdentity", "branch", "baseCommit", "contextId", "createdAt")


def parse_binding(b):
    allowed = set(IDENTITY) | {"preparationState", "lastError"}
    if not isinstance(b, dict) or type(b.get("version")) is not int or b.get("version") != 2 or set(b) - allowed or b.get("preparationState") not in ("creating", "unprepared", "preparing", "ready", "error"):
        raise DiagnosticError("binding_invalid", "Unsupported worktree binding version/state or unknown fields; expected strict version 2 (no migration)")
    for key in IDENTITY[1:]:
        text(b.get(key), f"binding {key}")
    task_slug(b["taskDir"])
    if not re.fullmatch(r"[a-f0-9]{40,64}", b["baseCommit"]) or not re.fullmatch(r"[A-Za-z0-9_-]+", b["contextId"]) or not re.fullmatch(r"[A-Za-z0-9-]+", b["bindingId"]):
        raise DiagnosticError("binding_invalid", "Invalid binding base/context/binding id")
    for key in ("sourceRoot", "worktreePath", "repositoryIdentity"):
        if str(canonical(b[key])) != b[key]:
            raise DiagnosticError("binding_invalid", f"Binding {key} must be a canonical absolute path")
    if "lastError" in b and (not isinstance(b["lastError"], str) or len(b["lastError"]) > 4096 or "\0" in b["lastError"]):
        raise DiagnosticError("binding_invalid", "Invalid binding lastError")
    return b


def json_value(data):
    # Match JSON.parse: NaN/Infinity are not JSON and cannot authorize state.
    def invalid_constant(value):
        raise ValueError(f"Invalid JSON constant: {value}")
    return json.loads(data, parse_constant=invalid_constant)


def read_json(file, limit):
    try:
        info = file.lstat()
    except FileNotFoundError:
        return None
    if not stat.S_ISREG(info.st_mode) or info.st_size > limit:
        raise DiagnosticError("record_invalid", f"Record must be a local regular bounded file: {file}", path=str(file))
    try:
        with file.open("rb") as stream:
            data = stream.read(limit + 1)
        if len(data) > limit or b"\0" in data:
            raise ValueError("Record exceeds byte bound or contains NUL")
        value = json_value(data.decode("utf-8"))
    except (ValueError, UnicodeError) as error:
        raise DiagnosticError("record_invalid", "Invalid UTF-8 JSON record: " + str(error), path=str(file)) from error
    if not isinstance(value, dict):
        raise DiagnosticError("record_invalid", f"Record must contain a JSON object: {file}", path=str(file))
    return value


def read_binding(root, task):
    b = read_json(binding_file(root, task), 1024 * 1024)
    return parse_binding(b) if b is not None else None


def read_marker(root):
    b = read_json(marker_file(root), 1024 * 1024)
    return parse_binding(b) if b is not None else None


def same_identity(a, b):
    return all(a.get(key) == b.get(key) for key in IDENTITY)


def atomic_json(file, value):
    # All callers supply contained runtime paths; refuse final-file symlinks too.
    if os.path.lexists(file) and not stat.S_ISREG(file.lstat().st_mode):
        raise ValueError(f"Record must be a regular file: {file}")
    file.parent.mkdir(parents=True, exist_ok=True)
    temp = file.parent / f".binding-{uuid.uuid4()}.tmp"
    try:
        fd = os.open(temp, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(fd, "w", encoding="utf-8") as stream:
            json.dump(value, stream, ensure_ascii=False, indent=2)
            stream.write("\n")
        if file.is_symlink():
            raise ValueError(f"Record changed to symlink: {file}")
        os.replace(temp, file)
    finally:
        temp.unlink(missing_ok=True)


@contextmanager
def source_lock(root):
    directory = runtime(root)
    directory.mkdir(parents=True, exist_ok=True)
    file = directory / "worktrees.lock"
    try:
        fd = os.open(file, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    except FileExistsError:
        raise DiagnosticError("operation_locked", f"Worktree operation already locked; inspect {file} before explicitly recovering a stale lock", path=str(file)) from None
    try:
        os.write(fd, (json.dumps(dict(pid=os.getpid(), token=str(uuid.uuid4()), createdAt=now())) + "\n").encode())
        yield
    finally:
        os.close(fd)
        file.unlink()


def execution_file(b):
    directory = runtime(b["sourceRoot"])
    if not re.fullmatch(r"[A-Za-z0-9-]+", b["bindingId"]):
        raise ValueError("Invalid execution binding id")
    file = directory / f"execution-{b['bindingId']}.json"
    if not contains(directory, canonical(file)):
        raise ValueError("Execution record escapes runtime")
    return file


def read_execution(b):
    r = read_json(execution_file(b), 65536)
    if r is not None and (not isinstance(r, dict) or r.get("bindingId") != b["bindingId"] or not isinstance(r.get("requestId"), str) or r.get("state") not in ("starting", "running", "completed", "failed", "stopped", "unknown") or type(r.get("ownerPid")) is not int or abs(r["ownerPid"]) > 9007199254740991):
        raise ValueError("Invalid execution record")
    if r is not None:
        for key in ('materialRevision', 'sourceFingerprint', 'targetFingerprint'):
            if key in r and (not isinstance(r[key], str) or not re.fullmatch(r'[A-Za-z0-9-]{1,80}' if key == 'materialRevision' else r'[a-f0-9]{64}', r[key])):
                raise ValueError('Invalid execution material facts')
    return r


def active_execution(b):
    r = read_execution(b)
    return r is not None and r["state"] in ("starting", "running", "unknown")


def active_source_execution(source, task):
    def utf16_length(value):
        return len(value.encode("utf-16-le", errors="surrogatepass")) // 2
    task_slug(task)
    directory = runtime(source["root"]) / "source-executions"
    file = directory / (hashlib.sha256(task.encode()).hexdigest() + ".json")
    # Source leases must remain local, including all existing ancestors.
    for path in (Path(source["root"]) / ".trellis", Path(source["root"]) / ".trellis" / ".runtime", runtime(source["root"]), directory, file):
        if path.is_symlink() or not contains(Path(source["root"]), canonical(path)):
            raise ValueError("Source execution path is symlinked or external")
    r = read_json(file, 65536)
    if r is None:
        return False
    if not isinstance(r, dict) or type(r.get("version")) is not int or r.get("version") != 1 or r.get("mode") != "source" or r.get("role") not in ("trellis-implement", "trellis-check", "trellis-research") or r.get("state") not in ("starting", "running", "completed", "failed", "unknown") or type(r.get("ownerPid")) is not int or not 0 < r["ownerPid"] <= 9007199254740991:
        raise ValueError("Invalid source execution state/owner")
    for key, value in (("sourceRoot", source["root"]), ("repositoryIdentity", source["commonDir"]), ("taskDir", task)):
        if r.get(key) != value:
            raise ValueError("Source execution identity mismatch")
    for key in ("requestId", "ownerToken", "createdAt"):
        v = r.get(key)
        if not isinstance(v, str) or not v or utf16_length(v) > 256 or re.search(r"[\x00\r\n]", v):
            raise ValueError("Invalid source execution identifier")
    if "agentId" in r and (not isinstance(r["agentId"], str) or not r["agentId"] or utf16_length(r["agentId"]) > 1024 or re.search(r"[\x00\r\n]", r["agentId"])):
        raise ValueError("Invalid source agent id")
    if "error" in r and (not isinstance(r["error"], str) or utf16_length(r["error"]) > 4096):
        raise ValueError("Invalid source execution error")
    return r["state"] in ("starting", "running", "unknown")


def owner_alive(record):
    pid = record.get("ownerPid")
    if type(pid) is not int or pid <= 0:
        return True  # A process group/invalid PID cannot prove the owner died.
    if os.name != "posix":
        return True  # Do not use Windows os.kill(signal=0): not a POSIX liveness probe.
    try:
        os.kill(record["ownerPid"], 0)
        return True
    except ProcessLookupError:
        return False
    except (OSError, OverflowError, ValueError):
        return True  # Unknown/unsupported PID is not proof of death.


def binding_problems(b, source):
    try:
        if b["sourceRoot"] != source["root"] or b["repositoryIdentity"] != source["commonDir"]:
            raise ValueError("Source repository identity does not match binding")
        target = repository(b["worktreePath"])
        row = next((r for r in source["worktrees"] if r["path"] == b["worktreePath"]), None)
        if not row or row["bare"] or target["root"] != b["worktreePath"] or target["commonDir"] != source["commonDir"]:
            raise ValueError("Target is not this repository's registered worktree")
        if row["branch"] != b["branch"]:
            raise ValueError("Target branch differs from binding")
        marker = read_marker(b["worktreePath"])
        if not marker or not same_identity(marker, b):
            raise ValueError("Target marker and source binding differ or marker is missing")
    except (ValueError, OSError, subprocess.SubprocessError) as error:
        return [str(error)]
    return []


def source_for(cwd):
    local_repo = repository(cwd)
    marker = read_marker(local_repo["root"])
    if marker:
        source = repository(marker["sourceRoot"])
        authoritative = read_binding(source["root"], marker["taskDir"])
        if not authoritative or not same_identity(marker, authoritative):
            raise ValueError("Untrusted target marker: source binding missing or mismatched")
        problems = binding_problems(authoritative, source)
        if problems:
            raise ValueError("; ".join(problems))
        if local_repo["root"] != marker["worktreePath"]:
            raise ValueError("Marker is not in its bound worktree")
        return source, authoritative
    if not local_repo["worktrees"] or local_repo["worktrees"][0]["path"] != local_repo["root"]:
        raise ValueError("Unbound linked worktree: manage from the source project or explicitly adopt this directory there")
    return local_repo, None


def assert_destination(source, destination, rows):
    if contains(destination, source):
        raise ValueError("Worktree destination cannot equal the source or contain it")
    for row in rows:
        if row["path"] != source and (contains(destination, row["path"]) or contains(row["path"], destination)):
            raise ValueError(f"Destination overlaps registered worktree {row['path']}")
