import { processInput } from "./process-input.ts";
import { test } from "node:test";
import assert from "node:assert/strict";
import { validateToolArguments } from "@earendil-works/pi-ai";
import { managementTool, parseAgentManagementParams, parseProcessManagementParams, validateManagementParams } from "../tools.ts";

const agentInput = (values: Record<string, unknown>) => ({ action: "list", agent_id: "null", execution_id: "null", kind: "null", detail: "null", ...values });

test("Agent management requires all fields and treats only declared sentinels as unspecified", async () => {
  let calls = 0;
  const { tool } = managementTool("agent", [{ list: () => [], execute: async () => { calls++; throw Error("unexpected effect"); } }]);
  const input = Object.freeze(agentInput({}));
  const host = (value: unknown) => validateToolArguments(tool, { type: "toolCall", id: "wire", name: tool.name, arguments: value as never });
  assert.doesNotMatch(JSON.stringify(tool.parameters), /"type":"null"/);
  assert.deepEqual(host(input), input);
  // pi coerces JSON null to the "null" sentinel before the parser sees it.
  assert.deepEqual(host({ action: "list", agent_id: null, execution_id: null, kind: null, detail: null }), input);
  assert.deepEqual(parseAgentManagementParams(input), { action: "list" });
  for (const field of Object.keys(input)) {
    const missing: Record<string, unknown> = { ...input }; delete missing[field];
    assert.throws(() => host(missing));
    assert.throws(() => parseAgentManagementParams(missing), /must be provided/);
    assert.equal((await tool.execute("bad", missing as never, undefined, undefined, {} as never)).isError, true);
  }
  for (const bad of [{ ...input, action: "null" }, { ...input, action: "stop" }, { ...input, typo: "null" }, { ...input, detail: "full" }, { ...input, detail: "default" }, { ...input, verbose: "null" }]) {
    assert.throws(() => parseAgentManagementParams(bad));
    assert.equal((await tool.execute("bad", bad as never, undefined, undefined, {} as never)).isError, true);
  }
  assert.throws(() => parseAgentManagementParams({ ...input, detail: "default" }), /`detail` does not apply to list; set it to "null" \(got "default"\)/);
  for (const action of ["status", "stop", "output", "wait"] as const) {
    assert.match(validateManagementParams("agent", agentInput({ action }))!, new RegExp(`${action} requires exactly one of agent_id`));
  }
  const id = "agent_general_purpose_0_12345678", wf = "wf_abcdef12";
  assert.deepEqual(parseAgentManagementParams(agentInput({ action: "output", agent_id: id, detail: "summary" })), { action: "output", agent_id: id, verbose: false });
  assert.deepEqual(parseAgentManagementParams(agentInput({ action: "wait", agent_id: id, detail: "full" })), { action: "wait", agent_id: id, verbose: true });
  // D10: "null" in an applicable defaultable field is the default.
  assert.deepEqual(parseAgentManagementParams(agentInput({ action: "output", agent_id: id, detail: "null" })), { action: "output", agent_id: id });
  // Both targets at once, and full detail for a workflow, are rejected at the parser.
  assert.match(validateManagementParams("agent", agentInput({ action: "status", agent_id: id, execution_id: wf }))!, /exactly one of agent_id/);
  assert.match(validateManagementParams("agent", agentInput({ action: "output", execution_id: wf, detail: "full" }))!, /applies only to subagents/);
  // "summary" is the default; for a workflow it must not reach the backend as a subagent-only option.
  for (const detail of ["summary", "default", "null"]) {
    assert.deepEqual(parseAgentManagementParams(agentInput({ action: "output", execution_id: wf, detail })), { action: "output", execution_id: wf });
  }
  assert.equal(validateManagementParams("process", processInput({ action: "list" })), undefined);
  assert.ok(validateManagementParams("process", { action: "list", task_type: "null" }));
  assert.equal(calls, 0);
});

test("Process management validates the complete sentinel envelope before any capability calls", async () => {
  let effects = 0;
  const effect = () => { effects++; throw Error("unexpected effect"); };
  const { tool } = managementTool("process", [{ list: effect, execute: async () => effect(), search: async () => effect(), stats: effect }]);
  const host = (value: unknown) => validateToolArguments(tool, { type: "toolCall", id: "wire", name: tool.name, arguments: value as never });
  const input = Object.freeze(processInput({ action: "list" }));
  const schema = JSON.parse(JSON.stringify(tool.parameters));
  assert.doesNotMatch(JSON.stringify(schema), /"type":"null"/);
  assert.deepEqual([...schema.required].sort(), Object.keys(input).sort());
  assert.equal(schema.additionalProperties, false);
  assert.deepEqual(host(input), input);
  assert.deepEqual(parseProcessManagementParams(input), { action: "list" });
  // Models may send JSON numbers and null; the host coerces them to the string spellings.
  assert.deepEqual(host({ action: "output", task_id: "job", task_type: null, offset: 0, limit: 10, pattern: null, case: null, context: null }),
    processInput({ action: "output", task_id: "job", offset: "0", limit: "10" }));
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
  for (const bad of [null, [], { ...input, typo: "null" }, { ...input, execution_id: "null" }, { ...input, ignore_case: "null" }, { ...input, action: "null" }, { ...input, action: "other" }, { ...input, task_type: null }]) {
    await refuse(bad);
  }
  for (const action of ["status", "stop", "output", "wait"] as const) {
    assert.equal(validateManagementParams("process", processInput({ action })), `\`task_id\` is required to ${action}; "null" is not a value.`);
  }
  const actions = {
    list: [{ task_type: "bash" }, { task_type: "bash" }], stats: [{ task_type: "monitor" }, { task_type: "monitor" }],
    status: [{ task_id: "job" }, { task_id: "job" }], stop: [{ task_id: "job" }, { task_id: "job" }],
    output: [{ task_id: "job", offset: "0", limit: "1" }, { task_id: "job", offset: 0, limit: 1 }],
    wait: [{ task_id: "job", limit: "1" }, { task_id: "job", limit: 1 }],
    search: [{ task_id: "job", task_type: "bash", pattern: "x", case: "insensitive", context: "0" }, { task_id: "job", task_type: "bash", pattern: "x", ignore_case: true, context: 0 }],
  } as const;
  const realValues: Record<string, string> = { task_id: "job", task_type: "bash", offset: "0", limit: "1", pattern: "x", case: "sensitive", context: "0" };
  for (const [action, [options, expected]] of Object.entries(actions)) {
    const valid = processInput({ action, ...options });
    assert.deepEqual(host(valid), valid);
    assert.deepEqual(parseProcessManagementParams(valid), { action, ...expected });
    for (const field of Object.keys(input).filter(k => k !== "action" && !Object.hasOwn(options, k))) {
      await refuse({ ...valid, [field]: realValues[field] });
      // "default" is not "null" where the field does not apply.
      if (["limit", "case", "context"].includes(field)) await refuse({ ...valid, [field]: "default" });
    }
    if (["status", "stop", "output", "wait"].includes(action)) await refuse({ ...valid, task_id: "null" });
    if (action === "search") await refuse({ ...valid, pattern: "null" });
  }
  // Applicable defaultable fields accept "default" and "null" alike.
  for (const sentinel of ["default", "null"]) {
    assert.deepEqual(parseProcessManagementParams(processInput({ action: "search", pattern: "x", case: sentinel, context: sentinel })), { action: "search", pattern: "x" });
    assert.deepEqual(parseProcessManagementParams(processInput({ action: "wait", task_id: "job", limit: sentinel })), { action: "wait", task_id: "job" });
  }
  for (const bad of [
    processInput({ action: "status", task_id: "" }), processInput({ action: "status", task_id: "  " }),
    processInput({ action: "search", task_id: "", pattern: "x" }), processInput({ action: "search", pattern: "" }),
    processInput({ action: "search", pattern: "x", task_type: "workflow" }),
    processInput({ action: "search", pattern: "x", case: "false" }),
    processInput({ action: "output", task_id: "job", offset: "default" }),
  ]) await refuse(bad);
  // Whitespace and regex syntax are not normalized by the argument parser.
  assert.deepEqual(parseProcessManagementParams(processInput({ action: "search", pattern: " " })), { action: "search", pattern: " " });
  assert.deepEqual(parseProcessManagementParams(processInput({ action: "search", pattern: "[" })), { action: "search", pattern: "[" });
  for (const [action, field] of [["output", "offset"], ["output", "limit"], ["search", "context"]] as const) {
    const base = processInput(action === "search" ? { action, pattern: "x" } : { action, task_id: "job" });
    for (const value of ["-1", "1.5", "Infinity", "NaN", String(Number.MAX_SAFE_INTEGER + 2), "1e3", ...(field === "limit" ? ["0"] : [])]) await refuse({ ...base, [field]: value });
    assert.equal(parseProcessManagementParams({ ...base, [field]: String(Number.MAX_SAFE_INTEGER) })[field], Number.MAX_SAFE_INTEGER);
  }
  assert.equal(effects, 0);
});
