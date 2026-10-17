import { test } from "node:test";
import assert from "node:assert/strict";
import { agentToolFields, parseAgentToolArguments, assertMessageToolArguments, parseWorkflowToolArguments } from "../src/tool-contract.ts";
const main = { nested: false, isolation: true, scheduling: true };
const nested = { ...main, nested: true, scheduling: false };
const run = (values: Record<string, unknown>, capabilities = main) => ({ ...Object.fromEntries(agentToolFields(capabilities).map(field => [field, null])), ...values });
const workflow = (values: Record<string, unknown>) => ({ script: null, scriptPath: null, name: null, args: null, resumeFromRunId: null, ...values });

test("required control nulls select spawn/resume without mutating the wire object", () => {
  for (const capabilities of [main, nested]) {
    const input = Object.freeze(run({ prompt: "inspect", description: "work", subagent_type: "Explore" }, capabilities));
    assert.deepEqual(parseAgentToolArguments(input, capabilities), { prompt: "inspect", description: "work", subagent_type: "Explore" });
    assert.equal(input.resume, null);
    const resume = parseAgentToolArguments(run({ prompt: "continue", resume: "agent" }, capabilities), capabilities);
    assert.deepEqual(resume, { prompt: "continue", resume: "agent" });
    for (const field of agentToolFields(capabilities)) {
      const missing = { ...input }; delete missing[field];
      assert.throws(() => parseAgentToolArguments(missing, capabilities), /must be provided/);
    }
  }
});
test("null cannot hide unknown or unavailable fields and non-null mode conflicts remain errors", () => {
  const base = { prompt: "inspect", description: "work", subagent_type: "Explore" };
  for (const extra of [{ typo: null }, { model: " " }, { thinking: "hight" }, { isolated: "false" }, { name: "a b" }]) assert.throws(() => parseAgentToolArguments(run({ ...base, ...extra }), main));
  assert.throws(() => parseAgentToolArguments(run({ ...base, schedule: null }, nested), nested), /schedule/);
  assert.throws(() => parseAgentToolArguments(run({ ...base, name: null }, nested), nested), /name/);
  const disabled = { ...main, isolation: false };
  assert.throws(() => parseAgentToolArguments(run({ ...base, isolation: null }, disabled), disabled), /isolation/);
  for (const capabilities of [main, nested]) {
    for (const resume of ["", " \t\n", 7]) assert.throws(() => parseAgentToolArguments(run({ ...base, resume }, capabilities), capabilities), /`resume` must be/);
    assert.throws(() => parseAgentToolArguments(run({ ...base, resume: "agent" }, capabilities), capabilities), /non-null resume selects resume mode/);
    assert.throws(() => parseAgentToolArguments(run({ prompt: "x" }, capabilities), capabilities), /description/);
  }
  for (const mode of [false, true]) assert.throws(() => parseAgentToolArguments(run({ prompt: "continue", resume: "agent", run_in_background: mode }, nested), nested), /run_in_background/);
  assert.equal(parseAgentToolArguments(run({ ...base, run_in_background: false, thinking: "off" }), main).run_in_background, false);
});
test("workflow requires every wire field, ignores only control null and preserves data null", () => {
  const input = Object.freeze(workflow({ script: "return args" }));
  assert.deepEqual(parseWorkflowToolArguments(input), { script: "return args", args: null });
  assert.equal(input.name, null);
  assert.deepEqual(parseWorkflowToolArguments(workflow({ resumeFromRunId: "wf_abcdef" })), { resumeFromRunId: "wf_abcdef", args: null });
  for (const args of [null, false, 0, "", { value: null }, [null]]) assert.equal(parseWorkflowToolArguments(workflow({ script: "return args", args })).args, args);
  for (const field of Object.keys(input)) { const missing: Record<string, unknown> = { ...input }; delete missing[field]; assert.throws(() => parseWorkflowToolArguments(missing), /must be provided/); }
  for (const value of [{}, { script: "x", name: "review" }, { script: "" }, { resumeFromRunId: "" }, { script: "x", typo: null }]) assert.throws(() => parseWorkflowToolArguments(workflow(value)));
});
test("message strings remain required non-null and closed", () => {
  assert.doesNotThrow(() => assertMessageToolArguments({ agent_id: "agent", message: "continue" }));
  for (const value of [null, [], {}, { agent_id: null, message: "x" }, { agent_id: "agent", message: null }, { agent_id: "agent", message: " " }, { agent_id: "agent", message: "x", extra: null }]) assert.throws(() => assertMessageToolArguments(value));
});
