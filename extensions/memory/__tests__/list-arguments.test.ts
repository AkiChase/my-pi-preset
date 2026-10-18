import assert from "node:assert/strict";
import { it } from "node:test";
import type { ExtensionAPI, ExtensionToolContext, ToolDefinition } from "@earendil-works/pi-coding-agent";
import { validateToolArguments } from "@earendil-works/pi-ai";
import * as fs from "node:fs";
import { join } from "node:path";
import { registerMemoryTools } from "../tools.ts";
import { header, LIST_BYTES, TOPIC_BYTES } from "../policy.ts";
import { fixture } from "./helpers.ts";
import { listInput } from "./list-input.ts";

function registered(getOrigin: Parameters<typeof registerMemoryTools>[1]) {
  const tools = new Map<string, ToolDefinition>();
  registerMemoryTools({ registerTool(tool: ToolDefinition) { tools.set(tool.name, tool); } } as unknown as ExtensionAPI, getOrigin);
  const tool = tools.get("memory_list")!;
  const host = (arguments_: unknown) => validateToolArguments(tool, { type: "toolCall", id: "test", name: tool.name, arguments: arguments_ as never });
  const direct = (args: unknown) => tool.execute("test", args as never, undefined, undefined, { cwd: "/unused" } as ExtensionToolContext);
  return { tool, host, direct };
}

it("memory_list schema is required, nonnullable, closed and has no defaults", () => {
  const { tool, host } = registered(() => { throw new Error("must not run"); });
  const schema = tool.parameters as { required: string[]; additionalProperties: boolean; properties: Record<string, { type: string; default?: unknown }> };
  assert.deepEqual(schema.required, ["query", "offset", "limit"]);
  assert.equal(schema.additionalProperties, false);
  for (const [field, type] of [["query", "string"], ["offset", "number"], ["limit", "number"]]) {
    assert.equal(schema.properties[field].type, type);
    assert.equal(Object.hasOwn(schema.properties[field], "default"), false);
    const args = listInput(); delete args[field];
    assert.throws(() => host(args), new RegExp(field));
  }
  assert.throws(() => host(listInput({ unknown: null })), /unknown/);
  for (const query of ["😀".repeat(161)]) assert.throws(() => host(listInput({ query })), /query/);
  // Control characters no longer fail schema validation; the direct-call test covers their rejection.
  for (const query of ["bad\nquery", "bad\n", "bad\r", "bad\u0085query"]) assert.deepEqual(host(listInput({ query })).query, query);
  for (const offset of [-1, Number.MAX_SAFE_INTEGER + 1, 1.5, "1.5"]) assert.throws(() => host(listInput({ offset })), /offset/);
  for (const limit of [0, 51, 1.5, "1.5"]) assert.throws(() => host(listInput({ limit })), /limit/);
  for (const args of [listInput(), listInput({ query: "😀".repeat(160), offset: Number.MAX_SAFE_INTEGER, limit: 50 }), listInput({ limit: 1 })]) assert.deepEqual(host(args), args);
});

it("installed host scalar conversion is distinct from strict direct admission", () => {
  const { host } = registered(() => { throw new Error("must not run"); });
  // The SDK converts a clone before validation; the raw scalar cannot be recovered at execute.
  for (const [value, converted] of [[null, "null"], [false, "false"], [0, "0"], [undefined, ""]] as const) {
    const args = listInput({ query: value });
    assert.deepEqual(host(args), listInput({ query: converted }));
    assert.equal(args.query, value);
  }
  for (const value of [null, false, "", undefined]) assert.deepEqual(host(listInput({ offset: value })), listInput());
  for (const value of [null, false, "", undefined]) assert.throws(() => host(listInput({ limit: value })), /limit/);
  assert.deepEqual(host(listInput({ offset: "2", limit: "3" })), listInput({ offset: 2, limit: 3 }));
});

it("direct malformed list calls fail safely before origin or reads and do not mutate inputs", async () => {
  let origins = 0;
  const { direct } = registered(() => { origins++; throw new Error("RAW_ORIGIN_SECRET"); });
  const invalid: unknown[] = [null, undefined, [], "RAW_INPUT_SECRET", 0, false, {}];
  for (const field of ["query", "offset", "limit"]) {
    const missing = listInput(); delete missing[field]; invalid.push(missing);
    for (const value of [null, undefined, false, {}, []]) invalid.push(listInput({ [field]: value }));
  }
  for (const query of [0, "😀".repeat(161), "bad\nquery", "bad\n", "bad\r", "bad\u0085query", ...[0, 10, 31, 127, 128, 159].map(code => `x${String.fromCharCode(code)}`)]) invalid.push(listInput({ query }));
  for (const offset of [-1, 0.1, "0", NaN, Infinity, -Infinity, Number.MAX_SAFE_INTEGER + 1]) invalid.push(listInput({ offset }));
  for (const limit of [0, -1, 51, 0.1, "20", NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) invalid.push(listInput({ limit }));
  invalid.push(listInput({ RAW_FIELD_SECRET: null }), { ...listInput(), [Symbol("RAW_SYMBOL_SECRET")]: null });
  invalid.push(Object.create(listInput()));
  const throwing = listInput(); Object.defineProperty(throwing, "query", { get() { throw new Error("RAW_GETTER_SECRET"); }, enumerable: true }); invalid.push(throwing);
  let message: string | undefined;
  for (const args of invalid) {
    if (args && typeof args === "object") Object.freeze(args);
    const descriptors = args && typeof args === "object" ? Object.getOwnPropertyDescriptors(args) : undefined;
    const result = await direct(args);
    assert.equal(result.isError, true); assert.deepEqual(result.details, { error: "list" });
    const text = result.content[0]; assert.equal(text.type, "text");
    if (text.type === "text") { message ??= text.text; assert.equal(text.text, message); assert.match(text.text, /query.*offset.*limit/); }
    assert.doesNotMatch(JSON.stringify(result), /RAW_/);
    if (descriptors) assert.deepEqual(Object.getOwnPropertyDescriptors(args), descriptors);
  }
  assert.equal(origins, 0);
});

it("valid direct list arguments reach the store unchanged; raw IO errors remain hidden", async t => {
  const { store } = fixture(t);
  let origins = 0;
  const received: unknown[][] = [];
  const originalList = store.list.bind(store);
  store.list = (query, offset, limit) => { received.push([query, offset, limit]); return originalList(query, offset, limit); };
  const { direct } = registered(() => { origins++; return { store, assertActive() {} }; });
  for (const args of [listInput(), listInput({ query: "😀".repeat(160), offset: Number.MAX_SAFE_INTEGER, limit: 50 }), listInput({ limit: 1 })]) {
    const before = { ...args };
    const frozen = Object.freeze(args); const result = await direct(frozen);
    assert.equal(result.isError, undefined); assert.deepEqual(result.details, { entries: [], total: 0, offset: args.offset, nextOffset: null });
    assert.deepEqual(received.at(-1), [before.query, before.offset, before.limit]);
    assert.deepEqual(frozen, before);
  }
  assert.equal(origins, 3);
  const failing = registered(() => { throw new Error("RAW_PATH_SECRET"); });
  const result = await failing.direct(listInput()); assert.equal(result.isError, true); assert.deepEqual(result.details, { error: "io" });
  assert.equal(result.content[0].type === "text" && result.content[0].text, "Memory operation failed due to a filesystem or permission error.");
});

it("registered explicit list paging preserves 8KiB, metadata-only reads, query and nextOffset:null", async t => {
  const { store } = fixture(t);
  for (let n = 0; n < 61; n++) {
    const meta = { name: `entry-${String(n).padStart(3, "0")}`, description: "四".repeat(160), type: "project" as const, created: "2026-10-15T00:00:00.000Z", updated: "2026-10-15T00:00:00.000Z" };
    const front = header(meta);
    // Invalid UTF8 body proves the list never attempts full body decoding.
    fs.writeFileSync(join(store.directory, `${meta.name}.md`), Buffer.concat([Buffer.from(front), Buffer.alloc(TOPIC_BYTES - Buffer.byteLength(front), 255)]));
  }
  const { direct, host } = registered(() => ({ store, assertActive() {} }));
  let offset: number | null = 0; const names: string[] = [];
  while (offset !== null) {
    const result = await direct(host(listInput({ offset, limit: 50 })));
    assert.equal(result.isError, undefined);
    const page = result.details as { entries: { name: string }[]; total: number; offset: number; nextOffset: number | null };
    assert.equal(page.total, 61); assert.equal(page.offset, offset);
    assert.ok(page.entries.length > 0 && page.entries.length < 50, "byte budget, not just requested limit, bounds each page");
    assert.ok(Buffer.byteLength(result.content[0].type === "text" ? result.content[0].text : "") <= LIST_BYTES);
    assert.equal(page.entries.some(entry => Object.hasOwn(entry, "body") || Object.hasOwn(entry, "revision")), false);
    names.push(...page.entries.map(entry => entry.name));
    if (page.nextOffset !== null) assert.equal(page.nextOffset, offset + page.entries.length);
    offset = page.nextOffset;
  }
  assert.equal(names.length, 61); assert.equal(new Set(names).size, 61);
  const filtered = await direct(listInput({ query: "ENTRY-060", limit: 1 }));
  assert.equal(filtered.isError, undefined);
  assert.equal((filtered.details as { total: number; nextOffset: number | null }).total, 1);
  assert.equal((filtered.details as { nextOffset: number | null }).nextOffset, null);
});
