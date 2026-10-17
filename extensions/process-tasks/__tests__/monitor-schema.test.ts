/**
 * `monitor` parameter schema — the closed-object half of the S1 contract.
 *
 * The runtime checks already existed and are covered by `monitor.test.ts`. What
 * these cases add is the host-level rejection: a misspelled or misplaced field
 * never reaches `execute`, so it cannot be swallowed as a no-op.
 */
import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { validateToolArguments } from "@earendil-works/pi-ai";
import { BackgroundRegistry } from "../state.ts";
import { DEFAULTS } from "../config.ts";
import { registerMonitorTool } from "../tools/monitor.ts";

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
            assert.equal(hostError(tool, args), undefined, `rejected ${JSON.stringify(args)}`);
        }
    });

    it("rejects a misspelled top-level field", () => {
        const { tool } = harness();
        // The defect: `wake_abscent_ms` passed validation and the watch silently
        // ran with no silence reminder at all.
        const err = hostError(tool, { command: "tail -f log", description: "x", wake_abscent_ms: 1000 });
        assert.ok(err);
        assert.match(err.message, /wake_abscent_ms/);
    });

    it("rejects a misspelled nested ws field", () => {
        const { tool } = harness();
        const err = hostError(tool, { ws: { url: "ws://x", protcols: ["a"] }, description: "x" });
        assert.ok(err);
        assert.match(err.message, /protcols/);
    });

    it("requires ws.url once a ws object is given", () => {
        const { tool } = harness();
        const err = hostError(tool, { ws: {}, description: "x" });
        assert.ok(err);
        assert.match(err.message, /url/);
    });

    it("requires a description, and coerces a scalar one like any other string field", () => {
        const { tool } = harness();
        assert.ok(hostError(tool, { command: "true" }), "description is required");
        // Same host coercion as `command`: 7 arrives as "7", which the runtime
        // check accepts as non-empty. A genuinely blank description is caught in
        // execute() (covered below).
        assert.equal(hostError(tool, { command: "true", description: 7 }), undefined);
    });

    it("keeps command/ws mutual exclusion as a runtime check, not a schema anyOf", () => {
        const { tool } = harness();
        const schema = JSON.parse(JSON.stringify(tool.parameters)) as Record<string, unknown>;
        assert.equal(schema.additionalProperties, false);
        // The host's strict schema mode rejects object-level alternatives, so the
        // XOR must not be expressed as oneOf/anyOf here.
        assert.equal(schema.oneOf, undefined);
        assert.equal(schema.anyOf, undefined);
    });

    it("reports both sources provided without starting anything", async () => {
        const h = harness();
        await assert.rejects(
            () => h.tool.execute("both", { command: "true", ws: { url: "ws://x" }, description: "x" }, undefined, undefined, h.ctx),
            /not both/
        );
        assert.equal(h.reg.jobs.size, 0);
        assert.equal(h.reg.totalStarted, 0);
    });

    it("empty unused command still conflicts with ws and explains omission", async () => {
        const h = harness();
        await assert.rejects(
            h.tool.execute("placeholder", { command: "", ws: { url: "ws://x" }, description: "x" }, undefined, undefined, h.ctx),
            /Omit the unused source entirely; an empty command still counts as supplied/
        );
        assert.equal(h.reg.jobs.size, 0);
        assert.equal(h.reg.totalStarted, 0);
    });

    it("names the empty field when a source is present but unusable", async () => {
        const h = harness();
        await assert.rejects(
            () => h.tool.execute("empty-cmd", { command: "   ", description: "x" }, undefined, undefined, h.ctx),
            /`command` is empty/
        );
        await assert.rejects(
            () => h.tool.execute("empty-url", { ws: { url: "" }, description: "x" }, undefined, undefined, h.ctx),
            /`ws\.url` must be a non-empty/
        );
        await assert.rejects(
            () => h.tool.execute("blank-desc", { command: "true", description: "  " }, undefined, undefined, h.ctx),
            /`description` must be a non-empty string/
        );
        assert.equal(h.reg.jobs.size, 0);
    });

    it("rejects unknown and malformed direct arguments before any job admission", async () => {
        const h = harness();
        for (const params of [null, [], { command: "true", description: "x", typo: 1 },
            { command: 7, description: "x" }, { ws: [], description: "x" },
            { ws: { url: "ws://x", typo: true }, description: "x" },
            { ws: { url: "ws://x", protocols: [7] }, description: "x" }]) {
            await assert.rejects(h.tool.execute("bad", params, undefined, undefined, h.ctx));
        }
        assert.equal(h.reg.jobs.size, 0); assert.equal(h.reg.totalStarted, 0);
    });

    it("host rejects non-positive times and preserves valid fractional values", () => {
        const { tool } = harness();
        for (const key of ["timeout_ms", "wake_absent_ms"]) {
            for (const value of [0, -1]) assert.ok(hostError(tool, { command: "true", description: "x", [key]: value }));
            assert.equal(hostError(tool, { command: "true", description: "x", [key]: 0.5 }), undefined);
        }
    });

    it("quotes the offending value for an invalid wake/timeout", async () => {
        const h = harness();
        await assert.rejects(
            () => h.tool.execute("nan", { command: "true", description: "x", wake_absent_ms: Number.NaN }, undefined, undefined, h.ctx),
            /`wake_absent_ms` must be a finite positive number, got NaN/
        );
        assert.equal(h.reg.jobs.size, 0);
    });
});
