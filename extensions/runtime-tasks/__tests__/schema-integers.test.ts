import assert from "node:assert/strict";
import { it } from "node:test";
import { validateToolArguments } from "@earendil-works/pi-ai";
import { managementTool } from "../tools.ts";

it("task_manage rejects fractional paging before host integer coercion can discard it", () => {
  const tool = managementTool("process", []).tool;
  const validate = (args: Record<string, string | number>) => validateToolArguments(tool,
    { type: "toolCall", id: "call", name: tool.name, arguments: args });
  // Each paging field is reachable only through the action that accepts it.
  const cases: readonly (readonly [string, Record<string, string | number>, readonly string[]])[] = [
    ["output", { task_id: "x" }, ["offset", "limit"]],
    ["wait", { task_id: "x" }, ["limit"]],
    ["search", { pattern: "x" }, ["context"]],
  ];
  for (const [action, base, fields] of cases) {
    for (const field of fields) {
      // A fraction must be rejected outright, never coerced into a whole page.
      // The per-action union reports the failure per branch, so the message is
      // only guaranteed to name the field; the schema-level guarantee that the
      // field is `number` + `multipleOf: 1` rather than a truncating integer is
      // asserted in contracts.test.ts.
      for (const value of [1.5, "1.5"]) {
        assert.throws(() => validate({ action, ...base, [field]: value }),
          error => error instanceof Error && error.message.includes(field), `${action}/${field}=${String(value)}`);
      }
      const args = { action, ...base, [field]: 2 };
      assert.deepEqual(validate(args), args);
      assert.deepEqual(validate({ ...args, [field]: "2" }), args);
    }
  }
});
