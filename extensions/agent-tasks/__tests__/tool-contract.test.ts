import { test } from "node:test";
import assert from "node:assert/strict";
import { assertAgentToolArguments, assertMessageToolArguments } from "../src/tool-contract.ts";
const main = { nested: false, isolation: true, scheduling: true };
const nested = { ...main, nested: true, scheduling: false };
test("tool admission separates spawn and resume without ignored parameters", () => {
  assert.doesNotThrow(() => assertAgentToolArguments({ prompt: "continue", resume: "agent", run_in_background: false }, main));
  assert.doesNotThrow(() => assertAgentToolArguments({ prompt: "continue", resume: "agent" }, nested));
  assert.doesNotThrow(() => assertAgentToolArguments({ prompt: "inspect", description: "inspect code", subagent_type: "Explore" }, main));
  for (const field of ["description", "name", "subagent_type", "model", "thinking", "isolated", "inherit_context", "isolation", "schedule"]) {
    assert.throws(() => assertAgentToolArguments({ prompt: "continue", resume: "agent", [field]: "value" }, main), /not accepted/);
  }
  for (const mode of [false, true]) assert.throws(() => assertAgentToolArguments({ prompt: "continue", resume: "agent", run_in_background: mode }, nested));
  for (const value of [null, [], {}, { prompt: "x", resume: "" }, { prompt: "x", resume: null }, { prompt: "x", description: "x" }]) assert.throws(() => assertAgentToolArguments(value, main));
});
test("direct tool calls reject unknown, malformed and disabled fields", () => {
  const base = { prompt: "inspect", description: "inspect code", subagent_type: "Explore" };
  for (const extra of [{ typo: true }, { isolated: "false" }, { thinking: "hight" }, { name: "a b" }, { isolation: "remote" }, { model: " " }]) assert.throws(() => assertAgentToolArguments({ ...base, ...extra }, main));
  assert.throws(() => assertAgentToolArguments({ ...base, isolation: "off" }, { ...main, isolation: false }));
  assert.throws(() => assertAgentToolArguments({ ...base, schedule: "+10m" }, nested));
});
test("message admission validates the closed real-ID input shape", () => {
  assert.doesNotThrow(() => assertMessageToolArguments({ agent_id: "agent", message: "continue" }));
  for (const value of [null, [], { agent_id: "", message: "x" }, { agent_id: "agent", message: " " }, { agent_id: "agent", message: "x", execution_id: "exec_" }]) assert.throws(() => assertMessageToolArguments(value));
});
