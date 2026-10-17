import { processInput } from "./process-input.ts";
import { test } from "node:test";
import assert from "node:assert/strict";
import { validateToolArguments } from "@earendil-works/pi-ai";
import { managementTool, parseAgentManagementParams, parseProcessManagementParams, validateManagementParams } from "../tools.ts";
import { executionId } from "../execution-id.ts";

test("Agent management requires all fields and treats only declared null controls as unspecified", async () => {
  let calls = 0;
  const { tool } = managementTool("agent", [{ list: () => [], execute: async () => { calls++; throw Error("unexpected effect"); } }]);
  const input = Object.freeze({ action: "list", execution_id: null, kind: null, verbose: null });
  const host = (value: unknown) => validateToolArguments(tool, { type: "toolCall", id: "wire", name: tool.name, arguments: value as never });
  assert.deepEqual(host(input), input);
  assert.deepEqual(parseAgentManagementParams(input), { action: "list" });
  for (const field of Object.keys(input)) {
    const missing: Record<string, unknown> = { ...input }; delete missing[field];
    assert.throws(() => host(missing));
    assert.throws(() => parseAgentManagementParams(missing), /must be provided/);
    assert.equal((await tool.execute("bad", missing as never, undefined, undefined, {} as never)).isError, true);
  }
  for (const bad of [{ ...input, action: null }, { ...input, action: "stop" }, { ...input, typo: null }, { ...input, verbose: false }]) {
    assert.throws(() => parseAgentManagementParams(bad));
    assert.equal((await tool.execute("bad", bad as never, undefined, undefined, {} as never)).isError, true);
  }
  const id = executionId({ taskId: "agent", runId: "1" }, "subagent");
  assert.deepEqual(parseAgentManagementParams({ action: "output", execution_id: id, kind: null, verbose: false }), { action: "output", execution_id: id, verbose: false });
  assert.equal(validateManagementParams("process", processInput({ action: "list" })), undefined);
  assert.ok(validateManagementParams("process", { action: "list", task_type: null }));
  assert.equal(input.verbose, null); assert.equal(calls, 0);
});

test("Process management validates the complete nullable envelope before any capability calls", async () => {
  let effects = 0;
  const effect = () => { effects++; throw Error("unexpected effect"); };
  const { tool } = managementTool("process", [{ list: effect, execute: async () => effect(), search: async () => effect(), stats: effect }]);
  const host = (value: unknown) => validateToolArguments(tool, { type: "toolCall", id: "wire", name: tool.name, arguments: value as never });
  const input = Object.freeze(processInput({ action: "list" }));
  const schema = JSON.parse(JSON.stringify(tool.parameters));
  assert.deepEqual([...schema.required].sort(), Object.keys(input).sort());
  assert.equal(schema.additionalProperties, false);
  assert.deepEqual(host(input), input);
  assert.deepEqual(parseProcessManagementParams(input), { action: "list" });
  assert.equal(input.task_id, null);
  const refuse = async (bad: unknown) => {
    assert.throws(() => parseProcessManagementParams(bad));
    assert.ok(validateManagementParams("process", bad));
    const result = await tool.execute("bad", bad as never, undefined, undefined, {} as never);
    assert.equal(result.isError, true);
    assert.equal(result.details.runtimeManagement.error_code, "invalid_arguments");
    assert.equal(effects, 0);
  };
  for (const field of Object.keys(input)) {
    const missing: Record<string, unknown> = { ...input }; delete missing[field];
    assert.throws(() => host(missing)); await refuse(missing);
    await refuse({ ...input, [field]: undefined });
  }
  for (const bad of [null, [], { ...input, typo: null }, { ...input, execution_id: null }, { ...input, verbose: null }, { ...input, action: null }, { ...input, action: "other" }]) {
    assert.throws(() => host(bad)); await refuse(bad);
  }
  const actions = {
    list: { task_type: "bash" }, stats: { task_type: "monitor" }, status: { task_id: "job" }, stop: { task_id: "job" },
    output: { task_id: "job", offset: 0, limit: 1 }, wait: { task_id: "job", limit: 1 },
    search: { task_id: "job", task_type: "bash", pattern: "x", ignore_case: false, context: 0 },
  };
  for (const [action, options] of Object.entries(actions)) {
    const valid = processInput({ action, ...options });
    assert.deepEqual(host(valid), valid);
    assert.deepEqual(parseProcessManagementParams(valid), { action, ...options });
    for (const field of Object.keys(input).filter(k => k !== "action" && !Object.hasOwn(options, k))) {
      const nonNull = ({ task_id: "job", task_type: "bash", offset: 0, limit: 1, pattern: "x", ignore_case: false, context: 0 } as Record<string, unknown>)[field];
      await refuse({ ...valid, [field]: nonNull });
    }
    if (["status", "stop", "output", "wait"].includes(action)) await refuse({ ...valid, task_id: null });
    if (action === "search") await refuse({ ...valid, pattern: null });
  }
  for (const bad of [
    processInput({ action: "status", task_id: "" }), processInput({ action: "status", task_id: "  " }),
    processInput({ action: "search", task_id: "", pattern: "x" }), processInput({ action: "search", pattern: "" }),
    processInput({ action: "search", pattern: "x", task_type: "workflow" }),
    processInput({ action: "search", pattern: "x", ignore_case: 0 }),
  ]) await refuse(bad);
  // Whitespace and regex syntax are not normalized by the argument parser.
  assert.deepEqual(parseProcessManagementParams(processInput({ action: "search", pattern: " " })), { action: "search", pattern: " " });
  assert.deepEqual(parseProcessManagementParams(processInput({ action: "search", pattern: "[" })), { action: "search", pattern: "[" });
  for (const [action, field] of [["output", "offset"], ["output", "limit"], ["search", "context"]] as const) {
    const base = processInput(action === "search" ? { action, pattern: "x" } : { action, task_id: "job" });
    for (const value of [-1, 1.5, "1.5", Infinity, NaN, Number.MAX_SAFE_INTEGER + 1, ...(field === "limit" ? [0] : [])]) await refuse({ ...base, [field]: value });
    assert.equal(parseProcessManagementParams({ ...base, [field]: Number.MAX_SAFE_INTEGER })[field], Number.MAX_SAFE_INTEGER);
  }
  assert.equal(effects, 0);
});
