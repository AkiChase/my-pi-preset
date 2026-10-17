import { test } from "node:test";
import assert from "node:assert/strict";
import { validateToolArguments } from "@earendil-works/pi-ai";
import { managementTool, parseAgentManagementParams, validateManagementParams } from "../tools.ts";
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
  assert.equal(validateManagementParams("process", { action: "list" }), undefined);
  assert.ok(validateManagementParams("process", { action: "list", task_type: null }));
  assert.equal(input.verbose, null); assert.equal(calls, 0);
});
