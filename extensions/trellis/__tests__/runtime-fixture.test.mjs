import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { inspect, verifyRuntime } from '../lib/initialization/engine.ts';
import { copyRuntimeFixture } from './runtime-fixture.mjs';

// A cached template is preparation only: each caller still owns mutable bytes.
test('runtime copies are independent, rehome operation authority and preserve template shape', t => {
  let prepared = 0;
  const options = { key: 'copy-isolation', user: 'Copy Fixture', prepare(root) {
    prepared++;
    writeFileSync(join(root, 'shape.txt'), 'pristine shape');
  } };
  const first = copyRuntimeFixture(t, options);
  const second = copyRuntimeFixture(t, options);
  assert.notEqual(first, second);
  assert.equal(prepared, 1, 'same shape initializes only once');
  for (const root of [first, second]) {
    const operation = JSON.parse(readFileSync(join(root, '.trellis/.runtime/init-operation.json'), 'utf8'));
    assert.equal(operation.plan.root, root);
    assert.equal(inspect(root).state, 'ready', 'reconstructed operation remains valid at the copied root');
    assert.ok(verifyRuntime(root));
  }
  const runtime = '.trellis/scripts/common/paths.py';
  const original = readFileSync(join(second, runtime));
  writeFileSync(join(first, runtime), 'tampered copy');
  writeFileSync(join(first, 'shape.txt'), 'mutated shape');
  assert.throws(() => verifyRuntime(first), /missing or modified/);
  assert.deepEqual(readFileSync(join(second, runtime)), original);
  assert.equal(readFileSync(join(second, 'shape.txt'), 'utf8'), 'pristine shape');
  const third = copyRuntimeFixture(t, options);
  assert.equal(prepared, 1);
  assert.equal(readFileSync(join(third, 'shape.txt'), 'utf8'), 'pristine shape');
  assert.deepEqual(readFileSync(join(third, runtime)), original);
  assert.equal(inspect(third).state, 'ready');

  const other = copyRuntimeFixture(t, { key: 'other-shape', user: 'Other Fixture', prepare(root) {
    writeFileSync(join(root, 'shape.txt'), 'other shape');
  } });
  assert.equal(readFileSync(join(other, 'shape.txt'), 'utf8'), 'other shape');
  assert.equal(readFileSync(join(other, '.trellis/.developer'), 'utf8').includes('Other Fixture'), true);
  assert.equal(readFileSync(join(third, '.trellis/.developer'), 'utf8').includes('Copy Fixture'), true);
});
