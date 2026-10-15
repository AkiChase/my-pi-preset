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
import { MAX_TIMEOUT_SECONDS, bashParamSchema } from "../tools/bash-params.ts";
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
    it("accepts a minimal call and the documented optional fields", () => {
        const { tool } = harness();
        for (const args of [
            { command: "true" },
            { command: "true", timeout: 30 },
            { command: "true", run_in_background: true },
            { command: "true", run_in_background: true, notify: false },
            { command: "true", description: "why" },
        ]) {
            assert.doesNotThrow(() => hostValidate(tool, args), `rejected ${JSON.stringify(args)}`);
        }
    });

    it("rejects a misspelled optional field instead of silently ignoring it", () => {
        const { tool } = harness();
        // The defect this closes: with an open object the typo passed validation
        // and the command ran with the *configured* timeout, so the model's
        // intent was discarded without a word.
        const err = hostError(tool, { command: "true", timeuot: 1 });
        assert.ok(err, "the typo must be rejected");
        assert.match(err.message, /timeuot/);
    });

    it("rejects each documented way of getting timeout wrong, naming the field", () => {
        const { tool } = harness();
        for (const timeout of [0, -1, 1.5e300]) {
            const err = hostError(tool, { command: "true", timeout });
            assert.ok(err, `timeout=${timeout} must be rejected`);
            assert.match(err.message, /timeout/);
        }
    });

    it("accepts the built-in tool's maximum timeout and rejects one second more", () => {
        const { tool } = harness();
        assert.doesNotThrow(() => hostValidate(tool, { command: "true", timeout: MAX_TIMEOUT_SECONDS }));
        // Above the built-in's `MAX_TIMEOUT_MS`, `setTimeout` wraps and the timer
        // fires immediately: a request to wait half an hour would return at once.
        assert.throws(() => hostValidate(tool, { command: "true", timeout: MAX_TIMEOUT_SECONDS + 1 }));
    });

    it("requires command and reports its absence by field name", () => {
        const { tool } = harness();
        const err = hostError(tool, {});
        assert.ok(err, "command is required");
        assert.match(err.message, /command/);
    });

    it("coerces a numeric command rather than rejecting it (host behavior, not ours)", () => {
        const { tool } = harness();
        // Documented so it is not mistaken for a gap: the host coerces scalars to
        // the declared type before the tool sees them, so `command: 42` arrives as
        // "42". `isBlankCommand` in execute() is what rejects an empty result.
        assert.deepEqual(hostValidate(tool, { command: 42 }), { command: "42" });
    });

    it("is a closed object at the top level", () => {
        const { tool } = harness();
        const schema = JSON.parse(JSON.stringify(tool.parameters)) as {
            additionalProperties?: unknown;
            properties: Record<string, { description?: string }>;
        };
        assert.equal(schema.additionalProperties, false);
        // Every field the model can send carries a description — an undocumented
        // knob is one the model has to guess at.
        for (const [key, value] of Object.entries(schema.properties)) {
            assert.equal(typeof value.description, "string", `${key} has no description`);
            assert.notEqual(value.description, "", `${key} has an empty description`);
        }
    });

    it("quotes the configured timeout default in the timeout description", () => {
        const schema = JSON.parse(JSON.stringify(bashParamSchema({ ...DEFAULTS, timeoutMs: 5_000 }))) as {
            properties: Record<string, { description?: string }>;
        };
        assert.match(schema.properties.timeout!.description!, /default: 5\b/);
    });
});

void describe("bash runtime checks — defense in depth behind the schema", () => {
    it("rejects an out-of-range timeout even when execute() is called directly", async () => {
        const h = harness();
        // A direct SDK/codemode caller can bypass the host validator; the check
        // must not live only in the schema.
        await assert.rejects(
            () => h.tool.execute("dl", { command: "true", timeout: MAX_TIMEOUT_SECONDS + 1 }, undefined, undefined, h.ctx),
            /must not exceed/
        );
        assert.equal(h.reg.totalStarted, 0, "a rejected timeout must not start a job");
        assert.equal(h.reg.jobs.size, 0);
    });

    it("rejects unknown parameters for direct execute callers before spawn", async () => {
        const h = harness();
        await assert.rejects(() => h.tool.execute("typo", { command: "true", timeuot: 1 }, undefined, undefined, h.ctx), /timeuot/);
        assert.equal(h.reg.totalStarted, 0);
    });

    it("rejects notify without run_in_background, explaining the dependency", async () => {
        const h = harness();
        await assert.rejects(
            () => h.tool.execute("n", { command: "true", notify: true }, undefined, undefined, h.ctx),
            /notify requires run_in_background=true/
        );
        assert.equal(h.reg.jobs.size, 0);
    });
});

void describe("bash structuredContent — the inherited output schema", () => {
    it("inherits the built-in outputSchema, which obliges the fields below", () => {
        // Registered with the real built-in definition, exactly as index.ts does:
        // `...originalBash` is where `outputSchema` comes from, and the override
        // has to satisfy it on every path because codemode resolves a declared
        // outputSchema to `structuredContent`.
        const { tool } = harness(createBashToolDefinition(dir));
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
            const pending = h.tool.execute(`s-${command}`, { command }, controller.signal, undefined, h.ctx);
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
            { command: "tail -f /dev/null", run_in_background: true },
            undefined,
            undefined,
            h.ctx
        );
        const job = [...h.reg.jobs.values()][0] as Job;
        spawnedPids.push(job.pid);
        const sc = result.structuredContent as Record<string, unknown>;
        assert.ok(sc, "a started job still owes its callers the shape");
        assert.equal(typeof sc.exit_code, "number");
        assert.match(result.content[0]!.text!, new RegExp(job.logPath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
        terminateJobSilently(h.reg, job);
        await job.donePromise;
    });

    it("marks truncated and points at the full log once output exceeds the structured cap", async () => {
        const h = harness();
        // 1 MiB + slack, written by the command itself so the size is real.
        const result = await h.tool.execute(
            "big",
            { command: "head -c 1050000 /dev/zero | tr '\\0' 'x'" },
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
        const result = await h.tool.execute("signal", { command: "printf before; kill -TERM $$" }, undefined, undefined, h.ctx);
        assert.equal(result.isError, true);
        assert.match(result.content[0]!.text, /SIGTERM/);
        assert.match(result.content[0]!.text, /143/);
        assert.match(result.content[0]!.text, /before/);
        assert.equal((result.structuredContent as Record<string, unknown>).exit_code, 143);
    });

    it("does not mistake multibyte output for truncation", async () => {
        const h = harness();
        const result = await h.tool.execute("utf8", { command: "printf '中文😀'" }, undefined, undefined, h.ctx);
        const sc = result.structuredContent as Record<string, unknown>;
        assert.equal(sc.output, "中文😀");
        assert.equal(sc.truncated, false);
        assert.equal(sc.full_output_path, undefined);
    });

    it("flags bounded output when a foreground run is detached", async () => {
        const h = harness();
        const pending = h.tool.execute("detach-big", { command: "tail -f /dev/null" }, undefined, undefined, h.ctx);
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
        const result = await h.tool.execute("small", { command: "printf tiny" }, undefined, undefined, h.ctx);
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
        await h.tool.execute("a", { command: "tail -f /dev/null", run_in_background: true }, undefined, undefined, h.ctx);
        spawnedPids.push(([...h.reg.jobs.values()][0] as Job).pid);
        await assert.rejects(
            () => h.tool.execute("b", { command: "true", run_in_background: true }, undefined, undefined, h.ctx),
            (err: Error) => err.message.length > 0
        );
        assert.equal(h.reg.jobs.size, 1, "the rejected call must not register a job");
        for (const job of h.reg.jobs.values()) {
            assert.ok(processExists(job.pid));
            terminateJobSilently(h.reg, job);
        }
    });
});
