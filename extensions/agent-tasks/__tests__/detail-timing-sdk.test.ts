import assert from "node:assert/strict";
import { it } from "node:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Type, createAssistantMessageEventStream, type AssistantMessage, type Model } from "@earendil-works/pi-ai";
import { createAgentSession, DefaultResourceLoader, ModelRuntime, SessionManager, SettingsManager, type ExtensionAPI, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import { stripTerminalSequences } from "@earendil-works/pi-tui";
import "./source-loader.mjs";
import { TaskCoordinator } from "../../task-ui/coordinator.ts";
import { TaskPanel } from "../../task-ui/panel.ts";
import { DEFAULTS } from "../../task-ui/config.ts";
import { loadNativeLayout } from "../../shared/scroll-panel/native-layout.ts";
const { AgentManager } = await import("../src/agent-manager.ts");
const { runAgent } = await import("../src/agent-runner.ts");
const { createAgentTaskSource } = await import("../src/source.ts");

function gate() {
    let resolve!: () => void;
    const promise = new Promise<void>(done => { resolve = done; });
    return { promise, resolve };
}
const usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };

void it("actual installed SDK runner/manager/source/panel carries independent real call durations through completion and resume", { timeout: 10_000 }, async () => {
    const dir = mkdtempSync(join(tmpdir(), "detail-timing-sdk-"));
    const previous = process.env.PI_CODING_AGENT_DIR;
    process.env.PI_CODING_AGENT_DIR = dir;
    const entered = gate(), first = gate(), second = gate();
    const coordinator = new TaskCoordinator();
    let panel: TaskPanel | undefined, manager: InstanceType<typeof AgentManager> | undefined;
    try {
        const runtime = await ModelRuntime.create({ authPath: join(dir, "auth.json"), modelsPath: null,
            modelsStorePath: join(dir, "models-store.json"), refreshOnCreate: false, allowModelNetwork: false });
        let request = 0, executing = 0;
        runtime.registerProvider("detail-fixture", { api: "openai-responses", baseUrl: "http://offline.invalid", apiKey: "offline",
            models: [{ id: "fixture", name: "Fixture", reasoning: false, input: ["text"], contextWindow: 400_000, maxTokens: 8192, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } }],
            streamSimple: () => {
                const stream = createAssistantMessageEventStream();
                const tools = ++request === 1;
                const message: AssistantMessage = { role: "assistant", api: "openai-responses", provider: "detail-fixture", model: "fixture", timestamp: Date.now(), usage,
                    content: tools ? ["one", "two"].map(id => ({ type: "toolCall", id, name: "noop", arguments: {} })) : [{ type: "text", text: "done" }], stopReason: tools ? "toolUse" : "stop" };
                queueMicrotask(() => { stream.push({ type: "done", reason: tools ? "toolUse" : "stop", message }); stream.end(message); });
                return stream;
            },
        });
        const model = runtime.getModel("detail-fixture", "fixture") as Model<"openai-responses">;
        const settings = SettingsManager.inMemory({ compaction: { enabled: false }, retry: { enabled: false } });
        const loader = new DefaultResourceLoader({ cwd: dir, agentDir: dir, settingsManager: settings, noExtensions: true,
            noSkills: true, noThemes: true, noPromptTemplates: true, noContextFiles: true, systemPrompt: "Offline fixture",
            extensionFactories: [pi => pi.registerTool({ name: "noop", label: "noop", description: "Offline gate", parameters: Type.Object({}),
                execute: async id => {
                    if (++executing === 2) entered.resolve();
                    await (id === "one" ? first : second).promise;
                    return { content: [{ type: "text", text: id }], details: undefined };
                } })],
        });
        await loader.reload();
        const sessionManager = SessionManager.create(dir, join(dir, "sessions"));
        const rootFile = join(dir, "root.jsonl"); writeFileSync(rootFile, "");
        const ctx = { cwd: dir, model, modelRegistry: { runtime }, getSystemPrompt: () => "",
            sessionManager: { getSessionFile: () => rootFile } } as unknown as ExtensionContext;
        manager = new AgentManager(undefined, 1, undefined, undefined, undefined, {
            runAgent: (context, type, prompt, options) => runAgent(context, type, prompt, options, {
                detectEnv: async () => ({ isGitRepo: false, branch: "", platform: "offline" }),
                createResourceLoader: () => loader,
                createAgentSession: () => createAgentSession({ cwd: dir, agentDir: dir, resourceLoader: loader, settingsManager: settings,
                    modelRuntime: runtime, model, thinkingLevel: "off", sessionManager, noTools: "builtin" }),
            }),
        });
        const source = createAgentTaskSource(manager, coordinator, new Map()); coordinator.registerSource(source);
        const id = manager.spawn({} as ExtensionAPI, ctx, "general-purpose", "test", { description: "timing", isolated: true, isBackground: true });
        await entered.promise;
        const row = source.list()[0]!;
        assert.deepEqual(row.stats.toolCalls?.map(c => [c.toolCallId, c.status]), [["one", "running"], ["two", "running"]]);
        panel = new TaskPanel({ coordinator, config: DEFAULTS, layout: await loadNativeLayout(), ctx: { ui: { notify() {} } } as unknown as ExtensionContext,
            theme: { fg: (_color, text) => text }, keys: { matches: () => false }, tui: { terminal: { columns: 120, rows: 30 }, requestRender() {} } as never, done() {} });
        panel.handleInput("\r"); assert.match(stripTerminalSequences(panel.render(120).join("\n")), /Running · elapsed/);
        first.resolve();
        // Await the actual SDK event, not a wall-clock guess or copy of the runner algorithm.
        const session = manager.getRecord(id)!.session!;
        await new Promise<void>(resolve => {
            const off = session.subscribe(event => { if (event.type === "tool_execution_end" && event.toolCallId === "one") { off(); resolve(); } });
        });
        assert.equal(source.list()[0]!.stats.toolCalls?.find(c => c.toolCallId === "one")?.status, "completed");
        assert.equal(source.list()[0]!.stats.toolCalls?.find(c => c.toolCallId === "two")?.status, "running");
        second.resolve(); await manager.waitForAll();
        const completed = source.list()[0]!;
        assert.equal(completed.status, "completed"); assert.equal(completed.stats.toolCalls?.length, 2);
        for (const call of completed.stats.toolCalls ?? []) {
            assert.ok(typeof call.durationMs === "number" && call.durationMs >= 0);
            const result = session.messages.find(m => m.role === "toolResult" && m.toolCallId === call.toolCallId);
            assert.equal(result?.role === "toolResult" ? result.durationMs : undefined, call.durationMs);
        }
        const out = stripTerminalSequences(panel.render(120).join("\n"));
        assert.match(out.split("\n")[0]!, /Completed/); assert.match(out, /Completed · execution/); assert.match(out, /Agent runtime/);
        assert.doesNotMatch(out, /Running · elapsed/);
        manager.resumeRun(id, "resume"); await manager.waitForAll();
        assert.deepEqual(source.list()[0]!.stats.toolCalls, []);
        assert.ok(session.messages.some(m => m.role === "toolResult" && m.durationMs !== undefined), "history retains evidenced host duration");
    } finally {
        first.resolve(); second.resolve(); panel?.dispose(); coordinator.dispose(); await manager?.dispose();
        if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR; else process.env.PI_CODING_AGENT_DIR = previous;
        rmSync(dir, { recursive: true, force: true });
    }
});
