"""Source-authoritative, role-scoped materials. No task copies or ancestry state.

Prompt rendering belongs to the host. Native validation reads complete bounded
UTF-8 files and hashes the selected graph independently of prompt budgets.
"""
import codecs
import hashlib
import json
import os
from pathlib import Path
import stat

from .diagnostics import DiagnosticError
from .records import canonical, contains, json_value, require_ignored, runtime, task_slug

MAX_RECORD = 1024 * 1024
MAX_MATERIAL = 16 * MAX_RECORD
MAX_GRAPH_BYTES = 64 * MAX_RECORD
MAX_FILES = 2048
ROLES = ("implement", "check", "research")
RUNTIME_FIELDS = frozenset(("branch", "worktree_path", "status", "completedAt", "commit", "pr_url"))


def role_name(role):
    if role not in ROLES:
        raise DiagnosticError("invalid_role", "Role must be implement, check or research", role=role)
    return role


def task_path(root, task):
    task_slug(task)
    root = canonical(root)
    lexical = root / task
    try:
        store = (root / ".trellis/tasks").resolve(strict=True)
        actual = lexical.resolve(strict=True)
        if lexical.is_symlink() or not contains(store, actual) or not actual.is_dir():
            raise DiagnosticError("material_path_unsafe", "Task escapes its Trellis task store or is a task-directory symlink", path=str(lexical))
        return lexical
    except OSError as error:
        raise DiagnosticError("material_missing", "Source task/store is unavailable: " + str(error), path=str(lexical)) from error


def safe_path(root, task, path):
    root = canonical(root)
    raw = str(path)
    if not raw or len(raw) > 4096 or "\\" in raw or any(ord(c) < 32 or ord(c) == 127 or 0xD800 <= ord(c) <= 0xDFFF for c in raw) or ".." in Path(raw).parts:
        raise DiagnosticError("material_path_unsafe", "Material path exceeds path/control bounds or contains traversal", path=raw[:4096])
    lexical = Path(os.path.abspath(root / path))
    if not contains(root, lexical):
        raise DiagnosticError("material_path_unsafe", "Path leaves source root", path=str(lexical))
    try:
        actual = lexical.resolve(strict=True)
        store = (root / ".trellis/tasks").resolve(strict=True)
        if not contains(root, actual) and not (contains(root / ".trellis/tasks", lexical) and contains(store, actual)):
            raise DiagnosticError("material_path_unsafe", "Symlink leaves source root/task store", path=str(lexical))
        # Do not grant other aliases the explicit source task-store exception.
        for parent in (lexical, *lexical.parents):
            if parent == root:
                break
            if parent.is_symlink() and parent != root / ".trellis/tasks":
                raise DiagnosticError("material_path_unsafe", "Material symlink is not a task-store route", path=str(lexical))
        return actual
    except OSError as error:
        raise DiagnosticError("material_missing", "Source material is unavailable: " + str(error), path=str(lexical), next_action="Verify the referenced source path, repair the source manifest within existing maintenance authorization, then retry this role.") from error


def file_identity(value):
    # Reads may update atime; it is not source drift.
    return (value.st_dev, value.st_ino, value.st_mode, value.st_size, value.st_mtime_ns, value.st_ctime_ns)


def read_material(root, task, label, limit=MAX_MATERIAL, retain=False):
    path = safe_path(root, task, label)
    info = path.stat()
    if not stat.S_ISREG(info.st_mode):
        raise DiagnosticError("material_not_regular", "Material must be a regular file", path=str(path))
    if info.st_size > limit:
        raise DiagnosticError("material_limit", f"Material exceeds {limit // MAX_RECORD} MiB", path=str(path))
    decoder = codecs.getincrementaldecoder("utf-8")("strict")
    hash_value, size, data = hashlib.sha256(), 0, []
    try:
        fd = os.open(path, os.O_RDONLY | getattr(os, "O_NONBLOCK", 0) | getattr(os, "O_NOFOLLOW", 0))
        with os.fdopen(fd, "rb") as stream:
            # A pathname stat alone cannot identify the file actually opened:
            # an ancestor can be swapped for open and restored before final stat.
            if file_identity(os.fstat(stream.fileno())) != file_identity(info):
                raise DiagnosticError("material_changed", "Source material changed while opening; retry", path=str(path))
            while chunk := stream.read(65536):
                size += len(chunk)
                if size > limit:
                    raise DiagnosticError("material_limit", f"Material exceeds {limit // MAX_RECORD} MiB during read", path=str(path))
                if b"\0" in chunk:
                    raise DiagnosticError("material_binary", "Binary content (NUL) is not a UTF-8 material", path=str(path))
                decoder.decode(chunk)
                hash_value.update(chunk)
                if retain:
                    data.append(chunk)
            decoder.decode(b"", final=True)
            if size != info.st_size or file_identity(os.fstat(stream.fileno())) != file_identity(info):
                raise DiagnosticError("material_changed", "Source material changed while reading; retry", path=str(path))
    except UnicodeError as error:
        raise DiagnosticError("material_encoding", "Material must contain valid UTF-8: " + str(error), path=str(path)) from error
    if safe_path(root, task, label) != path or file_identity(path.stat()) != file_identity(info):
        raise DiagnosticError("material_changed", "Source material changed while reading; retry", path=str(path))
    return dict(path=str(path), sha256=hash_value.hexdigest(), bytes=size), b"".join(data) if retain else None


def task_record(root, task):
    task_path(root, task)
    label = str(Path(task) / "task.json")
    _, data = read_material(root, task, label, MAX_RECORD, True)
    try:
        value = json_value(data)
        if not isinstance(value, dict):
            raise ValueError("Expected a JSON object")
        return value
    except ValueError as error:
        raise DiagnosticError("task_record_invalid", "Invalid task.json: " + str(error), path=str(Path(root) / label)) from error


def canonical_json(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False).encode("utf-8")


def digest(value):
    return hashlib.sha256(canonical_json(value)).hexdigest()


def projection(data):
    value = json_value(data)
    if not isinstance(value, dict):
        raise ValueError("Invalid task.json")
    return {k: v for k, v in value.items() if k not in RUNTIME_FIELDS}


def source_materials(root, task, role, approved=False):
    role_name(role)
    root = canonical(root)
    initial_task_path = task_path(root, task).resolve(strict=True)
    files, seen_files, seen_dirs, guards, directory_guards = {}, set(), set(), {}, {}
    refs, artifacts = [], []
    entries, total_bytes = 0, 0

    def add_file(label):
        nonlocal total_bytes
        path = safe_path(root, task, label)
        if path in seen_files:
            return next(value for value in files.values() if value["path"] == str(path))
        record_file = label == task + "/task.json"
        manifest_file = label in (task + "/implement.jsonl", task + "/check.jsonl")
        metadata, data = read_material(root, task, label, MAX_RECORD if record_file or manifest_file else MAX_MATERIAL, record_file)
        total_bytes += metadata["bytes"]
        if total_bytes > MAX_GRAPH_BYTES or len(files) >= MAX_FILES:
            raise DiagnosticError("material_limit", "Source material graph exceeds file/64 MiB bounds", path=str(path))
        guards[label] = (dict(metadata), MAX_RECORD if record_file or manifest_file else MAX_MATERIAL)
        metadata["label"] = label
        if data is not None:
            try:
                record = json_value(data)
                if not isinstance(record, dict):
                    raise ValueError("Expected a JSON object")
            except ValueError as error:
                raise DiagnosticError("task_record_invalid", "Invalid task.json: " + str(error), role=role, path=str(path)) from error
            if approved and record.get("status") != "in_progress":
                raise DiagnosticError("source_not_approved", "Source task is not approved/in_progress for execution", role=role, path=str(path))
            metadata["sha256"] = digest({k: v for k, v in record.items() if k not in RUNTIME_FIELDS})
        files[label] = metadata
        seen_files.add(path)
        return metadata

    # Common artifacts are validated independently of reference deduplication.
    fixed = [task + "/task.json", ".trellis/workflow.md", task + "/prd.md"]
    for name in ("design.md", "implement.md"):
        label = task + "/" + name
        if os.path.lexists(root / label):
            fixed.append(label)
    common = {}
    for label in fixed:
        common[label] = add_file(label)
        artifacts.append(common[label]["path"])
    if common[task + "/prd.md"]["bytes"] == 0:
        raise DiagnosticError("material_empty", "Required PRD is empty", role=role, path=str(root / task / "prd.md"))
    spec_root = safe_path(root, task, ".trellis/spec")
    if not spec_root.is_dir():
        raise DiagnosticError("material_not_regular", "Source spec root must be a directory", path=str(spec_root))

    def add_reference(raw, directory=False, nested=False):
        nonlocal entries
        actual = safe_path(root, task, raw)
        label = Path(os.path.abspath(root / raw)).relative_to(root).as_posix()
        if actual.is_dir():
            if not directory:
                raise DiagnosticError("manifest_reference_invalid", "Directory reference must declare type: directory", path=str(actual))
            if actual in seen_dirs:
                return
            seen_dirs.add(actual)
            if len(seen_dirs) > 128:
                raise DiagnosticError("material_limit", "Directory expansion limit reached", path=str(actual))
            # Do not materialize an unbounded directory listing.
            info = actual.stat()
            with os.scandir(actual) as children:
                names = []
                for child in children:
                    entries += 1
                    if entries > 512:
                        raise DiagnosticError("material_limit", "Directory entry limit reached", path=str(actual))
                    names.append(child.name)
            directory_guards[label] = (actual, file_identity(info))
            for name in sorted(names):
                add_reference(str(Path(label) / name), True, nested=True)
            if not nested and not any(contains(actual, Path(ref["path"])) for ref in refs):
                raise DiagnosticError("manifest_reference_invalid", "Directory reference contains no material files", path=str(actual))
        else:
            selected = add_file(label)
            if not any(ref["path"] == selected["path"] for ref in refs):
                raw_metadata, _ = guards[selected["label"]]
                refs.append(dict(selected, sha256=raw_metadata["sha256"]))

    manifest = None
    if role != "research":
        label = task + "/" + role + ".jsonl"
        manifest = str(safe_path(root, task, label))
        manifest_metadata, data = read_material(root, task, label, MAX_RECORD, True)
        selected_manifest = add_file(label)
        if selected_manifest["sha256"] != manifest_metadata["sha256"]:
            raise DiagnosticError("material_changed", "Manifest changed between validation and hashing; retry", role=role, manifest=manifest)
        count = 0
        for line_number, line in enumerate(data.decode("utf-8").split("\n"), 1):
            if not line.strip():
                continue
            try:
                row = json_value(line)
                if not isinstance(row, dict):
                    raise DiagnosticError("manifest_row_invalid", "Expected a JSON object")
                if "file" not in row:
                    continue
                if not isinstance(row["file"], str) or not row["file"].strip():
                    raise DiagnosticError("manifest_reference_invalid", "Invalid file reference")
                count += 1
                if count > 512:
                    raise DiagnosticError("material_limit", "JSONL reference limit reached")
                add_reference(row["file"], row.get("type") == "directory")
            except (ValueError, OSError) as error:
                context = error.issue if isinstance(error, DiagnosticError) else {}
                details = dict(role=role, path=context.get("path"), manifest=manifest, line=line_number)
                if context.get("nextAction") is not None:
                    details["next_action"] = context["nextAction"]
                raise DiagnosticError(context.get("code", "manifest_row_invalid"), context.get("message", str(error)), **details) from error
        if count == 0:
            raise DiagnosticError("manifest_empty", "No valid file references", role=role, manifest=manifest)
    # Verify the graph's earlier inputs again after expansion. This is bounded
    # live-read freshness, not a filesystem transaction or proof of agent reads.
    for label, (expected, limit) in guards.items():
        current, _ = read_material(root, task, label, limit)
        if current != expected:
            raise DiagnosticError("material_changed", "Source material changed during graph validation; retry", role=role, path=current["path"])
    for label, (expected_path, expected_identity) in directory_guards.items():
        current = safe_path(root, task, label)
        if current != expected_path or file_identity(current.stat()) != expected_identity:
            raise DiagnosticError("material_changed", "Source directory changed during graph validation; retry", role=role, path=str(current))
    current_fixed = [task + "/task.json", ".trellis/workflow.md", task + "/prd.md"] + [task + "/" + name for name in ("design.md", "implement.md") if os.path.lexists(root / task / name)]
    if current_fixed != fixed or task_path(root, task).resolve(strict=True) != initial_task_path or safe_path(root, task, ".trellis/spec") != spec_root:
        raise DiagnosticError("material_changed", "Source artifact/authority paths changed during graph validation; retry", role=role)
    fingerprint = digest(dict(role=role, taskPath=str(initial_task_path), specRoot=str(spec_root), hashes={k: dict(path=v["path"], sha256=v["sha256"]) for k, v in sorted(files.items())}))
    result = dict(state="valid", role=role, sourceRoot=str(root), materialRoot=str(root), taskDir=task,
                  taskPath=str(initial_task_path), specRoot=str(spec_root),
                  workflowPath=common[".trellis/workflow.md"]["path"], artifacts=artifacts,
                  manifest=manifest, references=refs, sourceFingerprint=fingerprint, revision=fingerprint, issues=[])
    if len(canonical_json(result)) > 512 * 1024:
        raise DiagnosticError("material_limit", "Source authority facts exceed 512 KiB; narrow the manifest references rather than omit required paths", role=role)
    return result


def references(root, task, role):
    return [ref["label"] for ref in source_materials(root, task, role)["references"]]


def require_target_cli(root):
    # Presence/type checks only: never execute any target CLI or hook. The host
    # separately validates the supported release and persistent role/adapter config.
    names = ["worktree.py", "task.py"] + ["pi_trellis_worktree/" + name for name in ("__init__.py", "cli.py", "records.py", "materials.py", "manager.py", "diagnostics.py")]
    for name in names:
        file = root / ".trellis/scripts" / name
        if not os.path.lexists(file) or not contains(root, canonical(file)) or not stat.S_ISREG(file.lstat().st_mode):
            raise DiagnosticError("runtime_invalid", f"Target base lacks local Trellis/native CLI files: {name}; explicitly update the target before preparing (no automatic deployment)", path=str(file))


def local_target(b):
    root = Path(b["worktreePath"])
    require_ignored(root, runtime(root))
    sessions = root / ".trellis/.runtime/sessions"
    if not contains(root, canonical(sessions)):
        raise DiagnosticError("runtime_invalid", "Target sessions runtime cannot symlink outside worktree", path=str(sessions))
    require_ignored(root, sessions)
    return root


def prepare(b, role="implement"):
    role_name(role)
    source = Path(b["sourceRoot"])
    if task_record(source, b["taskDir"]).get("status") != "in_progress":
        raise DiagnosticError("source_not_approved", "Start/approve the source task through the normal workflow first; preparation does not advance a planning task", role=role, path=str(source / b["taskDir"] / "task.json"))
    try:
        require_target_cli(local_target(b))
        return source_materials(source, b["taskDir"], role, approved=True)
    except DiagnosticError as error:
        error.issue.setdefault("role", role)
        raise


def validate_ready(b, role):
    return prepare(b, role)
