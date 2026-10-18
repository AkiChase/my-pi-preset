import { bashInput } from "./bash-input.ts";
/**
 * The `bash` override's parameter schema and its model-visible error contract.
 *
 * These go through the host's own validator (`validateToolArguments`), because
 * the point of the schema is what the host does with a bad call *before*
 * `execute` runs: the host turns a schema violation into `isError: true` with
 * the failing path, which is the only reason a misspelled field is learnable.
 * Asserting on `JSON.parse(JSON.stringify(schema))` would only prove we wrote a
 * keyword; this proves the keyword does something.
 */
import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { validateToolArguments } from "@earendil-works/pi-ai";
import { createBashToolDefinition } from "@earendil-works/pi-coding-agent";
import { BackgroundRegistry } from "../state.ts";
import { DEFAULTS } from "../config.ts";
import { registerBashTool } from "../tools/bash.ts";
import { MAX_BACKGROUND_AFTER_SECONDS, bashParamSchema } from "../tools/bash-params.ts";
import { killProcessTree, processExists } from "../spawn.ts";
import { terminateJobSilently } from "../lifecycle.ts";
import type { Job } from "../types.ts";

const dir = mkdtempSync(join(tmpdir(), "bash-schema-"));
after(() => { rmSync(dir, { recursive: true, force: true }); });

const spawnedPids: number[] = [];
after(() => {
    for (const pid of spawnedPids) {
        try { killProcessTree(pid, "SIGKILL"); } catch { /* already gone */ }
    }
});

interface ToolDef {
    name: string;
    description?: string;
    parameters: unknown;
    outputSchema?: unknown;
    execute: (
        toolCallId: string,
        params: unknown,
        signal: AbortSignal | undefined,
        onUpdate: unknown,
        ctx: unknown
    ) => Promise<{
        content: Array<{ type: "text"; text: string }>;
        details?: unknown;
        isError?: boolean;
        structuredContent?: unknown;
    }>;
}

function harness(originalBash?: unknown) {
    const reg = new BackgroundRegistry({ ...DEFAULTS, logDir: dir });
    let tool: ToolDef | undefined;
    registerBashTool(
        { registerTool: (def: ToolDef) => { tool = def; } } as never,
        reg,
        (originalBash ?? {}) as never
    );
    const ctx = {
        cwd: dir,
        ui: {
            notify: () => {},
            setWidget: () => {},
            setStatus: () => {},
            theme: { fg: (_c: string, t: string) => t },
        },
    };
    return { tool: tool!, reg, ctx };
}

/**
 * The host's validation, called exactly as the agent loop calls it.
 *
 * `validateToolArguments` takes the tool definition structurally, so a plain
 * object carrying the registered `parameters` is what the loop hands it. The
 * assertions below are therefore about the schema that actually reaches the
 * host, not a re-derived copy.
 */
function hostValidate(tool: ToolDef, args: unknown): unknown {
    return validateToolArguments(
        { name: tool.name, description: tool.description ?? "", parameters: tool.parameters } as never,
        { id: "call", name: tool.name, arguments: args } as never
    );
}

/**
 * The validation error for a rejected call, or undefined when it was accepted.
 *
 * `assert.throws` returns the error in the typings but not at runtime, so the
 * message has to be captured directly.
 */
function hostError(tool: ToolDef, args: unknown): Error | undefined {
    try {
        hostValidate(tool, args);
        return undefined;
    } catch (err) {
        return err as Error;
    }
}

void describe("bash parameter schema — host validation", () => {
    it("requires exactly three nonnullable fields, without schema defaults", () => {
        const { tool } = harness();
        const schema = JSON.parse(JSON.stringify(tool.parameters));
        assert.deepEqual(schema.required, ["command", "background_after_seconds", "description"]);
        assert.equal(schema.additionalProperties, false);
        assert.deepEqual(Object.keys(schema.properties), schema.required);
        for (const field of schema.required) {
            assert.equal(schema.properties[field].default, undefined);
            assert.notEqual(schema.properties[field].type, "null");
            assert.ok(schema.properties[field].description);
            const args = bashInput({ command: "true" }) as Record<string, unknown>;
            delete args[field];
            assert.match(hostError(tool, args)!.message, new RegExp(field));
        }
        for (const seconds of [-1, 0, 0.125, MAX_BACKGROUND_AFTER_SECONDS]) {
            assert.deepEqual(hostValidate(tool, bashInput({ command: "true", background_after_seconds: seconds })), bashInput({ command: "true", background_after_seconds: seconds }));
        }
        assert.match(JSON.parse(JSON.stringify(bashParamSchema(DEFAULTS))).properties.background_after_seconds.description, /-1.*0.*positive/);
        for (const seconds of [-2, Infinity, MAX_BACKGROUND_AFTER_SECONDS + 1]) assert.ok(hostError(tool, bashInput({ command: "true", background_after_seconds: seconds })));
        for (const key of ["run_in_background", "notify", "timeout", "timeuot"]) for (const value of [false, null, true]) {
            assert.match(hostError(tool, { ...bashInput({ command: "true" }), [key]: value })!.message, new RegExp(key));
        }
    });
    it("records actual host scalar conversions separately from strict direct admission", () => {
        const { tool } = harness();
        for (const value of [null, false, 0, 0.125, true, undefined]) {
            const expected = value === undefined ? "" : String(value);
            const args = { ...bashInput({ command: "true" }), description: value };
            assert.deepEqual(hostValidate(tool, args), { ...args, description: expected });
        }
        for (const [value, expected] of [[null, 0], [false, 0], ["", 0], ["0.125", 0.125], [true, 1], [undefined, 0]] as const) {
            assert.deepEqual(hostValidate(tool, { ...bashInput({ command: "true" }), background_after_seconds: value }), bashInput({ command: "true", background_after_seconds: expected }));
        }
        assert.deepEqual(hostValidate(tool, { ...bashInput({ command: "true" }), command: 42 }), bashInput({ command: "42" }));
        assert.ok(hostError(tool, bashInput({ command: "" })));
    });
});

void describe("bash runtime checks — defense in depth behind the schema", () => {
    it("rejects malformed raw shapes/types/domains before cwd, log or spawn effects without mutation", async () => {
        const h = harness();
        const good = bashInput({ command: "true" });
        const invalid: unknown[] = [null, false, [], "true", 42, { ...good, [Symbol("unknown")]: 1 }];
        for (const field of Object.keys(good)) {
            const missing = { ...good } as Record<string, unknown>; delete missing[field]; invalid.push(missing);
            for (const value of [null, undefined, false, {}, []]) invalid.push({ ...good, [field]: value });
        }
        for (const command of ["", " \n\t", 0, 42]) invalid.push({ ...good, command });
        for (const seconds of ["0", "-1", "0.125", -2, -0.5, NaN, Infinity, -Infinity, MAX_BACKGROUND_AFTER_SECONDS + 0.001]) invalid.push({ ...good, background_after_seconds: seconds });
        for (const description of [0, 42]) invalid.push({ ...good, description });
        for (const key of ["run_in_background", "timeout", "notify", "typo"]) for (const value of [false, null, undefined]) invalid.push({ ...good, [key]: value });
        for (const args of invalid) {
            if (args && typeof args === "object") Object.freeze(args);
            const before = args && typeof args === "object" ? Object.getOwnPropertyDescriptors(args) : args;
            await assert.rejects(h.tool.execute("invalid", args, undefined, undefined, { get cwd() { throw new Error("cwd must not be read"); } }), /bash|command|description|background_after_seconds/i);
            if (args && typeof args === "object") assert.deepEqual(Object.getOwnPropertyDescriptors(args), before);
            assert.equal(h.reg.totalStarted, 0); assert.equal(h.reg.jobs.size, 0);
        }
        const inherited = Object.create(good);
        await assert.rejects(h.tool.execute("inherited", inherited, undefined, undefined, h.ctx), /must be provided/);
    });
    it("rejects the removed mode with a correctable error", async () => {
        const h = harness();
        await assert.rejects(h.tool.execute("legacy", { ...bashInput({ command: "true" }), run_in_background: false }, undefined, undefined, h.ctx), /Unknown bash parameter 'run_in_background'.*background_after_seconds=0/);
        assert.equal(h.reg.totalStarted, 0);
    });
});

void describe("bash structuredContent — the inherited output schema", () => {
    it("inherits the built-in outputSchema, which obliges the fields below", () => {
        // Registered with the real built-in definition, exactly as index.ts does:
        // `...originalBash` is where `outputSchema` comes from, and the override
        // has to satisfy it on every path because codemode resolves a declared
        // outputSchema to `structuredContent`.
        const { tool } = harness(createBashToolDefinition(dir));
        assert.equal(Reflect.get(tool, "prepareArguments"), undefined, "no inherited legacy argument conversion");
        const schema = tool.outputSchema as { properties?: Record<string, unknown> } | undefined;
        assert.ok(schema, "the inherited outputSchema must still be attached");
        assert.deepEqual(
            Object.keys(schema.properties ?? {}).sort(),
            ["exit_code", "full_output_path", "output", "truncated", "wall_time_seconds"]
        );
    });

    it("returns the full shape on success, on non-zero exit, and on cancel", async () => {
        const h = harness();
        for (const command of ["printf ok", "printf bad; exit 7", "tail -f /dev/null"]) {
            const controller = new AbortController();
            const pending = h.tool.execute(`s-${command}`, bashInput({ command }), controller.signal, undefined, h.ctx);
            const job = [...h.reg.jobs.values()].at(-1) as Job;
            spawnedPids.push(job.pid);
            if (command.startsWith("tail")) controller.abort();
            const result = await pending;
            const sc = result.structuredContent as Record<string, unknown>;
            assert.ok(sc, `no structuredContent for ${command}`);
            assert.equal(typeof sc.output, "string");
            assert.equal(typeof sc.truncated, "boolean");
            assert.equal(typeof sc.exit_code, "number");
            assert.equal(typeof sc.wall_time_seconds, "number");
            assert.ok((sc.wall_time_seconds as number) >= 0);
            if (command.endsWith("exit 7")) {
                assert.equal(result.isError, true, "a non-zero exit is an error result");
                assert.equal(sc.exit_code, 7, "scripts receive the observed exit code");
                assert.match(result.content[0]!.text, /Command exited with code 7/);
            }
            if (command.startsWith("tail")) {
                assert.notEqual(result.isError, true, "a cancel is not a command failure");
                assert.equal(sc.exit_code, 128 + 15, "SIGTERM reports as 128+15");
                assert.match(result.content[0]!.text, /cancelled/);
            }
        }
    });

    it("points at the log when the run is still going, and reports no exit code as 0", async () => {
        const h = harness();
        const result = await h.tool.execute(
            "bg",
            bashInput({ command: "tail -f /dev/null", background_after_seconds: 0 }),
            undefined,
            undefined,
            h.ctx
        );
        const job = [...h.reg.jobs.values()][0] as Job;
        spawnedPids.push(job.pid);
        const sc = result.structuredContent as Record<string, unknown>;
        assert.ok(sc, "a started job still owes its callers the shape");
        // 0 is a placeholder, not an observed exit: the inherited schema has no
        // "still running" sentinel. Pinned here so the field is not misread.
        assert.equal(sc.exit_code, 0);
        assert.match(result.content[0]!.text!, new RegExp(job.logPath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
        terminateJobSilently(h.reg, job);
        await job.donePromise;
    });

    it("marks truncated and points at the full log once output exceeds the structured cap", async () => {
        const h = harness();
        // 1 MiB + slack, written by the command itself so the size is real.
        const result = await h.tool.execute(
            "big",
            bashInput({ command: "head -c 1050000 /dev/zero | tr '\\0' 'x'" }),
            undefined,
            undefined,
            h.ctx
        );
        const job = [...h.reg.jobs.values()].at(-1) as Job;
        assert.ok(readFileSync(job.logPath, "utf8").length >= 1024 * 1024);
        const sc = result.structuredContent as Record<string, unknown>;
        assert.equal(sc.truncated, true, "output beyond the cap must be flagged");
        assert.equal(sc.full_output_path, job.logPath, "and the full log must be reachable");
        assert.ok((sc.output as string).length <= 1024 * 1024);
    });

    it("treats a spontaneous signal as failure, not explicit cancellation", async () => {
        const h = harness();
        const result = await h.tool.execute("signal", bashInput({ command: "printf before; kill -TERM $$" }), undefined, undefined, h.ctx);
        assert.equal(result.isError, true);
        assert.match(result.content[0]!.text, /SIGTERM/);
        assert.match(result.content[0]!.text, /143/);
        assert.match(result.content[0]!.text, /before/);
        assert.equal((result.structuredContent as Record<string, unknown>).exit_code, 143);
    });

    it("does not mistake multibyte output for truncation", async () => {
        const h = harness();
        const result = await h.tool.execute("utf8", bashInput({ command: "printf '中文😀'" }), undefined, undefined, h.ctx);
        const sc = result.structuredContent as Record<string, unknown>;
        assert.equal(sc.output, "中文😀");
        assert.equal(sc.truncated, false);
        assert.equal(sc.full_output_path, undefined);
    });

    it("flags bounded output when a foreground run is detached", async () => {
        const h = harness();
        const pending = h.tool.execute("detach-big", bashInput({ command: "tail -f /dev/null" }), undefined, undefined, h.ctx);
        const job = [...h.reg.jobs.values()].at(-1) as Job;
        spawnedPids.push(job.pid);
        writeFileSync(job.logPath, "x".repeat(1050000));
        h.reg.foreground.get("detach-big")!.requestPause("manual");
        const result = await pending;
        const sc = result.structuredContent as Record<string, unknown>;
        assert.equal(sc.truncated, true);
        assert.equal(sc.full_output_path, job.logPath);
        terminateJobSilently(h.reg, job);
        await job.donePromise;
    });

    it("does not claim truncation for a small run", async () => {
        const h = harness();
        const result = await h.tool.execute("small", bashInput({ command: "printf tiny" }), undefined, undefined, h.ctx);
        const sc = result.structuredContent as Record<string, unknown>;
        assert.equal(sc.truncated, false);
        assert.equal(sc.full_output_path, undefined);
        assert.equal(sc.output, "tiny");
    });
});

void describe("bash terminate on slot exhaustion", () => {
    it("reports the concurrency limit before spawning, so no job is left behind", async () => {
        const h = harness();
        h.reg.config.maxConcurrentJobs = 1;
        await h.tool.execute("a", bashInput({ command: "tail -f /dev/null", background_after_seconds: 0 }), undefined, undefined, h.ctx);
        spawnedPids.push(([...h.reg.jobs.values()][0] as Job).pid);
        await assert.rejects(
            () => h.tool.execute("b", bashInput({ command: "true", background_after_seconds: 0 }), undefined, undefined, h.ctx),
            (err: Error) => err.message.length > 0
        );
        assert.equal(h.reg.jobs.size, 1, "the rejected call must not register a job");
        for (const job of h.reg.jobs.values()) {
            assert.ok(processExists(job.pid));
            terminateJobSilently(h.reg, job);
        }
    });
});
