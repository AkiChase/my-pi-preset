import './host-env.mjs';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, readdirSync, lstatSync, existsSync, realpathSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import test from 'node:test';
import trellis from '../index.ts';
import { plan, apply, verifyRuntime, digest, packageSkills, packageRoot, SKILL_ROOT } from '../lib/initialization/engine.ts';
import { resourcePlan, applyResourcePlan } from '../lib/initialization/resources.ts';
import { collectDiagnostics, DiagnosticReader } from '../lib/initialization/diagnostics.ts';
import { registerInitCommand, ACTIONS } from '../lib/initialization/command.ts';
import { copyRuntimeFixture } from './runtime-fixture.mjs';

const MANIFEST = '.trellis/.pi-trellis.json';
const skills = packageSkills();
const reference = '.pi/skills/trellis-meta/references/local-architecture/bundled-skills.md';
const entry = '.pi/skills/trellis-check/SKILL.md';

function fresh(t) {
 const root = realpathSync(mkdtempSync(join(tmpdir(), 'pi-skill-fresh-')));
 t.after(() => rmSync(root, { recursive: true, force: true }));
 return root;
}
const put = (root, path, value) => { mkdirSync(dirname(join(root, path)), { recursive: true }); writeFileSync(join(root, path), value); };
const manifest = root => JSON.parse(readFileSync(join(root, MANIFEST)));
const writeManifest = (root, value) => writeFileSync(join(root, MANIFEST), JSON.stringify(value, null, 2) + '\n');
function snapshot(root, dir = root) {
 return Object.fromEntries(readdirSync(dir, { withFileTypes: true }).flatMap(e => {
  const path = join(dir, e.name), rel = path.slice(root.length + 1);
  return e.isDirectory() ? [[rel, 'dir'], ...Object.entries(snapshot(root, path))] : [[rel, readFileSync(path).toString('base64')]];
 }));
}
/** The previous release: schema 2, no skills recorded or deployed. */
function olderProject(t) {
 const root = copyRuntimeFixture(t), m = manifest(root);
 delete m.skills; m.schemaVersion = 2; writeManifest(root, m);
 rmSync(join(root, SKILL_ROOT), { recursive: true });
 return root;
}

test('fresh init publishes every package skill file with manifest records; supporting files precede each SKILL.md', t => {
 const root = fresh(t), p = plan(root, 'Dev'), order = p.actions.map(a => a.path);
 assert.deepEqual(p.actions.filter(a => a.kind === 'skill').map(a => a.path), Object.keys(skills));
 for (const path of Object.keys(skills)) if (!path.endsWith('/SKILL.md')) assert.ok(order.indexOf(path) < order.indexOf(`${path.split('/').slice(0, 3).join('/')}/SKILL.md`), path);
 assert.equal(order.at(-1), MANIFEST);
 apply(p);
 const m = verifyRuntime(root);
 assert.equal(m.schemaVersion, 3);
 assert.deepEqual(m.skills, skills);
 for (const [path, record] of Object.entries(m.skills)) {
  assert.equal(record.source, `skills/${path.slice(SKILL_ROOT.length + 1)}`);
  assert.equal(digest(readFileSync(join(root, path))), record.sha256, path);
  assert.equal(lstatSync(join(root, path)).mode & 0o777, record.mode, path);
 }
 // Skills are recorded separately from runtime/agent files and nothing else lands in .pi/skills.
 assert.ok(!Object.keys(m.files).some(path => path.startsWith(SKILL_ROOT)));
 const files = Object.entries(snapshot(root)).filter(([path, value]) => path.startsWith(SKILL_ROOT + '/') && value !== 'dir').map(([path]) => path);
 assert.deepEqual(files.sort(), Object.keys(skills).sort());
});

test('init preserves an unmanaged same-name skill folder and writes nothing', t => {
 const root = fresh(t);
 put(root, '.pi/skills/trellis-check/notes.md', 'user notes');
 const before = snapshot(root);
 assert.throws(() => plan(root, 'Dev'), /not managed by Trellis; preserved.*\.pi\/skills\/trellis-check/);
 assert.deepEqual(snapshot(root), before);
});

test('content appearing in a planned skill folder before apply is preserved and blocks publication', t => {
 const root = fresh(t), p = plan(root, 'Dev');
 put(root, '.pi/skills/trellis-start/mine.md', 'mine');
 assert.throws(() => apply(p), /Unmanaged content in skill folder/);
 assert.equal(readFileSync(join(root, '.pi/skills/trellis-start/mine.md'), 'utf8'), 'mine');
 assert.ok(!existsSync(join(root, '.pi/skills/trellis-start/SKILL.md')));
 assert.ok(!existsSync(join(root, MANIFEST)));
});

test('previous-release project keeps runtime authority and gets an explicit Update plan that adds all skills', t => {
 const root = olderProject(t);
 assert.ok(verifyRuntime(root));
 const p = resourcePlan(root, 'update');
 assert.deepEqual(p.report.conflicts, []); assert.equal(p.unchanged, false);
 assert.deepEqual(p.changes.map(c => c.path), Object.keys(skills));
 assert.ok(p.report.rows.filter(r => r.path.startsWith(SKILL_ROOT)).every(r => r.state === 'New — will install'));
 assert.deepEqual(p.manifest.skills, skills); assert.equal(p.manifest.schemaVersion, 3);
 applyResourcePlan(p);
 const m = verifyRuntime(root);
 assert.equal(m.schemaVersion, 3); assert.deepEqual(m.skills, skills);
 for (const [path, record] of Object.entries(skills)) assert.equal(digest(readFileSync(join(root, path))), record.sha256);
 assert.equal(resourcePlan(root, 'update').unchanged, true);
});

test('unknown entries and unsupported schema versions remain rejected', t => {
 const root = olderProject(t), base = manifest(root);
 for (const mutate of [
  m => { m.files['.trellis/scripts/unknown.py'] = m.files['.trellis/scripts/task.py']; },
  m => { m.schemaVersion = 3; m.skills = { '.pi/skills/trellis-extra/SKILL.md': { ...skills[entry] } }; },
  m => { m.schemaVersion = 3; m.skills = { [entry]: { ...skills[entry], source: 'skills/trellis-start/SKILL.md' } }; },
  m => { m.skills = {}; },
  m => { m.schemaVersion = 4; m.skills = {}; },
 ]) {
  const m = structuredClone(base); mutate(m); writeManifest(root, m);
  const before = snapshot(root);
  assert.throws(() => resourcePlan(root, 'update'), /Unsupported|Invalid/);
  assert.throws(() => verifyRuntime(root));
  assert.deepEqual(snapshot(root), before);
 }
});

test('Update preserves an unmanaged same-name folder as a conflict; exact interrupted package copies resume', t => {
 const root = olderProject(t);
 put(root, entry, 'my own check skill'); put(root, '.pi/skills/trellis-check/extra.md', 'extra');
 const partial = '.pi/skills/trellis-meta/references/local-architecture/overview.md';
 put(root, partial, readFileSync(join(packageRoot, skills[partial].source)));
 const p = resourcePlan(root, 'update');
 assert.deepEqual(p.report.conflicts, ['.pi/skills/trellis-check/']);
 assert.ok(!p.changes.some(c => c.path.startsWith('.pi/skills/trellis-check/')));
 assert.ok(!Object.keys(p.manifest.skills).some(path => path.startsWith('.pi/skills/trellis-check/')));
 assert.ok(p.report.rows.some(r => r.path === partial && r.state === 'Current'));
 const before = snapshot(root);
 assert.throws(() => applyResourcePlan(p), /resolve conflicts/);
 assert.deepEqual(snapshot(root), before);
 // Resolved by the user (folder moved away): the plan installs it.
 rmSync(join(root, '.pi/skills/trellis-check'), { recursive: true });
 applyResourcePlan(resourcePlan(root, 'update'));
 assert.deepEqual(verifyRuntime(root).skills, skills);
});

test('managed skills: unmodified last-published files update, customized files are preserved conflicts', t => {
 const root = copyRuntimeFixture(t), m = manifest(root);
 // Simulate an older last-published copy of one reference.
 put(root, reference, 'older published reference\n');
 m.skills[reference] = { ...m.skills[reference], sha256: digest('older published reference\n') }; writeManifest(root, m);
 put(root, entry, 'customized entry\n');
 const p = resourcePlan(root, 'update');
 assert.deepEqual(p.report.conflicts, [entry]);
 assert.ok(p.report.rows.some(r => r.path === entry && r.state === 'Modified — preserved'));
 assert.ok(p.report.rows.some(r => r.path === reference && r.state === 'Safe update'));
 assert.deepEqual(p.changes.map(c => c.path), [reference]);
 assert.deepEqual(p.manifest.skills[entry], m.skills[entry]);
 assert.throws(() => applyResourcePlan(p), /Modified managed files preserved/);
 assert.equal(readFileSync(join(root, entry), 'utf8'), 'customized entry\n');
 assert.equal(readFileSync(join(root, reference), 'utf8'), 'older published reference\n');
 // The user restores their customization; the unmodified file then updates.
 put(root, entry, readFileSync(join(packageRoot, skills[entry].source)));
 applyResourcePlan(resourcePlan(root, 'update'));
 assert.equal(digest(readFileSync(join(root, reference))), skills[reference].sha256);
 assert.deepEqual(verifyRuntime(root).skills, skills);
});

test('skill customization, deletion or missing folders never affect the runtime gate; Check reports them as warnings', t => {
 const root = copyRuntimeFixture(t);
 // A copied completed init record carries another root's plan hash; drop it so Check judges runtime only.
 rmSync(join(root, '.trellis/.runtime/init-operation.json'));
 put(root, entry, 'customized');
 unlinkSync(join(root, reference));
 rmSync(join(root, '.pi/skills/trellis-start'), { recursive: true });
 assert.ok(verifyRuntime(root));
 const result = collectDiagnostics({ cwd: root }), item = result.items.find(i => i.id === 'inventory:skill');
 assert.equal(item.status, 'issue'); assert.equal(item.severity, 'warning');
 assert.ok(item.evidence.includes(`Modified — preserved: ${entry}`));
 assert.ok(item.evidence.includes(`Missing — will restore: ${reference}`));
 assert.ok(item.evidence.some(e => e.startsWith('Missing — will restore: .pi/skills/trellis-start/')));
 assert.match(item.impact, /runtime execution is unaffected/);
 assert.equal(result.facts.runtimeStaticValid, true);
 // Same classification as Update.
 assert.deepEqual(resourcePlan(root, 'update').report.conflicts, [entry]);
 const clean = collectDiagnostics({ cwd: copyRuntimeFixture(t) }).items.find(i => i.id === 'inventory:skill');
 assert.equal(clean.status, 'pass');
});

test('binary skill assets are byte/hash/mode checked without text validation', t => {
 const root = fresh(t), reader = new DiagnosticReader();
 put(root, 'asset.bin', Buffer.from([0, 255, 1]));
 assert.throws(() => reader.file(root, 'asset.bin', 1024, true), /UTF-8 or NUL/);
 const file = reader.file(root, 'asset.bin', 1024, true, true);
 assert.equal(file.sha256, digest(Buffer.from([0, 255, 1]))); assert.equal(file.text, undefined);
});

function commandHarness(t, root, script) {
 const commands = new Map(), notices = [], answers = [...script];
 let reloads = 0;
 registerInitCommand({ registerCommand: (name, spec) => commands.set(name, spec), sendMessage: () => {} }, async () => {});
 const next = () => { assert.ok(answers.length, 'unexpected dialog'); return answers.shift(); };
 const ctx = { cwd: root, hasUI: true, signal: undefined, isProjectTrusted: () => true, reload: async () => { reloads++; },
  ui: { select: async () => next(), input: async () => next(), notify: text => notices.push(text) } };
 return { run: () => commands.get('trellis-init').handler('', ctx), notices, reloads: () => reloads, answers };
}

test('init and update complete without reloading; notices tell the user to /reload for new skills', async t => {
 const root = fresh(t);
 const init = commandHarness(t, root, [ACTIONS.initialize, 'Enter a different username', 'Dev', ACTIONS.initialize]);
 await init.run();
 assert.equal(init.reloads(), 0); assert.deepEqual(init.answers, []);
 assert.match(init.notices.at(-1), /^Initialize project · Done/); assert.match(init.notices.at(-1), /\/reload/);
 assert.ok(existsSync(join(root, entry)));
 const older = olderProject(t);
 const update = commandHarness(t, older, [ACTIONS.update, ACTIONS.update]);
 await update.run();
 assert.equal(update.reloads(), 0); assert.deepEqual(update.answers, []);
 assert.match(update.notices.at(-1), /^Update resources · Done/); assert.match(update.notices.at(-1), /\/reload or start a new session/);
 assert.deepEqual(verifyRuntime(older).skills, skills);
});

test('the extension registers no resources_discover skill injection', () => {
 const handlers = new Map();
 trellis({ events: { on: () => () => {}, emit: () => {} }, on: (n, h) => handlers.set(n, h), registerTool: () => {}, registerCommand: () => {}, sendMessage: () => {}, getAllTools: () => [] });
 assert.ok(handlers.size > 0); assert.equal(handlers.has('resources_discover'), false);
});
