"""Full, budget-independent role validation and task-only preparation.

Prompt rendering/budgets remain host-owned. These validators enforce the same
containment, reference/directory bounds and UTF-8 rules without prefix truncation.
"""
import hashlib
import json
import os
from pathlib import Path
import stat
import sys

from .records import bounded_command, canonical, contains, git, git_environment, json_value, require_ignored, runtime, task_slug


MAX_RECORD = 1024 * 1024


def task_path(root, task):
    task_slug(task)
    root = canonical(root)
    store = (root / ".trellis/tasks").resolve(strict=True)
    lexical = root / task
    actual = lexical.resolve(strict=True)
    if not contains(store, actual) or not actual.is_dir():
        raise ValueError("Task escapes its Trellis task store")
    return lexical


def safe_path(root, task, path):
    root = canonical(root)
    lexical = Path(os.path.abspath(root / path))
    if not contains(root, lexical):
        raise ValueError("Path leaves execution root")
    actual = lexical.resolve(strict=True)
    store = (root / ".trellis/tasks").resolve(strict=True)
    if not contains(root, actual) and not (contains(root / ".trellis/tasks", lexical) and contains(store, actual)):
        raise ValueError("Symlink leaves execution root/task store")
    return actual


def task_record(root, task):
    task_path(root, task)
    path = safe_path(root, task, Path(task) / "task.json")
    if not path.is_file() or path.stat().st_size > MAX_RECORD:
        raise ValueError("task.json must be a regular file under 1 MiB")
    value = json_value(path.read_text(encoding="utf-8"))
    if not isinstance(value, dict):
        raise ValueError("Invalid task.json")
    return value


class MaterialView:
    """Read-only prospective files; None hides a file, bytes replace/add it."""
    def __init__(self, root, task, overlay=None):
        self.root, self.task = Path(root), task
        self.overlay = overlay or {}

    def label(self, path):
        lexical = Path(os.path.abspath(self.root / path))
        if not contains(self.root, lexical):
            raise ValueError("Path leaves execution root")
        return lexical.relative_to(self.root).as_posix()

    def path(self, path):
        label = self.label(path)
        virtual_directory = any(p.startswith(label + '/') and data is not None for p, data in self.overlay.items())
        if label in self.overlay or virtual_directory:
            if label in self.overlay and self.overlay[label] is None:
                raise FileNotFoundError(label)
            # Even virtual writes must not bypass ancestor containment/types.
            lexical = self.root / label
            for parent in lexical.parents:
                if os.path.lexists(parent) and not parent.is_dir():
                    raise ValueError(f'Overlay ancestor is not a directory: {label}')
                if parent == self.root:
                    break
            actual = canonical(lexical)
            store = canonical(self.root / ".trellis/tasks")
            if not contains(self.root, actual) and not (contains(self.root / ".trellis/tasks", self.root / label) and contains(store, actual)):
                raise ValueError("Overlay leaves execution root/task store")
            return actual
        return safe_path(self.root, self.task, path)

    def exists(self, path):
        label = self.label(path)
        return self.overlay[label] is not None if label in self.overlay else os.path.lexists(self.root / label) or any(p.startswith(label + '/') and data is not None for p, data in self.overlay.items())

    def data(self, path):
        label = self.label(path)
        self.path(path)
        if label in self.overlay:
            return self.overlay[label]
        file = self.path(label)
        info = file.stat()
        if not stat.S_ISREG(info.st_mode):
            raise ValueError(f'Material must be a regular file: {label}')
        if info.st_size > 16 * MAX_RECORD:
            raise ValueError(f"Material exceeds 16 MiB: {label}")
        return file.read_bytes()

    def is_dir(self, path):
        label = self.label(path)
        if label in self.overlay:
            self.path(path)
            return False
        if any(p.startswith(label + '/') and data is not None for p, data in self.overlay.items()):
            self.path(path)
            return True
        return self.path(path).is_dir()

    def children(self, path):
        label = self.label(path)
        names = {p.name for p in (self.root / label).iterdir()} if (self.root / label).is_dir() else set()
        prefix = label + "/"
        names.update(p[len(prefix):].split("/")[0] for p, data in self.overlay.items() if p.startswith(prefix) and data is not None)
        return [self.root / label / name for name in sorted(names) if self.exists(self.root / label / name)]


def references(root, task, role, overlay=None):
    view = MaterialView(root, task, overlay)
    record_data = view.data(Path(task) / "task.json")
    if len(record_data) > MAX_RECORD:
        raise ValueError('task.json must be under 1 MiB')
    record = json_value(record_data)
    if not isinstance(record, dict):
        raise ValueError("Invalid task.json")
    seen_files, seen_dirs = set(), set()
    refs = []
    entries = 0

    def add(path, directory=False):
        nonlocal entries
        lexical = Path(os.path.abspath(Path(root) / path))
        label = lexical.relative_to(root).as_posix() if contains(root, lexical) else str(lexical)
        actual = view.path(path)
        if view.is_dir(path):
            if not directory:
                raise ValueError("Directory reference must declare type: directory")
            if actual in seen_dirs:
                return
            seen_dirs.add(actual)
            if len(seen_dirs) > 128:
                raise ValueError("Directory expansion limit reached")
            for name in view.children(path):
                entries += 1
                if entries > 512:
                    raise ValueError("Directory entry limit reached")
                add(name, True)
        elif view.label(path) in view.overlay or actual.is_file():
            if actual not in seen_files:
                seen_files.add(actual)
                refs.append(label)
        else:
            raise ValueError(f"Not a regular file: {label}")

    file = Path(task) / f"{role}.jsonl"
    data = view.data(file)
    if len(data) > MAX_RECORD:
        raise ValueError("JSONL must be a regular file under 1 MiB")
    count = 0
    lines = data.decode("utf-8").split("\n")  # Match host /\r?\n/, not bare CR.
    for i, line in enumerate(lines, 1):
        if not line.strip():
            continue
        try:
            row = json_value(line)
            if not isinstance(row, dict):
                raise ValueError("Expected a JSON object")
            if "file" not in row:
                continue
            if not isinstance(row["file"], str) or not row["file"].strip():
                raise ValueError("Invalid file reference")
            count += 1
            if count > 512:
                raise ValueError("JSONL reference limit reached")
            add(row["file"], row.get("type") == "directory")
        except (ValueError, OSError) as error:
            raise ValueError(f"{task}/{role}.jsonl:{i}: {error}") from error
    if count == 0:
        raise ValueError(f"{task}/{role}.jsonl: No valid file references")
    for name in ("prd.md", "design.md", "implement.md"):
        path = Path(root) / task / name
        if name == "prd.md" or view.exists(path):
            add(path)
    # Required PRD is independent of canonical-file deduplication: an earlier
    # alias reference must not hide an empty requirements artifact.
    if not view.data(Path(task) / "prd.md"):
        raise ValueError("Required PRD is empty or not a regular file")
    for ref in refs:
        if overlay is not None:
            data = view.data(ref)
            if b"\0" in data:
                raise ValueError(f"Binary content: {ref}")
            data.decode("utf-8")
            continue
        path = safe_path(root, task, ref)
        # Streaming avoids allocating unbounded material during readiness queries.
        import codecs
        decoder = codecs.getincrementaldecoder("utf-8")("strict")
        with path.open("rb") as stream:
            while chunk := stream.read(65536):
                if b"\0" in chunk:
                    raise ValueError(f"Binary content: {ref}")
                decoder.decode(chunk)
            decoder.decode(b"", final=True)
        if ref == task + "/prd.md" and path.stat().st_size == 0:
            raise ValueError("Required PRD is empty")
    return refs


def require_target_cli(root):
    files = ["worktree.py", "task.py"] + ["pi_trellis_worktree/" + name for name in ("__init__.py", "cli.py", "records.py", "materials.py", "manager.py")]
    for name in files:
        file = root / ".trellis/scripts" / name
        if not os.path.lexists(file) or not contains(root, canonical(file)) or not stat.S_ISREG(file.lstat().st_mode):
            raise ValueError(f"Target base lacks local Trellis/native CLI files: {name}; commit scaffolding or explicitly update the target before preparing (no automatic deployment)")


def local_target(b):
    root = Path(b["worktreePath"])
    if not contains(root, canonical(root / ".trellis/tasks")):
        raise ValueError("Target task store cannot symlink outside the worktree")
    require_ignored(root, runtime(root))
    sessions = root / ".trellis/.runtime/sessions"
    if not contains(root, canonical(sessions)):
        raise ValueError("Target sessions runtime cannot symlink outside worktree")
    return root


def task_cli(b, args):
    root = Path(b["worktreePath"])
    script = root / ".trellis/scripts/task.py"
    if not contains(root, canonical(script)) or not stat.S_ISREG(script.lstat().st_mode):
        raise ValueError("Target Trellis CLI must be a local regular file in the worktree")
    env = dict(git_environment(), TRELLIS_CONTEXT_ID=b["contextId"], PYTHONDONTWRITEBYTECODE="1")
    code, stdout, stderr = bounded_command([sys.executable, str(script), *args], cwd=root, env=env, timeout=15, limit=MAX_RECORD)
    if code:
        raise ValueError("Trellis CLI failed: " + (stderr or stdout).decode("utf-8", "replace").strip())
    if args[0] == "start" and stdout:
        print(stdout.decode("utf-8", "replace").strip(), file=sys.stderr)
    if stderr:
        print(stderr.decode("utf-8", "replace").strip(), file=sys.stderr)
    return stdout.decode("utf-8")


def validate_context(b):
    root = local_target(b)
    require_target_cli(root)
    record = task_record(root, b["taskDir"])
    if record.get("status") != "in_progress" or record.get("branch") != b["branch"]:
        raise ValueError("Target task must be in_progress with its bound branch before dispatch")
    current = json_value(task_cli(b, ["current", "--json"]))
    if not isinstance(current, dict) or not isinstance(current.get("current_task"), dict) or current["current_task"].get("dir") != b["taskDir"] or current.get("source") != "session:" + b["contextId"] or current.get("stale") or current.get("error"):
        raise ValueError("Trellis current task/context does not match target binding")
    record = task_record(root, b['taskDir'])
    if record.get('status') != 'in_progress' or record.get('branch') != b['branch']:
        raise ValueError('Target lifecycle changed during context query')


def validate_ready(b):
    validate_context(b)
    for role in ("implement", "check"):
        references(Path(b["worktreePath"]), b["taskDir"], role)


def prepare(b, confirm=False):
    source, target, task = Path(b["sourceRoot"]), local_target(b), b["taskDir"]
    if task_record(source, task).get("status") != "in_progress":
        raise ValueError("Start/approve the source task through the normal workflow first; preparation does not advance a planning task")
    files = dict.fromkeys(f"{task}/{name}" for name in ("task.json", "prd.md", "implement.jsonl", "check.jsonl"))
    for name in ("design.md", "implement.md"):
        if os.path.lexists(source / task / name):
            files[f"{task}/{name}"] = None
    for role in ("implement", "check"):
        for ref in references(source, task, role):
            if ref.startswith(task + "/"):
                files[ref] = None
            else:
                original = (source / ref).read_bytes()
                dest = target / ref
                if not dest.exists() or not contains(target, canonical(dest)) or not original == dest.read_bytes():
                    raise ValueError(f"Referenced baseline material differs/missing in target: {ref}; commit or explicitly reconcile it before preparing")
                if git(source, ["status", "--porcelain", "--", ref]):
                    raise ValueError(f"Referenced baseline has uncommitted source differences: {ref}")
    copies = {}
    for file in files:
        src, dest = source / file, target / file
        local_file(source, task, file)
        local_file(target, task, file)
        if not contains(target, canonical(dest)):
            raise ValueError(f"Target file escapes worktree: {file}")
        original = src.read_bytes()
        data = original
        if file.endswith("/task.json"):
            record = json.loads(original)
            record["branch"] = b["branch"]
            data = (json.dumps(record, ensure_ascii=False, indent=2) + "\n").encode()
        if os.path.lexists(dest):
            if not stat.S_ISREG(dest.lstat().st_mode):
                raise ValueError(f"Target material must be a regular file: {file}")
            current = dest.read_bytes()
            if data != current and not (file.endswith("/task.json") and original == current):
                if file.endswith("/task.json") and b.get("preparedFiles", {}).get(file):
                    expected, prior = json.loads(data), json.loads(current)
                    expected.pop("branch", None)
                    prior.pop("branch", None)
                    if expected != prior:
                        raise ValueError(f"Target material conflict: {file}")
                else:
                    raise ValueError(f"Target material conflict: {file}; no overwrite attempted")
        copies[file] = data
    require_ignored(target, target / ".trellis/.runtime/sessions")
    require_target_cli(target)
    hashes = {file: hashlib.sha256(data).hexdigest() for file, data in copies.items()}
    if not confirm:
        return dict(files=list(copies), hashes=hashes)
    for file, data in copies.items():
        dest = local_file(target, task, file)
        if not contains(target, canonical(dest)):
            raise ValueError(f"Target changed: {file}")
        if not os.path.lexists(dest):
            dest.parent.mkdir(parents=True, exist_ok=True)
            dest = local_file(target, task, file)
            with dest.open("xb") as stream:
                stream.write(data)
        else:
            if not stat.S_ISREG(dest.lstat().st_mode):
                raise ValueError(f"Target changed before copying: {file}")
            if dest.read_bytes() != data:
                if not file.endswith("/task.json"):
                    raise ValueError(f"Target changed before copying: {file}")
                expected, current = json.loads(data), json.loads(dest.read_bytes())
                expected.pop("branch", None)
                current.pop("branch", None)
                if expected != current:
                    raise ValueError(f"Target task changed before copying: {file}")
                dest.write_bytes(data)
    task_cli(b, ["start", task])
    validate_ready(b)
    return dict(files=list(copies), hashes=hashes)

# Requirements are whole-file inputs. Runtime fields never flow back to source.
RUNTIME_FIELDS = frozenset(('branch', 'worktree_path', 'status', 'completedAt', 'commit', 'pr_url'))
MAX_FILES = 2048
MAX_SNAPSHOT = 1024 * 1024
MAX_PLAN_BYTES = 64 * 1024 * 1024


def canonical_json(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(',', ':'), allow_nan=False).encode('utf-8')


def digest(value):
    return hashlib.sha256(canonical_json(value)).hexdigest()


def projection(data):
    value = json_value(data)
    if not isinstance(value, dict):
        raise ValueError('Invalid task.json')
    return {k: v for k, v in value.items() if k not in RUNTIME_FIELDS}


def local_file(root, task, label):
    from .records import text
    text(label, 'material path')
    if not label.startswith(task + '/') or Path(label).as_posix() != label or any(p in ('.', '..') or p.startswith('.') for p in Path(label).parts[3:]):
        raise ValueError(f'Not a safe current-task material path: {label}')
    root = Path(root)
    path = root / label
    if not contains(canonical(root / task), canonical(path)):
        raise ValueError(f'Task material escapes task: {label}')
    # Only the explicit top-level task-store route may be a source symlink.
    # A task-directory alias would redirect current-task writes into another task.
    for parent in [path, *path.parents]:
        if parent.is_symlink():
            raise ValueError(f'Task material symlink: {label}')
        if parent != path and os.path.lexists(parent) and not parent.is_dir():
            raise ValueError(f'Task material ancestor is not a directory: {label}')
        if parent == root / task:
            break
    if os.path.lexists(path) and not stat.S_ISREG(path.lstat().st_mode):
        raise ValueError(f'Task material must be a regular file: {label}')
    return path


def file_hash(root, task, label, overlay=None):
    view = MaterialView(root, task, overlay)
    if not view.exists(label):
        return None
    if label.startswith(task + '/'):
        local_file(root, task, label)
    if label == task + '/task.json':
        return digest(projection(view.data(label)))
    if overlay is not None and label in overlay:
        return hashlib.sha256(view.data(label)).hexdigest()
    file = view.path(label)
    hash = hashlib.sha256()
    with file.open('rb') as stream:
        while chunk := stream.read(65536):
            hash.update(chunk)
    return hash.hexdigest()


def material_graph(root, task, overlay=None):
    root = Path(root)
    view = MaterialView(root, task, overlay)
    fixed = [task + '/' + name for name in ('task.json', 'prd.md', 'implement.jsonl', 'check.jsonl')]
    for name in ('design.md', 'implement.md'):
        if view.exists(task + '/' + name):
            fixed.append(task + '/' + name)
    roles = {role: sorted(references(root, task, role, overlay)) for role in ('implement', 'check')}
    labels = set(fixed).union(*roles.values())
    if len(labels) > MAX_FILES:
        raise ValueError('Material file limit reached')
    hashes = {}
    for label in sorted(labels):
        if len(label) > 4096 or any(ord(c) < 32 or ord(c) == 127 for c in label):
            raise ValueError('Material label exceeds path/control bounds')
        hashes[label] = file_hash(root, task, label, overlay)
    return dict(hashes=hashes, roles=roles)


def snapshot_path(b, revision):
    import re
    if not isinstance(revision, str) or not re.fullmatch(r'[A-Za-z0-9-]{1,80}', revision):
        raise ValueError('Invalid material revision')
    directory = runtime(b['sourceRoot']) / 'materials' / b['bindingId']
    path = directory / (revision + '.json')
    for parent in [directory, *directory.parents]:
        if parent == runtime(b['sourceRoot']):
            break
        if parent.is_symlink():
            raise ValueError('Material snapshot directories cannot be symlinks')
    if not contains(directory, canonical(path)):
        raise ValueError('Material snapshot escapes binding directory')
    return path


def load_snapshot(b):
    from .records import read_json
    descriptor = b.get('materials')
    if not descriptor:
        raise ValueError('Missing material snapshot; only newly prepared worktrees are supported (no migration)')
    value = read_json(snapshot_path(b, descriptor['snapshotId']), MAX_SNAPSHOT)
    if not value or type(value.get('version')) is not int or value.get('version') != 1 or set(value) != {'version', 'bindingId', 'revision', 'accepted', 'ancestors'} or value.get('bindingId') != b['bindingId'] or value.get('revision') != descriptor['revision']:
        raise ValueError('Invalid material snapshot identity/version')
    import re
    def hashes(mapping):
        if not isinstance(mapping, dict) or len(mapping) > MAX_FILES:
            raise ValueError('Invalid/bounded material hash map')
        for label, hash in mapping.items():
            if not isinstance(label, str) or len(label) > 4096 or not label or label.startswith('/') or any(p in ('', '.', '..') for p in label.split('/')) or any(ord(c) < 32 or ord(c) == 127 for c in label):
                raise ValueError('Invalid snapshot material label')
            if hash is not None and (not isinstance(hash, str) or not re.fullmatch('[a-f0-9]{64}', hash)):
                raise ValueError('Invalid snapshot material hash')
    hashes(value.get('ancestors'))
    graph = value.get('accepted')
    if not isinstance(graph, dict) or set(graph) != {'hashes', 'roles'}:
        raise ValueError('Invalid accepted source snapshot')
    hashes(graph.get('hashes'))
    roles = graph.get('roles')
    if not isinstance(roles, dict) or set(roles) != {'implement', 'check'} or any(not isinstance(refs, list) or len(refs) > MAX_FILES or any(not isinstance(ref, str) for ref in refs) or len(set(refs)) != len(refs) or any(ref not in graph['hashes'] for ref in refs) for refs in roles.values()):
        raise ValueError('Invalid snapshot reference selection')
    if any(hash is None for hash in graph['hashes'].values()) or any(label.startswith(b['taskDir'] + '/') and label not in value['ancestors'] for label in graph['hashes']):
        raise ValueError('Accepted inputs require hashes and task-local ancestry')
    if any(not label.startswith(b['taskDir'] + '/') for label in value['ancestors']):
        raise ValueError('Snapshot ancestor is not task-local')
    return value


def store_snapshot(b, accepted, ancestors, advance=True):
    from .records import atomic_json
    import uuid
    snapshot_id = str(uuid.uuid4())
    revision = snapshot_id if advance else b['materials']['revision']
    value = dict(version=1, bindingId=b['bindingId'], revision=revision, accepted=accepted, ancestors=ancestors)
    if len((json.dumps(value, ensure_ascii=False, indent=2) + '\n').encode()) > MAX_SNAPSHOT or len(ancestors) > MAX_FILES:
        raise ValueError('Material snapshot size/file limit reached')
    atomic_json(snapshot_path(b, snapshot_id), value)
    b['materials'] = dict(version=1, revision=revision, snapshotId=snapshot_id)


def initialize_snapshot(b, source_graph):
    # B is delivery, not target hook output. Post-start differences remain visible.
    ancestors = {p: h for p, h in source_graph['hashes'].items() if p.startswith(b['taskDir'] + '/')}
    store_snapshot(b, source_graph, ancestors)


def baseline_check(b, source_graph, target_graph):
    task = b['taskDir']
    paths = {p for p in set(source_graph['hashes']) | set(target_graph['hashes']) if not p.startswith(task + '/')}
    for label in paths:
        try:
            s = file_hash(b['sourceRoot'], task, label)
            t = file_hash(b['worktreePath'], task, label)
        except (ValueError, OSError) as error:
            raise ValueError(f'Referenced baseline differs/missing: {label}; explicitly reconcile baseline') from error
        if s is None or t != s or git(b['sourceRoot'], ['status', '--porcelain', '--', label]):
            raise ValueError(f'Referenced baseline differs/missing or source is uncommitted: {label}; explicitly reconcile baseline (never copied)')


def classify(base, source, target):
    if source == target:
        return 'converged'
    if source == base:
        return 'target-only'
    if target == base:
        return 'source-only'
    return 'conflict'


def bounded_labels(labels):
    labels = sorted(labels)
    paths, used = [], 0
    for label in labels[:24]:
        size = len(canonical_json(label))
        if used + size > 8192:
            break
        paths.append(label)
        used += size
    return dict(count=len(labels), paths=paths, omitted=len(labels) - len(paths))


def identity_changed(source, target, task):
    source_record, target_record = task_record(source, task), task_record(target, task)
    return any((key in source_record) != (key in target_record) or source_record.get(key) != target_record.get(key) for key in ('id', 'name'))


def material_summary(b):
    if task_record(b['sourceRoot'], b['taskDir']).get('status') != 'in_progress':
        raise ValueError('Source task must remain in_progress')
    snap = load_snapshot(b)
    task = b['taskDir']
    source = material_graph(b['sourceRoot'], task)
    target = material_graph(b['worktreePath'], task)
    baseline_check(b, source, target)
    old = snap['accepted']['hashes']
    drift = {p for p in set(old) | set(source['hashes']) if old.get(p) != source['hashes'].get(p)}
    if source['roles'] != snap['accepted']['roles']:
        drift.update(task + '/' + r + '.jsonl' for r in ('implement', 'check') if source['roles'][r] != snap['accepted']['roles'][r])
    target_changes, conflicts = [], []
    for p in set(snap['ancestors']) | {p for p in target['hashes'] if p.startswith(task + '/')}:
        base = snap['ancestors'].get(p)
        s = file_hash(b['sourceRoot'], task, p)
        t = file_hash(b['worktreePath'], task, p)
        if t != base:
            target_changes.append(p)
        if p in source['hashes'] and (classify(base, s, t) == 'conflict' or p == task + '/task.json' and identity_changed(b['sourceRoot'], b['worktreePath'], task)):
            conflicts.append(p)
    return dict(state='valid', revision=snap['revision'], sourceFingerprint=digest(source), targetFingerprint=digest(target), sourceDrift=bounded_labels(drift), targetChanges=bounded_labels(target_changes), conflicts=bounded_labels(conflicts), referenceAdded=bounded_labels(set(source['hashes']) - set(old)), referenceRemoved=bounded_labels(set(old) - set(source['hashes'])))


def require_fresh(summary):
    if summary['sourceDrift']['count'] or summary['conflicts']['count']:
        paths = summary['sourceDrift']['paths'] + summary['conflicts']['paths']
        raise ValueError(f"Materials drift/conflict ({summary['sourceDrift']['count']} source changes, {summary['conflicts']['count']} conflicts): " + ', '.join(paths) + '; preview/approve refresh or reconcile before dispatch')


def data_for(root, task, label, target=None):
    data = MaterialView(root, task).data(label)
    if label == task + '/task.json' and target is not None:
        record = task_record(target, task)
        required = projection(data)
        for key in list(record):
            if key not in RUNTIME_FIELDS:
                del record[key]
        record.update(required)
        return (json.dumps(record, ensure_ascii=False, indent=2) + '\n').encode()
    return data


def add_overlay(overlay, label, data):
    if sum(len(value) for value in overlay.values() if value is not None) + (len(data) if data is not None else 0) > MAX_PLAN_BYTES:
        raise ValueError('Material write plan exceeds 64 MiB')
    overlay[label] = data


def refresh_plan(b):
    snap = load_snapshot(b)
    task, source, target = b['taskDir'], Path(b['sourceRoot']), Path(b['worktreePath'])
    sg = material_graph(source, task)
    # The old target graph may be invalid; validate only the prospective overlay.
    overlay, actions, ancestors = {}, [], dict(snap['ancestors'])
    selected = {p for p in sg['hashes'] if p.startswith(task + '/')}
    for label in sorted(set(ancestors) | selected):
        base = ancestors.get(label)
        s, t = file_hash(source, task, label), file_hash(target, task, label)
        if label not in selected:
            action = 'detached' if s is not None else 'delete' if t == base and t is not None else 'orphan'
            if action == 'delete':
                overlay[label] = None
                ancestors[label] = None
        else:
            action = classify(base, s, t)
            if label == task + '/task.json' and identity_changed(source, target, task):
                action = 'conflict'
            if action == 'source-only':
                add_overlay(overlay, label, data_for(source, task, label, target))
                ancestors[label] = s
                action = 'add' if t is None else 'update'
            elif action == 'converged':
                ancestors[label] = s
        actions.append(dict(path=label, action=action, base=base, source=s, target=t, targetBytes=hashlib.sha256((target / label).read_bytes()).hexdigest() if label == task + '/task.json' else None))
    conflicts = [a['path'] for a in actions if a['action'] == 'conflict']
    errors = []
    try:
        tg = material_graph(target, task, overlay)
        baseline_check(b, sg, tg)
    except (ValueError, OSError, UnicodeError) as error:
        errors.append(str(error)[:4096])
    if len(ancestors) > MAX_FILES:
        raise ValueError('Material ancestry file limit reached')
    return dict(accepted=sg, ancestors=ancestors, overlay=overlay, actions=actions, conflicts=conflicts, errors=errors, prospectiveTarget=tg if not errors else None, beforeSource=digest(sg), beforeTarget=digest([(a['path'], a['target']) for a in actions]), changed=sg != snap['accepted'] or ancestors != snap['ancestors'])


def collectible(task, label):
    local = label.removeprefix(task + '/')
    fixed = {'prd.md', 'design.md', 'implement.md', 'implement.jsonl', 'check.jsonl'}
    # Evidence is textual documentation, not arbitrary code/environment files.
    if local not in fixed and not (local.startswith(('research/', 'evidence/')) and Path(local).suffix.lower() in ('.md', '.txt', '.json', '.jsonl', '.csv', '.log')):
        raise ValueError('Not a collectible task document/evidence path: ' + label)
    if any(token in Path(local).name.lower() for token in ('credential', 'secret', 'password', '.env', 'private-key')):
        raise ValueError('Credential/environment file is not collectible: ' + label)


def collection_candidates(b):
    task, root = b['taskDir'], Path(b['worktreePath'])
    labels = []
    count = 0
    for directory, dirs, files in os.walk(root / task, followlinks=False):
        count += len(dirs)
        if count > MAX_FILES:
            raise ValueError('Collection discovery limit reached')
        dirs[:] = sorted(d for d in dirs if not d.startswith('.') and not (Path(directory) / d).is_symlink())
        for name in sorted(files):
            count += 1
            if count > MAX_FILES:
                raise ValueError('Collection discovery limit reached')
            if name.startswith('.') or name == 'task.json':
                continue
            label = (Path(directory) / name).relative_to(root).as_posix()
            local_file(root, task, label)
            try:
                collectible(task, label)
            except ValueError:
                continue
            labels.append(label)
    return bounded_labels(labels)


def collect_plan(b, files):
    snap = load_snapshot(b)
    source, target, task = Path(b['sourceRoot']), Path(b['worktreePath']), b['taskDir']
    sg, tg = material_graph(source, task), material_graph(target, task)
    overlay, actions, ancestors = {}, [], dict(snap['ancestors'])
    if len(files) > MAX_FILES or len(set(files)) != len(files):
        raise ValueError('Duplicate/too many collection files')
    selected_inodes = set()
    for label in files:
        if label == task + '/task.json':
            raise ValueError('Collect never writes task.json')
        collectible(task, label)
        local_file(source, task, label)
        target_file = local_file(target, task, label)
        info = target_file.stat()
        inode = (info.st_dev, info.st_ino)
        if inode in selected_inodes:
            raise ValueError('Duplicate collection file alias')
        selected_inodes.add(inode)
        data = MaterialView(target, task).data(label)  # Missing target never propagates deletion.
        if b'\0' in data:
            raise ValueError('Binary collection material: ' + label)
        data.decode('utf-8')
        base = ancestors.get(label)
        s, t = file_hash(source, task, label), file_hash(target, task, label)
        action = classify(base, s, t)
        if action == 'target-only':
            add_overlay(overlay, label, data)
            ancestors[label] = t
            action = 'add' if s is None else 'update'
        elif action == 'converged':
            ancestors[label] = s
        actions.append(dict(path=label, action=action, base=base, source=s, target=t))
    errors = []
    try:
        prospective = material_graph(source, task, overlay)
        # Referenced task dependencies must be explicitly selected or identical.
        if any(p.endswith('/implement.jsonl') or p.endswith('/check.jsonl') for p in files):
            dependencies = set().union(*(prospective['roles'][role] for role in ('implement', 'check') if task + '/' + role + '.jsonl' in files))
            for p in dependencies:
                h = prospective['hashes'][p]
                if p.startswith(task + '/') and p != task + '/task.json' and tg['hashes'].get(p) != h:
                    raise ValueError('Collection manifest dependency must be explicitly selected or match source: ' + p)
        baseline_check(b, prospective, tg)
    except (ValueError, OSError, UnicodeError) as error:
        errors.append(str(error)[:4096])
        prospective = sg
    # Accept only explicitly collected inputs, never unrelated source drift.
    accepted = json_value(canonical_json(snap['accepted']))
    input_changed = False
    for a in actions:
        p = a['path']
        if a['action'] in ('add', 'update', 'converged') and p in prospective['hashes'] and (p in accepted['hashes'] or p in tg['hashes']):
            accepted['hashes'][p] = prospective['hashes'][p]
            input_changed |= sg['hashes'].get(p) != prospective['hashes'][p] or snap['accepted']['hashes'].get(p) != prospective['hashes'][p]
    for role in ('implement', 'check'):
        selected_manifest = any(a['path'] == task + '/' + role + '.jsonl' and a['action'] in ('add', 'update', 'converged') for a in actions)
        if not selected_manifest and not errors:
            # A selected new file can expand an already accepted directory ref.
            # Accept only that explicit dependency, not unrelated source changes.
            additions = {a['path'] for a in actions if a['action'] in ('add', 'update', 'converged') and a['path'] in prospective['roles'][role] and a['path'] in tg['roles'][role]}
            revised = sorted(set(accepted['roles'][role]) | additions)
            input_changed |= revised != accepted['roles'][role]
            accepted['roles'][role] = revised
        if selected_manifest and not errors:
            accepted['roles'][role] = prospective['roles'][role]
            input_changed |= accepted['roles'][role] != snap['accepted']['roles'][role]
            for p in prospective['roles'][role]:
                if p not in accepted['hashes']:
                    accepted['hashes'][p] = prospective['hashes'][p]
                    if p.startswith(task + '/') and p not in ancestors:
                        ancestors[p] = prospective['hashes'][p]
            still_used = set(accepted['roles']['implement']) | set(accepted['roles']['check']) | {task + '/' + n for n in ('task.json','prd.md','design.md','implement.md','implement.jsonl','check.jsonl')}
            accepted['hashes'] = {p: h for p, h in accepted['hashes'].items() if p in still_used}
    if len(ancestors) > MAX_FILES:
        raise ValueError('Material ancestry file limit reached')
    return dict(accepted=accepted, ancestors=ancestors, overlay=overlay, actions=actions, conflicts=[a['path'] for a in actions if a['action'] == 'conflict'], errors=errors, prospectiveSource=prospective, beforeSource=digest(sg), beforeTarget=digest(tg), changed=input_changed, collectionChanged=ancestors != snap['ancestors'])


def apply_files(root, task, overlay, actions, direction):
    import uuid
    expected = {a['path']: a[direction] for a in actions}
    def unchanged(label, dest):
        if file_hash(root, task, label) != expected[label]:
            return False
        action = next(a for a in actions if a['path'] == label)
        return not action.get('targetBytes') or hashlib.sha256(dest.read_bytes()).hexdigest() == action['targetBytes']
    for label, data in overlay.items():
        dest = local_file(root, task, label)
        if not unchanged(label, dest):
            raise ValueError('Material changed before write: ' + label)
        if data is None:
            dest.unlink()
        elif not os.path.lexists(dest):
            dest.parent.mkdir(parents=True, exist_ok=True)
            dest = local_file(root, task, label)
            with dest.open('xb') as stream:
                stream.write(data)
        else:
            mode = stat.S_IMODE(dest.stat().st_mode)
            temp = dest.parent / ('.material-' + str(uuid.uuid4()) + '.tmp')
            try:
                with temp.open('xb') as stream:
                    stream.write(data)
                temp.chmod(mode)
                local_file(root, task, label)
                if not unchanged(label, dest):
                    raise ValueError('Material changed before replacement: ' + label)
                os.replace(temp, dest)
            finally:
                temp.unlink(missing_ok=True)


def plan_preview(plan):
    snapshot_value = dict(version=1, bindingId='x'*36, revision='x'*36, accepted=plan['accepted'], ancestors=plan['ancestors'])
    if len((json.dumps(snapshot_value, ensure_ascii=False, indent=2) + '\n').encode()) > MAX_SNAPSHOT:
        raise ValueError('Prospective material snapshot exceeds 1 MiB')
    if sum(len(data) for data in plan['overlay'].values() if data is not None) > MAX_PLAN_BYTES:
        raise ValueError('Material write plan exceeds 64 MiB')
    actions = plan['actions']
    shown, used = [], 0
    for action in actions[:48]:
        size = len(canonical_json(action))
        if used + size > 24576:
            break
        shown.append(action)
        used += size
    return dict(applicable=not plan['conflicts'] and not plan['errors'], actions=shown, omitted=len(actions)-len(shown), conflicts=bounded_labels(plan['conflicts']), errors=plan['errors'], sourceFingerprint=plan['beforeSource'], targetFingerprint=plan['beforeTarget'], checkInvalidated=plan['changed'])


def cleanup_snapshots(b):
    directory = snapshot_path(b, 'probe').parent
    if directory.exists():
        for path in directory.iterdir():
            if path.suffix != '.json' or not stat.S_ISREG(path.lstat().st_mode):
                raise ValueError('Unexpected material snapshot cleanup entry')
        for path in directory.iterdir():
            path.unlink()
        directory.rmdir()
