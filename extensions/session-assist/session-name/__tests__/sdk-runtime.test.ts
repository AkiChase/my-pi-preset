import assert from "node:assert/strict";
import { it } from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createAssistantMessageEventStream, type Model } from "@earendil-works/pi-ai";
import { createAgentSession, DefaultResourceLoader, ModelRuntime, SessionManager, SettingsManager } from "@earendil-works/pi-coding-agent";
import register from "../index.ts";
import { reply, flush } from "./harness.ts";

it("actual AgentSession input/message/settled/name flow generates once and protects native rename", async () => {
    const directory = mkdtempSync(join(tmpdir(), "name-sdk-session-"));
    const previous = process.env.PI_CODING_AGENT_DIR;
    process.env.PI_CODING_AGENT_DIR = directory;
    let session: Awaited<ReturnType<typeof createAgentSession>>["session"] | undefined;
    let calls = 0;
    try {
        const runtime = await ModelRuntime.create({ authPath: join(directory, "auth.json"), modelsPath: null,
            modelsStorePath: join(directory, "models-store.json"), refreshOnCreate: false, allowModelNetwork: false });
        runtime.registerProvider("name-fixture", { api: "openai-responses", baseUrl: "http://offline.invalid", apiKey: "offline",
            models: [{ id: "fixture", name: "Fixture", reasoning: true, input: ["text"], contextWindow: 400_000, maxTokens: 8192,
                cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } }],
            streamSimple: (_model, _context, options) => {
                calls++;
                const stream = createAssistantMessageEventStream();
                queueMicrotask(() => {
                    assert.equal(options?.reasoning, "high");
                    const message = { ...reply(calls === 1 ? "Main reply" : "Fixture title"), provider: "name-fixture", model: "fixture" };
                    stream.push({ type: "done", reason: "stop", message });
                    stream.end(message);
                });
                return stream;
            },
        });
        const model = runtime.getModel("name-fixture", "fixture") as Model<"openai-responses">;
        assert.ok(model);
        const settings = SettingsManager.inMemory({ compaction: { enabled: false }, retry: { enabled: false } });
        const loader = new DefaultResourceLoader({ cwd: directory, agentDir: directory, settingsManager: settings,
            noExtensions: true, noSkills: true, noThemes: true, noPromptTemplates: true, noContextFiles: true,
            extensionFactories: [register], systemPrompt: "Offline fixture" });
        await loader.reload();
        const created = await createAgentSession({ cwd: directory, agentDir: directory, resourceLoader: loader,
            settingsManager: settings, modelRuntime: runtime, model, thinkingLevel: "high", sessionManager: SessionManager.inMemory(directory), noTools: "all" });
        session = created.session;
        await session.bindExtensions({ mode: "print" });
        await session.prompt("Name this work"); await flush();
        assert.equal(calls, 2);
        assert.equal(session.sessionManager.getSessionName(), "Fixture title");
        session.setSessionName("Manual native title"); await flush();
        await session.prompt("Continue"); await flush();
        assert.equal(calls, 3);
        assert.equal(session.sessionManager.getSessionName(), "Manual native title");
    } finally {
        session?.dispose();
        if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR; else process.env.PI_CODING_AGENT_DIR = previous;
        rmSync(directory, { recursive: true, force: true });
    }
});
