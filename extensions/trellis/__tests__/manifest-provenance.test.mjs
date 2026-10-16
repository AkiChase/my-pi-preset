import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, readdirSync, lstatSync, chmodSync, symlinkSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';
import { plan, apply, inspect, verifyRuntime, digest, runtimeBaseline, validateManifest, packageProvenance } from '../lib/initialization/engine.ts';
import { copyRuntimeFixture } from './runtime-fixture.mjs';
import { fileURLToPath } from 'node:url';

// Trellis resource root; tests never depend on the process cwd.
const pkg = fileURLToPath(new URL('..', import.meta.url));
const at = path => join(pkg, path);

const manifestPath = '.trellis/.pi-trellis.json';
const workflow = '.trellis/workflow.md';
const missingIndex = '.trellis/spec/index.md';
const revision = '2e8e73cc18eaf937a41ec023a3fbd9f295642496';
// Cases that only need an initialized project use the shared build directly; cases that mutate
// files copy it, so one initialization per process replaces one per case.
function shape(root) { const put = (path, value) => { mkdirSync(dirname(join(root, path)), { recursive: true }); writeFileSync(join(root, path), typeof value === 'string' ? value : JSON.stringify(value)); };
 const snapshot = (directory = root) => Object.fromEntries(readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name)).flatMap(e => {
  const path = join(directory, e.name), rel = path.slice(root.length + 1);
  return e.isDirectory() ? [[rel, 'directory'], ...Object.entries(snapshot(path))] : [[rel, e.isSymbolicLink() ? 'symlink' : `${lstatSync(path).mode & 0o777}:${readFileSync(path).toString('base64')}`]];
 }));
 const manifestFile = join(root, manifestPath);
 const manifest = existsSync(manifestFile) ? JSON.parse(readFileSync(manifestFile)) : undefined;
 return { root, put, snapshot, manifest };
}
// Cases that only need an initialized project use the shared build directly; cases that mutate
// files copy it, so one initialization per process replaces one per case.
function fixture(t) { return shape(copyRuntimeFixture(t, { user: 'Returning User' })); }
// Test-only construction: public init has no preserve/migration input. The shared build is
// transformed once; every copying case sees the same preserved layout.
function preserve(root) {
 const manifest = JSON.parse(readFileSync(join(root, manifestPath)));
 for (const path of Object.keys(manifest.templates)) {
  const absent = path === missingIndex;
  const content = `Legacy project-owned ${path}\r\nCustom conventions retained.\r\n`;
  const mode = path === workflow ? 0o640 : 0o644;
  if (absent) rmSync(join(root, path));
  else { mkdirSync(dirname(join(root, path)), { recursive: true }); writeFileSync(join(root, path), content); chmodSync(join(root, path), mode); }
  manifest.templates[path] = { origin: 'preserved-project', sha256: absent ? null : digest(content), mode: absent ? null : mode, source: { kind: 'project-snapshot', revision } };
 }
 writeFileSync(join(root, manifestPath), JSON.stringify(manifest, null, 2) + '\n');
}
function preserved(t) { return shape(copyRuntimeFixture(t, { key: 'preserved', user: 'Returning User', prepare: preserve })); }
function rehash(plan) { const { planHash, ...body } = plan; plan.planHash = digest(JSON.stringify(body)); }

test('manifest separates exact runtime/roles from seven preserved old-project templates and an absent index', t => {
 const f = preserved(t), before = f.snapshot(), release = runtimeBaseline().releaseId;
 const m = verifyRuntime(f.root);
 assert.equal(m.schemaVersion, 3); assert.equal(m.runtimeReleaseId, release);
 assert.equal(Object.values(m.files).filter(v => v.kind === 'runtime').length, Object.keys(runtimeBaseline().files).length);
 assert.equal(Object.values(m.files).filter(v => v.kind === 'agent').length, 3);
 assert.equal(Object.keys(m.templates).length, 8);
 for (const [path, value] of Object.entries(m.templates)) {
  assert.equal(value.origin, 'preserved-project');
  assert.equal(Object.hasOwn(m.files, path), false);
  if (path === missingIndex) assert.deepEqual([value.sha256, value.mode], [null, null]);
  else { assert.equal(value.sha256, digest(readFileSync(join(f.root, path)))); assert.equal(value.mode, lstatSync(join(f.root, path)).mode & 0o777); }
 }
 assert.equal(inspect(f.root).state, 'ready'); assert.deepEqual(f.snapshot(), before);
 // Provenance is an initial diagnostic, not an assertion of current editable bytes.
 f.put(workflow, 'later user edit'); assert.equal(inspect(f.root).state, 'ready');
});

test('preserved clone identity setup/retry retains exact provenance and all project templates without overwrite', t => {
 const f = preserved(t); rmSync(join(f.root, '.trellis/.developer'));
 const before = f.snapshot(), p = plan(f.root, 'Returning User');
 assert.equal(inspect(f.root).state, 'supported'); assert.equal(p.operation, 'identity');
 assert.ok(p.actions.every(a => ['identity', 'workspace', 'task'].includes(a.kind)));
 assert.throws(() => apply(p, { afterWrite: () => { throw Error('interrupted identity'); } }), /interrupted/);
 assert.equal(inspect(f.root).state, 'incomplete'); assert.equal(apply(plan(f.root, 'Returning User')).state, 'ready');
 for (const [path, value] of Object.entries(before)) if (path !== '.trellis/.runtime/init-operation.json') assert.equal(f.snapshot()[path], value, path);
 assert.equal(f.snapshot()[missingIndex], undefined);
 assert.deepEqual(verifyRuntime(f.root).templates, f.manifest.templates);
 const ready = f.snapshot(); assert.equal(plan(f.root, 'Returning User'), undefined); assert.deepEqual(f.snapshot(), ready);
});

const malformedManifests = {
 'unreleased schema1': m => { m.schemaVersion = 1; },
 'unreleased schema4': m => { m.schemaVersion = 4; },
 'skills under schema2': m => { m.schemaVersion = 2; },
 'schema3 without skills': m => { delete m.skills; },
 'unknown skill entry': m => { m.skills['.pi/skills/trellis-extra/SKILL.md'] = m.skills['.pi/skills/trellis-start/SKILL.md']; },
 'wrong skill source': m => { m.skills['.pi/skills/trellis-start/SKILL.md'].source = 'runtime/task.py'; },
 'unknown skill field': m => { m.skills['.pi/skills/trellis-start/SKILL.md'].kind = 'runtime'; },
 'invalid skill hash': m => { m.skills['.pi/skills/trellis-start/SKILL.md'].sha256 = 'A'.repeat(64); },
 'skills array': m => { m.skills = []; },
 'null files': m => { m.files = null; },
 'array files': m => { m.files = []; },
 'missing runtime': m => { delete m.files['.trellis/scripts/task.py']; },
 'unknown runtime replacing known': m => { m.files['.trellis/scripts/evil.py'] = m.files['.trellis/scripts/task.py']; delete m.files['.trellis/scripts/task.py']; },
 'null runtime source': m => { m.files['.trellis/scripts/task.py'].source = null; },
 'unknown role': m => { m.files['.pi/agents/trellis-extra.md'] = m.files['.pi/agents/trellis-check.md']; },
 'missing role': m => { delete m.files['.pi/agents/trellis-check.md']; },
 'wrong runtime kind': m => { m.files['.trellis/scripts/task.py'].kind = 'template'; },
 'wrong runtime hash': m => { m.files['.trellis/scripts/task.py'].sha256 = digest('untrusted'); },
 'wrong role source': m => { m.files['.pi/agents/trellis-check.md'].source = 'runtime/task.py'; },
 'wrong role kind': m => { m.files['.pi/agents/trellis-check.md'].kind = 'runtime'; },
 'malformed role hash': m => { m.files['.pi/agents/trellis-check.md'].sha256 = 'A'.repeat(64); },
 'malformed role mode': m => { m.files['.pi/agents/trellis-check.md'].mode = '0644'; },
 'unknown role field': m => { m.files['.pi/agents/trellis-check.md'].authorize = true; },
 'unknown manifest field': m => { m.authorize = true; },
 'null templates': m => { m.templates = null; },
 'array templates': m => { m.templates = []; },
 'missing template': m => { delete m.templates[workflow]; },
 'extra template': m => { m.templates['user.txt'] = { sha256: digest('x'), mode: 0o644, origin: 'package-default', source: 'user.txt' }; },
 'unknown template replacing known': m => { m.templates['../outside'] = m.templates[workflow]; delete m.templates[workflow]; },
 'template in executable files': m => { m.files[workflow] = m.templates[workflow]; },
 'null template record': m => { m.templates[workflow] = null; },
 'unknown template origin': m => { m.templates[workflow].origin = 'external'; },
 'arbitrary source string': m => { m.templates[workflow].source = '/tmp/untrusted.py'; },
 'unknown source field': m => { m.templates[workflow].source.path = '../outside'; },
 'wrong source discriminator': m => { m.templates[workflow].source.kind = 'package-default'; },
 'unbounded source revision': m => { m.templates[workflow].source.revision = 'a'.repeat(4096); },
 'revision path': m => { m.templates[workflow].source.revision = '../outside'; },
 'revision wrong type': m => { m.templates[workflow].source.revision = 42; },
 'revision trailing newline': m => { m.templates[workflow].source.revision = revision + '\n'; },
 'revision short with newline': m => { m.templates[workflow].source.revision = 'a'.repeat(39) + '\n'; },
 'revision uppercase': m => { m.templates[workflow].source.revision = 'A'.repeat(40); },
 'short hash': m => { m.templates[workflow].sha256 = 'a'.repeat(63); },
 'hash trailing newline': m => { m.templates[workflow].sha256 = 'a'.repeat(64) + '\n'; },
 'uppercase hash': m => { m.templates[workflow].sha256 = 'A'.repeat(64); },
 'null hash with mode': m => { m.templates[workflow].sha256 = null; },
 'hash with null mode': m => { m.templates[workflow].mode = null; },
 'string mode': m => { m.templates[workflow].mode = '0644'; },
 'fractional mode': m => { m.templates[workflow].mode = 1.5; },
 'negative mode': m => { m.templates[workflow].mode = -1; },
 'excess mode bits': m => { m.templates[workflow].mode = 0o1000; },
 'missing source revision': m => { delete m.templates[workflow].source.revision; },
 'unknown template field': m => { m.templates[workflow].output = 'untrusted'; },
};
let schemaManifest;
const schemaPackage = packageProvenance();
for (const [attack, mutate] of Object.entries(malformedManifests)) {
 test(`manifest schema rejects ${attack}`, t => {
  schemaManifest ??= preserved(t).manifest;
  const manifest = structuredClone(schemaManifest);
  mutate(manifest);
  assert.throws(() => validateManifest(manifest, schemaPackage));
 });
}

// Field combinations belong to the validator matrix above. Keep the real
// runtime/inspection/planning refusal wiring for each resource category.
for (const attack of ['wrong runtime hash', 'string mode', 'invalid skill hash']) {
 test(`malformed ${attack} blocks runtime and planning without writes`, t => {
  const f = preserved(t);
  malformedManifests[attack](f.manifest); f.put(manifestPath, f.manifest);
  const before = f.snapshot();
  assert.throws(() => verifyRuntime(f.root)); assert.equal(inspect(f.root).state, 'conflict');
  assert.throws(() => plan(f.root, 'Returning User')); assert.deepEqual(f.snapshot(), before);
 });
}

test('stale role/template fingerprints are safe updates while runtime rows and malformed shapes still reject', t => {
	// A role row that only records older bytes/mode is a safe update, never a blocked project: dispatch
	// reads the role file without hash checks, and Update restores the exact current fingerprint.
	const f = fixture(t), role = '.pi/agents/trellis-check.md';
	f.manifest.files[role] = { ...f.manifest.files[role], sha256: digest('older role wording'), mode: 0o600 };
	f.put(manifestPath, f.manifest);
	assert.equal(inspect(f.root).state, 'ready'); assert.ok(verifyRuntime(f.root));
	assert.ok(readFileSync(join(f.root, role), 'utf8').startsWith('---'));
	// A package-default template row with an older fingerprint is likewise a safe refresh of the record.
	f.manifest.templates[workflow] = { ...f.manifest.templates[workflow], sha256: digest('older workflow'), mode: 0o640 };
	f.put(manifestPath, f.manifest); assert.ok(verifyRuntime(f.root));
	// Only runtime rows must equal the current package bytes, and every row still needs a valid shape.
	for (const [field, value] of [['sha256', digest('untrusted')], ['mode', 0o600], ['source', 'runtime/other.py']]) {
	 const g = fixture(t); g.manifest.files['.trellis/scripts/task.py'][field] = value; g.put(manifestPath, g.manifest); assert.throws(() => verifyRuntime(g.root));
	}
	for (const [field, value] of [['sha256', null], ['mode', null], ['sha256', 'A'.repeat(64)], ['mode', 0o1000], ['source', 'resources/templates/config.yaml']]) {
	 const g = fixture(t); g.manifest.templates[workflow][field] = value; g.put(manifestPath, g.manifest); assert.throws(() => verifyRuntime(g.root));
	}
	for (const attack of ['bytes', 'mode']) {
	 const g = preserved(t), path = '.trellis/scripts/task.py';
	 if (attack === 'bytes') g.put(path, '# untrusted runtime\n'); else chmodSync(join(g.root, path), 0o600);
	 const before = g.snapshot(); assert.throws(() => verifyRuntime(g.root), /missing or modified/); assert.deepEqual(g.snapshot(), before);
	}
});

test('bounded null/64-character revisions and mixed provenance are diagnostic, never filesystem source paths', t => {
 const f = preserved(t), canonical = JSON.parse(readFileSync(join(fixture(t).root, manifestPath))).templates;
 f.manifest.templates[workflow].source.revision = null;
 f.manifest.templates['.trellis/config.yaml'].source.revision = 'a'.repeat(64);
 f.manifest.templates['.trellis/spec/guides/index.md'] = canonical['.trellis/spec/guides/index.md'];
 f.put(manifestPath, f.manifest); assert.ok(verifyRuntime(f.root));
 const victim = shape(mkdtempSync(join(tmpdir(), 'pi-manifest-victim-'))); t.after(() => rmSync(victim.root, { recursive: true, force: true })); rmSync(join(f.root, missingIndex), { force: true }); symlinkSync(join(victim.root, 'absent'), join(f.root, missingIndex));
 const before = f.snapshot(); assert.throws(() => verifyRuntime(f.root), /symlinked/); assert.deepEqual(f.snapshot(), before); assert.deepEqual(readdirSync(victim.root), []);
});

for (const attack of ['preserved manifest output', 'arbitrary template output', 'identity template action']) {
 test(`preserved diagnostic provenance cannot authorize recovery: ${attack}`, t => {
  const f = attack === 'identity template action' ? preserved(t) : fixture(t);
  if (attack === 'identity template action') rmSync(join(f.root, '.trellis/.developer'));
  const p = plan(f.root, 'Returning User'); assert.throws(() => apply(p, { afterWrite: () => { throw Error('interrupt'); } }));
  const opPath = '.trellis/.runtime/init-operation.json', op = JSON.parse(readFileSync(join(f.root, opPath))), q = op.plan;
  if (attack === 'preserved manifest output') {
   const action = q.actions.find(a => a.kind === 'manifest'), m = JSON.parse(Buffer.from(action.output, 'base64'));
   m.templates[workflow] = { origin: 'preserved-project', sha256: null, mode: null, source: { kind: 'project-snapshot', revision: null } };
   action.output = Buffer.from(JSON.stringify(m, null, 2) + '\n').toString('base64');
  } else if (attack === 'arbitrary template output') q.actions.find(a => a.kind === 'template').output = Buffer.from('untrusted template').toString('base64');
  else { q.actions.push({ path: missingIndex, original: null, kind: 'template', mode: 0o644, output: Buffer.from('untrusted').toString('base64') }); q.guards[missingIndex] = null; }
  rehash(q); f.put(opPath, op); const before = f.snapshot();
  assert.equal(inspect(f.root).state, 'conflict'); assert.throws(() => plan(f.root, 'Returning User')); assert.throws(() => apply(q)); assert.deepEqual(f.snapshot(), before);
 });
}

test('directly maintained role/skill/template hashes preserve historical provenance and dynamic resource counts', () => {
 const agents = JSON.parse(readFileSync(at('resources/agent-baseline.json'), 'utf8'));
 const historical = {
  implement: '73b56b3047c0e852382c4630aa181fb847d1e5ea1f63459dac4bf728f43fd097',
  check: '9e48342243f311d55386f8fb42933945e87aba73d5ade547133aa98345a06128',
  research: 'add4aa4259ded425b04ec992802c646490352bb4eb3730a7ab450beea87d4faa',
 };
 assert.equal(agents.version, '0.6.17'); assert.equal(agents.platform, 'claude'); assert.equal(agents.adapted, '2026-10-12');
 for (const [role, source] of Object.entries(historical)) {
  assert.equal(agents.files[role].source, source);
  assert.equal(agents.files[role].adapted, digest(readFileSync(at(`agents/trellis-${role}.md`))));
 }
 const skills = JSON.parse(readFileSync(at('resources/skill-baseline.json'), 'utf8'));
 for (const [path, source] of [['trellis-start/SKILL.md', '79a5ba7a2aff3c72e06d7f4cd6942dc4f4f4092dd40f9c8e94f1838024a81e4d']]) {
  assert.equal(skills.files[path].sourceSha256, source);
  assert.equal(skills.files[path].sha256, digest(readFileSync(at(`skills/${path}`))));
  assert.equal(skills.files[path].license, 'AGPL-3.0-only');
 }
 const templates = JSON.parse(readFileSync(at('resources/template-baseline.json'), 'utf8'));
 assert.equal(templates.files['workflow.md'].sha256, digest(readFileSync(at('resources/templates/workflow.md'))));
 assert.equal(templates.files['workflow.md'].license, 'AGPL-3.0-only');
 assert.match(templates.files['workflow.md'].origin, /no exact upstream template revision asserted/);
 const baseline = runtimeBaseline();
 assert.ok(Object.keys(baseline.files).length > 0);
 assert.equal(Object.keys(agents.files).length, 3);
 for (const [path, record] of Object.entries(baseline.files)) assert.equal(record.sha256, digest(readFileSync(at(`runtime/${path}`))), path);
});

test('native diagnostics is MIT package source with an exact release hash',()=>{
 const baseline=JSON.parse(readFileSync(at('resources/runtime-baseline.json'),'utf8'));
 const path='pi_trellis_worktree/diagnostics.py', record=baseline.files[path];
 assert.equal(record.origin,'pi-trellis');assert.equal(record.license,'MIT');
 assert.equal(record.sha256,digest(readFileSync(at('runtime/')+path)));
 assert.equal(record.sourceSha256,null);assert.equal(record.sourcePath,null);
});
