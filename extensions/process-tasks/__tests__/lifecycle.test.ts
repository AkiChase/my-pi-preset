/**
 * Unit tests for spawn.ts process primitives and lifecycle.ts.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { killProcessTree, processExists } from "../spawn.ts";
import {
    abortJob,
    createJobAbort,
    ensureCompletionPromise,
    markKilledSilently,
    markTerminal,
    statusFromExit,
} from "../lifecycle.ts";
import { BackgroundRegistry } from "../state.ts";
import { type Job } from "../types.ts";

void describe("processExists", () => {
    void it("the current process is alive", () => {
        assert.equal(processExists(process.pid), true);
    });
    void it("rejects invalid PIDs", () => {
        for (const pid of [0, -1, undefined]) assert.equal(processExists(pid), false);
    });
});

void describe("killProcessTree", () => {
    void it("PID 0 / negative / undefined are no-ops", () => {
        // Must not throw.
        killProcessTree(0);
        killProcessTree(-1);
        killProcessTree(undefined);
        killProcessTree(12345678, "SIGTERM"); // dead PID — must not throw.
    });
});

void describe("statusFromExit", () => {
    void it("maps exit codes and signals to terminal status", () => {
        const cases = [
            [0, undefined, "completed"], [1, undefined, "failed"],
            [null, "SIGKILL", "killed"], [null, "SIGTERM", "killed"],
            [0, "SIGKILL", "killed"], [null, undefined, "failed"],
            [undefined, undefined, "failed"],
        ] as const;
        for (const [code, signal, status] of cases) assert.equal(statusFromExit(code, signal), status);
    });
});

void describe("markTerminal idempotency", () => {
    void it("a second call after completion is ignored", () => {
        const job = makeJob();
        const reg = new BackgroundRegistry();
        markTerminal(reg, job, "completed", 0);
        markTerminal(reg, job, "failed", 1);
        assert.equal(job.status, "completed");
        assert.equal(job.exitCode, 0);
    });
    void it("killed → killed", () => {
        const job = makeJob();
        markTerminal(new BackgroundRegistry(), job, "killed");
        assert.equal(job.status, "killed");
    });
});

function makeJob(overrides: Partial<Job> = {}): Job {
    return {
        id: "job-mt-1",
        command: "x",
        pid: 1,
        startTime: 0,
        status: "running",
        logPath: "/tmp/x",
        toolCallId: "tc-1",
        isBackgrounded: false,
        ...overrides,
    };
}

void describe("ensureCompletionPromise", () => {
    void it("creates donePromise resolvable via resolveDone", async () => {
        const job = makeJob();
        ensureCompletionPromise(job);
        assert.ok(job.donePromise);
        assert.ok(job.resolveDone);
        let resolved = false;
        void job.donePromise.then(() => {
            resolved = true;
        });
        job.resolveDone!();
        await job.donePromise;
        assert.equal(resolved, true);
    });
});

void describe("markKilledSilently", () => {
    void it("status=killed, outcome marked surfaced", () => {
        const job = makeJob();
        markKilledSilently(new BackgroundRegistry(), job);
        assert.equal(job.status, "killed");
        assert.equal(job.outcomeSurfaced, true);
    });
});

void describe("createJobAbort / abortJob", () => {
    void it("registers a controller and is idempotent", () => {
        const reg = new BackgroundRegistry();
        const a = createJobAbort(reg, "job-1");
        const b = createJobAbort(reg, "job-1");
        assert.equal(a, b);
        assert.equal(reg.jobAborts.get("job-1"), a);
        assert.equal(a.signal.aborted, false);
    });
    void it("abortJob aborts the signal and removes the controller", () => {
        const reg = new BackgroundRegistry();
        const ac = createJobAbort(reg, "job-2");
        let aborted = false;
        ac.signal.addEventListener("abort", () => {
            aborted = true;
        });
        abortJob(reg, "job-2");
        assert.equal(aborted, true);
        assert.equal(ac.signal.aborted, true);
        assert.equal(reg.jobAborts.has("job-2"), false);
    });
    void it("abortJob on an unknown job is a no-op", () => {
        const reg = new BackgroundRegistry();
        abortJob(reg, "nope"); // must not throw
        assert.equal(reg.jobAborts.has("nope"), false);
    });
});
