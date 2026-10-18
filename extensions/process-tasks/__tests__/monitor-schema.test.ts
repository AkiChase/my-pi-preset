import { monitorInput } from "./monitor-input.ts";
/**
 * Monitor wire schema, actual host conversions and strict direct admission.
 * Fixed-object closure and required nullable controls are distinct from the
 * SDK scalar conversion step, which cannot establish raw input validity.
 */
import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { validateToolArguments } from "@earendil-works/pi-ai";
import { BackgroundRegistry } from "../state.ts";
import { DEFAULTS } from "../config.ts";
import { registerMonitorTool, parseMonitorArguments } from "../tools/monitor.ts";

const dir = mkdtempSync(join(tmpdir(), "monitor-schema-"));
after(() => { rmSync(dir, { recursive: true, force: true }); });

interface ToolDef {
    name: string;
    description?: string;
    parameters: unknown;
    execute: (id: string, params: unknown, signal: undefined, update: undefined, ctx: unknown) => Promise<unknown>;
}

function harness() {
    const reg = new BackgroundRegistry({ ...DEFAULTS, logDir: dir });
    let tool!: ToolDef;
    registerMonitorTool(
        { registerTool: (def: ToolDef) => { tool = def; }, sendMessage: () => {} } as never,
        reg
    );
    const ctx = {
        cwd: dir,
        ui: { notify: () => {}, setWidget: () => {}, setStatus: () => {}, theme: { fg: (_c: string, t: string) => t } },
    };
    return { tool, reg, ctx };
}

function hostError(tool: ToolDef, args: unknown): Error | undefined {
    try {
        validateToolArguments(
            { name: tool.name, description: tool.description ?? "", parameters: tool.parameters } as never,
            { id: "call", name: tool.name, arguments: args } as never
        );
        return undefined;
    } catch (err) {
        return err as Error;
    }
}

void describe("monitor parameter schema", () => {
    it("accepts a command source and a ws source", () => {
        const { tool } = harness();
        for (const args of [
            { command: "tail -f log", description: "watch log" },
            { ws: { url: "ws://localhost:8080" }, description: "watch socket" },
            { ws: { url: "wss://example.test/x", protocols: ["graphql-ws"] }, description: "protocols" },
            { command: "tail -f log", description: "with knobs", wake_absent_ms: 1000, timeout_ms: 60000 },
        ]) {
            assert.equal(hostError(tool, monitorInput(args)), undefined, `rejected ${JSON.stringify(args)}`);
        }
    });

    it("rejects a misspelled top-level field", () => {
        const { tool } = harness();
        // The defect: `wake_abscent_ms` passed validation and the watch silently
        // ran with no silence reminder at all.
        const err = hostError(tool, monitorInput({ command: "tail -f log", description: "x", wake_abscent_ms: 1000 }));
        assert.ok(err);
        assert.match(err.message, /wake_abscent_ms/);
    });

    it("rejects a misspelled nested ws field", () => {
        const { tool } = harness();
        const err = hostError(tool, monitorInput({ ws: { url: "ws://x", protcols: ["a"] }, description: "x" }));
        assert.ok(err);
        assert.match(err.message, /protcols/);
    });

    it("requires ws.url once a ws object is given", () => {
        const { tool } = harness();
        const err = hostError(tool, monitorInput({ ws: {}, description: "x" }));
        assert.ok(err);
        assert.match(err.message, /url/);
    });

    it("requires a description, and coerces a scalar one like any other string field", () => {
        const { tool } = harness();
        const missing = monitorInput({ command: "true" }); delete missing.description;
        assert.ok(hostError(tool, missing), "description is required");
        // Same host coercion as `command`: 7 arrives as "7", which the runtime
        // check accepts as non-empty. A genuinely blank description is caught in
        // execute() (covered below).
        assert.equal(hostError(tool, monitorInput({ command: "true", description: 7 })), undefined);
    });

    it("keeps command/ws mutual exclusion as a runtime check, not a schema anyOf", () => {
        const { tool } = harness();
        const schema = JSON.parse(JSON.stringify(tool.parameters)) as Record<string, unknown>;
        assert.equal(schema.additionalProperties, false);
        assert.deepEqual(schema.required, ["command", "ws", "description", "timeout_ms", "wake_absent_ms"]);
        const properties = schema.properties as Record<string, { anyOf?: Record<string, unknown>[] }>;
        for (const field of ["command", "ws", "timeout_ms", "wake_absent_ms"]) assert.ok(properties[field]!.anyOf!.some(variant => variant.type === "null"));
        assert.equal(properties.description!.anyOf, undefined);
        const ws = properties.ws!.anyOf!.find(variant => variant.type === "object")!;
        assert.equal(ws.additionalProperties, false); assert.deepEqual(ws.required, ["url", "protocols"]);
        // The host's strict schema mode rejects object-level alternatives, so the
        // XOR must not be expressed as oneOf/anyOf here.
        assert.equal(schema.oneOf, undefined);
        assert.equal(schema.anyOf, undefined);
    });

    it("reports both sources provided without starting anything", async () => {
        const h = harness();
        await assert.rejects(
            () => h.tool.execute("both", monitorInput({ command: "true", ws: { url: "ws://x" }, description: "x" }), undefined, undefined, h.ctx),
            /not both/
        );
        assert.equal(h.reg.jobs.size, 0);
        assert.equal(h.reg.totalStarted, 0);
    });

    it("empty unused command still conflicts with ws and explains null", async () => {
        const h = harness();
        await assert.rejects(
            h.tool.execute("placeholder", monitorInput({ command: "", ws: { url: "ws://x" }, description: "x" }), undefined, undefined, h.ctx),
            /Set the unused source to null; an empty command still counts as supplied/
        );
        assert.equal(h.reg.jobs.size, 0);
        assert.equal(h.reg.totalStarted, 0);
    });

    it("names the empty field when a source is present but unusable", async () => {
        const h = harness();
        await assert.rejects(
            () => h.tool.execute("empty-cmd", monitorInput({ command: "   ", description: "x" }), undefined, undefined, h.ctx),
            /`command` is empty/
        );
        await assert.rejects(
            () => h.tool.execute("empty-url", monitorInput({ ws: { url: "" }, description: "x" }), undefined, undefined, h.ctx),
            /`ws\.url` must be a non-empty/
        );
        await assert.rejects(
            () => h.tool.execute("blank-desc", monitorInput({ command: "true", description: "  " }), undefined, undefined, h.ctx),
            /`description` must be a non-empty string/
        );
        assert.equal(h.reg.jobs.size, 0);
    });

    it("rejects unknown and malformed direct arguments before any job admission", async () => {
        const h = harness();
        for (const params of [null, [], monitorInput({ command: "true", description: "x", typo: 1 }),
            monitorInput({ command: 7, description: "x" }), monitorInput({ ws: [], description: "x" }),
            monitorInput({ ws: { url: "ws://x", typo: true }, description: "x" }),
            monitorInput({ ws: { url: "ws://x", protocols: [7] }, description: "x" })]) {
            await assert.rejects(h.tool.execute("bad", params, undefined, undefined, h.ctx));
        }
        assert.equal(h.reg.jobs.size, 0); assert.equal(h.reg.totalStarted, 0);
    });

    it("host rejects negative times, coerces zero to null and preserves valid fractions", () => {
        const { tool } = harness();
        for (const key of ["timeout_ms", "wake_absent_ms"]) {
            for (const value of [-1]) assert.ok(hostError(tool, monitorInput({ command: "true", description: "x", [key]: value })));
            assert.equal(hostError(tool, monitorInput({ command: "true", description: "x", [key]: 0 })), undefined, "host converts zero to nullable null");
            assert.equal(hostError(tool, monitorInput({ command: "true", description: "x", [key]: 0.5 })), undefined);
        }
    });

    it("quotes the offending value for an invalid wake/timeout", async () => {
        const h = harness();
        await assert.rejects(
            () => h.tool.execute("nan", monitorInput({ command: "true", description: "x", wake_absent_ms: Number.NaN }), undefined, undefined, h.ctx),
            /`wake_absent_ms` must be a finite positive number, got NaN/
        );
        assert.equal(h.reg.jobs.size, 0);
    });
});

void describe("required-nullable wire boundary", () => {
    it("rejects complete raw invalid inputs with zero effects and verifies actual host conversion", async t => {
        const h = harness();
        let opens = 0, publications = 0;
        const original = globalThis.WebSocket;
        globalThis.WebSocket = class { constructor() { opens++; } } as unknown as typeof WebSocket;
        t.after(() => { globalThis.WebSocket = original; });
        t.mock.method(h.reg, "changed", () => { publications++; });
        const base = monitorInput({ command: "echo must-not-run" });
        const invalid: unknown[] = [null, [], { ...base, typo: null }, { ...base, description: null },
            { ...base, command: false }, { ...base, ws: [] }];
        for (const field of Object.keys(base)) {
            const missing = { ...base }; delete missing[field];
            invalid.push(missing, { ...base, [field]: undefined });
        }
        for (const ws of [{ protocols: null }, { url: "ws://x" }, { url: "ws://x", protocols: undefined },
            { url: null, protocols: null }, { url: "ws://x", protocols: null, typo: null },
            { url: "ws://x", protocols: [null] }, { url: "ws://x", protocols: {} }]) {
            invalid.push({ ...base, command: null, ws });
        }
        for (const key of ["timeout_ms", "wake_absent_ms"]) {
            for (const value of [0, -1, NaN, Infinity, -Infinity]) invalid.push({ ...base, [key]: value });
        }
        for (const args of invalid) {
            await assert.rejects(h.tool.execute("bad-wire", args, undefined, undefined, h.ctx));
        }
        const hostInvalid: unknown[] = [null, [], { ...base, typo: null }, { ...base, ws: [] }];
        for (const field of Object.keys(base)) {
            const missing = { ...base }; delete missing[field]; hostInvalid.push(missing);
        }
        for (const ws of [{ protocols: null }, { url: "ws://x" },
            { url: "ws://x", protocols: null, typo: null }, { url: "ws://x", protocols: {} }]) {
            hostInvalid.push({ ...base, command: null, ws });
        }
        for (const key of ["timeout_ms", "wake_absent_ms"]) {
            for (const value of [-1, NaN, Infinity, -Infinity]) hostInvalid.push({ ...base, [key]: value });
        }
        for (const args of hostInvalid) assert.ok(hostError(h.tool, args), `host accepted ${JSON.stringify(args)}`);
        // Host scalar coercion is not raw-type validation: direct calls still reject.
        for (const args of [{ ...base, description: 7 }, { ...base, command: 7 },
            { ...base, command: null, ws: { url: 7, protocols: null } }, { ...base, timeout_ms: "0.5" }]) {
            await assert.rejects(h.tool.execute("raw-type", args, undefined, undefined, h.ctx));
        }
        assert.equal(opens, 0); assert.equal(publications, 0);
        assert.equal(h.reg.jobs.size, 0); assert.equal(h.reg.totalStarted, 0);
    });

    it("host preserves empty command as a supplied source for XOR admission", async () => {
        const h = harness();
        for (const command of ["", " ", "true"]) {
            const args = monitorInput({ command, ws: { url: "ws://x", protocols: null } });
            const converted = validateToolArguments(h.tool as never,
                { id: "xor", name: "monitor", arguments: args } as never) as Record<string, unknown>;
            assert.equal(converted.command, command);
            await assert.rejects(h.tool.execute("xor", converted, undefined, undefined, h.ctx), /not both/);
        }
        assert.equal(h.reg.jobs.size, 0); assert.equal(h.reg.totalStarted, 0);
    });

    it("documents SDK conversions without treating them as direct input acceptance", () => {
        const { tool } = harness();
        const base = monitorInput({ command: "true" });
        for (const [input, expected] of [[0, null], [false, null], [undefined, null], [0.5, 0.5]] as const) {
            const args = { ...base, timeout_ms: input };
            const converted = validateToolArguments(tool as never, { id: "coercion", name: "monitor", arguments: args } as never) as Record<string, unknown>;
            assert.equal(converted.timeout_ms, expected);
            assert.equal(args.timeout_ms, input, "host does not mutate the caller envelope");
        }
        const converted = validateToolArguments(tool as never, { id: "strings", name: "monitor", arguments: {
            ...base, command: null, description: null, ws: { url: null, protocols: [null] },
        } } as never) as { description: string; ws: { url: string; protocols: string[] } };
        assert.equal(converted.description, "null"); assert.equal(converted.ws.url, "null"); assert.deepEqual(converted.ws.protocols, ["null"]);
    });

    it("shallow normalization preserves null/defaults, fractions, arrays and input identity", () => {
        for (const protocols of [null, [], ["second", "first"]]) {
            const ws = Object.freeze({ url: "ws://x", protocols: protocols === null ? null : Object.freeze(protocols) });
            const input = Object.freeze({ command: null, ws, description: "socket", timeout_ms: null, wake_absent_ms: null });
            const parsed = parseMonitorArguments(input);
            assert.notEqual(parsed, input); assert.notEqual(parsed.ws, ws);
            assert.equal(parsed.command, undefined); assert.equal(parsed.timeout_ms, undefined); assert.equal(parsed.wake_absent_ms, undefined);
            assert.equal(parsed.ws!.protocols, protocols === null ? undefined : protocols);
            assert.deepEqual(input.ws, ws); assert.equal(input.command, null);
        }
        const fractional = parseMonitorArguments(monitorInput({ command: "true", timeout_ms: 0.5, wake_absent_ms: 0.25 }));
        assert.equal(fractional.timeout_ms, 0.5); assert.equal(fractional.wake_absent_ms, 0.25);
    });
});
