import "../../agent-tasks/__tests__/source-loader.mjs";
import assert from "node:assert/strict";
import { it } from "node:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
    AgentSessionRuntime, SessionManager, createExtensionRuntime,
    type AgentSession, type AgentSessionServices, type CreateAgentSessionRuntimeFactory,
    type ExtensionAPI, type ExtensionContext, type ExtensionToolContext, type SessionShutdownEvent,
} from "@earendil-works/pi-coding-agent";
import { TaskCoordinator } from "../coordinator.ts";
import { TaskLifecycle } from "../lifecycle.ts";
import processTasks from "../../process-tasks/index.ts";
import { until } from "../../process-tasks/__tests__/process-harness.ts";
import { processExists } from "../../process-tasks/spawn.ts";

const { default: agentTasks } = await import("../../agent-tasks/src/index.ts");
import type { RunResult } from "../../agent-tasks/src/agent-runner.ts";

interface Tool {
    execute(id: string, params: unknown, signal: AbortSignal | undefined, update: undefined, ctx: ExtensionToolContext): Promise<unknown>;
}

void it("actual SDK runtime new/resume/fork/import/quit creates fresh factories; canceled/invalid switch keeps old activation usable", { timeout: 20_000 }, async () => {
    const dir = mkdtempSync(join(tmpdir(), "task-sdk-runtime-"));
    const agentDir = join(dir, "agent");
    const activations: { lifecycle: TaskLifecycle }[] = [];
    const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
    process.env.PI_CODING_AGENT_DIR = agentDir;
    const oldLogDir = process.env.PROCESS_TASKS_LOG_DIR;
    process.env.PROCESS_TASKS_LOG_DIR = dir;
    const order: string[] = [];
    let cancelSwitch = false;
    function activate(sessionManager: SessionManager) {
        const coordinator = new TaskCoordinator(), lifecycle = new TaskLifecycle(coordinator);
        const tools = new Map<string, Tool>();
        const messages: unknown[] = [];
        const callbacks = new Map<string, (event: unknown, ctx: ExtensionContext) => Promise<unknown>>();
        const context = { cwd: dir, hasUI: false, mode: "print", sessionManager, modelRegistry: {}, ui: { setStatus() {}, setWidget() {}, notify() {}, theme: { fg: (_: string, text: string) => text } } };
        // The two SDK boundary casts supply only services used by actual backend/runtime methods.
        const ctx = context as unknown as ExtensionToolContext;
        const partialPi = {
            registerTool(tool: { name: string }) { tools.set(tool.name, tool as unknown as Tool); },
            registerCommand() {}, registerShortcut() {}, registerMessageRenderer() {}, registerEntryRenderer() {}, registerFlag() {},
            getFlag: () => undefined, getAllTools: () => [], getActiveTools: () => [], appendEntry() {},
            events: { emit() {}, on() { return () => {}; } },
            sendMessage(message: unknown) { messages.push(message); },
            on(event: string, callback: (event: unknown, ctx: ExtensionContext) => Promise<unknown>) { callbacks.set(event, callback); },
        };
        const backend = processTasks(partialPi as unknown as ExtensionAPI, { coordinator, lifecycle });
        let agentRuns = 0, agentStops = 0;
        agentTasks(partialPi as unknown as ExtensionAPI, { coordinator, lifecycle, managerDependencies: {
            runAgent: async (_ctx, _type, _prompt, options) => {
                agentRuns++;
                let resolve!: (value: RunResult) => void;
                const work = new Promise<RunResult>(done => { resolve = done; });
                const session = { messages: [], sessionManager: { getSessionFile: () => undefined }, subscribe: () => () => {}, dispose() {}, getContextUsage: () => undefined } as unknown as AgentSession;
                queueMicrotask(() => options.onSessionCreated?.(session));
                options.signal?.addEventListener("abort", () => { agentStops++; resolve({ session, responseText: "stopped", aborted: true, steered: false }); }, { once: true });
                return work;
            },
        } });
        void callbacks.get("session_start")?.({}, ctx);
        callbacks.set("session_shutdown", async (event) => {
            order.push(`shutdown:${(event as SessionShutdownEvent).reason}`);
            await lifecycle.shutdown();
        });
        const parent = new AbortController();
        let foreground: Promise<unknown> | undefined;
        const runner = {
            hasHandlers(event: string) { return event === "session_before_switch" || event === "session_before_fork" || callbacks.has(event); },
            async emit(event: { type: string }) {
                if (event.type === "session_before_switch") return { cancel: cancelSwitch };
                if (event.type === "session_before_fork") return { cancel: false };
                await callbacks.get(event.type)?.(event, ctx);
                return undefined;
            },
        };
        const partialSession: Pick<AgentSession, "abort" | "dispose" | "sessionManager" | "sessionFile"> = {
            sessionManager, sessionFile: sessionManager.getSessionFile(),
            async abort() { order.push("abort"); parent.abort(); await foreground; },
            dispose() { order.push("dispose"); },
        };
        const session = { ...partialSession, extensionRunner: runner } as unknown as AgentSession;
        const result = { session, backend, coordinator, lifecycle, tools, messages, ctx,
            counts: () => ({ agentRuns, agentStops }),
            execute(name: string, params: unknown) { return tools.get(name)!.execute(name, params, undefined, undefined, ctx); },
            launchForeground(command: string) { foreground = tools.get("bash")!.execute("fg", { command }, parent.signal, undefined, ctx); return foreground; },
        };
        activations.push(result);
        return result;
    }
    let current: ReturnType<typeof activate> | undefined;
    const services = { cwd: dir, agentDir } as AgentSessionServices;
    const factory: CreateAgentSessionRuntimeFactory = async (options) => {
        order.push("create");
        const h = activate(options.sessionManager);
        current = h;
        return { session: h.session, services, diagnostics: [], extensionsResult: { extensions: [], errors: [], runtime: createExtensionRuntime() } };
    };
    const initial = activate(SessionManager.inMemory(dir));
    const runtime = new AgentSessionRuntime(initial.session, services, factory);
    runtime.setRebindSession(async () => { order.push("rebind"); });
    const validFile = join(dir, "valid.jsonl"), invalidFile = join(dir, "invalid.jsonl");
    const header = (cwd: string) => JSON.stringify({ type: "session", version: 3, id: "test", timestamp: new Date().toISOString(), cwd }) + "\n";
    writeFileSync(validFile, header(dir)); writeFileSync(invalidFile, header(join(dir, "missing-cwd")));
    try {
        cancelSwitch = true;
        assert.deepEqual(await runtime.newSession(), { cancelled: true });
        assert.equal(initial.lifecycle.active, true);
        await initial.execute("bash", { command: "printf AFTER_CANCEL" });
        cancelSwitch = false;
        await assert.rejects(runtime.switchSession(invalidFile), /cwd|directory/i);
        assert.equal(initial.lifecycle.active, true);
        await initial.execute("bash", { command: "printf AFTER_INVALID" });
        const foreground = initial.launchForeground("trap '' TERM; printf READY; while true; do sleep 0.1; done");
        const job = initial.backend.source.list().at(-1)!;
        const log = job.artifacts[0]!.path;
        await until(() => readFileSync(log, "utf8").includes("READY"));
        await initial.execute("subagent_run", { subagent_type: "general-purpose", description: "old", prompt: "offline", run_in_background: true });
        assert.equal(initial.counts().agentRuns, 1);
        order.length = 0;
        assert.deepEqual(await runtime.newSession(), { cancelled: false });
        await foreground;
        assert.deepEqual(order, ["abort", "shutdown:new", "dispose", "create", "rebind"]);
        assert.equal(processExists(Number(job.stats.pid)), false);
        assert.equal(initial.counts().agentStops, 1);
        await assert.rejects(initial.execute("subagent_run", { subagent_type: "general-purpose", prompt: "stale" }), /closing|closed/);
        assert.equal(initial.coordinator.waitCount, 0); assert.equal(initial.backend.source.list().length, 0);
        assert.match(readFileSync(log, "utf8"), /READY/);
        await assert.rejects(initial.execute("bash", { command: "echo stale" }), /closed/);
        assert.equal((runtime.session === initial.session ? initial : current!).backend.source.list().length, 0);
        await current!.execute("bash", { command: "printf NEW_FACTORY" });
        assert.equal(current!.counts().agentRuns, 0);
        await current!.execute("subagent_run", { subagent_type: "general-purpose", description: "new", prompt: "offline", run_in_background: true });
        assert.equal(current!.counts().agentRuns, 1);
        await runtime.switchSession(validFile);
        assert.equal(current!.lifecycle.active, true);
        const manager = runtime.session.sessionManager;
        const entry = manager.appendMessage({ role: "user", content: "fork target", timestamp: Date.now() });
        await runtime.fork(entry, { position: "at" });
        await runtime.importFromJsonl(validFile);
        assert.ok(order.includes("shutdown:resume")); assert.ok(order.includes("shutdown:fork"));
        const newest = current!;
        await newest.execute("bash", { command: "printf LAST_FACTORY" });
        await runtime.dispose();
        assert.equal(newest.lifecycle.phase, "closed");
        assert.ok(order.includes("shutdown:quit"));
        assert.equal(initial.messages.length, 0);
        assert.equal(newest.messages.length, 0);
    } finally {
        for (const h of activations) await h.lifecycle.shutdown();
        if (oldLogDir === undefined) delete process.env.PROCESS_TASKS_LOG_DIR;
        else process.env.PROCESS_TASKS_LOG_DIR = oldLogDir;
        if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR; else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
        rmSync(dir, { recursive: true, force: true });
    }
});

void it("actual SDK AgentSession.reload invokes old shutdown before activation rebuild (typed offline services)", async () => {
    const { AgentSession } = await import("@earendil-works/pi-coding-agent");
    const { processActivation } = await import("../../process-tasks/__tests__/process-harness.ts");
    const dir = mkdtempSync(join(tmpdir(), "task-sdk-reload-"));
    const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
    process.env.PI_CODING_AGENT_DIR = join(dir, "agent");
    let agentStops = 0;
    function bothActivation() {
        const backend = processActivation(dir);
        const callbacks = new Map<string, (event: unknown, ctx: ExtensionContext) => Promise<unknown>>();
        const pi = { registerTool(tool: { name: string }) { backend.tools.set(tool.name, tool as unknown as ReturnType<typeof processActivation>["tools"] extends Map<string, infer T> ? T : never); },
            registerCommand() {}, registerMessageRenderer() {}, registerEntryRenderer() {}, registerFlag() {},
            getFlag: () => undefined, getAllTools: () => [], getActiveTools: () => [], appendEntry() {}, sendMessage() {},
            events: { emit() {}, on() { return () => {}; } }, on(name: string, callback: (event: unknown, ctx: ExtensionContext) => Promise<unknown>) { callbacks.set(name, callback); },
        } as unknown as ExtensionAPI;
        agentTasks(pi, { coordinator: backend.coordinator, lifecycle: backend.lifecycle, managerDependencies: {
            runAgent: async (_ctx, _type, _prompt, options) => {
                const session = { messages: [], sessionManager: { getSessionFile: () => undefined }, subscribe: () => () => {}, dispose() {} } as unknown as AgentSession;
                options.onSessionCreated?.(session);
                return await new Promise<RunResult>(resolve => { options.signal?.addEventListener("abort", () => { agentStops++; resolve({ session, responseText: "stopped", aborted: true, steered: false }); }, { once: true }); });
            },
        } });
        Object.assign(backend.context, { sessionManager: SessionManager.inMemory(dir), modelRegistry: {}, mode: "print" });
        void callbacks.get("session_start")?.({}, backend.context);
        return backend;
    }
    const old = bothActivation();
    let fresh: ReturnType<typeof processActivation> | undefined;
    const order: string[] = [];
    const runner = { getFlagValues: () => new Map<string, boolean | string>(), hasHandlers: () => true,
        async emit(event: SessionShutdownEvent) { order.push(event.reason); await old.lifecycle.shutdown(); },
        invalidate() { order.push("invalidate"); },
    };
    // Minimal services for the ACTUAL reload method; no copied setter/lifecycle implementation.
    // Private host fields make a single boundary cast necessary here.
    const seam = {
        _extensionRunner: runner, _usesDefaultTools: false, _pendingToolNames: new Set<string>(),
        settingsManager: { async reload() {} }, _resourceLoader: { async reload() {} },
        syncQueueModesFromSettings() {}, getActiveToolNames: () => [],
        _buildRuntime() { order.push("create"); fresh = bothActivation(); },
    };
    try {
        await old.execute("bash", { run_in_background: true, command: "tail -f /dev/null" });
        const pid = [...old.reg.jobs.values()][0]!.pid;
        await old.execute("subagent_run", { subagent_type: "general-purpose", description: "reload", prompt: "offline", run_in_background: true });
        await AgentSession.prototype.reload.call(seam as unknown as AgentSession);
        assert.deepEqual(order, ["reload", "invalidate", "create"]);
        assert.equal(processExists(pid), false); assert.equal(agentStops, 1);
        assert.match((await old.execute("process_manage", { action: "output", task_id: "old" })).content[0].text!, /closed/);
        await assert.rejects(old.execute("bash", { command: "echo old" }), /closed/);
        assert.ok(fresh); assert.equal(fresh.reg.totalStarted, 0);
        await fresh.execute("bash", { command: "printf FRESH_RELOAD" });
    } finally { await old.lifecycle.shutdown(); await fresh?.lifecycle.shutdown();
        if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR; else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
        rmSync(dir, { recursive: true, force: true }); }
});
