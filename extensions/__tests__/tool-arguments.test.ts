import assert from "node:assert/strict";
import { test } from "node:test";
import { validateToolArguments } from "@earendil-works/pi-ai";
import { Type } from "typebox";
import {
  defaultableEnum, integerString, nullableEnum, nullableObject, parseControls, rejectInapplicable, requireValue, sentinelString,
  type ControlSpec,
} from "../shared/tool-arguments.ts";

const controls: Record<string, ControlSpec> = {
  id: { kind: "nullable" },
  mode: { kind: "defaultable" },
  offset: { kind: "nullable", integer: { min: 0 } },
  limit: { kind: "defaultable", integer: { min: 1 } },
};
const fields = ["text", "id", "mode", "offset", "limit"];
const base = { text: "null", id: "null", mode: "default", offset: "null", limit: "default" };

test("sentinels separate from real values; undeclared fields keep literal text", () => {
  const parsed = parseControls(base, fields, controls);
  assert.deepEqual(parsed.values, { text: "null" });
  assert.deepEqual(parsed.sentinels, { id: "null", mode: "default", offset: "null", limit: "default" });
  const real = parseControls({ ...base, id: "x1", mode: "fast", offset: "0", limit: "12" }, fields, controls);
  assert.deepEqual(real.values, { text: "null", id: "x1", mode: "fast", offset: 0, limit: 12 });
  // A defaultable field accepts "null" as its default.
  assert.deepEqual(parseControls({ ...base, mode: "null", limit: "null" }, fields, controls).sentinels.mode, "null");
});

test("nullable fields do not accept \"default\" as a sentinel", () => {
  assert.equal(parseControls({ ...base, id: "default" }, fields, controls).values.id, "default");
  assert.throws(() => parseControls({ ...base, offset: "default" }, fields, controls), /`offset` must be a non-negative integer string or "null"/);
});

test("integer strings keep the original bounds", () => {
  for (const bad of ["-1", "1.5", "abc", "9007199254740993", " 1"]) {
    assert.throws(() => parseControls({ ...base, offset: bad }, fields, controls), /`offset`/);
  }
  assert.throws(() => parseControls({ ...base, limit: "0" }, fields, controls), /`limit` must be a positive integer string/);
  assert.equal(parseControls({ ...base, limit: 3 }, fields, controls).values.limit, 3);
});

test("JSON null, empty strings, missing and unknown fields are rejected with the field name", () => {
  assert.throws(() => parseControls({ ...base, id: null }, fields, controls), /`id` must not be JSON null; use the string "null"/);
  assert.throws(() => parseControls({ ...base, mode: "" }, fields, controls), /`mode` is empty; use "default"/);
  const missing: Record<string, unknown> = { ...base }; delete missing.limit;
  assert.throws(() => parseControls(missing, fields, controls), /Field 'limit' must be provided/);
  assert.throws(() => parseControls({ ...base, extra: "null" }, fields, controls), /Field 'extra' is not accepted/);
  assert.throws(() => parseControls([], fields, controls), /must be an object/);
});

test("branch helpers reject inapplicable values and sentinel-filled required fields", () => {
  const parsed = parseControls({ ...base, id: "x1" }, fields, controls);
  assert.throws(() => rejectInapplicable(parsed, ["id"], "to list"), /`id` does not apply to list; set it to "null" \(got a value\)/);
  assert.throws(() => rejectInapplicable(parsed, ["mode"], "to list"), /`mode` does not apply to list; set it to "null" \(got "default"\)/);
  rejectInapplicable(parsed, ["offset"], "to list");
  assert.equal(requireValue(parsed, "id", "for status"), "x1");
  assert.throws(() => requireValue(parsed, "offset", "for output"), /`offset` is required for output; "null" is not a value/);
});

test("schemas contain no JSON null and accept the coerced spellings", () => {
  const tool = {
    name: "probe", description: "probe",
    parameters: Type.Object({
      id: sentinelString("id"),
      kind: nullableEnum(["a", "b"] as const, "kind"),
      mode: defaultableEnum(["fast"] as const, "mode"),
      limit: integerString(["default"], "limit"),
      ws: nullableObject(Type.Object({ url: Type.String() }, { additionalProperties: false }), "ws"),
    }, { additionalProperties: false }),
  };
  assert.doesNotMatch(JSON.stringify(tool.parameters), /"type":"null"/);
  const call = (args: unknown) => validateToolArguments(tool as never, { type: "toolCall", id: "c", name: "probe", arguments: args as never });
  // JSON null and numbers are coerced to their string spellings by the host.
  assert.deepEqual(call({ id: null, kind: null, mode: null, limit: 5, ws: null }), { id: "null", kind: "null", mode: "null", limit: "5", ws: "null" });
  assert.deepEqual(call({ id: "x", kind: "a", mode: "default", limit: "null", ws: { url: "wss://x" } }), { id: "x", kind: "a", mode: "default", limit: "null", ws: { url: "wss://x" } });
  assert.throws(() => call({ id: "x", kind: "c", mode: "default", limit: "default", ws: "null" }));
  assert.throws(() => call({ id: "x", kind: "a", mode: "default", limit: "-1", ws: "null" }));
});
