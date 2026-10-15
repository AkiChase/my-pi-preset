/** Fixed package-owned bootstrap. No project path ever becomes Python program text. */
export const DIAGNOSTIC_BOOTSTRAP = String.raw`
import sys, json
if sys.version_info < (3, 10):
    raise RuntimeError("Python 3.10 or later is required")
if not (sys.flags.isolated and sys.flags.no_site and sys.dont_write_bytecode and sys.flags.utf8_mode) or 'site' in sys.modules:
    raise RuntimeError("Required isolated/no-site/no-bytecode/UTF-8 flags are unavailable")
def exact(value, keys):
    if not isinstance(value, dict) or set(value) != set(keys):
        raise ValueError("Invalid diagnostic protocol schema")
raw = sys.stdin.buffer.read(8 * 1024 * 1024 + 1)
if len(raw) > 8 * 1024 * 1024:
    raise ValueError("Diagnostic stdin limit")
request = json.loads(raw.decode('utf-8'))
exact(request, ['schemaVersion', 'requestId', 'scope', 'mode', 'sources', 'snapshots', 'developer'])
if request['schemaVersion'] != 1 or request['mode'] not in ('environment', 'context'):
    raise ValueError("Invalid diagnostic request")
import re
if not isinstance(request['requestId'], str) or not re.fullmatch(r'[a-f0-9-]{36}', request['requestId']):
    raise ValueError("Invalid request ID")
scope = request['scope']
exact(scope, ['executionRoot'])
if not isinstance(scope['executionRoot'], str) or not scope['executionRoot'].startswith('/') or len(scope['executionRoot']) > 8192 or any(ord(c) < 32 for c in scope['executionRoot']):
    raise ValueError("Invalid diagnostic root scope")
if request['developer'] is not None and (not isinstance(request['developer'], str) or len(request['developer']) > 8192):
    raise ValueError("Invalid developer input")
if not isinstance(request['sources'], dict) or not isinstance(request['snapshots'], dict):
    raise ValueError("Invalid source/snapshot table")
if request['mode'] == 'environment':
    if request['sources'] or request['snapshots']:
        raise ValueError("Environment probe cannot load project sources")
    payload = {'version': list(sys.version_info[:3]), 'isolated': True, 'noSite': True, 'noBytecode': True, 'utf8': True}
else:
    import base64, hashlib, importlib.abc, importlib.util
    rows = {}
    if not request['sources'] or len(request['sources']) > 64:
        raise ValueError("Nonempty bounded verified source table required")
    total = 0
    for name, row in request['sources'].items():
        if not isinstance(name, str) or not (name == 'diagnostics' or name == 'common' or name.startswith('common.') or name == 'pi_trellis_worktree' or name.startswith('pi_trellis_worktree.')):
            raise ValueError("Non-reserved source namespace")
        exact(row, ['data', 'sha256', 'mode', 'origin', 'package'])
        if not isinstance(row['data'], str) or not isinstance(row['sha256'], str) or not re.fullmatch(r'[a-f0-9]{64}', row['sha256']) or type(row['mode']) is not int or not 0 <= row['mode'] <= 511 or type(row['package']) is not bool:
            raise ValueError("Invalid source row")
        if not isinstance(row['origin'], str) or not row['origin'].startswith(scope['executionRoot'] + '/.trellis/scripts/') or '..' in row['origin'].split('/'):
            raise ValueError("Invalid deployed source origin")
        data = base64.b64decode(row['data'], validate=True)
        total += len(data)
        if total > 8 * 1024 * 1024 or len(data) > 4 * 1024 * 1024 or b'\0' in data or hashlib.sha256(data).hexdigest() != row['sha256']:
            raise ValueError("Captured source hash/size mismatch")
        data.decode('utf-8')
        rows[name] = (row, data)
    class CapturedLoader(importlib.abc.Loader):
        def __init__(self, row, data): self.row, self.data = row, data
        def create_module(self, spec): return None
        def exec_module(self, module):
            module.__file__ = self.row['origin']
            exec(compile(self.data, self.row['origin'], 'exec', dont_inherit=True), module.__dict__)
    class CapturedFinder(importlib.abc.MetaPathFinder):
        def find_spec(self, name, path=None, target=None):
            reserved = name == 'diagnostics' or name == 'common' or name.startswith('common.') or name == 'pi_trellis_worktree' or name.startswith('pi_trellis_worktree.')
            if not reserved: return None
            if name not in rows: raise ModuleNotFoundError('Missing reserved captured module: ' + name)
            row, data = rows[name]
            spec = importlib.util.spec_from_loader(name, CapturedLoader(row, data), origin=row['origin'], is_package=row['package'])
            if row['package']: spec.submodule_search_locations = []
            return spec
    sys.meta_path.insert(0, CapturedFinder())
    import diagnostics
    payload = diagnostics.collect(request['snapshots'], request['developer'])
print(json.dumps({'schemaVersion': 1, 'requestId': request['requestId'], 'scope': scope, 'mode': request['mode'], 'payload': payload}, ensure_ascii=False, separators=(',', ':')))
`;
export const DIAGNOSTIC_CLOSURE = Object.freeze({
	diagnostics: "diagnostics.py", common: "common/__init__.py", "common.paths": "common/paths.py",
	"common.git": "common/git.py", "common.task_records": "common/task_records.py", "common.active_task": "common/active_task.py",
	"common.io": "common/io.py", "common.config": "common/config.py", "common.trellis_config": "common/trellis_config.py", "common.workflow_phase": "common/workflow_phase.py",
});
