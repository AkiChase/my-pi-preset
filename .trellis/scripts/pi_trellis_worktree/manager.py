"""Management transitions. Only confirmed operations acquire the source lock."""
import hashlib
import os
from pathlib import Path
import uuid

from .records import (
    active_execution, assert_destination, atomic_json, binding_file, binding_problems,
    canonical, contains, execution_file, git, marker_file, now, owner_alive,
    read_binding, read_execution, read_marker, repository, require_ignored,
    resolve_base, runtime, same_identity, source_for, source_lock, task_slug,
    validate_branch, worktree_directory,
)
from .materials import (
    prepare, task_record, validate_ready, validate_context, material_graph,
    initialize_snapshot, material_summary, require_fresh, refresh_plan, collect_plan,
    collection_candidates, plan_preview, apply_files, store_snapshot, cleanup_snapshots,
)


def checked_binding(source, task):
    b = read_binding(source["root"], task)
    if b and (b["sourceRoot"] != source["root"] or b["repositoryIdentity"] != source["commonDir"] or b["taskDir"] != task):
        raise ValueError("Authoritative binding identity does not match source/task")
    return b


def require_identity(b, source):
    problems = binding_problems(b, source)
    if problems:
        raise ValueError("; ".join(problems))


def query(cwd, task=None, ready=False):
    # Read-only, including when called while the host already holds the lock.
    source, local = source_for(cwd)
    result = dict(source=source, local=local)
    if task is not None:
        b = checked_binding(source, task)
        result["binding"] = b
        if b:
            require_identity(b, source)
        if ready:
            if not b or b["preparationState"] != "ready":
                raise ValueError("No ready worktree binding; create/adopt then prepare first")
            if task_record(source["root"], task).get("status") != "in_progress":
                raise ValueError("Source task is not approved/in_progress for managed execution")
            validate_ready(b)
        if b and b.get('materials'):
            try:
                result['materials'] = material_summary(b)
            except (ValueError, OSError, UnicodeError) as error:
                if ready:
                    raise
                result['materials'] = dict(state='invalid', error=str(error)[:4096])
        if ready:
            if 'materials' not in result:
                raise ValueError('Missing material snapshot; prepare a new worktree (no migration)')
            require_fresh(result['materials'])
    return result


def snapshot(b):
    digest = hashlib.sha256()
    count = 0

    def walk(directory, prefix=""):
        nonlocal count
        # Match JavaScript's UTF-16 sort used by the host snapshot, including
        # supplementary Unicode names (Python's default codepoint order differs).
        for path in sorted(directory.iterdir(), key=lambda p: p.name.encode("utf-16-be", "surrogatepass")):
            rel = prefix + "/" + path.name if prefix else path.name
            if rel in (".git", ".pi", "node_modules") or rel.startswith(".trellis/.runtime"):
                continue
            count += 1
            if count > 10000:
                raise ValueError("Snapshot file limit reached")
            info = path.lstat()
            if path.is_symlink():
                continue
            if path.is_dir():
                walk(path, rel)
            elif path.is_file():
                digest.update(rel.encode())
                digest.update(str(info.st_size).encode())
                if info.st_size < 4 * 1024 * 1024:
                    digest.update(path.read_bytes())
                else:
                    # Node's mtimeMs is a floating point millisecond timestamp.
                    value = info.st_mtime_ns / 1_000_000
                    digest.update((str(int(value)) if value.is_integer() else str(value)).encode())
    walk(Path(b["worktreePath"]))
    return digest.hexdigest()


def publish(b):
    atomic_json(binding_file(b["sourceRoot"], b["taskDir"]), b)
    atomic_json(marker_file(b["worktreePath"]), b)


def fresh_binding(source, task, expected):
    b = checked_binding(repository(source["root"]), task)
    if not b or not same_identity(b, expected):
        raise ValueError("Binding changed before operation; inspect and retry")
    return b


def remove(b, cwd, integrated_into, confirm):
    if active_execution(b):
        raise ValueError("Cannot remove a running/unknown execution; stop or explicitly recover it first")
    if any(contains(b["worktreePath"], canonical(directory)) for directory in (cwd, os.getcwd())):
        raise ValueError("Cannot remove the current working directory")
    stale = not os.path.lexists(b["worktreePath"])
    ignored = ""
    saved = None
    if not stale:
        if git(b["worktreePath"], ["status", "--porcelain"]):
            raise ValueError("Worktree has staged/unstaged/untracked changes; refusing removal")
        if not integrated_into:
            raise ValueError("Specify --integrated-into: the user-approved reference preserving worktree commits")
        tip = git(b["worktreePath"], ["rev-parse", "HEAD"])
        saved = resolve_base(b["sourceRoot"], integrated_into)
        git(b["sourceRoot"], ["merge-base", "--is-ancestor", tip, saved])
        ignored = git(b["worktreePath"], ["ls-files", "--others", "--ignored", "--exclude-standard"])
    if confirm:
        if not stale:
            if active_execution(b) or git(b["worktreePath"], ["status", "--porcelain"]):
                raise ValueError("Worktree changed before removal")
            tip = git(b["worktreePath"], ["rev-parse", "HEAD"])
            git(b["sourceRoot"], ["merge-base", "--is-ancestor", tip, saved])
            git(b["sourceRoot"], ["worktree", "remove", "--", b["worktreePath"]])
        cleanup_snapshots(b)
        for file in (binding_file(b["sourceRoot"], b["taskDir"]), execution_file(b)):
            file.unlink(missing_ok=True)
    return dict(binding=b, preview=not confirm, ignored=ignored, note=f"{'Removed/unbound' if confirm else 'Removal preview'}. Ignored files at risk:\n{ignored or '(none)'}. No branch deleted.")


def manage(action, cwd, task, confirm=False, path=None, branch=None, base=None, integrated_into=None, files=None):
    source, local = source_for(cwd)
    task_slug(task)
    b = checked_binding(source, task)
    if action == "status":
        if not b:
            return dict(note="No worktree binding for this task.")
        problems = binding_problems(b, source)
        status = git(b["worktreePath"], ["status", "--short"]) if not problems else None
        execution = read_execution(b)
        verification = "not verified"
        materials = None
        if not problems and b.get('materials'):
            try:
                materials = material_summary(b)
            except (ValueError, OSError, UnicodeError) as error:
                materials = dict(state='invalid', error=str(error)[:4096])
        if execution and execution.get("role") == "trellis-check" and execution["state"] == "completed":
            try:
                current = materials and materials['state'] == 'valid' and not materials['sourceDrift']['count'] and not materials['conflicts']['count'] and execution.get('materialRevision') == materials['revision'] and execution.get('finalSnapshot') == snapshot(b)
                verification = "check ended on current snapshot and material revision (inspect its report; not automatic acceptance)" if current else "check snapshot/material lineage stale or unavailable"
            except (ValueError, OSError):
                verification = "check snapshot unavailable"
        return dict(binding=b, problems=problems, gitStatus=status, execution=execution, materials=materials, note=f"Preparation: {b['preparationState']}. Execution: {execution['state'] if execution else 'none'}. {verification}.")
    if action in ('refresh', 'collect'):
        if not b:
            raise ValueError('Task has no worktree binding')
        def plan_for(binding):
            require_identity(binding, repository(source['root']))
            if binding['preparationState'] != 'ready' or active_execution(binding):
                raise ValueError('Refresh/collect require ready and no active/unknown execution')
            if task_record(source['root'], task).get('status') != 'in_progress':
                raise ValueError('Source task must remain in_progress')
            validate_context(binding)  # Do not reject a repairable old target reference graph.
            return refresh_plan(binding) if action == 'refresh' else collect_plan(binding, files)
        files = files or []
        if action == 'collect' and not files:
            if confirm:
                raise ValueError('Collect confirmation requires explicit --file selections')
            plan_for(b)
            return dict(binding=b, preview=True, candidates=collection_candidates(b), note='Select task-local files with --file; review preview/diff before approved --confirm. task.json is never collected.')
        plan = plan_for(b)
        preview = plan_preview(plan)
        if not confirm:
            return dict(binding=b, preview=True, **preview, note='Material plan preview; review hashes/files. Confirmation recomputes under lock, not a persisted reservation.')
        with source_lock(source['root']):
            b = fresh_binding(source, task, b)
            plan = plan_for(b)
            preview = plan_preview(plan)
            if plan['conflicts'] or plan['errors']:
                raise ValueError('Material conflicts/invalid prospective graph: ' + ', '.join(preview['conflicts']['paths'] + plan['errors']) + f" ({preview['conflicts']['count']} conflicts)")
            # All validation precedes any material write. External editors are not locked.
            prior_materials = b.get('materials')
            try:
                destination = b['worktreePath'] if action == 'refresh' else b['sourceRoot']
                apply_files(destination, task, plan['overlay'], plan['actions'], 'target' if action == 'refresh' else 'source')
                validate_ready(b)
                if task_record(b['sourceRoot'], task).get('status') != 'in_progress':
                    raise ValueError('Source lifecycle changed during material operation')
                from .materials import digest, file_hash
                if action == 'refresh':
                    if digest(material_graph(b['sourceRoot'], task)) != plan['beforeSource'] or material_graph(b['worktreePath'], task) != plan['prospectiveTarget']:
                        raise ValueError('Source/target materials changed during refresh')
                else:
                    if digest(material_graph(b['worktreePath'], task)) != plan['beforeTarget'] or material_graph(b['sourceRoot'], task) != plan['prospectiveSource']:
                        raise ValueError('Source/target materials changed during collect')
                for a in plan['actions']:
                    expected = a['source'] if action == 'refresh' else a['target']
                    if a['path'] in plan['overlay'] and file_hash(destination, task, a['path']) != (None if plan['overlay'][a['path']] is None else expected):
                        raise ValueError('Written material changed before snapshot publication')
                if plan['changed'] or plan.get('collectionChanged'):
                    store_snapshot(b, plan['accepted'], plan['ancestors'], advance=plan['changed'])
                publish(b)
            except Exception as error:
                if prior_materials is not None:
                    b['materials'] = prior_materials
                b['preparationState'] = 'error'
                b['lastError'] = str(error)
                publish(b)
                raise
            return dict(binding=b, **plan_preview(plan), note=f'{action.title()} completed; no start/hooks, commit, merge or archive. Inspect reports; no automatic acceptance.')
    if action in ("prepare", "remove", "recover"):
        if not b:
            raise ValueError("Task has no worktree binding; create or adopt first")
        if action == "remove":
            if os.path.lexists(b["worktreePath"]):
                require_identity(b, source)
            if not confirm:
                return remove(b, cwd, integrated_into, False)
            with source_lock(source["root"]):
                b = fresh_binding(source, task, b)
                if os.path.lexists(b["worktreePath"]):
                    require_identity(b, repository(source["root"]))
                return remove(b, cwd, integrated_into, True)
        if action == "recover":
            # Recovery may repair a failed marker publication, but not changed Git identity.
            target = repository(b["worktreePath"])
            if target["root"] != b["worktreePath"] or target["commonDir"] != b["repositoryIdentity"] or not any(r["path"] == b["worktreePath"] and r["branch"] == b["branch"] for r in target["worktrees"]):
                raise ValueError("Cannot recover a missing or changed worktree identity")
            record = read_execution(b)
            if active_execution(b) and owner_alive(record):
                raise ValueError("Execution owner process is still alive; stop through the provider instead of releasing its lease")
            if not confirm:
                return dict(binding=b, preview=True, note="Recovery resets preparation to unprepared and releases only a dead-owner execution; no files are overwritten.")
            with source_lock(source["root"]):
                b = fresh_binding(source, task, b)
                record = read_execution(b)
                if active_execution(b) and owner_alive(record):
                    raise ValueError("Execution owner is alive; cannot recover lease")
                if record:
                    atomic_json(execution_file(b), dict(record, state="stopped", error="Explicit recovery after owner process exited"))
                b["preparationState"] = "unprepared"
                b.pop("lastError", None)
                publish(b)
                return dict(binding=b, note="Recovered to unprepared; run prepare before dispatch.")
        require_identity(b, source)
        if active_execution(b):
            raise ValueError("Task worktree has an active/unknown execution")
        if b["preparationState"] == "ready":
            validate_ready(b)
            require_fresh(material_summary(b))
            return dict(binding=b, reused=True, note="Already prepared; validated without synchronization. Use explicit refresh for source updates.")
        if b["preparationState"] in ("error", "creating", "preparing"):
            raise ValueError("Preparation state requires explicit recover first")
        preview = prepare(b)
        if not confirm:
            return dict(binding=b, preview=True, files=preview["files"], note="Copy selected task materials: " + ", ".join(preview["files"]) + ". Runs target task.py start (records branch, runs configured after_start hooks). Source task must already be in_progress; source lifecycle is unchanged.")
        with source_lock(source["root"]):
            b = fresh_binding(source, task, b)
            require_identity(b, repository(source["root"]))
            if active_execution(b) or b["preparationState"] != "unprepared":
                raise ValueError("Execution/preparation state changed before preparation")
            b["preparationState"] = "preparing"
            b["preparedFiles"] = preview["hashes"]
            atomic_json(binding_file(source["root"], task), b)
            try:
                delivered = material_graph(b['sourceRoot'], task)
                prepared = prepare(b, True)
                if material_graph(b['sourceRoot'], task) != delivered:
                    raise ValueError('Source materials changed during preparation')
                if b.get('materials'):
                    require_fresh(material_summary(b))
                else:
                    initialize_snapshot(b, delivered)
                b["preparationState"] = "ready"
                b["preparedFiles"] = prepared["hashes"]
                b.pop("lastError", None)
            except Exception as error:
                b["preparationState"] = "error"
                b["lastError"] = str(error)
                raise
            finally:
                publish(b)
            return dict(binding=b, note="Ready: task materials and independent target context validated. No agent dispatched.")
    if action not in ("create", "adopt"):
        raise ValueError("Unsupported worktree action")
    if b:
        require_identity(b, source)
        if path is not None and str(canonical(Path(source["root"]) / path)) != b["worktreePath"]:
            raise ValueError("Task already bound to a different path")
        if branch is not None and branch != b["branch"]:
            raise ValueError("Task already bound to a different branch")
        if base is not None and resolve_base(source["root"], base) != b["baseCommit"]:
            raise ValueError("Task already bound to a different base commit")
        if b["preparationState"] in ("error", "creating", "preparing"):
            raise ValueError("Binding requires explicit recover before reuse")
        return dict(binding=b, reused=True, note=f"Existing worktree reused after identity validation; {b['preparationState']}.")
    task_record(source["root"], task)
    root = source["root"]
    if action == "adopt":
        if not path or not os.path.lexists(Path(root) / path):
            raise ValueError("Worktree to adopt does not exist")
        destination = canonical(Path(root) / path)
    else:
        directory = worktree_directory(root)
        if contains(directory, root):
            raise ValueError("Managed directory cannot equal or contain source root")
        destination = canonical(directory / task_slug(task))
    if contains(destination, root):
        raise ValueError("Destination cannot equal the source or contain it")
    if any(contains(directory, destination) for directory in (source["commonDir"], Path(root) / ".trellis", Path(root) / ".pi")):
        raise ValueError("Worktree destination cannot be inside Git/Trellis/Pi metadata directories")
    row = next((r for r in source["worktrees"] if r["path"] == str(destination)), None)
    if action == "adopt":
        target = repository(destination)
        if not row or target["root"] != str(destination) or target["commonDir"] != source["commonDir"] or row["bare"] or not row["branch"]:
            raise ValueError("Adopt requires a branch-backed registered Git worktree of this repository")
        if read_marker(destination):
            raise ValueError("Destination already contains a binding marker")
        assert_destination(root, destination, [r for r in source["worktrees"] if r != row])
    else:
        assert_destination(root, destination, source["worktrees"])
        if os.path.lexists(destination):
            raise ValueError(f"Destination already exists: {destination}; nothing will be overwritten")
    branch = branch if branch is not None else row["branch"] if action == "adopt" else "trellis/" + task_slug(task)
    validate_branch(root, branch)
    if action == "adopt" and branch != row["branch"]:
        raise ValueError("Requested branch does not match existing worktree")
    if action == "create" and f"refs/heads/{branch}" in git(root, ["for-each-ref", "--format=%(refname)", f"refs/heads/{branch}"]).splitlines():
        raise ValueError(f"Branch already exists: {branch}; adopt its existing worktree explicitly")
    base_commit = resolve_base(root, base if base is not None else row["head"] if action == "adopt" else "HEAD")
    plan = dict(action=action, taskDir=task, sourceRoot=root, worktreePath=str(destination), branch=branch, baseCommit=base_commit, note="No staged, unstaged or untracked source changes are copied. Leaves unprepared; no task/agent is started.")
    require_ignored(root, runtime(root))
    if contains(root, destination):
        require_ignored(root, destination)
    if action == "adopt":
        require_ignored(destination, runtime(destination))
    if not confirm:
        return dict(plan=plan, preview=True, note="Creation preview. Repeat with --confirm only after user authorization.")
    with source_lock(root):
        if read_binding(root, task):
            raise ValueError("Task was bound by another operation; query status and retry")
        task_record(root, task)
        if canonical(destination) != destination:
            raise ValueError("Destination parent changed through a symlink; inspect and retry")
        require_ignored(root, runtime(root))
        if contains(root, destination):
            require_ignored(root, destination)
        fresh = repository(root)
        if action == "create":
            assert_destination(root, destination, fresh["worktrees"])
            if os.path.lexists(destination):
                raise ValueError("Destination appeared before creation; refusing to overwrite")
        elif not any(r["path"] == str(destination) and r["branch"] == branch for r in fresh["worktrees"]):
            raise ValueError("Worktree changed before adoption")
        id = str(uuid.uuid4())
        b = dict(version=1, bindingId=id, taskDir=task, sourceRoot=root, worktreePath=str(destination), repositoryIdentity=source["commonDir"], branch=branch, baseCommit=base_commit, contextId="pi-wt-" + id, preparationState="creating", createdAt=now())
        atomic_json(binding_file(root, task), b)
        try:
            if action == "create":
                destination.parent.mkdir(parents=True, exist_ok=True)
                git(root, ["worktree", "add", "-b", branch, "--", str(destination), base_commit])
            target = repository(destination)
            actual = next((r for r in target["worktrees"] if r["path"] == str(destination)), None)
            if target["root"] != str(destination) or target["commonDir"] != source["commonDir"] or not actual or actual["branch"] != branch:
                raise ValueError("Created/adopted worktree identity does not match plan")
            if action == "create" and actual["head"] != base_commit:
                raise ValueError("Created worktree is not at the pinned base commit")
            require_ignored(destination, runtime(destination))
            if read_marker(destination):
                raise ValueError("Target marker appeared during creation/adoption")
            b["preparationState"] = "unprepared"
            atomic_json(marker_file(destination), b)
            atomic_json(binding_file(root, task), b)
        except Exception as error:
            b["preparationState"] = "error"
            b["lastError"] = str(error)
            atomic_json(binding_file(root, task), b)
            raise ValueError(f"{error}. Directory/branch and error record were retained; no cleanup was attempted.") from error
        return dict(plan=plan, binding=b, note="Directory created/adopted, not prepared. Use prepare, then trellis_dispatch.")
