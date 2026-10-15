import assert from "node:assert/strict";
import { it } from "node:test";
import { validateToolArguments } from "@earendil-works/pi-ai";
import { createRuntimeTaskFacade, runtimeTaskTool } from "../facade.ts";

it("task_manage rejects fractional paging before host integer coercion can discard it", () => {
  const tool = runtimeTaskTool(createRuntimeTaskFacade([]));
  const validate = (args: Record<string, string | number>) => validateToolArguments(tool,
    { type: "toolCall", id: "call", name: tool.name, arguments: args });
  for (const field of ["offset", "limit", "context"]) {
    for (const value of [1.5, "1.5"]) {
      assert.throws(() => validate({ action: "search", pattern: "x", [field]: value }),
        error => error instanceof Error && error.message.includes(field) && error.message.includes("multiple of 1"));
    }
    const args = { action: "search", pattern: "x", [field]: 2 };
    assert.deepEqual(validate(args), args);
    assert.deepEqual(validate({ ...args, [field]: "2" }), args);
  }
});
