/**
 * `jobs` tool actions — kill result strings (CC's TaskStopTool), unknown-id
 * errors and retained terminal outcomes.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BackgroundRegistry } from "../state.ts";
import { registerManagementFixture } from "./management-fixture.ts";
import { add, createRunningJob } from "../registry.ts";
import { markOutcomeSurfaced } from "../notify.ts";
import type { Job, UiContext } from "../types.ts";

const dir = join(tmpdir(), `pi-bg-jobs-${process.pid}`);
mkdirSync(dir, { recursive: true });

interface CapturedTool {
    execute: (
        toolCallId: string,
        params: unknown,
        signal: unknown,
        onUpdate: unknown,
        ctx: unknown
    ) => Promise<{ content: { type: "text"; text: string }[] }>;
}

function harness() {
    const messages: { customType: string }[] = [];
    let tool: CapturedTool | undefined;
    const pi = {
        registerTool(def: CapturedTool) {
            tool = def;
        },
        sendMessage(msg: { customType: string }) {
            messages.push(msg);
        },
    };
    const reg = new BackgroundRegistry();
    registerManagementFixture(pi as never, reg);
    const ctx = {
        ui: {
            notify() {},
            setWidget() {},
            setStatus() {},
            theme: { fg: (_c: string, t: string) => t },
        },
    } as unknown as UiContext;
    return { tool: tool!, reg, ctx, messages };
}

function mkJob(reg: BackgroundRegistry, over: Partial<Job>): Job {
    const logPath = join(dir, `${over.id ?? "job"}.log`);
    writeFileSync(logPath, "some output\n");
    const job = createRunningJob({
        id: over.id ?? `job-${process.pid}-1`,
        command: over.command ?? "npm test",
        pid: 0,
        logPath,
        toolCallId: "tc-1",
        name: over.name,
    });
    Object.assign(job, over, { logPath });
    add(reg, job);
    return job;
}

void describe("jobs kill — CC's TaskStopTool", () => {
    void it("returns the exact CC success string and suppresses the notification", async () => {
        const { tool, reg, ctx, messages } = harness();
        const job = mkJob(reg, { id: `job-${process.pid}-k1`, command: "npm run\nbuild" });
        const res = await tool.execute(
            "t1",
            { action: "stop", task_id: job.id },
            undefined,
            undefined,
            ctx
        );
        assert.equal(
            res.content[0].text,
            `task_type=bash task_id=${job.id} run_id=${job.id}\nStop requested; observed status=killed. Actual execution may still be draining.`
        );
        assert.equal(job.status, "killed");
        assert.equal(job.outcomeSurfaced, true, "marked so the exit path skips notifying");
        assert.equal(messages.length, 0, "no <task-notification> for a deliberate kill");
    });

    void it("unknown id errors with CC's exact string", async () => {
        const { tool, ctx } = harness();
        assert.match((await tool.execute("t2", { action: "stop", task_id: "nope" }, undefined, undefined, ctx)).content[0].text, /not found/i);
    });
});

void describe("jobs output — a read surfaces the outcome", () => {
    void it("marks a terminal job surfaced on read", async () => {
        const { tool, reg, ctx } = harness();
        const job = mkJob(reg, { id: `job-${process.pid}-o1` });
        job.status = "completed";
        job.exitCode = 0;
        await tool.execute("t3", { action: "output", task_id: job.id }, undefined, undefined, ctx);
        assert.equal(job.outcomeSurfaced, true);
    });

    void it("does NOT mark a still-running job (peek)", async () => {
        const { tool, reg, ctx } = harness();
        const job = mkJob(reg, { id: `job-${process.pid}-o2` });
        await tool.execute("t4", { action: "output", task_id: job.id }, undefined, undefined, ctx);
        assert.equal(job.outcomeSurfaced, undefined, "completion must still notify later");
    });

    void it("unknown id errors with CC's exact string", async () => {
        const { tool, ctx } = harness();
        assert.match((await tool.execute("t5", { action: "output", task_id: "ghost" }, undefined, undefined, ctx)).content[0].text, /not found/i);
    });
});

void describe("jobs list — retained metadata", () => {
    void it("lists surfaced terminal records without eviction or duplicates", async () => {
        const { tool, reg, ctx } = harness();
        const running = mkJob(reg, { id: `job-${process.pid}-l1`, command: "run-me" });
        const swept = mkJob(reg, { id: `job-${process.pid}-l3`, command: "done-read" });
        swept.status = "completed";
        swept.exitCode = 0;
        markOutcomeSurfaced(swept);

        const res = await tool.execute("t6", { action: "list" }, undefined, undefined, ctx);
        const text = res.content[0].text;

        assert.equal(reg.jobs.has(swept.id), true, "listing must not reclaim metadata");
        assert.ok(text.includes("run-me"), "running job listed");
        assert.match(text, /status=completed[\s\S]*done-read/);
        assert.equal(text.split("done-read").length - 1, 1);
        assert.ok(running.status === "running");
    });

    void it("lists a terminal job whose outcome never reached the agent", async () => {
        // The whole point of splitting the latch: a `notify: false` job that
        // FAILED, or one whose notification send threw, is terminal and
        // unsurfaced. Upstream listed only running jobs plus the recent ring,
        // so this job appeared nowhere at all.
        const { tool, reg, ctx } = harness();
        const stranded = mkJob(reg, { id: `job-${process.pid}-l4`, command: "quiet-fail" });
        stranded.status = "failed";
        stranded.exitCode = 3;
        stranded.notifyError = "steer queue closed";

        const res = await tool.execute("t7", { action: "list" }, undefined, undefined, ctx);
        const text = res.content[0].text;

        assert.ok(reg.jobs.has(stranded.id), "not swept — nobody has been told");
        assert.ok(text.includes("quiet-fail"), "listed despite being terminal");
        assert.match(text, /notification failed: steer queue closed/);
    });
});

void describe("jobs attach — suppression is scoped to the wait", () => {
    void it("an aborted attach leaves the job able to notify later", async () => {
        const { tool, reg, ctx } = harness();
        const job = mkJob(reg, { id: `job-${process.pid}-a1`, command: "long-build" });
        // ensureCompletionPromise is called inside attachAction; the job stays
        // running, so only the abort resolves the race.
        const ac = new AbortController();
        const pending = tool.execute(
            "t8",
            { action: "wait", task_id: job.id },
            ac.signal,
            () => {},
            ctx
        );
        // The wait is in flight: the exit path must stay quiet, because this
        // attach is the one that would report.
        assert.equal(job.attachCount, 1);
        ac.abort();
        const res = await pending;

        assert.match(res.content[0].text, /Wait cancelled; target unchanged/);
        // Upstream wrote `job.notified = false` here, clobbering the shared
        // latch. The counter is scoped instead, and the outcome was never
        // surfaced, so the job's own notification can still fire.
        assert.equal(job.attachCount, 0);
        assert.equal(job.outcomeSurfaced, undefined);
    });

    void it("two concurrent attaches do not cancel each other's suppression", async () => {
        const { tool, reg, ctx } = harness();
        const job = mkJob(reg, { id: `job-${process.pid}-a2`, command: "long-build" });
        const first = new AbortController();
        const second = new AbortController();
        const a = tool.execute("t9", { action: "wait", task_id: job.id }, first.signal, () => {}, ctx);
        const b = tool.execute("t10", { action: "wait", task_id: job.id }, second.signal, () => {}, ctx);
        assert.equal(job.attachCount, 2);

        first.abort();
        await a;
        // With a boolean this would already have re-enabled notifications
        // while the second attach was still waiting to report.
        assert.equal(job.attachCount, 1);

        second.abort();
        await b;
        assert.equal(job.attachCount, 0);
    });
});

process.on("exit", () => {
    try {
        rmSync(dir, { recursive: true, force: true });
    } catch {
        /* best-effort */
    }
});
