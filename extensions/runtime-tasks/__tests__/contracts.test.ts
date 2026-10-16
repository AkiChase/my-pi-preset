import { test } from "node:test";
import assert from "node:assert/strict";
import { validateToolArguments } from "@earendil-works/pi-ai";
import { TASK_ACTIONS, isRuntimeTaskMetadata, taskResult, validateRuntimeTaskParams, validateTargetOptions, type RuntimeTaskAction } from "../contracts.ts";
import { createRuntimeTaskFacade, runtimeTaskTool, type RuntimeTaskCapability } from "../facade.ts";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { TaskView } from "../../task-ui/types.ts";
const ctx = {} as ExtensionContext;
const view = (taskId: string, runId = "1"): TaskView => Object.freeze({ sourceId: "agent", taskId, runId, key: taskId, kind: "agent", title: "answer", status: "completed", executionMode: "background", waitCount: 0, stats: {}, artifacts: [], capabilities: { stop: true, details: true } });

test("flat action validation rejects ignored fields and unsafe values", () => {
  for (const params of [{ action: "wait" }, { action: "list", verbose: false }, { action: "status", task_id: "x", offset: 0 }, { action: "search", pattern: "x", run_id: "1" }, { action: "output", task_id: "x", limit: NaN }, { action: "output", task_id: "x", offset: Number.MAX_SAFE_INTEGER + 1 }]) assert.ok(validateRuntimeTaskParams(params));
  assert.equal(validateRuntimeTaskParams({ action: "wait", task_id: "x", run_id: "1", verbose: false }), undefined);
  assert.ok(validateTargetOptions({ action: "output", limit: 10 }, "workflow"));
  assert.ok(validateTargetOptions({ action: "search", pattern: "x" }, "subagent"));
});

test("an inapplicable field is reported by name, with the fields the action does accept", () => {
  // Previously: "Inapplicable field for status." — true, but it left the caller
  // to bisect its own arguments. The message now names the field so the next
  // call can be correct instead of merely different.
  const message = validateRuntimeTaskParams({ action: "status", task_id: "x", offset: 0 });
  assert.ok(message);
  assert.match(message, /`offset` is not accepted for action 'status'/);
  assert.match(message, /Accepted fields: action, task_id, run_id\./);
});

test("offset/limit/context must be integers when the host validator is bypassed", () => {
  // Direct callers still require a safe-integer check before reading a log.
  for (const key of ["offset", "limit", "context"] as const) {
    const message = validateRuntimeTaskParams({ action: "output", task_id: "x", [key]: 1.5 });
    assert.ok(message, `${key}=1.5 must be rejected`);
    assert.match(message, new RegExp(key));
  }
  assert.equal(validateRuntimeTaskParams({ action: "output", task_id: "x", offset: 0, limit: 1 }), undefined);
});

/** Field sets the model-visible union exposes per action, mirroring `allowed`. */
const actionFields: Record<RuntimeTaskAction, readonly string[]> = {
  list: ["action", "task_type"], status: ["action", "task_id", "run_id"],
  output: ["action", "task_id", "run_id", "offset", "limit", "verbose"],
  wait: ["action", "task_id", "run_id", "limit", "verbose"],
  stop: ["action", "task_id", "run_id"],
  search: ["action", "task_id", "run_id", "task_type", "pattern", "ignore_case", "context"],
  stats: ["action", "task_type"],
};
/** A targeted action cannot omit task_id; a global search may omit it. */
const requiredFields: Record<RuntimeTaskAction, readonly string[]> = {
  list: ["action"], status: ["action", "task_id"], output: ["action", "task_id"],
  wait: ["action", "task_id"], stop: ["action", "task_id"], search: ["action", "pattern"], stats: ["action"],
};

test("the registered task_manage schema is a closed per-action union", () => {
  const capability: RuntimeTaskCapability = {
    list: () => [],
    execute: async () => taskResult("x", { action: "output" }),
  };
  const tool = runtimeTaskTool(createRuntimeTaskFacade([capability]));
  const schema = JSON.parse(JSON.stringify(tool.parameters)) as {
    anyOf: { required?: string[]; additionalProperties?: unknown; properties: Record<string, { const?: unknown; type?: unknown; minimum?: unknown; multipleOf?: unknown; description?: unknown }> }[];
  };
  const branches = new Map(schema.anyOf.map(branch => [String(branch.properties.action!.const), branch]));
  assert.deepEqual([...branches.keys()].sort(), [...TASK_ACTIONS].sort());
  for (const [action, fields] of Object.entries(actionFields)) {
    const branch = branches.get(action)!;
    // Closed per branch, so a typo like `limt` cannot reach the facade as a
    // silently ignored key even though the union shares one top level.
    assert.equal(branch.additionalProperties, false, `${action} branch must be closed`);
    // A `list` caller is no longer shown `pattern`/`verbose`, and a targeted
    // action cannot omit its task_id.
    assert.deepEqual(Object.keys(branch.properties).sort(), [...fields].sort(), `${action} fields`);
    assert.deepEqual(branch.required, requiredFields[action as RuntimeTaskAction], `${action} required`);
  }
  const paged = branches.get("output")!.properties;
  for (const key of ["offset", "limit"]) {
    // Type.Integer triggers host truncation; number + multipleOf preserves the
    // original fraction until validation rejects it.
    assert.equal(paged[key]!.type, "number");
    assert.equal(paged[key]!.multipleOf, 1);
    assert.equal(typeof paged[key]!.description, "string");
  }
  assert.equal(paged.limit!.minimum, 1, "limit 0 would return nothing to a caller that asked for output");
  assert.equal(paged.offset!.minimum, 0);
  const context = branches.get("search")!.properties.context!;
  assert.equal(context.type, "number");
  assert.equal(context.multipleOf, 1);
  assert.equal(context.minimum, 0);
});

test("the union schema refuses fields an action does not accept", () => {
  const tool = runtimeTaskTool(createRuntimeTaskFacade([{ list: () => [], execute: async () => taskResult("x", { action: "output" }) }]));
  const validate = (args: Record<string, unknown>) => validateToolArguments(tool, { type: "toolCall", id: "call", name: tool.name, arguments: args } as never);
  for (const args of [
    { action: "list", pattern: "x" }, { action: "list", verbose: false }, { action: "stats", task_id: "x" },
    { action: "status", task_id: "x", offset: 0 }, { action: "output", task_id: "x", pattern: "x" },
    { action: "wait" }, { action: "search" }, { action: "stop" }, { action: "search", pattern: "x", task_type: "subagent" },
  ]) assert.throws(() => validate(args), error => error instanceof Error && /additional properties|required propert/.test(error.message), JSON.stringify(args));
  assert.deepEqual(validate({ action: "list" }), { action: "list" });
  assert.deepEqual(validate({ action: "output", task_id: "x", offset: 0, limit: 1, verbose: false }), { action: "output", task_id: "x", offset: 0, limit: 1, verbose: false });
  assert.deepEqual(validate({ action: "search", pattern: "x", task_type: "monitor", context: 2, ignore_case: true }), { action: "search", pattern: "x", task_type: "monitor", context: 2, ignore_case: true });
});

test("versioned public metadata rejects foreign envelopes and invalid ranges", () => {
  assert.equal(isRuntimeTaskMetadata({}), false);
  assert.equal(isRuntimeTaskMetadata({ version: 2, action: "list" }), false);
  assert.equal(isRuntimeTaskMetadata({ version: 1, action: "list", secret: "x" }), false);
  assert.equal(isRuntimeTaskMetadata({ version: 1, action: "wait", task_id: "x" }), false);
  assert.equal(isRuntimeTaskMetadata({ version: 1, action: "output", range: { start: 0, end: 4, size: 3, omitted_before: 0, omitted_after: 0 } }), false);
  const result = taskResult("answer", { action: "output", task_type: "subagent", task_id: "x", run_id: "1", stats: { duration_ms: 10 } });
  assert.ok(isRuntimeTaskMetadata(result.details.runtimeTask));
  assert.ok(Object.isFrozen(result.details.runtimeTask.stats));
});

test("facade rejects ambiguity/stale/foreign owners without invoking execution", async () => {
  let calls = 0;
  const capability: RuntimeTaskCapability = { list: () => [{ view: view("x"), manageable: true, rawStatus: "completed" }], execute: async () => { calls++; return taskResult("answer", { action: "output" }); } };
  const facade = createRuntimeTaskFacade([capability]);
  assert.equal((await facade.execute({ action: "output", task_id: "x", run_id: "0" }, undefined, undefined, ctx)).details.runtimeTask.error_code, "stale");
  assert.equal((await createRuntimeTaskFacade([capability, capability]).execute({ action: "output", task_id: "x" }, undefined, undefined, ctx)).details.runtimeTask.error_code, "ambiguous");
  assert.equal((await createRuntimeTaskFacade([{ ...capability, list: () => [{ view: view("x"), manageable: false, rawStatus: "completed" }] }]).execute({ action: "output", task_id: "x" }, undefined, undefined, ctx)).details.runtimeTask.error_code, "forbidden");
  await facade.execute({ action: "list" }, undefined, undefined, ctx);
  await facade.execute({ action: "status", task_id: "x" }, undefined, undefined, ctx);
  assert.equal(calls, 0);
  facade.close();
  assert.equal((await facade.execute({ action: "list" }, undefined, undefined, ctx)).details.runtimeTask.error_code, "closed");
});

test("target identity binds at admission and survives a new live run", async () => {
  let current = view("raw-rpc-id");
  let finish!: () => void;
  const pending = new Promise<void>(resolve => { finish = resolve; });
  const facade = createRuntimeTaskFacade([{ list: () => [{ view: current, manageable: true, rawStatus: "completed" }], execute: async identity => { await pending; return taskResult(`old run=${identity.runId}`, { action: "wait", task_type: "subagent", task_id: identity.taskId, run_id: identity.runId }); } }]);
  const result = facade.execute({ action: "wait", task_id: "raw-rpc-id" }, undefined, undefined, ctx);
  current = view("raw-rpc-id", "2"); finish();
  assert.equal((await result).details.runtimeTask.run_id, "1");
});

test("metadata validates safe counts separately from finite duration/cost", () => {
  for (const stats of [{ tokens: 1.5 }, { tokens: Number.MAX_SAFE_INTEGER + 1 }, { cost: Infinity }, { unknown: 1 }])
    assert.equal(isRuntimeTaskMetadata({ version: 1, action: "stats", stats }), false);
  assert.equal(isRuntimeTaskMetadata({ version: 1, action: "stats", stats: { tokens: 2, cost: 0.25, duration_ms: 1.5 } }), true);
  assert.equal(isRuntimeTaskMetadata({ version: 1, action: "output" }), false);
});

test("typed failures carry the host tool error flag and survive search aggregation", async () => {
  const failure = taskResult("Cannot search", { action: "search", error_code: "log_error" });
  assert.equal(failure.isError, true);
  const facade = createRuntimeTaskFacade([{ list: () => [], execute: async () => failure, search: async () => failure }]);
  const result = await facade.execute({ action: "search", pattern: "x" }, undefined, undefined, ctx);
  assert.equal(result.isError, true); assert.equal(result.details.runtimeTask.error_code, "log_error");
  assert.equal((await facade.execute({ action: "output", task_id: "missing" }, undefined, undefined, ctx)).isError, true);
});
