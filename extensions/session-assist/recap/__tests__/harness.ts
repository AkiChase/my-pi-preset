import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { AssistantMessage, Model, UserMessage } from "@earendil-works/pi-ai";
import { SessionManager, type ExtensionAPI, type ExtensionContext, type ExtensionCommandContext, type ExtensionEvent, type RegisteredCommand } from "@earendil-works/pi-coding-agent";
import type { TestContext } from "node:test";
import register, { type RecapClock } from "../index.ts";

export function reply(text = "目标是修复问题，已定位原因，下一步验证。"): AssistantMessage {
    return { role: "assistant", api: "openai-responses", provider: "fixture", model: "model", content: [{ type: "text", text }], timestamp: 1,
        stopReason: "stop", usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } };
}
export async function flush(): Promise<void> { await new Promise<void>(resolve => setImmediate(resolve)); }
export function deferred<T>() { let resolve!: (value: T) => void; let reject!: (error: Error) => void;
    const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; }); return { promise, resolve, reject }; }
export class FakeClock implements RecapClock {
    time = 0; created = 0; private next = 0;
    timers = new Map<number, { callback: () => void; due: number }>();
    now() { return this.time; }
    set(callback: () => void, delay: number) { const key = ++this.next; this.created++; this.timers.set(key, { callback, due: this.time + delay }); return key; }
    clear(timer: unknown) { this.timers.delete(timer as number); }
    async tick(ms: number) {
        this.time += ms;
        for (const [key, timer] of [...this.timers]) if (timer.due <= this.time && this.timers.delete(key)) timer.callback();
        await flush();
    }
}
export function harness(t: TestContext, options: { initial?: boolean; config?: Record<string, unknown>; hasUI?: boolean; mode?: "tui" | "rpc" | "print" } = {}) {
    const directory = mkdtempSync(join(tmpdir(), "recap-runtime-"));
    writeFileSync(join(directory, "recap.json"), JSON.stringify(options.config ?? { model: "fixture/model", thinking: "high" }));
    const manager = SessionManager.inMemory(directory);
    if (options.initial) manager.appendMessage({ role: "user", content: "恢复目标", timestamp: 1 });
    const handlers = new Map<string, ((event: ExtensionEvent, ctx: ExtensionContext) => unknown)[]>();
    const commands = new Map<string, RegisteredCommand>();
    const clock = new FakeClock();
    const notices: string[] = [];
    const widgets: (unknown | undefined)[] = [];
    const menus: { title: string; options: string[] }[] = [];
    const selections: (string | undefined | Promise<string | undefined>)[] = [];
    const inputs: (string | undefined | Promise<string | undefined>)[] = [];
    const requests: { context: { systemPrompt?: string; messages: UserMessage[] }; options: { reasoning?: string; signal?: AbortSignal; timeoutMs?: number }; resolve: (value: AssistantMessage) => void; reject: (error: Error) => void }[] = [];
    let idle = true; let pending = false; let auth = true; let available = true;
    let wait = Promise.resolve();
    let onAppend: (() => void) | undefined; let onWidget: (() => void) | undefined;
    const model: Model<"openai-responses"> = { provider: "fixture", id: "model", api: "openai-responses", name: "Fixture", baseUrl: "http://offline.invalid", reasoning: true,
        input: ["text"], contextWindow: 100000, maxTokens: 8192, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, thinkingLevelMap: { minimal: null, max: null, xhigh: null } };
    const pi = {
        on(name: string, handler: (event: ExtensionEvent, ctx: ExtensionContext) => unknown) { const list = handlers.get(name) ?? []; list.push(handler); handlers.set(name, list); return () => {}; },
        registerCommand(name: string, command: RegisteredCommand) { commands.set(name, command); },
        appendEntry(name: string, data: unknown) { manager.appendCustomEntry(name, data); onAppend?.(); },
    } as unknown as ExtensionAPI;
    const models = [model];
    const registry = {
        getAvailable() { return available && auth ? models : []; },
        find(provider: string, id: string) { return available ? models.find(model => provider === model.provider && id === model.id) : undefined; },
        hasConfiguredAuth() { return auth; },
        streamSimple(_model: unknown, context: { systemPrompt?: string; messages: UserMessage[] }, options: { signal?: AbortSignal; reasoning?: string; timeoutMs?: number }) {
            const d = deferred<AssistantMessage>(); requests.push({ context, options, resolve: d.resolve, reject: d.reject }); return { result: () => d.promise };
        },
    } as unknown as ExtensionContext["modelRegistry"];
    const ctx = { sessionManager: manager, model, modelRegistry: registry, mode: options.mode ?? "tui", hasUI: options.hasUI ?? true,
        isIdle: () => idle, hasPendingMessages: () => pending, waitForIdle: () => wait,
        ui: { notify(text: string) { notices.push(text); }, setWidget(_key: string, content: unknown) { widgets.push(content); onWidget?.(); },
            select: async (title: string, options: string[]) => { menus.push({ title, options }); return await selections.shift(); }, input: async () => await inputs.shift() },
    } as unknown as ExtensionCommandContext;
    register(pi, { clock, directory: () => directory });
    const emit = async (name: string, event: Record<string, unknown> = {}) => { for (const handler of handlers.get(name) ?? []) await handler({ type: name, ...event } as ExtensionEvent, ctx); };
    t.after(async () => { await emit("session_shutdown"); await flush(); rmSync(directory, { recursive: true, force: true }); });
    return { directory, manager, clock, requests, notices, widgets, selections, inputs, menus, models, ctx, emit, model,
        start: () => emit("session_start"), command: (args = "") => commands.get("recap")!.handler(args, ctx),
        async user(text = "修复目标") { await emit("input", { text, source: "interactive" }); manager.appendMessage({ role: "user", content: text, timestamp: 1 }); },
        async run() { idle = false; await emit("before_agent_start"); await emit("agent_start"); },
        async settled(aborted = false) { idle = true; await emit("agent_settled", { aborted }); },
        setIdle(value: boolean) { idle = value; }, setPending(value: boolean) { pending = value; }, setAuth(value: boolean) { auth = value; }, setAvailable(value: boolean) { available = value; },
        setWait(value: Promise<void>) { wait = value; }, setOnAppend(value: (() => void) | undefined) { onAppend = value; }, setOnWidget(value: (() => void) | undefined) { onWidget = value; },
    };
}
