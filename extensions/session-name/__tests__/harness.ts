import { SessionManager, type ExtensionAPI, type ExtensionContext, type ExtensionCommandContext, type RegisteredCommand } from "@earendil-works/pi-coding-agent";
import type { AssistantMessage, UserMessage } from "@earendil-works/pi-ai";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { TestContext } from "node:test";
import register from "../index.ts";

export function reply(text = "New title"): AssistantMessage {
    return { role: "assistant", api: "openai-responses", provider: "fake", model: "fake", content: [{ type: "text", text }], timestamp: 1,
        stopReason: "stop", usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } };
}
export async function flush(): Promise<void> { await new Promise<void>(resolve => setImmediate(resolve)); }
export function harness(t: TestContext, options: { existing?: string; synchronousNameEvent?: boolean; reentrantSameName?: boolean } = {}) {
    const directory = mkdtempSync(join(tmpdir(), "name-runtime-"));
    const previous = process.env.PI_CODING_AGENT_DIR;
    process.env.PI_CODING_AGENT_DIR = directory;
    t.after(() => { if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR; else process.env.PI_CODING_AGENT_DIR = previous; rmSync(directory, { recursive: true, force: true }); });
    const manager = SessionManager.inMemory();
    if (options.existing) manager.appendSessionInfo(options.existing);
    const handlers = new Map<string, ((event: unknown, ctx: ExtensionContext) => unknown)[]>();
    const commands = new Map<string, RegisteredCommand>();
    const notices: string[] = [];
    const requests: { data: unknown; signal: AbortSignal | undefined; resolve: (value: AssistantMessage) => void; reject: (value: Error) => void }[] = [];
    let selection: string | undefined;
    let input: string | undefined;
    const emit = async (name: string, event: unknown = {}) => {
        for (const handler of handlers.get(name) ?? []) await handler(event, ctx);
    };
    // Typed partial public host seam: production sees only ExtensionAPI methods implemented here.
    const pi = {
        on(name: string, handler: (event: unknown, context: ExtensionContext) => unknown) {
            const list = handlers.get(name) ?? []; list.push(handler); handlers.set(name, list);
            return () => { const index = list.indexOf(handler); if (index >= 0) list.splice(index, 1); };
        },
        registerCommand(name: string, command: RegisteredCommand) { commands.set(name, command); },
        appendEntry(name: string, data: unknown) { manager.appendCustomEntry(name, data); },
        getThinkingLevel: () => "high",
        setSessionName(name: string) {
            manager.appendSessionInfo(name);
            if (options.reentrantSameName) manager.appendSessionInfo(name);
            if (options.synchronousNameEvent) void emit("session_info_changed", { name });
            else queueMicrotask(() => { void emit("session_info_changed", { name }); });
        },
    } as unknown as ExtensionAPI;
    const ctx = {
        sessionManager: manager, model: { id: "fake", provider: "fake", api: "openai-responses" },
        modelRegistry: { streamSimple(_model: unknown, context: { messages: UserMessage[] }, options: { signal?: AbortSignal }) {
            let resolve!: (value: AssistantMessage) => void;
            let reject!: (value: Error) => void;
            const promise = new Promise<AssistantMessage>((res, rej) => { resolve = res; reject = rej; });
            requests.push({ data: JSON.parse(String(context.messages[0].content)), signal: options.signal, resolve, reject });
            return { result: () => promise };
        } },
        hasUI: true, mode: "tui", isIdle: () => true,
        ui: { notify(text: string) { notices.push(text); }, select: async () => selection, input: async () => input },
        waitForIdle: async () => {},
    } as unknown as ExtensionCommandContext;
    register(pi);
    t.after(async () => { await emit("session_shutdown"); await flush(); });
    return { manager, requests, notices, emit, ctx, pi, directory,
        start: () => emit("session_start"),
        async user(text: string, source = "interactive", deliver = true) {
            await emit("input", { text, source });
            if (deliver) manager.appendMessage({ role: "user", content: text, timestamp: Date.now() });
        },
        settled: (aborted = false) => emit("agent_settled", { aborted }),
        command: (args = "") => commands.get("session-name")!.handler(args, ctx),
        choose(value: string | undefined, raw?: string) { selection = value; input = raw; },
        async externalName(name: string) { manager.appendSessionInfo(name); await emit("session_info_changed", { name }); },
    };
}
