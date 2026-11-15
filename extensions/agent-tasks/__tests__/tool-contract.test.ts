import { test } from "node:test";
import assert from "node:assert/strict";
import { agentToolFields, parseAgentToolArguments, assertMessageToolArguments, parseMessageToolArguments, parseWorkflowToolArguments } from "../src/tool-contract.ts";
const main = { nested: false, isolation: true };
const nested = { ...main, nested: true };
const DEFAULTABLE = ["model", "thinking", "execution", "tools", "context", "isolation"];
/** A new-agent call: defaultable controls "default", nullable controls "null". */
const run = (values: Record<string, unknown>, capabilities = main) => ({
  ...Object.fromEntries(agentToolFields(capabilities).map(field => [field, DEFAULTABLE.includes(field) ? "default" : "null"])), ...values,
});
/** A resume call: every control "null". */
const resumeCall = (values: Record<string, unknown>, capabilities = main) => ({ ...Object.fromEntries(agentToolFields(capabilities).map(field => [field, "null"])), ...values });
const workflow = (values: Record<string, unknown>) => ({ script: "null", scriptPath: "null", name: "null", args: {}, resumeFromRunId: "null", ...values });

test("string sentinels select spawn/resume without mutating the wire object", () => {
  for (const capabilities of [main, nested]) {
    const input = Object.freeze(run({ prompt: "inspect", description: "work", subagent_type: "Explore" }, capabilities));
    assert.deepEqual(parseAgentToolArguments(input, capabilities), { prompt: "inspect", description: "work", subagent_type: "Explore" });
    assert.equal(input.resume, "null");
    // D10: "null" in an applicable defaultable field is the default.
    assert.deepEqual(parseAgentToolArguments(resumeCall({ prompt: "inspect", description: "work", subagent_type: "Explore" }, capabilities), capabilities),
      { prompt: "inspect", description: "work", subagent_type: "Explore" });
    const resume = parseAgentToolArguments(resumeCall({ prompt: "continue", resume: "agent" }, capabilities), capabilities);
    assert.deepEqual(resume, { prompt: "continue", resume: "agent" });
    for (const field of agentToolFields(capabilities)) {
      const missing: Record<string, unknown> = { ...input }; delete missing[field];
      assert.throws(() => parseAgentToolArguments(missing, capabilities), /must be provided/);
    }
  }
});

test("semantic enums map to the internal boolean options", () => {
  const base = { prompt: "inspect", description: "work", subagent_type: "Explore" };
  assert.deepEqual(parseAgentToolArguments(run({ ...base, execution: "foreground", tools: "builtin", context: "inherit", thinking: "off", isolation: "off", model: "haiku" }), main),
    { ...base, run_in_background: false, isolated: true, inherit_context: true, thinking: "off", isolation: "off", model: "haiku" });
  assert.deepEqual(parseAgentToolArguments(run({ ...base, execution: "background", tools: "full", context: "fresh" }), main),
    { ...base, run_in_background: true, isolated: false, inherit_context: false });
  const resumed = parseAgentToolArguments(resumeCall({ prompt: "continue", resume: "agent", execution: "background" }), main);
  assert.equal(resumed.run_in_background, true);
});

test("unknown, unavailable, invalid and mode-conflicting fields are errors naming the field", () => {
  const base = { prompt: "inspect", description: "work", subagent_type: "Explore" };
  for (const extra of [{ typo: "null" }, { model: " " }, { thinking: "hight" }, { thinking: "none" }, { tools: "false" }, { execution: "true" }, { isolated: "null" }, { run_in_background: "null" }, { name: "a b" }]) {
    assert.throws(() => parseAgentToolArguments(run({ ...base, ...extra }), main));
  }
  for (const capabilities of [main, nested]) assert.throws(() => parseAgentToolArguments(run({ ...base, schedule: "null" }, capabilities), capabilities), /schedule/);
  const disabled = { ...main, isolation: false };
  assert.throws(() => parseAgentToolArguments(run({ ...base, isolation: "null" }, disabled), disabled), /isolation/);
  for (const capabilities of [main, nested]) {
    for (const resume of ["", " \t\n", 7]) assert.throws(() => parseAgentToolArguments(run({ ...base, resume }, capabilities), capabilities), /`resume`/);
    // A real resume with new-agent fields is a mode conflict, and "default" is not "null" when a field does not apply.
    assert.throws(() => parseAgentToolArguments(run({ ...base, resume: "agent" }, capabilities), capabilities), /`description` does not apply when resuming.*selects resume mode/);
    assert.throws(() => parseAgentToolArguments(resumeCall({ prompt: "x", resume: "agent", model: "default" }, capabilities), capabilities), /`model` does not apply when resuming; set it to "null" \(got "default"\)/);
    assert.throws(() => parseAgentToolArguments(run({ prompt: "x" }, capabilities), capabilities), /`description` is required for a new agent/);
    // "default" is only a sentinel on defaultable fields; in description it is literal text.
    assert.equal(parseAgentToolArguments(run({ ...base, description: "default" }, capabilities), capabilities).description, "default");
  }
  for (const mode of ["foreground", "background", "default"]) assert.throws(() => parseAgentToolArguments(resumeCall({ prompt: "continue", resume: "agent", execution: mode }, nested), nested), /`execution` does not apply/);
  // The incident: JSON null or the string "null" in resume must start a new agent, never resume one.
  assert.equal(parseAgentToolArguments(run({ ...base, resume: "null" }), main).resume, undefined);
  assert.throws(() => parseAgentToolArguments(run({ ...base, resume: null }), main), /`resume` must not be JSON null/);
});

test("workflow requires every wire field, treats \"null\" sources as unset and preserves args data", () => {
  const input = Object.freeze(workflow({ script: "return args" }));
  assert.deepEqual(parseWorkflowToolArguments(input), { script: "return args", args: {} });
  assert.deepEqual(parseWorkflowToolArguments(workflow({ resumeFromRunId: "wf_abcdef" })), { resumeFromRunId: "wf_abcdef", args: {} });
  for (const args of [null, false, 0, "", "null", { value: null }, [null]]) assert.equal(parseWorkflowToolArguments(workflow({ script: "return args", args })).args, args);
  for (const field of Object.keys(input)) { const missing: Record<string, unknown> = { ...input }; delete missing[field]; assert.throws(() => parseWorkflowToolArguments(missing), /must be provided/); }
  for (const value of [{}, { script: "x", name: "review" }, { script: "" }, { resumeFromRunId: "" }, { resumeFromRunId: "default" }, { script: null }, { script: "x", typo: "null" }]) {
    assert.throws(() => parseWorkflowToolArguments(workflow(value)));
  }
});

test("message strings remain required and reply is a closed business enum", () => {
  assert.doesNotThrow(() => assertMessageToolArguments({ agent_id: "agent", message: "continue" }));
  for (const value of [null, [], {}, { agent_id: null, message: "x" }, { agent_id: "agent", message: null }, { agent_id: "agent", message: " " }, { agent_id: "agent", message: "x", extra: null }]) assert.throws(() => assertMessageToolArguments(value));
  assert.deepEqual(parseMessageToolArguments({ agent_id: "a", message: "m", reply: "skip" }), { agent_id: "a", message: "m" });
  assert.deepEqual(parseMessageToolArguments({ agent_id: "a", message: "null", reply: "wait" }), { agent_id: "a", message: "null", reply: "wait" });
  for (const reply of ["null", null, "none", ""]) assert.throws(() => parseMessageToolArguments({ agent_id: "a", message: "m", reply }), /`reply` must be "skip", "wait" or "notify"/);
});
