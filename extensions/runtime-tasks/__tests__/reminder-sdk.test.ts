import assert from "node:assert/strict";
import { it } from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Type, createAssistantMessageEventStream, type AssistantMessage, type Model } from "@earendil-works/pi-ai";
import { createAgentSession, DefaultResourceLoader, ModelRuntime, SessionManager, SettingsManager, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { TaskCoordinator } from "../../task-ui/coordinator.ts";
import { TaskLifecycle } from "../../task-ui/lifecycle.ts";
import { taskKey, type TaskView } from "../../task-ui/types.ts";
import type { RuntimeTaskCapability } from "../facade.ts";
import { REMINDER_SYSTEM_RULE } from "../reminder.ts";
import { REMINDER_CUSTOM_TYPE, registerBackgroundReminder } from "../reminder-owner.ts";

type Session = Awaited<ReturnType<typeof createAgentSession>>["session"];
type Step = "text" | "tool" | "tools2";
interface Fixture { session: Session; requests: unknown[][]; plan: Step[]; tasks: TaskView[] }

const usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };
let toolIds = 0;
function respond(step: Step): AssistantMessage {
    const calls = step === "text" ? [] : Array.from({ length: step === "tools2" ? 2 : 1 }, () => ({ type: "toolCall" as const, id: `call-${++toolIds}`, name: "noop", arguments: {} }));
    return { role: "assistant", api: "openai-responses", provider: "reminder-fixture", model: "fixture", timestamp: Date.now(), usage,
        content: calls.length ? calls : [{ type: "text", text: "done" }], stopReason: calls.length ? "toolUse" : "stop" };
}
const shell = (id: string): TaskView => {
    const identity = { sourceId: "process", taskId: id, runId: id };
    return { ...identity, key: taskKey(identity), kind: "shell", title: "secret command", reminderTitle: "full-tests", status: "running", executionMode: "background",
        waitCount: 0, startedAt: Date.now(), stats: {}, artifacts: [], capabilities: { stop: true, details: true } };
};

async function withSession(interval: number, test: (f: Fixture) => Promise<void>) {
    const directory = mkdtempSync(join(tmpdir(), "reminder-sdk-"));
    const previous = process.env.PI_CODING_AGENT_DIR;
    process.env.PI_CODING_AGENT_DIR = directory;
    const lifecycle = new TaskLifecycle(new TaskCoordinator());
    const requests: unknown[][] = [], plan: Step[] = [], tasks: TaskView[] = [shell("b1")];
    const capability: RuntimeTaskCapability = { list: () => tasks.map(view => ({ view, manageable: true, rawStatus: view.status })), execute: async () => { throw new Error("reminder must not execute tools"); } };
    let session: Session | undefined;
    try {
        const runtime = await ModelRuntime.create({ authPath: join(directory, "auth.json"), modelsPath: null,
            modelsStorePath: join(directory, "models-store.json"), refreshOnCreate: false, allowModelNetwork: false });
        runtime.registerProvider("reminder-fixture", { api: "openai-responses", baseUrl: "http://offline.invalid", apiKey: "offline",
            models: [{ id: "fixture", name: "Fixture", reasoning: false, input: ["text"], contextWindow: 400_000, maxTokens: 8192, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } }],
            streamSimple: (_model, context) => {
                requests.push(structuredClone(context.messages));
                const stream = createAssistantMessageEventStream();
                const message = respond(plan.shift() ?? "text");
                queueMicrotask(() => { stream.push({ type: "done", reason: message.stopReason === "toolUse" ? "toolUse" : "stop", message }); stream.end(message); });
                return stream;
            },
        });
        const model = runtime.getModel("reminder-fixture", "fixture") as Model<"openai-responses">;
        const factory = (pi: ExtensionAPI) => {
            pi.registerTool({ name: "noop", label: "noop", description: "No-op fixture tool", parameters: Type.Object({}),
                execute: async () => ({ content: [{ type: "text", text: "ok" }], details: undefined }) });
            pi.on("session_before_compact", (event) => ({ compaction: { summary: "Fixture summary", firstKeptEntryId: event.preparation.firstKeptEntryId, tokensBefore: 1 } }));
            registerBackgroundReminder(pi, { capabilities: () => [capability], lifecycle, interval });
        };
        const settings = SettingsManager.inMemory({ compaction: { enabled: false, keepRecentTokens: 1 }, retry: { enabled: false } });
        const loader = new DefaultResourceLoader({ cwd: directory, agentDir: directory, settingsManager: settings,
            noExtensions: true, noSkills: true, noThemes: true, noPromptTemplates: true, noContextFiles: true, extensionFactories: [factory], systemPrompt: "Offline fixture" });
        await loader.reload();
        const created = await createAgentSession({ cwd: directory, agentDir: directory, resourceLoader: loader, settingsManager: settings,
            modelRuntime: runtime, model, thinkingLevel: "off", sessionManager: SessionManager.inMemory(directory), noTools: "builtin" });
        session = created.session;
        await session.bindExtensions({ mode: "print" });
        await test({ session, requests, plan, tasks });
    } finally {
        session?.dispose();
        await lifecycle.shutdown();
        if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR; else process.env.PI_CODING_AGENT_DIR = previous;
        rmSync(directory, { recursive: true, force: true });
    }
}

const text = (message: unknown): string => {
    const content = (message as { content?: unknown }).content;
    return typeof content === "string" ? content : Array.isArray(content) ? content.map(part => (part as { text?: string }).text ?? "").join("") : "";
};
const isReminder = (message: unknown) => text(message).startsWith("<background-task-reminder>");
const reminderIndexes = (messages: unknown[]) => messages.flatMap((message, index) => isReminder(message) ? [index] : []);
const roles = (messages: unknown[]) => messages.map(message => (message as { role: string }).role);

void it("actual AgentSession appends hidden reminders before request 8 (tool continuation) and 16 (new user run) with stable prefixes", async () => {
    await withSession(8, async ({ session, requests, plan }) => {
        plan.push("tool", "tools2", "text"); // requests 1-3: two tool calls still count as one request
        await session.prompt("first");
        plan.push("tool", "tool", "tool", "tool", "text"); // requests 4-8; request 8 follows tool results
        await session.prompt("second");
        for (let n = 3; n <= 10; n++) await session.prompt(`input ${n}`); // requests 9-16
        assert.equal(requests.length, 16, "no extra model request");
        for (let n = 0; n < 7; n++) assert.deepEqual(reminderIndexes(requests[n]!), [], `request ${n + 1}`);
        const eighth = requests[7]!;
        const [at8] = reminderIndexes(eighth);
        assert.equal(at8, eighth.length - 1, "reminder is the final message before request 8");
        assert.equal(roles(eighth)[at8! - 1], "toolResult");
        assert.match(text(eighth[at8!]), /^<background-task-reminder>\nshell \| b1 \| full-tests \| \d+s\n<\/background-task-reminder>$/);
        assert.doesNotMatch(text(eighth[at8!]), /secret/);
        for (let n = 8; n < 15; n++) assert.deepEqual(reminderIndexes(requests[n]!), [at8], `request ${n + 1}`);
        const sixteenth = requests[15]!;
        const indexes = reminderIndexes(sixteenth);
        assert.equal(indexes.length, 2);
        assert.equal(indexes[1], sixteenth.length - 2, "reminder sits right before the new user message");
        assert.equal(text(sixteenth.at(-1)), "input 10");
        // Append-only: every request's input is a prefix of the next request's input.
        for (let n = 1; n < requests.length; n++) assert.deepEqual(requests[n]!.slice(0, requests[n - 1]!.length), requests[n - 1], `prefix ${n}`);
        assert.ok(JSON.stringify(requests[0]).includes(REMINDER_SYSTEM_RULE.split("\n")[0]!), "constant system rule present");
        const stored = session.sessionManager.getEntries().filter(entry => entry.type === "custom_message" && entry.customType === REMINDER_CUSTOM_TYPE);
        assert.equal(stored.length, 2);
        assert.ok(stored.every(entry => entry.type === "custom_message" && entry.display === false));
    });
});

void it("interval 1 reminds before the first request; no outstanding work appends nothing", async () => {
    await withSession(1, async ({ session, requests, tasks }) => {
        await session.prompt("hello");
        assert.equal(requests.length, 1);
        assert.deepEqual(roles(requests[0]!).slice(-2), ["user", "user"]);
        assert.equal(text(requests[0]!.at(-2)), "hello");
        assert.ok(isReminder(requests[0]!.at(-1)));
        tasks.length = 0;
        await session.prompt("again");
        await session.prompt("third");
        assert.equal(reminderIndexes(requests[2]!).length, reminderIndexes(requests[1]!).length, "nothing new without background work");
    });
});

void it("interval 0 disables periodic reminders but a successful compaction reminds the next request", async () => {
    await withSession(0, async ({ session, requests }) => {
        for (let n = 0; n < 4; n++) await session.prompt(`warmup ${n}`);
        assert.ok(requests.every(messages => reminderIndexes(messages).length === 0));
        await session.compact();
        await session.prompt("after compaction");
        const last = requests.at(-1)!;
        assert.equal(reminderIndexes(last).length, 1);
        assert.ok(isReminder(last.at(-1)));
        await session.prompt("later");
        assert.equal(reminderIndexes(requests.at(-1)!).length, 1, "compaction reminder is sent once");
    });
});
