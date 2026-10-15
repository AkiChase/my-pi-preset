import assert from "node:assert/strict";
import { it } from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createAssistantMessageEventStream, type Model } from "@earendil-works/pi-ai";
import { createAgentSession, DefaultResourceLoader, ModelRuntime, SessionManager, SettingsManager } from "@earendil-works/pi-coding-agent";
import { buildMaterial } from "../../shared/material.ts";
import register, { MATERIAL_BUDGET, STATE_TYPE } from "../index.ts";
import { TITLE_PROMPT } from "../title.ts";
import { reply, flush } from "./harness.ts";

const textOf = (content: unknown) => typeof content === "string" ? content :
    (content as { type: string; text?: string }[]).filter(part => part.type === "text").map(part => part.text).join("");
type Session = Awaited<ReturnType<typeof createAgentSession>>["session"];

/** Offline actual AgentSession with a scripted provider; naming calls are recognised by their system prompt. */
async function withSession(test: (session: Session, naming: { content: string; material: string }[], calls: () => number) => Promise<void>) {
    const directory = mkdtempSync(join(tmpdir(), "name-sdk-session-"));
    const previous = process.env.PI_CODING_AGENT_DIR;
    process.env.PI_CODING_AGENT_DIR = directory;
    let session: Session | undefined;
    let calls = 0;
    const naming: { content: string; material: string }[] = [];
    try {
        const runtime = await ModelRuntime.create({ authPath: join(directory, "auth.json"), modelsPath: null,
            modelsStorePath: join(directory, "models-store.json"), refreshOnCreate: false, allowModelNetwork: false });
        runtime.registerProvider("name-fixture", { api: "openai-responses", baseUrl: "http://offline.invalid", apiKey: "offline",
            models: [{ id: "fixture", name: "Fixture", reasoning: true, input: ["text"], contextWindow: 400_000, maxTokens: 8192,
                cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } }],
            streamSimple: (_model, context, options) => {
                calls++;
                // The SDK delivers the request system prompt as a leading system message.
                const [system, user] = context.messages as { role: string; content: unknown }[];
                const isNaming = system?.role === "system" && system.content === TITLE_PROMPT;
                if (isNaming) naming.push({ content: textOf(user?.content), material: buildMaterial(session!.sessionManager, MATERIAL_BUDGET).text });
                const stream = createAssistantMessageEventStream();
                queueMicrotask(() => {
                    assert.equal(options?.reasoning, "high");
                    const message = { ...reply(isNaming ? `Fixture title ${naming.length}` : "Main reply"), provider: "name-fixture", model: "fixture" };
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
        await test(session, naming, () => calls);
    } finally {
        session?.dispose();
        if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR; else process.env.PI_CODING_AGENT_DIR = previous;
        rmSync(directory, { recursive: true, force: true });
    }
}

it("actual AgentSession names once directly from shared material and protects native rename", async () => {
    await withSession(async (session, naming, calls) => {
        await session.prompt("Name this work"); await flush();
        assert.equal(calls(), 2);
        assert.equal(naming.length, 1);
        assert.equal(naming[0].content, naming[0].material);
        assert.match(naming[0].content, /^User: Name this work\nAssistant: Main reply$/);
        assert.equal(session.sessionManager.getSessionName(), "Fixture title 1");
        session.setSessionName("Manual native title"); await flush();
        for (let n = 0; n < 10; n++) { await session.prompt(`Continue ${n}`); await flush(); }
        assert.equal(naming.length, 1);
        assert.equal(calls(), 12);
        assert.equal(session.sessionManager.getSessionName(), "Manual native title");
    });
});

it("actual AgentSession keeps the two-request quota across tree navigation", async () => {
    await withSession(async (session, naming) => {
        await session.prompt("First goal"); await flush();
        assert.equal(naming.length, 1);
        const answer = session.sessionManager.getEntries().find(entry => entry.type === "message" && entry.message.role === "assistant")!;
        const result = await session.navigateTree(answer.id);
        assert.equal(result.cancelled, false);
        assert.equal(session.sessionManager.getBranch().some(entry => entry.type === "custom" && entry.customType === STATE_TYPE), false);
        for (let n = 0; n < 7; n++) { await session.prompt(`Branch input ${n}`); await flush(); }
        assert.equal(naming.length, 1);
        await session.prompt("Ninth input"); await flush();
        assert.equal(naming.length, 2);
        assert.equal(naming[1].content, naming[1].material);
        assert.doesNotMatch(naming[1].content, /Fixture title/);
        assert.equal(session.sessionManager.getSessionName(), "Fixture title 2");
        for (let n = 0; n < 12; n++) { await session.prompt(`Later ${n}`); await flush(); }
        assert.equal(naming.length, 2);
    });
});
