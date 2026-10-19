import assert from 'node:assert/strict';
import { chmodSync, existsSync, readFileSync, renameSync, statSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { verifyRuntime } from '../lib/initialization/engine.ts';
import { resourcePlan, applyResourcePlan, templatePlan } from '../lib/initialization/resources.ts';
import { collectDiagnostics } from '../lib/initialization/diagnostics.ts';
import { copyRuntimeFixture } from './runtime-fixture.mjs';

const block = readFileSync(new URL('../resources/templates/agents-block.md', import.meta.url), 'utf8').trimEnd();
const ignoreBlock = readFileSync(new URL('../resources/templates/root.gitignore-block.txt', import.meta.url), 'utf8').trimEnd();
const oldBlock = '<!-- TRELLIS:START -->\n# Pi Trellis\n\nOld rules.\n<!-- TRELLIS:END -->';
const fixture = t => copyRuntimeFixture(t, { user: 'Dev' });
const rowOf = (plan, path) => plan.report.rows.find(row => row.path === path);
const backupsOf = root => join(root, '.trellis/.runtime/resource-backups');

test('initialized project blocks are current and produce no change', t => {
 const root = fixture(t), plan = resourcePlan(root, 'update');
 assert.equal(rowOf(plan, 'AGENTS.md').state, 'Current block');
 assert.equal(rowOf(plan, '.gitignore').state, 'Current block');
 assert.ok(!plan.changes.some(c => c.path === 'AGENTS.md' || c.path === '.gitignore'));
 assert.equal(applyResourcePlan(plan), undefined);
 assert.equal(existsSync(backupsOf(root)), false);
 assert.equal(collectDiagnostics({ cwd: root }).items.find(i => i.id === 'inventory:root-block').status, 'pass');
});

test('outdated AGENTS block is backed up and replaced; surrounding bytes are preserved', t => {
 const root = fixture(t), file = join(root, 'AGENTS.md');
 const original = Buffer.from(`# Project\r\nprefix line\r\n\r\n${oldBlock}\r\n\r\n# Conventions\r\n- keep me\r\n`);
 writeFileSync(file, original); chmodSync(file, 0o640);
 const diagnostic = collectDiagnostics({ cwd: root }).items.find(i => i.id === 'inventory:root-block');
 assert.equal(diagnostic.status, 'issue'); assert.equal(diagnostic.severity, 'warning');
 assert.ok(diagnostic.evidence.includes('Block update: AGENTS.md'));
 assert.equal(rowOf(resourcePlan(root, 'repair'), 'AGENTS.md').state, 'Block update available');
 const plan = resourcePlan(root, 'update');
 assert.equal(rowOf(plan, 'AGENTS.md').state, 'Block update — backup and replace');
 assert.deepEqual(plan.report.conflicts, []);
 const backup = applyResourcePlan(plan);
 assert.match(backup, /^\.trellis\/\.runtime\/resource-backups\/[0-9a-f-]{36}$/);
 assert.deepEqual(readFileSync(join(root, backup, 'AGENTS.md')), original);
 assert.equal(readFileSync(file, 'utf8'), `# Project\r\nprefix line\r\n\r\n${block}\r\n\r\n# Conventions\r\n- keep me\r\n`);
 assert.equal(statSync(file).mode & 0o777, 0o640);
 assert.ok(verifyRuntime(root));
 assert.equal(rowOf(resourcePlan(root, 'update'), 'AGENTS.md').state, 'Current block');
});

test('repair mode reports a stale block without writing', t => {
 const root = fixture(t), file = join(root, 'AGENTS.md');
 writeFileSync(file, `${oldBlock}\n`);
 applyResourcePlan(resourcePlan(root, 'repair'));
 assert.equal(readFileSync(file, 'utf8'), `${oldBlock}\n`);
 assert.equal(existsSync(backupsOf(root)), false);
});

test('a file without the block gets it appended after a backup; a missing file is created', t => {
 const root = fixture(t), file = join(root, 'AGENTS.md');
 writeFileSync(file, '# Project only\n');
 let plan = resourcePlan(root, 'update');
 assert.equal(rowOf(plan, 'AGENTS.md').state, 'Missing block — backup and restore');
 const backup = applyResourcePlan(plan);
 assert.equal(readFileSync(join(root, backup, 'AGENTS.md'), 'utf8'), '# Project only\n');
 assert.equal(readFileSync(file, 'utf8'), `# Project only\n${block}\n`);
 const other = fixture(t);
 writeFileSync(join(other, '.gitignore'), '');
 unlinkSync(join(other, 'AGENTS.md'));
 plan = resourcePlan(other, 'update');
 assert.equal(rowOf(plan, 'AGENTS.md').state, 'Missing block — will restore');
 applyResourcePlan(plan);
 assert.equal(readFileSync(join(other, 'AGENTS.md'), 'utf8'), `${block}\n`);
 assert.equal(readFileSync(join(other, '.gitignore'), 'utf8'), `${ignoreBlock}\n`);
});

test('outdated .gitignore block is refreshed like AGENTS.md', t => {
 const root = fixture(t), file = join(root, '.gitignore');
 writeFileSync(file, 'node_modules/\n# pi-trellis:ignore:start\nold\n# pi-trellis:ignore:end\ndist/\n');
 const backup = applyResourcePlan(resourcePlan(root, 'update'));
 assert.equal(readFileSync(file, 'utf8'), `node_modules/\n${ignoreBlock}\ndist/\n`);
 assert.match(readFileSync(join(root, backup, '.gitignore'), 'utf8'), /\nold\n/);
});

test('malformed blocks are preserved conflicts and nothing is written', t => {
 const root = fixture(t), file = join(root, 'AGENTS.md');
 const malformed = `${oldBlock}\n${oldBlock}\n`;
 writeFileSync(file, malformed);
 const plan = resourcePlan(root, 'update');
 assert.equal(rowOf(plan, 'AGENTS.md').state, 'Malformed block — preserved');
 assert.ok(plan.report.conflicts.includes('AGENTS.md'));
 assert.throws(() => applyResourcePlan(plan), /Modified managed files preserved/);
 assert.equal(readFileSync(file, 'utf8'), malformed);
 assert.equal(existsSync(backupsOf(root)), false);
 const item = collectDiagnostics({ cwd: root }).items.find(i => i.id === 'inventory:root-block');
 assert.equal(item.severity, 'error');
});

test('a symlinked root file is a preserved conflict, not an exception; nothing is written', t => {
 const root = fixture(t), file = join(root, 'AGENTS.md'), target = join(root, 'CLAUDE.md');
 renameSync(file, target); symlinkSync('CLAUDE.md', file);
 const before = readFileSync(target);
 const plan = resourcePlan(root, 'update');
 assert.equal(rowOf(plan, 'AGENTS.md').state, 'Unreadable file — preserved');
 assert.ok(plan.report.conflicts.includes('AGENTS.md'));
 assert.ok(!plan.changes.some(c => c.path === 'AGENTS.md'));
 assert.throws(() => applyResourcePlan(plan), /Modified managed files preserved/);
 assert.doesNotThrow(() => templatePlan(root, 'workflow'));
 assert.deepEqual(readFileSync(target), before);
 assert.equal(existsSync(backupsOf(root)), false);
 const item = collectDiagnostics({ cwd: root }).items.find(i => i.id === 'inventory:root-block');
 assert.equal(item.severity, 'error');
 assert.ok(item.evidence.some(line => line.startsWith('Unreadable file — preserved: AGENTS.md')));
});

test('a change after preview blocks publication without writing', t => {
 const root = fixture(t), file = join(root, 'AGENTS.md');
 writeFileSync(file, `${oldBlock}\n`);
 const plan = resourcePlan(root, 'update');
 writeFileSync(file, `${oldBlock}\nedited after preview\n`);
 assert.throws(() => applyResourcePlan(plan), /changed since preview/);
 assert.equal(readFileSync(file, 'utf8'), `${oldBlock}\nedited after preview\n`);
 assert.equal(existsSync(backupsOf(root)), false);
});


test('the preview signature covers the backup flag', t => {
 const root = fixture(t), file = join(root, 'AGENTS.md');
 writeFileSync(file, `${oldBlock}\n`);
 const plan = resourcePlan(root, 'update');
 plan.changes.find(c => c.path === 'AGENTS.md').backup = false;
 assert.throws(() => applyResourcePlan(plan), /changed since preview/);
 assert.equal(readFileSync(file, 'utf8'), `${oldBlock}\n`);
 assert.equal(existsSync(backupsOf(root)), false);
});
