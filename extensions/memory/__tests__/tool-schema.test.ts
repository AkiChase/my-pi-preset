/**
 * The memory tools' schema must not be more permissive than the store.
 *
 * Both layers check the same limits, which is deliberate — the host rejects an
 * out-of-range call before `execute` runs and names the field. But a schema bound
 * larger than the runtime bound is worse than either: the call passes validation
 * and then fails with a message about a limit the caller was never told about.
 * `description` was declared `maxLength: 320` against a 160-codepoint policy, and
 * `query` 320 against a 160-character one.
 *
 * One documented exception: `query` declares `maxLength` only, and its "no control
 * characters" rule is enforced at `execute`. Expressing a character set needs `pattern`,
 * and every consumer compiles that regex — including provider-side schema validators that
 * reject lookaround, where one unsupported construct fails the whole request. The rule
 * therefore stays visible in the field description and in the execute error instead of
 * the schema.
 */
import assert from "node:assert/strict";
import { it } from "node:test";
import type { ExtensionAPI, ToolDefinition } from "@earendil-works/pi-coding-agent";
import { validateToolArguments } from "@earendil-works/pi-ai";
import memory from "../../memory.ts";
import { listInput } from "./list-input.ts";
import { fixture } from "./helpers.ts";

const REVISION = "a".repeat(64);

function registered(t: Parameters<typeof fixture>[0]) {
    const { agentDir } = fixture(t);
    const previous = process.env.PI_CODING_AGENT_DIR;
    process.env.PI_CODING_AGENT_DIR = agentDir;
    t.after(() => {
        if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR;
        else process.env.PI_CODING_AGENT_DIR = previous;
    });
    const tools = new Map<string, ToolDefinition>();
    const pi = {
        registerCommand() {},
        registerTool(tool: ToolDefinition) { tools.set(tool.name, tool); },
        on() { return () => {}; },
    } as unknown as ExtensionAPI;
    memory(pi);
    return { tools };
}

function hostError(tools: Map<string, ToolDefinition>, name: string, args: unknown): Error | undefined {
    try {
        validateToolArguments(
            { name, description: "", parameters: tools.get(name)!.parameters } as never,
            { id: "call", name, arguments: args } as never
        );
        return undefined;
    } catch (err) {
        return err as Error;
    }
}

void it("Memory tool names and display labels use lowercase snake_case", t => {
    const { tools } = registered(t);
    for (const tool of tools.values()) {
        assert.match(tool.name, /^[a-z][a-z0-9_]*$/);
        assert.equal(tool.label, tool.name);
    }
});

void it("every memory tool rejects an unknown field instead of ignoring it", t => {
    const { tools } = registered(t);
    for (const [name, args] of [
        ["memory_read", { name: "item", body: "x" }],
        ["memory_list", listInput({ limitt: 5 })],
        ["memory_write", { name: "item", type: "user", description: "d", body: "b", expectedRevision: null, extra: 1 }],
        ["memory_forget", { name: "item", expectedRevision: REVISION, force: true }],
    ] as const) {
        const err = hostError(tools, name, args);
        assert.ok(err, `${name} must reject an unknown field`);
    }
});

void it("description is bounded at the policy limit, not above it", t => {
    const { tools } = registered(t);
    const write = (description: string) => hostError(tools, "memory_write",
        { name: "item", type: "user", description, body: "content", expectedRevision: null });
    // The policy measures Unicode codepoints; this string is 160 of them.
    assert.equal(write("😀".repeat(160)), undefined, "160 astral codepoints must be accepted");
    const err = write("😀".repeat(161));
    assert.ok(err, "161 codepoints must be rejected before reaching the store");
    assert.match(err.message, /description/);
});

void it("list query keeps only the length bound; control characters are an execute concern", t => {
    const { tools } = registered(t);
    assert.equal(hostError(tools, "memory_list", listInput({ query: "q".repeat(160) })), undefined);
    const err = hostError(tools, "memory_list", listInput({ query: "q".repeat(161) }));
    assert.ok(err, "a query longer than the store accepts must be rejected");
    assert.match(err.message, /query/);
    // Deliberate exception to "schema is never more permissive than the store": a character-set rule
    // needs `pattern`, and provider-side schema validators reject regexes such as lookaround. The rule
    // stays enforced at execute and is named in the field description, so no caller meets an
    // unannounced limit.
    assert.equal(hostError(tools, "memory_list", listInput({ query: "bad\nquery" })), undefined);
});

void it("name, revision and paging keep their declared bounds", t => {
    const { tools } = registered(t);
    assert.equal(hostError(tools, "memory_read", { name: "item-1" }), undefined);
    assert.ok(hostError(tools, "memory_read", { name: "Item" }), "names are lowercase slugs");
    // Reserved names are rejected by validName() at runtime, not this slug schema.
    assert.equal(hostError(tools, "memory_read", { name: "index" }), undefined);
    assert.ok(hostError(tools, "memory_forget", { name: "item", expectedRevision: "short" }), "an exact SHA256 is required");
    assert.equal(hostError(tools, "memory_forget", { name: "item", expectedRevision: REVISION }), undefined);
    for (const field of ["offset", "limit"] as const) {
        for (const fraction of [1.5, "1.5"]) {
            const err = hostError(tools, "memory_list", listInput({ [field]: fraction }));
            assert.ok(err, `${field} must reject fractions without integer coercion`);
            assert.match(err.message, new RegExp(field));
        }
    }
    assert.equal(hostError(tools, "memory_list", listInput({ limit: 50 })), undefined);
    assert.ok(hostError(tools, "memory_list", listInput({ limit: 51 })), "the page size is capped at 50");
    assert.ok(hostError(tools, "memory_list", listInput({ offset: -1 })), "offset is non-negative");
});
