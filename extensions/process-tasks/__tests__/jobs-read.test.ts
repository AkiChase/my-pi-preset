import { processInput } from "../../runtime-tasks/__tests__/process-input.ts";
/**
 * `jobs` read paths: byte-range paging for `output`, the explicit
 * required-parameter errors, and `search`'s scope / ignoreCase / context
 * options. All three were gaps in upstream v2.0.0 — the tail was the only
 * readable part of a log, a missing jobId surfaced as a confusing downstream
 * error, and search was all-jobs, case-sensitive and context-free.
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BackgroundRegistry } from "../state.ts";
import { DEFAULTS } from "../config.ts";
import { registerManagementFixture } from "./management-fixture.ts";
import { add, createRunningJob } from "../registry.ts";
import { readLogSlice } from "../output.ts";
import type { Job, UiContext } from "../types.ts";

let dir: string;
before(() => {
    dir = mkdtempSync(join(tmpdir(), "pi-bg-read-"));
});
after(() => {
    rmSync(dir, { recursive: true, force: true });
});

interface CapturedTool {
    execute: (
        toolCallId: string,
        params: unknown,
        signal: unknown,
        onUpdate: unknown,
        ctx: unknown
    ) => Promise<{ content: { type: "text"; text: string }[] }>;
}

function harness(config = DEFAULTS) {
    let tool: CapturedTool | undefined;
    const pi = {
        registerTool(def: CapturedTool) {
            tool = def;
        },
        sendMessage() {},
    };
    const reg = new BackgroundRegistry(config);
    registerManagementFixture(pi as never, reg);
    const ctx = {
        ui: {
            notify() {},
            setWidget() {},
            setStatus() {},
            theme: { fg: (_c: string, t: string) => t },
        },
    } as unknown as UiContext;
    return { tool: tool!, reg, ctx };
}

/** A terminal job whose log holds exactly `body`. */
function jobWithLog(reg: BackgroundRegistry, id: string, body: string): Job {
    const logPath = join(dir, `${id}.log`);
    writeFileSync(logPath, body);
    const job = createRunningJob({ id, command: "emit", pid: 1, logPath, toolCallId: "t" });
    job.status = "completed";
    job.exitCode = 0;
    add(reg, job);
    return job;
}

const text = async (
    tool: CapturedTool,
    params: unknown,
    ctx: unknown
): Promise<string> => {
    const res = await tool.execute("t", processInput(params as { action: string }), undefined, undefined, ctx);
    return res.content[0]!.text;
};

void describe("readLogSlice", () => {
    void it("returns the tail when no offset is given", () => {
        const logPath = join(dir, "slice-tail.log");
        writeFileSync(logPath, "0123456789");
        const slice = readLogSlice(logPath, { limit: 4 });
        assert.deepEqual(slice, { text: "6789", start: 6, end: 10, size: 10 });
    });

    void it("reads an interior range — the part upstream could not reach", () => {
        const logPath = join(dir, "slice-mid.log");
        writeFileSync(logPath, "0123456789");
        const slice = readLogSlice(logPath, { offset: 3, limit: 4 });
        assert.deepEqual(slice, { text: "3456", start: 3, end: 7, size: 10 });
    });

    void it("clamps a range that runs past the end", () => {
        const logPath = join(dir, "slice-over.log");
        writeFileSync(logPath, "0123456789");
        const slice = readLogSlice(logPath, { offset: 8, limit: 100 });
        assert.equal(slice?.text, "89");
        assert.equal(slice?.end, 10);
    });

    void it("clamps an offset beyond EOF to an empty slice, not an error", () => {
        // Paging to the bottom of a log that has since been truncated is
        // normal, not a failure.
        const logPath = join(dir, "slice-eof.log");
        writeFileSync(logPath, "short");
        const slice = readLogSlice(logPath, { offset: 999, limit: 10 });
        assert.deepEqual(slice, { text: "", start: 5, end: 5, size: 5 });
    });

    void it("returns undefined for a missing or empty log", () => {
        writeFileSync(join(dir, "slice-empty.log"), "");
        assert.equal(readLogSlice(join(dir, "slice-empty.log"), { limit: 10 }), undefined);
        assert.equal(readLogSlice(join(dir, "nope.log"), { limit: 10 }), undefined);
    });
});

void describe("jobs output — paging", () => {
    void it("defaults to the tail and says which bytes it showed", async () => {
        const { tool, reg, ctx } = harness({ ...DEFAULTS, outputPreviewChars: 10 });
        const job = jobWithLog(reg, "pg-1", "abcdefghijklmnopqrstuvwxyz");
        const out = await text(tool, { action: "output", task_id: job.id }, ctx);
        assert.match(out, /bytes 16-26 of 26/);
        assert.ok(out.includes("qrstuvwxyz"));
    });

    void it("names the offset to continue from when more remains", async () => {
        const { tool, reg, ctx } = harness();
        const job = jobWithLog(reg, "pg-2", "abcdefghij");
        const out = await text(tool, { action: "output", task_id: job.id, offset: 0, limit: 4 }, ctx);
        assert.match(out, /bytes 0-4 of 10/);
        assert.match(out, /\[6 more bytes; offset=4\]/);
    });

    void it("flags the bytes it skipped so a tail cannot read as the whole log", async () => {
        const { tool, reg, ctx } = harness();
        const job = jobWithLog(reg, "pg-3", "abcdefghij");
        const out = await text(tool, { action: "output", task_id: job.id, limit: 4 }, ctx);
        assert.match(out, /\[6 earlier bytes omitted; offset=0\]/);
    });

    void it("pages the whole log without overlap or gaps", async () => {
        const { tool, reg, ctx } = harness();
        const job = jobWithLog(reg, "pg-4", "0123456789");
        let offset = 0;
        let seen = "";
        for (let i = 0; i < 10 && offset < 10; i++) {
            const out = await text(
                tool,
                { action: "output", task_id: job.id, offset, limit: 3 },
                ctx
            );
            // Strip the header and both bracketed markers; what's left is the
            // slice's own bytes.
            seen += out
                .split("\n")
                .slice(2)
                .filter((l) => !l.startsWith("["))
                .join("\n");
            const next = /more bytes; offset=(\d+)/.exec(out);
            if (!next) break;
            offset = Number(next[1]);
        }
        assert.equal(seen, "0123456789");
    });

    void it("says so plainly when the offset lands past the end", async () => {
        const { tool, reg, ctx } = harness();
        const job = jobWithLog(reg, "pg-5", "abc");
        const out = await text(tool, { action: "output", task_id: job.id, offset: 99 }, ctx);
        assert.match(out, /bytes 3-3 of 3[\s\S]*\(no output\)/);
    });
});

void describe("jobs — required parameters", () => {
    void it("names the action and the missing parameter", async () => {
        // Upstream's `p.jobId!` surfaced as "No task found with ID: undefined"
        // for output and a TypeError elsewhere.
        const { tool, ctx } = harness();
        for (const action of ["output", "stop", "wait"]) {
            const result = await tool.execute("t", processInput({ action }), undefined, undefined, ctx);
            assert.match(result.content[0].text, new RegExp(`${action} requires task_id`));
            assert.equal((result as { isError?: boolean }).isError, true);
        }
        const result = await tool.execute("t", processInput({ action: "search" }), undefined, undefined, ctx);
        assert.match(result.content[0].text, /search requires pattern/);
        assert.equal((result as { isError?: boolean }).isError, true);
    });
});

void describe("jobs search — scope, case, context", () => {
    const LOG = [
        "starting up",
        "WARNING: disk almost full",
        "still going",
        "ERROR: boom",
        "after the error",
        "done",
    ].join("\n");

    void it("scans every job by default", async () => {
        const { tool, reg, ctx } = harness();
        jobWithLog(reg, "s-1", LOG);
        jobWithLog(reg, "s-2", LOG);
        const out = await text(tool, { action: "search", pattern: "ERROR" }, ctx);
        assert.match(out, /across 2 job\(s\)/);
    });

    void it("limits the scan to one job when given a jobId", async () => {
        const { tool, reg, ctx } = harness();
        const only = jobWithLog(reg, "s-3", LOG);
        jobWithLog(reg, "s-4", LOG);
        const out = await text(
            tool,
            { action: "search", pattern: "ERROR", task_id: only.id },
            ctx
        );
        assert.match(out, /across 1 job\(s\)/);
        assert.ok(!out.includes("s-4"));
    });

    void it("errors on an unknown jobId instead of silently scanning everything", async () => {
        const { tool, ctx } = harness();
        const result = await tool.execute("t", processInput({ action: "search", task_id: "ghost", pattern: "x" }), undefined, undefined, ctx);
        assert.equal((result as { isError?: boolean }).isError, true);
        assert.match(result.content[0].text, /not found/i);
    });

    void it("is case-sensitive by default and case-insensitive on request", async () => {
        const { tool, reg, ctx } = harness();
        const job = jobWithLog(reg, "s-5", LOG);
        // "warning" appears only as "WARNING:", so case is the only variable.
        const strict = await text(
            tool,
            { action: "search", pattern: "warning", task_id: job.id },
            ctx
        );
        assert.match(strict, /No matches for \/warning\//);

        const loose = await text(
            tool,
            { action: "search", pattern: "warning", task_id: job.id, ignore_case: true },
            ctx
        );
        assert.match(loose, /Found 1 matches for \/warning\/i/);
    });

    void it("shows context lines in grep's :/- convention", async () => {
        const { tool, reg, ctx } = harness();
        const job = jobWithLog(reg, "s-6", LOG);
        const out = await text(
            tool,
            { action: "search", pattern: "ERROR", task_id: job.id, context: 1 },
            ctx
        );
        assert.match(out, /:3- still going/);
        assert.match(out, /:4: ERROR: boom/);
        assert.match(out, /:5- after the error/);
    });

    void it("omits context lines that do not exist at the file edges", async () => {
        const { tool, reg, ctx } = harness();
        const job = jobWithLog(reg, "s-7", "ERROR: first line\nsecond");
        const out = await text(
            tool,
            { action: "search", pattern: "ERROR", task_id: job.id, context: 2 },
            ctx
        );
        assert.match(out, /:1: ERROR: first line/);
        assert.match(out, /:2- second/);
        assert.ok(!/:0-/.test(out), "no line 0");
    });

    void it("counts every match even when context is on and display is capped", async () => {
        const { tool, reg, ctx } = harness();
        const many = Array.from({ length: 25 }, (_, i) => `ERROR ${i}`).join("\n");
        const job = jobWithLog(reg, "s-8", many);
        const out = await text(
            tool,
            { action: "search", pattern: "ERROR", task_id: job.id, context: 1 },
            ctx
        );
        assert.match(out, /Found 25 matches/);
        assert.match(out, /\.\.\. and 5 more/);
    });

    void it("still reports a context-free search in one line per hit", async () => {
        const { tool, reg, ctx } = harness();
        const job = jobWithLog(reg, "s-9", LOG);
        const out = await text(
            tool,
            { action: "search", pattern: "ERROR", task_id: job.id },
            ctx
        );
        const hitLines = out.split("\n").filter((l) => l.includes(".log:"));
        assert.equal(hitLines.length, 1);
    });
});
