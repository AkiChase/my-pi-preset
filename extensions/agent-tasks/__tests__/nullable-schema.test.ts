import { test } from "node:test";
import assert from "node:assert/strict";
import { Type } from "typebox";
import { validateToolArguments } from "@earendil-works/pi-ai";
import { nullableControl, parseControlArguments } from "../../shared/tool-arguments.ts";

test("host requires every nullable control field and does not erase declared null", () => {
  const tool = { name: "probe", description: "offline", parameters: Type.Object({ prompt: Type.String(), text: nullableControl(Type.String()), flag: nullableControl(Type.Boolean()), args: Type.Any() }, { additionalProperties: false }) };
  const input = { prompt: "work", text: null, flag: false, args: { value: null, index: 0 } };
  const validate = (arguments_: unknown) => validateToolArguments(tool, { type: "toolCall", id: "probe", name: tool.name, arguments: arguments_ as never });
  assert.deepEqual(validate(input), input);
  const required = Reflect.get(tool.parameters, "required") as string[];
  assert.deepEqual(required, ["prompt", "text", "flag", "args"]);
  for (const field of required) { const missing: Record<string, unknown> = { ...input }; delete missing[field]; assert.throws(() => validate(missing)); }
  assert.throws(() => validate({ ...input, typo: null }));
  // Host scalar conversion can turn a non-nullable null into a string;
  // semantic non-empty admission remains the tool's responsibility.
  const converted = validate({ ...input, prompt: null });
  assert.equal(typeof converted.prompt, "string");
  const parsed = parseControlArguments(Object.freeze(input), required, ["text", "flag"]);
  assert.deepEqual(parsed, { prompt: "work", flag: false, args: input.args });
  assert.equal(input.text, null);
  assert.equal(parsed.args, input.args);
});
