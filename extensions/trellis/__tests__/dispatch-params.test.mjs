import assert from 'node:assert/strict';
import childProcess from 'node:child_process';
import fs from 'node:fs';
import { findPackageJSON, syncBuiltinESMExports } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import { registerDispatchTool, rpc, validateDispatchParams as rawValidateDispatchParams } from '../lib/subagent-rpc.ts';

// Resolve the actual host's validator, not a duplicated schema implementation.
const aiPackage = findPackageJSON('@earendil-works/pi-ai', import.meta.resolve('@earendil-works/pi-coding-agent'));
const aiUrl = new URL('./dist/index.js', pathToFileURL(aiPackage));
const { validateToolArguments } = await import(aiUrl.href);
const { makeStrictJsonSchema } = await import(new URL('./api/constrained-sampling.js', aiUrl).href);

function harness(activeTask = async () => undefined) {
  let tool;
  const handlers = new Map();
  const requests = [];
  const pi = {
    events: { on: () => () => {}, emit: (...args) => requests.push(args) },
    on: (name, handler) => handlers.set(name, handler),
    registerTool: value => { tool = value; },
  };
  registerDispatchTool(pi, activeTask);
  return { tool, requests, handlers };
}
const hostValidate = (tool, arguments_) => validateToolArguments(tool, {
  id: 'schema-call', name: tool.name, arguments: complete(arguments_),
});
const complete = input => input && typeof input === "object" && !Array.isArray(input) ? { action: null, agent: null, task: null, prompt: null, ...input } : input;
const validateDispatchParams = input => rawValidateDispatchParams(complete(input));
const valid = { agent: 'trellis-implement', prompt: 'Work on the approved scope' };

const invalidCases = [
  [null, /object/],
  [undefined, /object/],
  [[], /object/],
  ['dispatch', /object/],
  [42, /object/],
  [true, /object/],
  [{ ...valid, agnet: 'trellis-check' }, /agnet/],
  [{ ...valid, action: 'launch' }, /action.*dispatch.*stop/],
  [{ ...valid, action: 1 }, /action/],
  [{ ...valid, action: {} }, /action/],
  [{ prompt: 'work' }, /agent/],
  [{ ...valid, agent: '' }, /agent/],
  [{ ...valid, agent: ' \t' }, /agent/],
  [{ ...valid, agent: 'generic' }, /agent.*trellis-implement/],
  [{ ...valid, agent: 42 }, /agent/],
  [{ ...valid, agent: null }, /agent/],
  [{ ...valid, agent: [] }, /agent/],
  [{ agent: 'trellis-check' }, /prompt/],
  [{ ...valid, prompt: '' }, /prompt/],
  [{ ...valid, prompt: '\n\t ' }, /prompt/],
  [{ ...valid, prompt: 'work\0more' }, /prompt.*NUL/],
  [{ ...valid, prompt: 42 }, /prompt/],
  [{ ...valid, prompt: null }, /prompt/],
  [{ ...valid, prompt: {} }, /prompt/],
  [{ ...valid, task: ' ' }, /task/],
  [{ ...valid, task: 'task\nname' }, /task/],
  [{ ...valid, task: 'task\0name' }, /task/],
  [{ ...valid, task: 'task\x7f' }, /task/],
  [{ ...valid, task: 42 }, /task/],
  [{ ...valid, task: {} }, /task/],
  [{ action: 'stop', agent: 'trellis-check' }, /agent.*dispatch-only/],
  [{ action: 'stop', agent: '' }, /agent.*dispatch-only/],
  [{ action: 'stop', agent: undefined }, /agent.*must be provided/],
  [{ action: 'stop', prompt: 'ignored' }, /prompt.*dispatch-only/],
  [{ action: 'stop', prompt: '' }, /prompt.*dispatch-only/],
  [{ action: 'stop', prompt: undefined }, /prompt.*must be provided/],
  [{ action: 'stop', task: ' ' }, /task/],
  [{ action: 'stop', task: false }, /task/],
  [{ action: 'stop', extra: true }, /extra/],
];

test('dispatch schema is a plain closed object accepted by real host strict conversion', () => {
  const { tool } = harness();
  const schema = tool.parameters;
  assert.equal(schema.type, 'object');
  assert.equal(schema.additionalProperties, false);
  assert.deepEqual(Object.keys(schema.properties).sort(), ['action', 'agent', 'prompt', 'task']);
  for (const key of ['anyOf', 'oneOf', 'if']) assert.equal(Object.hasOwn(schema, key), false);
  assert.deepEqual(schema.properties.action.anyOf[1].enum, ['dispatch', 'stop', '']);
  assert.deepEqual(schema.properties.agent.anyOf[1].enum, ['trellis-implement', 'trellis-check', 'trellis-research', '']);
  for (const property of Object.values(schema.properties)) assert.ok(property.description);
  const strict = makeStrictJsonSchema(schema);
  assert.equal(strict.additionalProperties, false);
  assert.deepEqual(strict.required.sort(), ['action', 'agent', 'prompt', 'task']);
  assert.deepEqual(schema.required, ['action', 'agent', 'task', 'prompt'], 'all exposed wire fields are required');
});

test('real host validation accepts legal legacy/stop shapes and rejects unknown fields/enums/types', () => {
  const { tool } = harness();
  for (const input of [valid, { ...valid, action: '' }, { ...valid, action: 'dispatch', task: '' }, { action: 'stop' }, { action: 'stop', task: '.trellis/tasks/test' }]) {
    assert.deepEqual(hostValidate(tool, input), complete(input));
  }
  for (const [input, pattern] of [
    [{ ...valid, promtp: 'work' }, /promtp/],
    [{ ...valid, action: 'launch' }, /action/],
    [{ ...valid, agent: 'generic' }, /agent/],
    [{ ...valid, prompt: { text: 'work' } }, /prompt/],
    [{ ...valid, task: { path: 'test' } }, /task/],
  ]) assert.throws(() => hostValidate(tool, input), pattern);
  // Host scalar coercion and optional null handling are not direct-helper semantics.
  assert.equal(hostValidate(tool, { ...valid, prompt: 42 }).prompt, '42');
  assert.deepEqual(hostValidate(tool, { action: 'stop', agent: null, prompt: null, task: null }), { action: 'stop', agent: null, prompt: null, task: null });
});

test('pure dispatch validator normalizes only legacy action/task and preserves exact prose without mutation', () => {
  for (const agent of ['trellis-implement', 'trellis-check', 'trellis-research']) {
    for (const action of [null, '', 'dispatch']) {
      const input = Object.freeze({ action, agent, prompt: ' First line\n\t第二行 ', task: '' });
      assert.deepEqual(validateDispatchParams(input), { action: 'dispatch', agent, prompt: input.prompt });
      assert.equal(input.task, '');
      assert.equal(input.action, action);
    }
  }
  assert.deepEqual(validateDispatchParams({ ...valid, task: '.trellis/tasks/test' }), { action: 'dispatch', ...valid, task: '.trellis/tasks/test' });
  assert.deepEqual(validateDispatchParams({ action: 'stop', task: '' }), { action: 'stop' });
  assert.deepEqual(validateDispatchParams({ action: 'stop' }), { action: 'stop' });
  assert.deepEqual(validateDispatchParams({ action: 'stop', task: '.trellis/tasks/test' }), { action: 'stop', task: '.trellis/tasks/test' });
});

test('pure dispatch validator rejects invalid arguments and identifies the offending field', () => {
  for (const [input, pattern] of invalidCases) assert.throws(() => validateDispatchParams(input), pattern);
  assert.throws(() => validateDispatchParams({ ...valid, [Symbol('extra')]: true }), /extra/);
  assert.throws(() => rawValidateDispatchParams(Object.defineProperty(complete(valid), 'hidden', { value: true })), /hidden/);
});

test('registered execute rejects bad direct/host inputs before cwd, query, filesystem, activeTask or provider effects', async t => {
  const root = fs.mkdtempSync(join(tmpdir(), 'pi-dispatch-params-'));
  const marker = join(root, 'unchanged');
  fs.writeFileSync(marker, 'preserved');
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  let activeCalls = 0, cwdReads = 0, queries = 0, fileCalls = 0;
  const h = harness(async () => { activeCalls++; throw Error('activeTask must not run'); });
  const ctx = { get cwd() { cwdReads++; return root; } };
  // The real query owner begins with execFile. Observe the actual imported Node
  // boundary and filesystem exports; no product test hook or fake query is needed.
  t.mock.method(childProcess, 'execFile', () => { queries++; throw Error('query must not run'); });
  for (const name of ['readFileSync', 'lstatSync', 'realpathSync', 'writeFileSync', 'mkdirSync', 'openSync', 'renameSync', 'unlinkSync']) {
    t.mock.method(fs, name, () => { fileCalls++; throw Error(`${name} must not run`); });
  }
  syncBuiltinESMExports();
  try {
    for (const [input, pattern] of invalidCases) {
      await assert.rejects(h.tool.execute('direct', complete(input), undefined, undefined, ctx), pattern);
    }
    for (const input of [{ ...valid, prompt: '' }, { action: 'stop', agent: '' }, { action: 'stop', prompt: '' }]) {
      await assert.rejects(h.tool.execute('host', hostValidate(h.tool, input), undefined, undefined, ctx), /agent|prompt/);
    }
    assert.equal(cwdReads, 0);
    assert.equal(queries, 0);
    assert.equal(fileCalls, 0);
    assert.equal(activeCalls, 0);
    assert.deepEqual(h.requests, []);
    h.handlers.get('session_shutdown')();
    await assert.rejects(h.tool.execute('shutdown', valid, undefined, undefined, ctx), /shut down/);
  } finally {
    t.mock.restoreAll();
    syncBuiltinESMExports();
  }
  assert.equal(fs.readFileSync(marker, 'utf8'), 'preserved');
  assert.deepEqual(fs.readdirSync(root), ['unchanged']);
});

test('required nullable wire fields survive host validation and missing fields fail before effects', async () => {
  const { tool } = harness();
  const input = Object.freeze(complete({ ...valid, action: null, task: null }));
  assert.deepEqual(hostValidate(tool, input), input);
  assert.deepEqual(rawValidateDispatchParams(input), { action: 'dispatch', ...valid });
  assert.deepEqual(rawValidateDispatchParams(complete({ action: 'stop' })), { action: 'stop' });
  for (const field of Object.keys(input)) {
    const missing = { ...input }; delete missing[field];
    assert.throws(() => validateToolArguments(tool, { type: 'toolCall', id: 'missing', name: tool.name, arguments: missing }));
    assert.throws(() => rawValidateDispatchParams(missing), /must be provided/);
    await assert.rejects(tool.execute('missing', missing, undefined, undefined, { get cwd() { throw Error('must not query'); } }), /must be provided/);
  }
  assert.equal(input.action, null);
});

test('RPC timeout keeps execution uncertainty wording and removes its reply subscription', async () => {
  let requests = 0, unsubscribed = 0;
  const pi = { events: {
    on: () => () => { unsubscribed++; },
    emit: () => { requests++; },
  } };
  await assert.rejects(rpc(pi, 'spawn', {}, 1), /timed out; execution may already exist/);
  assert.equal(requests, 1);
  assert.equal(unsubscribed, 1);
});
