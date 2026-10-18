import { bashInput } from "./bash-input.ts";
import { processInput } from "../../runtime-tasks/__tests__/process-input.ts";
import { it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { BackgroundRegistry } from "../state.ts";
import { DEFAULTS } from "../config.ts";
import { registerBashTool } from "../tools/bash.ts";
import { registerManagementFixture } from "./management-fixture.ts";
import { add, createRunningJob, getStats, stopSidebarTicker } from "../registry.ts";
import { startBackgroundJob, terminateJobSilently } from "../lifecycle.ts";
import { createProcessTaskSource, processTaskIdentity } from "../source.ts";
import { processExists } from "../spawn.ts";
import processTasks from "../index.ts";
import { TaskCoordinator } from "../../task-ui/coordinator.ts";

interface Tool {
    name: string;
    execute(id: string, params: unknown, signal: AbortSignal | undefined, update: undefined, ctx: unknown): Promise<{ content: { text?: string }[] }>;
}
const tick = () => new Promise<void>((resolve) => setImmediate(resolve));
function harness() {
    const dir = mkdtempSync(join(tmpdir(), "process-waits-"));
    const reg = new BackgroundRegistry({ ...DEFAULTS, logDir: dir });
    const tools = new Map<string, Tool>();
    const messages: unknown[] = [];
    const pi = { registerTool: (tool: Tool) => tools.set(tool.name, tool), sendMessage: (message: unknown) => messages.push(message) };
    const ctx = { cwd: dir, ui: { notify() {}, setWidget() {}, setStatus() {}, theme: { fg: (_color: string, text: string) => text } } };
    registerBashTool(pi as never, reg, {} as never);
    registerManagementFixture(pi as never, reg);
    const source = createProcessTaskSource(reg);
    const cleanup = async () => {
        for (const job of reg.jobs.values()) terminateJobSilently(reg, job);
        reg.coordinator.dispose();
        source.dispose();
        stopSidebarTicker(reg);
        await tick();
        rmSync(dir, { recursive: true, force: true });
    };
    const fakeJob = (mode = true) => {
        const id = `fake-${reg.jobs.size}`;
        const logPath = join(dir, `${id}.log`);
        writeFileSync(logPath, "first line\n");
        const job = add(reg, createRunningJob({ id, command: "fake runner", pid: 0, logPath, toolCallId: id, isBackgrounded: mode }));
        let resolve!: (result: { code: number; signal: null }) => void;
        const exit = new Promise<{ code: number; signal: null }>((done) => { resolve = done; });
        startBackgroundJob({ reg, pi: pi as never, ctx: ctx as never, job, exit });
        return { job, finish: () => resolve({ code: 0, signal: null }) };
    };
    return { dir, reg, tools, messages, ctx, source, cleanup, fakeJob };
}

void it("early /bg before two seconds returns immediately; same PID/log survive subsequent parent abort", { timeout: 10_000 }, async () => {
    const h = harness();
    try {
        const signal = new AbortController();
        const result = h.tools.get("bash")!.execute("launch", bashInput({ command: "printf ready; tail -f /dev/null" }), signal.signal, undefined, h.ctx);
        const job = [...h.reg.jobs.values()][0]!;
        const before = h.source.list()[0]!;
        assert.equal(before.executionMode, "foreground");
        assert.equal(before.waitCount, 1);
        assert.equal(h.reg.totalStarted, 1);
        const started = Date.now();
        assert.equal(h.reg.coordinator.detachAll(), 1);
        assert.equal(h.reg.coordinator.detachAll(), 0);
        signal.abort();
        const text = (await result).content[0]!.text!;
        assert.ok(Date.now() - started < 1_000, "must not wait for the old two-second window");
        assert.match(text, new RegExp(`manually backgrounded.*${job.id}`));
        assert.ok(processExists(job.pid));
        assert.equal(h.reg.jobs.get(job.id), job);
        assert.equal(h.source.list()[0]!.executionMode, "background");
        assert.equal(h.source.list()[0]!.waitCount, 0);
        assert.equal(before.executionMode, "foreground", "old snapshot must not mutate");
        assert.equal(h.reg.totalStarted, 1, "promotion must not count another execution");
    } finally { await h.cleanup(); }
});

for (const command of ["printf final-log", "printf failed-log; exit 7"]) {
    void it(`foreground finalization preserves terminal record/log: ${command}`, async () => {
        const h = harness();
        try {
            const result = h.tools.get("bash")!.execute("launch", bashInput({ command }), undefined, undefined, h.ctx);
            const job = [...h.reg.jobs.values()][0]!;
            const returned = await result;
            assert.equal((returned as { isError?: boolean }).isError === true, command.includes("exit 7"));
            assert.match(returned.content[0]!.text!, command.includes("exit 7") ? /\nfailed-log$/ : /\nfinal-log$/);
            assert.equal(h.reg.jobs.get(job.id), job);
            assert.ok(readFileSync(job.logPath, "utf8").includes("log"));
            assert.equal(h.source.list()[0]!.executionMode, "foreground");
            assert.equal(h.source.list()[0]!.waitCount, 0);
            assert.equal(h.messages.length, 0, "inline result suppresses completion notice");
            assert.equal(h.reg.jobAborts.size, 0);
            assert.equal(h.reg.foreground.size, 0);
            assert.equal(getStats(h.reg).completed + getStats(h.reg).failed, 1);
        } finally { await h.cleanup(); }
    });
}

void it("genuine launch signal and source silent stop retain final logs and release runtime hooks", async () => {
    const h = harness();
    try {
        for (const action of ["abort", "stop"] as const) {
            const signal = new AbortController();
            const result = h.tools.get("bash")!.execute(action, bashInput({ command: "printf before-kill; tail -f /dev/null" }), signal.signal, undefined, h.ctx);
            const job = [...h.reg.jobs.values()].at(-1)!;
            await new Promise((resolve) => setTimeout(resolve, 50));
            if (action === "abort") signal.abort();
            else assert.equal(h.source.stop(processTaskIdentity(job.id)), true);
            await result;
            assert.equal(job.status, "killed");
            assert.equal(processExists(job.pid), false, "abort/stop must end the original process");
            assert.equal(h.reg.jobs.get(job.id), job);
            assert.match(readFileSync(job.logPath, "utf8"), /before-kill/);
            assert.equal(h.reg.jobAborts.size, 0);
            assert.equal(h.reg.coordinator.waitCount, 0);
            assert.equal(h.source.stop(processTaskIdentity(job.id)), false);
        }
        assert.equal(h.messages.length, 0);
        assert.equal(getStats(h.reg).killed, 2);
    } finally { await h.cleanup(); }
});

void it("bash waiting threshold retains auto-background behavior inside the quick window", async () => {
    const h = harness();
    try {
        const result = await h.tools.get("bash")!.execute("threshold", bashInput({ command: "tail -f /dev/null", background_after_seconds: 0.05 }), undefined, undefined, h.ctx);
        assert.match(result.content[0]!.text!, /\nCommand running in background/);
        assert.equal(h.source.list()[0]!.executionMode, "background");
        assert.equal(h.reg.totalStarted, 1);
    } finally { await h.cleanup(); }
});

void it("already-aborted retrieval and wait:false return promptly without stopping or consuming a running job", async () => {
    const h = harness();
    try {
        const { job, finish } = h.fakeJob();
        const signal = new AbortController();
        signal.abort();
        const result = await h.tools.get("process_manage")!.execute("retrieve", processInput({ action: "wait", task_id: job.id }), signal.signal, undefined, h.ctx);
        assert.match(result.content[0]!.text!, /Wait cancelled; target unchanged/);
        const peek = await h.tools.get("process_manage")!.execute("peek", processInput({ action: "status", task_id: job.id }), undefined, undefined, h.ctx);
        assert.match(peek.content[0]!.text!, /: running/);
        assert.doesNotMatch(peek.content[0]!.text!, /finished/);
        assert.equal(job.outcomeSurfaced, undefined);
        assert.equal(job.attachCount, 0);
        finish();
        await tick();
        assert.equal(h.messages.length, 1);
    } finally { await h.cleanup(); }
});

void it("two retrieval waits share counts; cancelling one cannot release the sibling suppression", async () => {
    const h = harness();
    try {
        const { job, finish } = h.fakeJob();
        const signal = new AbortController();
        const a = h.tools.get("process_manage")!.execute("a", processInput({ action: "wait", task_id: job.id }), signal.signal, undefined, h.ctx);
        const b = h.tools.get("process_manage")!.execute("b", processInput({ action: "wait", task_id: job.id }), undefined, undefined, h.ctx);
        assert.equal(h.source.list()[0]!.executionMode, "background");
        assert.equal(h.source.list()[0]!.waitCount, 2);
        signal.abort();
        await a;
        assert.equal(job.attachCount, 1);
        assert.equal(h.reg.coordinator.waitCount, 1);
        finish();
        await b;
        assert.equal(job.outcomeSurfaced, true);
        assert.equal(job.attachCount, 0);
        assert.equal(h.messages.length, 0, "remaining retrieval is the outcome report");
    } finally { await h.cleanup(); }
});

for (const winner of ["completion", "detach"] as const) {
    void it(`retrieval ${winner} on completion tick produces inline result OR one notification`, async () => {
        const h = harness();
        try {
            const { job, finish } = h.fakeJob();
            const waits = ["a", "b"].map((id) => h.tools.get("process_manage")!.execute(id, processInput({ action: "wait", task_id: job.id }), undefined, undefined, h.ctx));
            finish();
            if (winner === "completion") await tick();
            else await Promise.resolve(); // exit marked terminal, retrieval continuation still queued
            h.reg.coordinator.detachAll();
            const results = await Promise.all(waits);
            await tick();
            assert.equal(job.status, "completed");
            assert.equal(job.attachCount, 0);
            if (winner === "completion") {
                assert.ok(results.every((result) => result.content[0]!.text!.includes("status=completed")));
                assert.equal(h.messages.length, 0);
            } else {
                assert.ok(results.every((result) => result.content[0]!.text!.includes("Wait released; target unchanged")));
                assert.equal(h.messages.length, 1, "last cancelled wait must recheck suppressed terminal delivery");
            }
        } finally { await h.cleanup(); }
    });
}

void it("source exposes frozen queued/foreground/background/terminal views and bounded detail only", async () => {
    const h = harness();
    try {
        let changes = 0;
        const unsubscribe = h.source.subscribe(() => { changes++; });
        const fg = h.fakeJob(false);
        const bg = h.fakeJob();
        bg.job.status = "pending";
        h.reg.changed();
        const views = h.source.list();
        assert.equal(views[0]!.executionMode, "foreground");
        assert.equal(views[1]!.status, "queued");
        assert.ok(Object.isFrozen(views));
        for (const view of views) {
            assert.ok(Object.isFrozen(view));
            assert.ok(Object.isFrozen(view.stats));
            assert.ok(Object.isFrozen(view.artifacts[0]));
            assert.ok(!("donePromise" in view));
            assert.ok(!("stop" in view));
        }
        writeFileSync(fg.job.logPath, "x".repeat(30_000));
        const detail = h.source.detail(processTaskIdentity(fg.job.id), { limit: 1_000_000 })!;
        assert.ok(detail.text.length <= h.reg.config.outputPreviewChars);
        assert.ok(detail.omittedBefore! > 0);
        assert.equal(h.source.detail({ sourceId: "agent", taskId: fg.job.id, runId: fg.job.id }), undefined);
        assert.equal(h.source.stop({ sourceId: "agent", taskId: fg.job.id, runId: fg.job.id }), false);
        assert.equal(h.source.stop(processTaskIdentity(fg.job.id)), true);
        assert.equal(h.source.list()[0]!.status, "stopped");
        assert.equal(views[0]!.status, "running");
        assert.ok(changes >= 3);
        unsubscribe();
        h.source.dispose();
        assert.deepEqual(h.source.list(), []);
    } finally { await h.cleanup(); }
});

void it("factory injection registers one source, no shared controls; standalone fixtures register controls once", async () => {
    const coordinator = new TaskCoordinator();
    const commands: string[] = [];
    const shortcuts: string[] = [];
    const handlers = new Map<string, () => Promise<void>>();
    const pi = { registerTool() {}, registerMessageRenderer() {}, registerCommand: (name: string) => commands.push(name),
        registerShortcut: (key: string) => shortcuts.push(key), on: (event: string, fn: () => Promise<void>) => handlers.set(event, fn) };
    const backend = processTasks(pi as never, { coordinator });
    assert.equal(backend.coordinator, coordinator);
    assert.deepEqual(commands, ["process-tasks-version", "process-tasks-config"]);
    assert.deepEqual(shortcuts, []);
    assert.equal(coordinator.snapshot().length, 1);
    await handlers.get("session_shutdown")!();
    assert.equal(coordinator.snapshot().length, 0);
    coordinator.dispose();
    commands.length = 0;
    const standalone = processTasks(pi as never);
    assert.deepEqual(commands, ["bg", "tasks", "process-tasks-version", "process-tasks-config"]);
    assert.deepEqual(shortcuts, ["ctrl+shift+b", "shift+down"]);
    assert.equal(standalone.coordinator.waitCount, 0);
    await handlers.get("session_shutdown")!();
});

void it("foreground setup failure rolls back the process and wait but preserves its log", async () => {
    const h = harness();
    try {
        const changed = h.reg.changed.bind(h.reg);
        let failed = false;
        h.reg.changed = () => {
            if (h.reg.jobAborts.size && !failed) { failed = true; throw new Error("source unavailable"); }
            changed();
        };
        await assert.rejects(h.tools.get("bash")!.execute("failure", bashInput({ command: "tail -f /dev/null" }), undefined, undefined, h.ctx), /source unavailable/);
        const job = [...h.reg.jobs.values()][0]!;
        assert.equal(job.status, "killed");
        assert.ok(!processExists(job.pid));
        assert.equal(h.reg.coordinator.waitCount, 0);
        assert.equal(h.reg.jobAborts.size, 0);
        assert.equal(h.reg.foreground.size, 0);
        assert.equal(typeof readFileSync(job.logPath, "utf8"), "string");
    } finally { await h.cleanup(); }
});
