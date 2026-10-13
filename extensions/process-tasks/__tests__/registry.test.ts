import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BackgroundRegistry } from "../state.ts";
import { add, createRunningJob, findJob, getStats, logPathFor, newJobId, startRegistrySweep, stopRegistrySweep, sweepTerminal } from "../registry.ts";
import { completeJob, markTerminal, terminateJobSilently } from "../lifecycle.ts";
import { TERMINAL_RETENTION_MS, REGISTRY_SWEEP_MS, type UiContext } from "../types.ts";

const ctx = { ui: { setStatus() {}, setWidget() {}, notify() {}, theme: { fg: (_c: string, t: string) => t } } } as unknown as UiContext;
function job(reg: BackgroundRegistry, id = "job-1") {
    return add(reg, createRunningJob({ id, command: "echo hi", pid: 0, logPath: "/tmp/test", toolCallId: "t" }));
}
void describe("registry IDs and lookup", () => {
    void it("uses random typed IDs and resolves only retained records", () => {
        assert.match(newJobId("shell"), /^b[0-9a-z]{8}$/);
        assert.match(newJobId("monitor"), /^m[0-9a-z]{8}$/);
        assert.notEqual(newJobId("shell"), newJobId("shell"));
        const reg = new BackgroundRegistry();
        const j = job(reg);
        assert.equal(findJob(reg, j.id), j);
        assert.equal(findJob(reg, "unknown"), undefined);
        assert.ok(logPathFor(reg, j.id).startsWith("/"));
    });
});
void describe("terminal transitions own lifetime counters", () => {
    for (const status of ["completed", "failed", "killed"] as const) {
        void it(`${status} is counted once and time freezes at the first transition`, () => {
            const reg = new BackgroundRegistry();
            const j = job(reg);
            j.startTime = Date.now() - 5000;
            markTerminal(reg, j, status, status === "completed" ? 0 : 1);
            const endedAt = j.endedAt;
            markTerminal(reg, j, "failed", 9);
            assert.equal(j.endedAt, endedAt);
            assert.equal(j.status, status);
            assert.equal(reg.jobs.size, 1, "completion does not evict");
            const s = getStats(reg);
            assert.equal(s.completed + s.failed + s.killed, 1);
            assert.equal(s.totalStarted, 1);
            assert.equal(s.running, 0);
            assert.equal(s.totalDurationMs, status === "killed" ? 0 : (endedAt ?? 0) - j.startTime);
        });
    }
    void it("silent kill followed by late exit cannot double-count or overwrite endedAt", () => {
        const reg = new BackgroundRegistry();
        const j = job(reg);
        const ac = new AbortController();
        reg.jobAborts.set(j.id, ac);
        terminateJobSilently(reg, j);
        const endedAt = j.endedAt;
        completeJob({ reg, job: j, code: 1, pi: { sendMessage() { throw new Error("must not notify"); } } as never, ctx });
        assert.equal(reg.killedCount, 1);
        assert.equal(reg.failedCount, 0);
        assert.equal(j.endedAt, endedAt);
        assert.equal(ac.signal.aborted, true);
        assert.equal(reg.jobAborts.size, 0);
    });
    void it("foreground entries are included in execution lifetime metrics", () => {
        const reg = new BackgroundRegistry();
        const j = job(reg);
        j.isBackgrounded = false;
        markTerminal(reg, j, "killed");
        assert.equal(reg.killedCount, 1);
        assert.equal(reg.totalStarted, 1);
    });
});
void describe("age-based metadata sweep", () => {
    void it("expires all terminal statuses after ten minutes, never live jobs or log files", () => {
        const dir = mkdtempSync(join(tmpdir(), "pi-retention-"));
        try {
            const reg = new BackgroundRegistry();
            const now = Date.now();
            const live = job(reg, "live");
            for (const status of ["completed", "failed", "killed"] as const) {
                const j = job(reg, status);
                j.logPath = join(dir, `${status}.log`);
                writeFileSync(j.logPath, "final output");
                markTerminal(reg, j, status);
                j.endedAt = now - TERMINAL_RETENTION_MS;
            }
            const fresh = job(reg, "fresh");
            markTerminal(reg, fresh, "completed");
            fresh.endedAt = now - TERMINAL_RETENTION_MS + 1;
            assert.equal(sweepTerminal(reg, now), 3);
            assert.equal(reg.jobs.size, 2);
            assert.equal(findJob(reg, "completed"), undefined);
            assert.equal(findJob(reg, live.id), live);
            assert.ok(existsSync(join(dir, "completed.log")));
            assert.equal(sweepTerminal(reg, now), 0);
            assert.equal(reg.completedCount, 2, "sweeping does not change counters");
        } finally { rmSync(dir, { recursive: true, force: true }); }
    });
    void it("sweeps every sixty seconds and releases the timer idempotently", (t) => {
        t.mock.timers.enable({ apis: ["setInterval", "Date"], now: 1_000_000 });
        const reg = new BackgroundRegistry();
        const j = job(reg);
        markTerminal(reg, j, "completed");
        startRegistrySweep(reg);
        t.mock.timers.tick(TERMINAL_RETENTION_MS - 1);
        assert.ok(reg.jobs.has(j.id));
        t.mock.timers.tick(1);
        assert.equal(reg.jobs.has(j.id), false);
        assert.equal(REGISTRY_SWEEP_MS, 60_000);
        stopRegistrySweep(reg);
        stopRegistrySweep(reg);
        assert.equal(reg.sweepTimer, undefined);
    });
});
