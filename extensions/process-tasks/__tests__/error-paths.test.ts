import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { setTimeout as delay } from "node:timers/promises";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULTS } from "../config.ts";
import { BackgroundRegistry } from "../state.ts";
import { registerBashTool } from "../tools/bash.ts";
import { registerBashBgTool } from "../tools/bash-bg.ts";
import { registerJobsTool } from "../tools/jobs.ts";
import { add, createRunningJob, getStats, stopSidebarTicker } from "../registry.ts";
import { startBackgroundJob, terminateJobSilently } from "../lifecycle.ts";
import { createProcessTaskSource, processTaskIdentity } from "../source.ts";
import { processExists } from "../spawn.ts";

interface Tool {
    name: string;
    execute(id: string, params: unknown, signal: AbortSignal | undefined, update: undefined, ctx: unknown): Promise<{ content: { text?: string }[] }>;
}
const tick = () => new Promise<void>((resolve) => setImmediate(resolve));
function harness(t: TestContext) {
    const dir = mkdtempSync(join(tmpdir(), "process-errors-"));
    const reg = new BackgroundRegistry({ ...DEFAULTS, logDir: dir });
    const tools = new Map<string, Tool>();
    const messages: unknown[] = [];
    const pi = { registerTool: (tool: Tool) => tools.set(tool.name, tool), sendMessage: (m: unknown) => messages.push(m) };
    const ctx = { cwd: dir, ui: { setWidget(_key: string, _content: unknown) {}, setStatus() {}, notify() {}, theme: { fg: (_: string, text: string) => text } } };
    registerBashTool(pi as never, reg, {} as never);
    registerBashBgTool(pi as never, reg);
    registerJobsTool(pi as never, reg);
    const source = createProcessTaskSource(reg);
    t.after(async () => {
        for (const job of reg.jobs.values()) terminateJobSilently(reg, job);
        reg.coordinator.dispose(); source.dispose(); stopSidebarTicker(reg);
        for (const job of reg.jobs.values()) await until(() => !processExists(job.pid));
        rmSync(dir, { recursive: true, force: true });
    });
    const controlledJob = () => {
        const logPath = join(dir, "controlled.log"); writeFileSync(logPath, "retained result\n");
        const job = add(reg, createRunningJob({ id: "controlled", command: "controlled runner", pid: 0, logPath, toolCallId: "controlled" }));
        let finish!: () => void;
        const exit = new Promise<{ code: number; signal: null }>((resolve) => { finish = () => resolve({ code: 0, signal: null }); });
        startBackgroundJob({ reg, pi: pi as never, ctx: ctx as never, job, exit });
        return { job, finish };
    };
    return { reg, tools, messages, ctx, source, controlledJob };
}
async function until(condition: () => boolean) {
    for (let i = 0; i < 200; i++) { if (condition()) return; await delay(10); }
    assert.ok(condition(), "isolated subprocess did not settle within two seconds");
}
function trackTimers(t: TestContext) {
    t.mock.timers.enable({ apis: ["setTimeout", "setInterval", "Date"], now: 1_000_000 });
    const active = new Set<NodeJS.Timeout>();
    const set = globalThis.setTimeout, clear = globalThis.clearTimeout;
    const interval = globalThis.setInterval, clearInterval = globalThis.clearInterval;
    t.mock.method(globalThis, "setTimeout", (callback: () => void, ms: number) => {
        let timer: NodeJS.Timeout;
        timer = set(() => { active.delete(timer); callback(); }, ms); active.add(timer); return timer;
    });
    t.mock.method(globalThis, "clearTimeout", (timer: NodeJS.Timeout) => { active.delete(timer); clear(timer); });
    t.mock.method(globalThis, "setInterval", (callback: () => void, ms: number) => {
        const timer = interval(callback, ms); active.add(timer); return timer;
    });
    t.mock.method(globalThis, "clearInterval", (timer: NodeJS.Timeout) => { active.delete(timer); clearInterval(timer); });
    return active;
}

for (const failureMode of ["show-and-clear", "clear-only", "poller-stop"] as const) {
    test(`foreground two-second hint ${failureMode} failure cannot orphan a launch`, async t => {
        const timers = trackTimers(t);
        const h = harness(t);
        const primary = new Error("hint show failed");
        const secondary = new Error("hint clear failed");
        const writes: unknown[] = [];
        t.mock.method(h.ctx.ui, "setWidget", (_key: string, content: unknown) => {
            writes.push(content);
            if (content === undefined) throw secondary;
            if (failureMode === "show-and-clear") throw primary;
        });
        // Exercise a throwing stop handle without replacing streamLog: clear its
        // actual poll timer first, then simulate failure in that cleanup step.
        if (failureMode === "poller-stop") {
            const set = globalThis.setTimeout, clear = globalThis.clearTimeout;
            let pollTimer: NodeJS.Timeout | undefined;
            t.mock.method(globalThis, "setTimeout", (callback: () => void, ms: number) => {
                const timer = set(callback, ms);
                if (ms === 1000) pollTimer = timer;
                return timer;
            });
            t.mock.method(globalThis, "clearTimeout", (timer: NodeJS.Timeout) => {
                clear(timer);
                if (timer === pollTimer) { pollTimer = undefined; throw new Error("poller stop failed after clearing timer"); }
            });
        }
        const result = h.tools.get("bash")!.execute("hint", { command: "printf ready; tail -f /dev/null" }, undefined, undefined, h.ctx);
        // Attach the rejection handler before advancing the quick-window timer.
        const settled = result.then(value => ({ value, error: undefined }), error => ({ value: undefined, error }));
        const job = [...h.reg.jobs.values()][0]!;
        const controller = h.reg.jobAborts.get(job.id)!;
        await until(() => readFileSync(job.logPath, "utf8").includes("ready"));
        assert.equal(h.reg.coordinator.waitCount, 1);
        t.mock.timers.tick(2000); await tick();
        if (failureMode !== "show-and-clear") {
            assert.ok(processExists(job.pid), "failed optional clear must not prematurely stop execution");
            terminateJobSilently(h.reg, job);
        }
        const outcome = await settled;
        if (failureMode === "show-and-clear") assert.equal(outcome.error, primary, "cleanup must not mask the primary show error");
        else { assert.equal(outcome.error, undefined); assert.match(outcome.value!.content[0]!.text!, /ready/); }
        assert.equal(writes.length, 2, "show and clear paths must both be exercised");
        assert.equal(writes[1], undefined);
        assert.equal(job.status, "killed");
        assert.ok(!processExists(job.pid));
        assert.ok(controller.signal.aborted);
        assert.equal(h.reg.coordinator.waitCount, 0);
        assert.equal(h.reg.foreground.size, 0);
        assert.equal(h.reg.jobAborts.size, 0);
        assert.equal(h.reg.notificationRetries.size, 0);
        assert.equal(timers.size, 0);
        assert.match(readFileSync(job.logPath, "utf8"), /ready/);
        assert.equal(h.messages.length, 0);
        assert.equal(getStats(h.reg).killed, 1);
    });
}

test("foreground execution error survives a failing final source publication", async t => {
    const h = harness(t);
    const result = h.tools.get("bash")!.execute("error", { command: "printf primary-command-error; exit 7" }, undefined, undefined, h.ctx);
    const changed = h.reg.changed.bind(h.reg);
    t.mock.method(h.reg, "changed", () => {
        if (h.reg.coordinator.waitCount === 0) throw new Error("secondary final publication error");
        changed();
    });
    await assert.rejects(result, /primary-command-error/);
    assert.equal(h.reg.coordinator.waitCount, 0);
    assert.equal(h.reg.jobAborts.size, 0);
    assert.equal(h.reg.foreground.size, 0);
    assert.equal(h.reg.sidebarTimer, undefined);
    assert.equal(h.messages.length, 0);
});

for (const entry of ["bash", "bash_bg"] as const) {
    test(`${entry} explicit background setup failure silently stops the spawned process and preserves original error`, async t => {
        const timers = trackTimers(t);
        const h = harness(t);
        const failure = new Error(`${entry} publication unavailable`);
        let statusCalls = 0;
        let controller: AbortController | undefined;
        let done: Promise<void> | undefined;
        const changed = h.reg.changed.bind(h.reg);
        t.mock.method(h.reg, "changed", () => {
            if (!h.reg.jobAborts.size || statusCalls > 0) { changed(); return; }
            statusCalls++; controller = [...h.reg.jobAborts.values()][0];
            done = [...h.reg.jobs.values()][0]?.donePromise; throw failure;
        });
        const params = { command: "tail -f /dev/null", run_in_background: true, timeout: 60 };
        await assert.rejects(h.tools.get(entry)!.execute("setup", params, undefined, undefined, h.ctx), error => error === failure);
        const job = [...h.reg.jobs.values()][0]!;
        assert.equal(statusCalls, 1, "failure must occur on the initial render after lifecycle wiring");
        assert.ok(controller?.signal.aborted);
        await done;
        assert.equal(job.status, "killed");
        assert.ok(!processExists(job.pid), "tool rejection must not leave a running subprocess");
        assert.equal(h.reg.jobAborts.size, 0);
        assert.equal(h.reg.notificationRetries.size, 0);
        assert.equal(job.donePromise, undefined);
        assert.equal(job.resolveDone, undefined);
        assert.equal(h.reg.coordinator.waitCount, 0);
        assert.equal(timers.size, 0);
        assert.equal(typeof readFileSync(job.logPath, "utf8"), "string");
        await tick(); t.mock.timers.tick(120_000);
        assert.equal(h.messages.length, 0, "late exit/timeout must not emit completion notices");
        assert.equal(getStats(h.reg).totalStarted, 1);
        assert.equal(getStats(h.reg).killed, 1);
        assert.equal(getStats(h.reg).running, 0);
    });
}

for (const mode of ["wait", "terminal", "sibling-cancel"] as const) {
    test(`jobs ${mode} returns a consumed inline outcome even when the completion toast throws`, async t => {
        const h = harness(t);
        const { job, finish } = h.controlledJob();
        let toastAttempts = 0;
        t.mock.method(h.ctx.ui, "notify", () => { toastAttempts++; throw new Error("optional toast unavailable"); });
        if (mode === "terminal") {
            job.attachCount = 1; finish(); await tick(); job.attachCount = 0;
            const before = h.source.list()[0]!;
            const detail = h.source.detail(processTaskIdentity(job.id));
            assert.equal(before.status, "completed"); assert.match(detail!.text, /retained result/);
            assert.equal(job.outcomeSurfaced, undefined, "snapshot/detail reads must remain non-consuming");
        }
        const signal = mode === "sibling-cancel" ? new AbortController() : undefined;
        const sibling = signal ? h.tools.get("jobs")!.execute("cancelled", { action: "attach", jobId: job.id }, signal.signal, undefined, h.ctx) : undefined;
        const result = h.tools.get("jobs")!.execute("inline", { action: "attach", jobId: job.id }, undefined, undefined, h.ctx);
        if (signal) {
            assert.equal(job.attachCount, 2);
            signal.abort(); await sibling;
            assert.equal(job.attachCount, 1, "cancellation must not release sibling suppression");
            assert.equal(toastAttempts, 0, "cancelled retrieval is not a completion");
            assert.equal(h.messages.length, 0);
        }
        if (mode !== "terminal") {
            assert.equal(job.attachCount, 1);
            finish();
        }
        const report = await result;
        assert.match(report.content[0]!.text!, /finished\. Status: completed/);
        assert.equal(toastAttempts, 1);
        assert.equal(job.outcomeSurfaced, true);
        assert.equal(job.attachCount, 0);
        assert.equal(h.reg.coordinator.waitCount, 0);
        assert.equal(h.reg.jobAborts.size, 0);
        assert.equal(h.messages.length, 0, "the consumed inline report suppresses backend notices");
        h.reg.notificationRetries.get(job.id)?.(); await tick();
        assert.equal(h.messages.length, 0);
    });
}
