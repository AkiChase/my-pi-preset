import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { BackgroundRegistry } from "../state.ts";
import {
    buildTaskNotification,
    completionSummary,
    markOutcomeSurfaced,
    sendTaskNotification,
} from "../notify.ts";
import { completeJob, ensureCompletionPromise, terminateJobSilently } from "../lifecycle.ts";
import { add } from "../registry.ts";
import { EVENT, type Job, type UiContext } from "../types.ts";

interface Captured {
    customType: string;
    content: string;
    display?: boolean;
    details?: {
        jobId?: string;
        status?: string;
        summary?: string;
        outputFile?: string;
        toolUseId?: string;
    };
}

interface DeliverOpts {
    deliverAs: "steer" | "followUp";
    triggerTurn: boolean;
}

function harness(opts?: { deliverThrows?: boolean }) {
    const messages: Captured[] = [];
    const deliverOptions: DeliverOpts[] = [];
    const pi = {
        sendMessage: (m: Captured, o?: DeliverOpts) => {
            if (opts?.deliverThrows) throw new Error("sendMessage failed");
            messages.push(m);
            if (o) deliverOptions.push(o);
        },
    };
    const ctx = {
        ui: {
            notify() {},
            setWidget() {},
            setStatus() {},
            theme: { fg: (_c: string, t: string) => t },
        },
    } as unknown as UiContext;
    return { reg: new BackgroundRegistry(), pi, ctx, messages, deliverOptions };
}

function mkJob(over: Partial<Job>): Job {
    return {
        id: "job-1-1",
        command: "npm test",
        pid: 100,
        startTime: Date.now(),
        status: "completed",
        exitCode: 0,
        logPath: "/tmp/pi-bg/job-1-1.log",
        toolCallId: "tc-42",
        isBackgrounded: true,
        ...over,
    } as Job;
}

void describe("buildTaskNotification — compact text", () => {
    void it("is two lines for an outcome with no tail", () => {
        // Upstream emitted seven lines of XML here, with <summary> duplicating
        // details.summary verbatim. The structure travels in `details`; the
        // text carries only what the model cannot get from there.
        const text = buildTaskNotification({
            taskId: "job-1-1",
            outputFile: "/tmp/pi-bg/job-1-1.log",
            status: "completed",
            summary: `Background command "npm test" completed (exit code 0)`,
        });
        assert.equal(
            text,
            [
                `[task job-1-1 · completed] Background command "npm test" completed (exit code 0)`,
                "log: /tmp/pi-bg/job-1-1.log",
            ].join("\n")
        );
    });

    void it("omits the status segment when there is none (stall warning)", () => {
        const text = buildTaskNotification({
            taskId: "job-1-1",
            outputFile: "/tmp/x.log",
            summary: "waiting",
        });
        assert.ok(text.startsWith("[task job-1-1] waiting"));
    });

    void it("does not escape anything — there is no markup left to break", () => {
        const text = buildTaskNotification({
            taskId: "t",
            outputFile: "f",
            summary: `a & <b>`,
        });
        assert.ok(text.includes("a & <b>"));
    });

    void it("delimits the tail so log text cannot read as our own", () => {
        const text = buildTaskNotification({
            taskId: "t",
            outputFile: "f",
            status: "failed",
            summary: "s",
            outputTail: "boom",
        });
        assert.equal(text, ["[task t · failed] s", "log: f", "--- output tail ---", "boom"].join("\n"));
    });
});

void describe("completionSummary — CC's exact strings", () => {
    void it("bash completed with an exit code", () => {
        assert.equal(
            completionSummary(mkJob({ status: "completed", exitCode: 0 })),
            `Background command "npm test" completed (exit code 0)`
        );
    });
    void it("bash completed without an exit code omits the suffix", () => {
        assert.equal(
            completionSummary(mkJob({ status: "completed", exitCode: undefined })),
            `Background command "npm test" completed`
        );
    });
    void it("bash failed", () => {
        assert.equal(
            completionSummary(mkJob({ status: "failed", exitCode: 3 })),
            `Background command "npm test" failed with exit code 3`
        );
    });
    void it("bash killed", () => {
        assert.equal(
            completionSummary(mkJob({ status: "killed" })),
            `Background command "npm test" was stopped`
        );
    });
    void it("uses the job name as {desc} when set", () => {
        assert.equal(
            completionSummary(mkJob({ name: "tests", status: "completed", exitCode: 0 })),
            `Background command "tests" completed (exit code 0)`
        );
    });
    void it("monitor summaries", () => {
        const base = { kind: "monitor" as const, name: "API health" };
        assert.equal(
            completionSummary(mkJob({ ...base, status: "completed" })),
            `Monitor "API health" stream ended`
        );
        assert.equal(
            completionSummary(mkJob({ ...base, status: "failed", exitCode: 2 })),
            `Monitor "API health" failed (exit 2)`
        );
        assert.equal(
            completionSummary(mkJob({ ...base, status: "killed" })),
            `Monitor "API health" stopped`
        );
    });
});

void describe("sendTaskNotification — exactly-once + retention", () => {
    void it("sends compact text with steer delivery without evicting the job", () => {
        const { reg, pi, messages, deliverOptions } = harness();
        const job = mkJob({ id: "job-1-5", status: "completed", exitCode: 0 });
        add(reg, job);

        const sent = sendTaskNotification({ reg, pi: pi as never, job });

        assert.equal(sent, true);
        assert.equal(messages.length, 1);
        const m = messages[0];
        assert.equal(m.customType, EVENT.taskNotification);
        assert.equal(m.display, true);
        assert.equal(
            m.content,
            [
                `[task job-1-5 · completed] Background command "npm test" completed (exit code 0)`,
                "log: /tmp/pi-bg/job-1-1.log",
            ].join("\n")
        );
        // Details carry the structured status/summary for the TUI renderer,
        // plus the tool-use id the model-facing text no longer repeats.
        assert.equal(m.details?.status, "completed");
        assert.equal(m.details?.toolUseId, "tc-42");
        assert.equal(m.details?.summary, `Background command "npm test" completed (exit code 0)`);
        // Steer + triggerTurn — CC's 'next' priority, waking an idle agent.
        assert.deepEqual(deliverOptions[0], { deliverAs: "steer", triggerTurn: true });
        assert.equal(reg.jobs.has("job-1-5"), true);
        assert.equal(reg.completedCount, 0, "sending does not count transitions");
    });

    void it("latches exactly-once: a second send is a no-op", () => {
        const { reg, pi, messages } = harness();
        const job = mkJob({});
        add(reg, job);
        sendTaskNotification({ reg, pi: pi as never, job });
        assert.equal(job.outcomeSurfaced, true);
        const again = sendTaskNotification({ reg, pi: pi as never, job });
        assert.equal(again, false);
        assert.equal(messages.length, 1);
    });

    void it("kill suppression: a pre-latched job is skipped (and not evicted)", () => {
        const { reg, pi, messages } = harness();
        const job = mkJob({ status: "killed" });
        add(reg, job);
        markOutcomeSurfaced(job); // the kill path marks BEFORE the exit handler runs
        const sent = sendTaskNotification({ reg, pi: pi as never, job });
        assert.equal(sent, false);
        assert.equal(messages.length, 0);
        assert.equal(reg.jobs.has("job-1-1"), true, "lingers for the lazy sweep");
    });

    void it("the monitor's pre-transition send retains its record", () => {
        const { reg, pi, messages } = harness();
        const job = mkJob({ status: "running" as Job["status"] });
        add(reg, job);
        const sent = sendTaskNotification({
            reg,
            pi: pi as never,
            job,
            status: "completed",
            summary: `Monitor "watch" stream ended`,
        });
        assert.equal(sent, true);
        assert.equal(reg.jobs.has("job-1-1"), true);
        assert.ok(messages[0].content.includes("· completed]"));
    });

    void it("a failed send strands the job: unsurfaced, listed, and reason recorded", () => {
        const { reg, pi, messages } = harness({ deliverThrows: true });
        const job = mkJob({});
        add(reg, job);
        // Silence the module's console.error for the throw path.
        const origError = console.error;
        console.error = () => {};
        let sent = false;
        try {
            sent = sendTaskNotification({ reg, pi: pi as never, job });
        } finally {
            console.error = origError;
        }
        assert.equal(sent, false);
        assert.equal(messages.length, 0);
        // Upstream set the latch before the send, so a throw lost the outcome
        // permanently. The outcome must stay unsurfaced and the job listed.
        assert.equal(job.outcomeSurfaced, undefined);
        assert.ok(job.notifyError, "the reason is recorded for jobs list");
        assert.equal(reg.jobs.has("job-1-1"), true);
    });

    void it("skips the send while a jobs attach is waiting, without surfacing", () => {
        const { reg, pi, messages } = harness();
        const job = mkJob({});
        add(reg, job);
        job.attachCount = 1;
        assert.equal(sendTaskNotification({ reg, pi: pi as never, job }), false);
        assert.equal(messages.length, 0);
        // Not surfaced: if that attach is aborted, the job must still be able
        // to report when it ends.
        assert.equal(job.outcomeSurfaced, undefined);
        job.attachCount = 0;
        assert.equal(sendTaskNotification({ reg, pi: pi as never, job }), true);
    });
});

void describe("completeJob — exit-path notification", () => {
    void it("terminal transition releases hooks and freezes counters even when send fails", () => {
        const { reg, pi, ctx } = harness({ deliverThrows: true });
        const job = mkJob({ status: "running", exitCode: undefined, startTime: Date.now() - 5000 });
        add(reg, job);
        job.stop = () => {};
        ensureCompletionPromise(job);
        const error = console.error;
        console.error = () => {};
        try { completeJob({ reg, job, code: 1, pi: pi as never, ctx }); }
        finally { console.error = error; }
        assert.equal(reg.failedCount, 1);
        assert.ok(job.endedAt);
        assert.equal(job.stop, undefined);
        assert.equal(job.donePromise, undefined);
        const elapsed = reg.totalDurationMs;
        terminateJobSilently(reg, job);
        completeJob({ reg, job, code: 0, pi: pi as never, ctx });
        assert.equal(reg.totalDurationMs, elapsed);
        assert.equal(reg.failedCount, 1);
        assert.equal(reg.killedCount, 0);
    });

    void it("sends the <task-notification> the moment the job exits", () => {
        const { reg, pi, ctx, messages } = harness();
        const job = mkJob({ id: "job-9-1", status: "running", exitCode: undefined });
        add(reg, job);
        completeJob({ job, code: 0, reg, pi: pi as never, ctx });
        assert.equal(messages.length, 1);
        assert.ok(messages[0].content.includes("· completed]"));
        assert.equal(reg.jobs.has("job-9-1"), true, "retained after the send");
        assert.equal(reg.completedCount, 1);
        assert.ok(job.endedAt);
    });

    void it("a job read before exit exits silently and lingers", () => {
        const { reg, pi, ctx, messages } = harness();
        const job = mkJob({ id: "job-9-2", status: "running", exitCode: undefined });
        add(reg, job);
        markOutcomeSurfaced(job); // jobs output / attach raced the exit
        completeJob({ job, code: 1, reg, pi: pi as never, ctx });
        assert.equal(messages.length, 0);
        assert.equal(job.status, "failed");
        assert.equal(reg.jobs.has("job-9-2"), true);
    });

    void it('notification "self": the monitor already sent, so this retains silently', () => {
        const { reg, pi, ctx, messages } = harness();
        const job = mkJob({ id: "job-9-3", status: "running", exitCode: undefined });
        add(reg, job);
        markOutcomeSurfaced(job); // monitor already sent its own terminal notification
        completeJob({ job, code: 0, reg, pi: pi as never, ctx, notification: "self" });
        assert.equal(messages.length, 0);
        assert.equal(reg.jobs.has("job-9-3"), true);
    });

    void it('notification "self" whose send failed keeps the job listed', () => {
        const { reg, pi, ctx, messages } = harness();
        const job = mkJob({ id: "job-9-5", status: "running", exitCode: undefined });
        add(reg, job);
        // The monitor tried and threw: nothing reached the agent, so evicting
        // here would be the same silent loss as upstream's.
        job.notifyError = "boom";
        completeJob({ job, code: 0, reg, pi: pi as never, ctx, notification: "self" });
        assert.equal(messages.length, 0);
        assert.equal(reg.jobs.has("job-9-5"), true);
    });

    void it('notification "suppressed" + FAILED stays listed instead of vanishing', () => {
        const { reg, pi, ctx, messages } = harness();
        const job = mkJob({ id: "job-9-4", status: "running", exitCode: undefined });
        add(reg, job);
        // Upstream treated "don't notify" as "already notified" and evicted
        // the job at exit, so a `notify: false` command that FAILED was
        // unobservable. "Don't wake me" is not "I know how it went".
        completeJob({ job, code: 1, reg, pi: pi as never, ctx, notification: "suppressed" });
        assert.equal(messages.length, 0);
        assert.equal(job.status, "failed");
        assert.equal(job.outcomeSurfaced, undefined);
        assert.equal(reg.jobs.has("job-9-4"), true, "still listable");
    });

    void it('notification "suppressed" + completed retains without notification', () => {
        const { reg, pi, ctx, messages } = harness();
        const job = mkJob({ id: "job-9-6", status: "running", exitCode: undefined });
        add(reg, job);
        // Suppression affects delivery only, not ten-minute retention.
        completeJob({ job, code: 0, reg, pi: pi as never, ctx, notification: "suppressed" });
        assert.equal(messages.length, 0);
        assert.equal(reg.jobs.has("job-9-6"), true);
        assert.equal(reg.completedCount, 1);
    });
});
