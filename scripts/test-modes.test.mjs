import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const { scripts } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const defaultTest = scripts.test;
const lowCpu = scripts['test:low-cpu'];

test('low CPU test mode changes only file concurrency and preserves SDK/discovery/failure contract', t => {
  assert.match(defaultTest, /--test-concurrency=8\b/);
  assert.match(lowCpu, /--test-concurrency=4\b/);
  assert.equal(lowCpu, defaultTest.replace('--test-concurrency=8', '--test-concurrency=4'));
  assert.equal(scripts.check, 'pnpm run typecheck && pnpm run test');

  const root = mkdtempSync(join(tmpdir(), 'pi-test-mode-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const pass = join(root, 'pass.test.mjs'), fail = join(root, 'fail.test.mjs');
  writeFileSync(pass, "import test from 'node:test'; test('passes', () => {});\n");
  writeFileSync(fail, "import test from 'node:test'; test('fails', () => { throw Error('expected fixture failure'); });\n");
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT; // Child owns a fresh runner, not the parent's test isolation context.
  for (const command of [defaultTest, lowCpu]) {
    // Execute the actual configured Node options with isolated deterministic fixtures.
    const match = command.match(/&& node (.*?) "extensions\//);
    assert.ok(match);
    const options = match[1].split(' ');
    const success = spawnSync(process.execPath, [...options, pass], { cwd: root, env, encoding: 'utf8', timeout: 10000 });
    assert.equal(success.status, 0, success.stderr);
    const failure = spawnSync(process.execPath, [...options, fail], { cwd: root, env, encoding: 'utf8', timeout: 10000 });
    assert.equal(failure.status, 1, failure.stderr);
    assert.match(failure.stdout, /expected fixture failure/);
  }
});
