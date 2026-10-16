import registerWidgetDisplay from "../../../shared/widget-display/owner.ts";
import { createWidgetClient } from "../../../shared/widget-display/client.ts";
import assert from "node:assert/strict";
import { it, mock } from "node:test";
import { mkdtempSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createAssistantMessageEventStream, type AssistantMessage, type Context, type SimpleStreamOptions } from "@earendil-works/pi-ai";
import { AgentSessionRuntime, createAgentSession, DefaultResourceLoader, ModelRuntime, SessionManager, SettingsManager, type ExtensionAPI, type ExtensionContext, type ExtensionEvent, type ExtensionUIContext, type Theme } from "@earendil-works/pi-coding-agent";
import type { Component, TUI } from "@earendil-works/pi-tui";
import type { TestContext } from "node:test";
import register, { STATE_TYPE } from "../index.ts";
import { RECAP_PROMPT } from "../output.ts";
import { buildMaterial } from "../../shared/material.ts";
import { deferred, FakeClock, flush, reply } from "./harness.ts";

async function sdkHarness(t: TestContext, options: { initial?: boolean; automatic?: boolean; thinking?: string; extra?: (pi: ExtensionAPI) => void; rpc?: boolean; tui?: boolean; persisted?: boolean; retry?: boolean; config?: Record<string, unknown> } = {}) {
    const directory = mkdtempSync(join(tmpdir(), "recap-actual-sdk-"));
    const clock = new FakeClock();
    writeFileSync(join(directory, "recap.json"), JSON.stringify({ model: "recap-sdk/fixture", thinking: options.thinking ?? "high", automatic: options.automatic ?? true, ...options.config }));
    const runtime = await ModelRuntime.create({ authPath: join(directory, "auth.json"), modelsPath: null, modelsStorePath: join(directory, "models-store.json"), refreshOnCreate: false, allowModelNetwork: false });
    const calls: { kind: "recap" | "main"; model: string; context: Context; options?: SimpleStreamOptions }[] = [];
    const recapStreams: ReturnType<typeof createAssistantMessageEventStream>[] = [];
    let mainGate: Promise<void> | undefined;
    let mainReason: AssistantMessage["stopReason"] = "stop";
    let mainFailures = options.retry ? 1 : 0;
    let recapException: Error | undefined;
    runtime.registerProvider("recap-sdk", { api: "openai-responses", baseUrl: "http://offline.invalid", apiKey: "offline",
        models: ["fixture", "next"].map(id => ({ id, name: "Fixture", reasoning: true, input: ["text"], contextWindow: 400000, maxTokens: 8192, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, thinkingLevelMap: { minimal: null, max: null } })),
        streamSimple: (_model, context, streamOptions) => {
            const first = context.messages[0];
            const kind = first?.role === "system" && first.content === RECAP_PROMPT ? "recap" : "main";
            calls.push({ kind, model: _model.id, context, options: streamOptions });
            const stream = createAssistantMessageEventStream();
            if (kind === "recap") { if (recapException) throw recapException; recapStreams.push(stream); return stream; }
            const gate = mainGate;
            void (async () => {
                if (gate) await gate;
                const failed = mainFailures-- > 0;
                const reason = failed ? "error" : mainReason;
                const message = { ...reply("Actual main reply"), provider: "recap-sdk", model: "fixture", stopReason: reason, ...(failed ? { errorMessage: "429 Too many requests" } : {}) };
                if (reason === "stop") { stream.push({ type: "start", partial: { ...message, content: [] } }); stream.push({ type: "text_delta", contentIndex: 0, delta: "Actual main reply", partial: message }); stream.push({ type: "done", reason: "stop", message }); }
                else stream.push({ type: "error", reason: "error", error: message });
                stream.end(message);
            })();
            return stream;
        } });
    const settings = SettingsManager.inMemory({ compaction: { enabled: false, reserveTokens: 10, keepRecentTokens: 10 }, retry: { enabled: options.retry ?? false, baseDelayMs: 1, maxRetries: 1 }, cacheWarming: "off" });
    let ctx!: ExtensionContext;
    const events: { name: string; idle: boolean; aborted?: boolean }[] = [];
    const loader = new DefaultResourceLoader({ cwd: directory, agentDir: directory, settingsManager: settings, noExtensions: true, noSkills: true, noThemes: true, noPromptTemplates: true, noContextFiles: true,
        extensionFactories: [registerWidgetDisplay, pi => { register(pi, { clock, directory: () => directory });
            const observe = (event: ExtensionEvent, context: ExtensionContext) => { ctx = context; events.push({ name: event.type, idle: context.isIdle(), aborted: "aborted" in event ? event.aborted : undefined }); };
            pi.on("session_start", observe); pi.on("input", observe); pi.on("before_agent_start", observe); pi.on("agent_start", observe);
            pi.on("agent_end", observe); pi.on("agent_settled", observe); pi.on("session_before_tree", observe); pi.on("session_tree", observe);
            pi.on("session_compact", observe); pi.on("session_compact_failed", observe);
            options.extra?.(pi);
        }], systemPrompt: "Offline main fixture" });
    await loader.reload();
    const manager = options.persisted ? SessionManager.create(directory, join(directory, "sessions")) : SessionManager.inMemory(directory);
    if (options.initial) { manager.appendMessage({ role: "user", content: "older goal ".repeat(100), timestamp: 1 }); manager.appendMessage(reply("older state")); manager.appendMessage({ role: "user", content: "new goal ".repeat(100), timestamp: 2 }); manager.appendMessage(reply("new state")); }
    const created = await createAgentSession({ cwd: directory, agentDir: directory, resourceLoader: loader, settingsManager: settings, modelRuntime: runtime, model: runtime.getModel("recap-sdk", "fixture"), thinkingLevel: "off", sessionManager: manager, noTools: "all" });
    const session = created.session;
    const notices: string[] = []; const widgets: unknown[] = [];
    const selections: (string | undefined | Promise<string | undefined>)[] = [];
    const inputs: (string | undefined)[] = [];
    const titles: string[] = []; const placeholders: string[] = []; const menus: string[][] = [];
    let currentWidget: Component | undefined;
    const mounted = new Map<string, Component>();
    let onWidget: (() => void) | undefined; let onDispose: (() => void) | undefined;
    const sinkTheme = { fg: (_color: string, text: string) => text } as unknown as Theme;
    const ui = { notify: (text: string) => { notices.push(text); }, select: async (title: string, options: string[]) => { titles.push(title); menus.push(options); return await selections.shift(); },
        input: async (_title: string, placeholder: string) => { placeholders.push(placeholder); return inputs.shift(); },
        setWidget: (key: string, content: Parameters<ExtensionUIContext["setWidget"]>[1]) => {
            widgets.push(content);
            // Actual SDK TUI order: dispose/remove old, call content factory, then install replacement.
            const previous = mounted.get(key) as (Component & { dispose?(): void }) | undefined;
            mounted.delete(key); previous?.dispose?.();
            if (key === "preset.widgets.aboveEditor") { onDispose?.(); currentWidget = undefined; }
            let component: Component | undefined;
            if (typeof content === "function") { component = content({ requestRender() { onWidget?.(); } } as unknown as TUI, sinkTheme); onWidget?.(); }
            if (component) mounted.set(key, component);
            if (key === "preset.widgets.aboveEditor") currentWidget = component;
        } } as unknown as ExtensionUIContext;
    const commandContextActions = { waitForIdle: () => session.waitForIdle(),
        newSession: async () => { throw new Error("Unexpected command newSession"); }, fork: async () => { throw new Error("Unexpected command fork"); },
        navigateTree: async () => { throw new Error("Unexpected command navigateTree"); }, switchSession: async () => { throw new Error("Unexpected command switchSession"); },
        reload: async () => { throw new Error("Unexpected command reload"); } };
    await session.bindExtensions(options.rpc || options.tui ? { mode: options.tui ? "tui" : "rpc", uiContext: ui, commandContextActions } : { mode: "print", commandContextActions });
    const services = { cwd: directory, agentDir: directory, modelRuntime: runtime, settingsManager: settings, resourceLoader: loader, diagnostics: [] };
    const sessionRuntime = new AgentSessionRuntime(session, services, async () => { throw new Error("Unexpected session replacement"); });
    t.after(async () => { await sessionRuntime.dispose(); await flush(); rmSync(directory, { recursive: true, force: true }); });
    return { directory, clock, calls, recapStreams, manager, session, sessionRuntime, events, notices, widgets, selections, inputs, titles, placeholders, menus, get ctx() { return ctx; },
        mounted, get currentWidget() { return currentWidget; }, setOnWidget(value: (() => void) | undefined) { onWidget = value; }, setOnDispose(value: (() => void) | undefined) { onDispose = value; },
        setGate(value: Promise<void> | undefined) { mainGate = value; }, setException(value: Error | undefined) { recapException = value; }, setReason(value: AssistantMessage["stopReason"]) { mainReason = value; },
        finishRecap(index = recapStreams.length - 1, message = reply("Actual recap")) { const stream = recapStreams[index]; const value = { ...message, provider: "recap-sdk", model: "fixture" };
            if (value.stopReason === "stop") stream.push({ type: "done", reason: "stop", message: value }); else stream.push({ type: "error", reason: "error", error: value }); stream.end(value); },
    };
}

it("actual SDK normal boundary starts full delay and literal request retains configured model/thinking without tools/cache patches", async t => {
    const h = await sdkHarness(t); await h.session.prompt("用户目标"); await h.clock.tick(299999); assert.equal(h.recapStreams.length, 0);
    assert.equal(h.events.find(e => e.name === "agent_end")?.idle, false); assert.equal(h.events.find(e => e.name === "agent_settled")?.idle, true);
    await h.clock.tick(1); assert.equal(h.recapStreams.length, 1);
    const call = h.calls.at(-1)!; assert.equal(call.kind, "recap"); assert.match(String(call.context.messages[1].content), /^User: 用户目标/);
    assert.equal(call.context.tools, undefined); assert.equal(call.options?.reasoning, "high"); assert.equal(call.options?.maxTokens, undefined); assert.equal(call.options?.cacheRetention, undefined); assert.equal(call.options?.timeoutMs, 120000);
    h.finishRecap(); await flush(); assert.equal(h.manager.getBranch().filter(e => e.type === "custom" && e.customType === STATE_TYPE).length, 1);
    assert.equal(h.manager.buildSessionProjection().messages.some(m => m.role === "custom"), false);
    await h.clock.tick(600000); assert.equal(h.recapStreams.length, 1);
});
it("actual SDK abort settled is ineligible; handled/rejected input and cancelled tree/fork/switch remain paused", async t => {
    let cancelNavigation = true;
    const h = await sdkHarness(t, { initial: true, automatic: false, extra: pi => {
        pi.on("input", event => event.text === "handled" ? { action: "handled" } : undefined);
        pi.on("session_before_tree", () => cancelNavigation ? { cancel: true } : undefined);
        pi.on("session_before_fork", () => ({ cancel: true })); pi.on("session_before_switch", () => ({ cancel: true }));
    } });
    // Establish automatic configuration through the real command boundary.
    writeFileSync(join(h.directory, "recap.json"), '{"model":"recap-sdk/fixture","thinking":"high","automatic":true}');
    // Successful tree starts restoration, which is subsequently cancelled by normal input.
    cancelNavigation = false; const target = h.manager.getBranch().find(e => e.type === "message" && e.message.role === "assistant")!; await h.session.navigateTree(target.id); cancelNavigation = true;
    const gate = deferred<void>(); h.setGate(gate.promise); const run = h.session.prompt("abort"); await flush();
    const abort = h.session.abort(); h.setReason("aborted"); gate.resolve(); await Promise.all([run, abort]); h.setGate(undefined); h.setReason("stop");
    assert.equal(h.events.filter(e => e.name === "agent_settled").at(-1)?.aborted, true); await h.clock.tick(600000); assert.equal(h.recapStreams.length, 0);
    await h.session.prompt("normal"); await h.session.prompt("handled"); await h.clock.tick(600000); assert.equal(h.recapStreams.length, 0);
    await h.session.prompt("normal again"); await h.session.navigateTree(target.id); await h.clock.tick(600000); assert.equal(h.recapStreams.length, 0);
    await h.session.prompt("normal fork"); await h.sessionRuntime.fork(target.id); await h.clock.tick(600000); assert.equal(h.recapStreams.length, 0);
    await h.session.prompt("normal switch"); await h.sessionRuntime.switchSession(join(h.directory, "missing.jsonl")); await h.clock.tick(600000); assert.equal(h.recapStreams.length, 0);
    await h.session.prompt("next normal"); await h.clock.tick(300000); assert.equal(h.recapStreams.length, 1); h.finishRecap(); await flush();
});
it("actual SDK manual compact success-before-cleanup gets one full delayed check; cancel/fail do not retry attempted material", async t => {
    let cancel = false;
    const h = await sdkHarness(t, { initial: true, extra: pi => pi.on("session_before_compact", event => cancel ? { cancel: true } : { compaction: { summary: "Compacted target", firstKeptEntryId: event.preparation.firstKeptEntryId, tokensBefore: event.preparation.tokensBefore } }) });
    await h.clock.tick(0); h.finishRecap(); await flush();
    await h.session.compact(); assert.equal(h.events.find(e => e.name === "session_compact")?.idle, false);
    await h.clock.tick(299999); assert.equal(h.recapStreams.length, 1); await h.clock.tick(1); assert.equal(h.recapStreams.length, 2); h.finishRecap(); await flush();
    cancel = true; await assert.rejects(h.session.compact(), /Nothing to compact \(session too small\)/); assert.equal(h.events.filter(e => e.name === "session_compact_failed").at(-1)?.aborted, false);
    await h.clock.tick(600000); assert.equal(h.recapStreams.length, 2);
});
it("actual SDK queued continuation/retry cannot create multiple windows and background continuation cancels late recap", async t => {
    const h = await sdkHarness(t, { retry: true });
    await h.session.followUp("queued while idle"); assert.equal(h.ctx.hasPendingMessages(), true);
    await h.session.prompt("normal with retry"); assert.ok(h.calls.filter(c => c.kind === "main").length >= 2);
    await h.clock.tick(300000); assert.equal(h.recapStreams.length, 1);
    const stale = h.recapStreams[0]; const continuation = h.session.prompt("notification continuation"); await continuation;
    assert.equal(h.calls.filter(c => c.kind === "recap")[0].options?.signal?.aborted, true);
    const message = { ...reply("stale"), provider: "recap-sdk", model: "fixture" }; stale.push({ type: "done", reason: "stop", message }); stale.end(message); await flush();
    assert.equal(h.manager.getBranch().filter(e => e.type === "custom" && e.customType === STATE_TYPE).length, 0);
    await h.clock.tick(300000); assert.equal(h.recapStreams.length, 2); h.finishRecap(); await flush();
});
it("actual SDK passive model-visible material fences results while own/name metadata is neutral; RPC errors reveal safe cause", async t => {
    const h = await sdkHarness(t, { initial: true, rpc: true }); await h.clock.tick(0);
    await h.session.sendCustomMessage({ customType: "passive", content: "passively changed context", display: false }, { triggerTurn: false });
    h.finishRecap(); await flush(); assert.equal(h.manager.getBranch().filter(e => e.type === "custom" && e.customType === STATE_TYPE).length, 0);
    const manual = h.session.prompt("/recap"); await flush(); assert.equal(h.recapStreams.length, 2); h.session.setSessionName("neutral metadata");
    h.finishRecap(1, { ...reply(), stopReason: "error", errorMessage: "Unsupported reasoning; api_key=secretvalue" }); await manual;
    assert.match(h.notices.at(-1)!, /Unsupported reasoning/); assert.doesNotMatch(h.notices.at(-1)!, /secretvalue/); assert.match(h.notices.at(-1)!, /No recap was saved/);
    const success = h.session.prompt("/recap"); await flush(); h.finishRecap(); await success;
    assert.equal(h.manager.getBranch().filter(e => e.type === "custom" && e.customType === STATE_TYPE).length, 1); assert.equal(h.widgets.length, 0);
    assert.match(h.notices.at(-1)!, /Recap: Actual recap/);
});
it("actual SDK config bypasses input, cancels late dialog writes, and explicit off remains undefined reasoning", async t => {
    const h = await sdkHarness(t, { rpc: true, thinking: "off" });
    await h.session.prompt("goal"); const inputs = h.events.filter(e => e.name === "input").length;
    h.selections.push("Toggle automatic"); await h.session.prompt("/recap config"); assert.equal(h.events.filter(e => e.name === "input").length, inputs);
    await h.clock.tick(600000); assert.equal(h.recapStreams.length, 0);
    const manual = h.session.prompt("/recap"); await flush(); assert.equal(h.calls.at(-1)?.options?.reasoning, undefined); h.finishRecap(); await manual;
    const selection = deferred<string | undefined>(); h.selections.push(selection.promise); const config = h.session.prompt("/recap config"); await flush();
    await h.session.prompt("new input"); selection.resolve("Toggle automatic"); await config;
    assert.equal(JSON.parse((await import("node:fs")).readFileSync(join(h.directory, "recap.json"), "utf8")).automatic, false);
});
it("actual SDK restore valid state automatic-off never calls model; stale branch restoration uses current projection only", async t => {
    const h = await sdkHarness(t, { initial: true, automatic: false });
    const material = buildMaterial(h.manager, 32000); h.manager.appendCustomEntry(STATE_TYPE, { version: 1, text: "saved valid", material: material.identity });
    h.session.setSessionName("neutral");
    const target = h.manager.getLeafId()!; await h.session.navigateTree(target); await h.clock.tick(0);
    assert.equal(h.recapStreams.length, 0); assert.equal(h.widgets.length, 0);
    const command = h.session.prompt("/recap"); await flush(); assert.equal(h.recapStreams.length, 1); h.finishRecap(); await command;
});

it("actual SDK returned/throw/timeout errors preserve old saved recap and cancel late results", async t => {
    const h = await sdkHarness(t, { initial: true, rpc: true }); await h.clock.tick(0); h.finishRecap(); await flush();
    await h.session.prompt("new goal"); h.setException(new Error("Provider overloaded; Authorization: Bearer secretvalue"));
    await h.clock.tick(300000); assert.match(h.notices.at(-1)!, /Provider overloaded/); assert.doesNotMatch(h.notices.at(-1)!, /secretvalue/);
    assert.match(h.notices.at(-1)!, /Saved recap was not overwritten/); await h.clock.tick(600000); assert.equal(h.recapStreams.length, 1);
    h.setException(undefined); await h.session.prompt("another goal");
    mock.timers.enable({ apis: ["setTimeout"] });
    try {
        await h.clock.tick(300000); assert.equal(h.recapStreams.length, 2); mock.timers.tick(120000); await flush();
        assert.match(h.notices.at(-1)!, /Request timed out.*Saved recap was not overwritten/); h.finishRecap(1, reply("late timed")); await flush();
        assert.equal(h.manager.getBranch().filter(e => e.type === "custom" && e.customType === STATE_TYPE).length, 1);
    } finally { mock.timers.reset(); }
});
it("actual SDK compact cancellation after before hook and unresolved later handler have only one delayed check", async t => {
    let cancel = true; const gate = deferred<void>();
    const h = await sdkHarness(t, { initial: true, extra: pi => {
        pi.on("session_before_compact", event => cancel ? { cancel: true } : { compaction: { summary: "compact goal", firstKeptEntryId: event.preparation.firstKeptEntryId, tokensBefore: event.preparation.tokensBefore } });
        pi.on("session_compact", async () => await gate.promise);
    } });
    await h.clock.tick(0); h.finishRecap(); await flush(); await assert.rejects(h.session.compact(), /cancelled/);
    assert.equal(h.events.filter(e => e.name === "session_compact_failed").at(-1)?.aborted, true); await h.clock.tick(300000); assert.equal(h.recapStreams.length, 1);
    cancel = false; const compact = h.session.compact(); await flush(); await h.clock.tick(300000); assert.equal(h.recapStreams.length, 1);
    gate.resolve(); await compact; await h.clock.tick(600000); assert.equal(h.recapStreams.length, 1);
});
it("actual SDK nextTurn asides are not current projection or public pending; next normal run invalidates old context", async t => {
    const h = await sdkHarness(t, { initial: true }); await h.clock.tick(0);
    await h.session.sendCustomMessage({ customType: "aside", content: "future nextTurn", display: false }, { triggerTurn: false, deliverAs: "nextTurn" });
    assert.equal(h.ctx.hasPendingMessages(), false);
    assert.equal(h.manager.buildSessionProjection().messages.some(m => m.role === "custom" && m.customType === "aside"), false);
    h.finishRecap(0); await flush(); assert.equal(h.manager.getBranch().filter(e => e.type === "custom" && e.customType === STATE_TYPE).length, 1);
    await h.session.prompt("next normal"); await h.clock.tick(300000); assert.equal(h.recapStreams.length, 2); h.finishRecap(1); await flush();
});
it("actual SDK late factory/update publication is revoked after same-material handled input for new, restored and auto-cached display", async t => {
    for (const source of ["new", "restore", "auto"] as const) {
        const h = await sdkHarness(t, { initial: true, automatic: false, tui: true, extra: pi => pi.on("input", event => event.text === "handled" ? { action: "handled" } : undefined) });
        let identity = buildMaterial(h.manager, 32000).identity;
        if (source !== "new") {
            const command = h.session.prompt("/recap"); await flush(); h.finishRecap(); await command;
        }
        let injected: Promise<void> | undefined;
        const inject = () => { h.setOnWidget(undefined); h.setOnDispose(undefined); injected = h.session.prompt("handled"); };
        if (source === "new") h.setOnWidget(inject);
        if (source === "new") {
            const command = h.session.prompt("/recap"); await flush(); h.finishRecap(); await command;
        } else if (source === "restore") {
            const target = h.manager.getLeafId()!; h.manager.appendSessionInfo("neutral before restore");
            await h.session.navigateTree(target); h.setOnWidget(inject); await h.clock.tick(0);
        } else {
            h.selections.push("Toggle automatic"); await h.session.prompt("/recap config");
            await h.session.prompt("next normal window");
            identity = buildMaterial(h.manager, 32000).identity;
            h.manager.appendCustomEntry(STATE_TYPE, { version: 1, text: "auto cached", material: identity });
            h.setOnWidget(inject); await h.clock.tick(300000);
        }
        await injected; await flush();
        assert.equal(buildMaterial(h.manager, 32000).identity, identity, source);
        assert.equal(h.currentWidget, undefined, source);
        assert.equal(h.recapStreams.length, 1, source);
    }
});
it("actual SDK nested restored publication remains owned when the outer late setter returns", async t => {
    const h = await sdkHarness(t, { initial: true, automatic: false, tui: true });
    const first = h.session.prompt("/recap"); await flush(); h.finishRecap(0, reply("older display")); await first;
    const manager = h.manager; let nested: Promise<void> | undefined;
    h.setOnWidget(() => {
        h.setOnWidget(undefined);
        const current = buildMaterial(manager, 32000);
        const target = manager.appendCustomEntry(STATE_TYPE, { version: 1, text: "newer owned", material: current.identity });
        manager.appendSessionInfo("neutral force navigation");
        nested = h.session.navigateTree(target).then(() => h.clock.tick(0));
    });
    const command = h.session.prompt("/recap"); await flush(); h.finishRecap(1, reply("outer display")); await command; await nested; await flush();
    assert.match(h.currentWidget!.render(120).join("\n"), /newer owned/);
});
it("actual SDK manual waiter releases on handled input before main idle without aborting main agent", async t => {
    const h = await sdkHarness(t, { automatic: false, rpc: true, extra: pi => pi.on("input", event => event.text === "handled" ? { action: "handled" } : undefined) });
    const gate = deferred<void>(); h.setGate(gate.promise); const run = h.session.prompt("held main"); await flush();
    let completed = false; const manual = h.session.prompt("/recap").then(() => { completed = true; }); await flush();
    await h.session.prompt("handled"); await flush();
    assert.equal(completed, true); assert.equal(h.session.isIdle, false); assert.equal(h.recapStreams.length, 0);
    assert.equal(h.calls.find(call => call.kind === "main")?.options?.signal?.aborted, false);
    gate.resolve(); await run; await manual;
});
it("actual SDK namespace context_edit invalidates in-flight result and qualified text keeps evidence", async t => {
    const h = await sdkHarness(t, { initial: true, automatic: false, rpc: true });
    const target = h.manager.appendMessage({ ...reply(), content: [{ type: "toolCall", id: "c", name: "read", namespace: "production", arguments: { path: "state" } }] });
    const before = buildMaterial(h.manager, 32000); const command = h.session.prompt("/recap"); await flush();
    assert.match(String(h.calls.at(-1)!.context.messages[1].content), /Tool call production\.read:/);
    h.manager.appendContextEdit(target, { content: [{ type: "toolCall", id: "c", name: "read", namespace: "staging", arguments: { path: "state" } }] });
    assert.notEqual(buildMaterial(h.manager, 32000).identity, before.identity);
    h.finishRecap(); await command;
    assert.equal(h.manager.getBranch().filter(entry => entry.type === "custom" && entry.customType === STATE_TYPE).length, 0);
});
it("actual SDK config titles/issues/model labels are single-line bounded and invalid model controls never reach requests", async t => {
    const h = await sdkHarness(t, { initial: true, automatic: false, rpc: true, config: { model: "recap-sdk/fixture\x1b]0;unsafe\x07\u202e" } });
    await h.session.prompt("/recap config"); await h.session.prompt("/recap"); assert.equal(h.recapStreams.length, 0);
    const long = "recap-sdk/" + "😀".repeat(1000);
    writeFileSync(join(h.directory, "recap.json"), JSON.stringify({ model: long, thinking: "off", automatic: false }));
    h.selections.push("Set model", undefined); await h.session.prompt("/recap config");
    for (const text of [...h.titles, ...h.menus.flat()]) { assert.doesNotMatch(text, /[\x00-\x1f\x7f-\x9f\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/u); assert.ok(Array.from(text).length <= 800); }
    assert.equal(h.placeholders.length, 0); assert.match(h.titles.at(-2)!, /…/);
    assert.equal(JSON.parse(readFileSync(join(h.directory, "recap.json"), "utf8")).model, long);
});
it("actual SDK EISDIR append leaves history intact but unconfirmed recap cannot be restored or auto-reused in this activation", async t => {
    const h = await sdkHarness(t, { initial: true, automatic: false, persisted: true, tui: true });
    const first = h.session.prompt("/recap"); await flush(); h.finishRecap(0, reply("prior confirmed")); await first;
    const prior = h.manager.getBranch().findLast(entry => entry.type === "custom" && entry.customType === STATE_TYPE)!;
    const path = h.manager.getSessionFile()!; const disk = readFileSync(path, "utf8");
    const command = h.session.prompt("/recap"); await flush(); renameSync(path, `${path}.backup`); mkdirSync(path);
    h.finishRecap(1, reply("unconfirmed refresh")); await command;
    const states = h.manager.getBranch().filter(entry => entry.type === "custom" && entry.customType === STATE_TYPE);
    assert.equal(states.length, 2); assert.equal(states[0].id, prior.id); assert.equal((states.at(-1) as typeof prior & { data: { text: string } }).data.text, "unconfirmed refresh");
    assert.equal(readFileSync(`${path}.backup`, "utf8"), disk);
    assert.match(h.notices.at(-1)!, /persistence failed:.*EISDIR.*Persistence not confirmed; in-memory state may have changed/);
    assert.doesNotMatch(h.notices.at(-1)!, /Saved recap was not overwritten/); assert.equal(h.currentWidget, undefined);
    // Test fixture repairs only its own path so navigation may persist; product never rolls back history.
    rmSync(path, { recursive: true }); renameSync(`${path}.backup`, path);
    h.manager.appendSessionInfo("neutral force restore"); await h.session.navigateTree(states.at(-1)!.id); await h.clock.tick(0);
    assert.match(h.currentWidget!.render(120).join("\n"), /prior confirmed/); assert.doesNotMatch(h.currentWidget!.render(120).join("\n"), /unconfirmed/);
    assert.equal(h.recapStreams.length, 2);
    const manual = h.session.prompt("/recap"); await flush(); assert.equal(h.recapStreams.length, 3); h.finishRecap(2, reply("confirmed refresh")); await manual;
    assert.match(h.currentWidget!.render(120).join("\n"), /confirmed refresh/);
});
it("actual SDK model menu links missing thinking atomically and filters supported levels", async t => {
    const h = await sdkHarness(t, { rpc: true, automatic: false, config: { thinking: null, unknown: true } });
    const path = join(h.directory, "recap.json"); const before = readFileSync(path, "utf8");
    const selection = deferred<string | undefined>();
    h.selections.push("Set model", "2. recap-sdk/next", selection.promise);
    const command = h.session.prompt("/recap config"); await flush();
    assert.deepEqual(h.menus[1], ["1. recap-sdk/fixture", "2. recap-sdk/next"]);
    assert.deepEqual(h.menus[2], ["off", "low", "medium", "high"]);
    assert.equal(readFileSync(path, "utf8"), before); assert.equal(h.placeholders.length, 0);
    selection.resolve("off"); await command;
    assert.deepEqual(JSON.parse(readFileSync(path, "utf8")), { model: "recap-sdk/next", thinking: "off", automatic: false, unknown: true });
    await h.session.prompt("goal"); const manual = h.session.prompt("/recap"); await flush();
    assert.equal(h.calls.at(-1)!.model, "next"); assert.equal(h.calls.at(-1)!.options?.reasoning, undefined); h.finishRecap(); await manual;
});

it("actual SDK sequential explicit refresh consumes new configured model while concurrent commands fence older request", async t => {
    const h = await sdkHarness(t, { initial: true, automatic: false, rpc: true });
    const first = h.session.prompt("/recap"); await flush(); h.finishRecap(); await first;
    h.selections.push("Set model", "2. recap-sdk/next"); await h.session.prompt("/recap config");
    const second = h.session.prompt("/recap"); await flush(); assert.equal(h.calls.at(-1)!.model, "next");
    const third = h.session.prompt("/recap"); await flush(); assert.equal(h.recapStreams.length, 3); assert.equal(h.calls.filter(call => call.kind === "recap")[1].options?.signal?.aborted, true);
    h.finishRecap(1, reply("stale replaced")); h.finishRecap(2, reply("explicit latest")); await Promise.all([second, third]);
    const states = h.manager.getBranch().filter(entry => entry.type === "custom" && entry.customType === STATE_TYPE);
    assert.equal(states.length, 2); assert.match(h.notices.at(-1)!, /explicit latest/);
});

it("actual SDK Recap arriving after a peer slot keeps fixed order, peer identity and third-party widgets", async t => {
    let peer!: ReturnType<typeof createWidgetClient>;
    let creates = 0, disposes = 0;
    const h = await sdkHarness(t, { initial: true, automatic: false, tui: true, extra: pi => {
        peer = createWidgetClient(pi, "trellis");
        pi.on("session_start", (_event, ctx) => {
            peer.set(ctx, () => { creates++; return { render: () => ["Peer task"], invalidate() {}, dispose() { disposes++; } }; });
        });
    } });
    const thirdParty = { render: () => ["external"], invalidate() {} };
    const writes: string[] = [];
    const original = h.ctx.ui.setWidget;
    h.ctx.ui.setWidget = (key, content, options) => { writes.push(key); if (typeof content === "function") original(key, content, options); else original(key, content, options); };
    h.ctx.ui.setWidget("external.widget", () => thirdParty);
    writes.length = 0;
    let command = h.session.prompt("/recap"); await flush(); h.finishRecap(0, reply("first recap")); await command;
    assert.match(h.currentWidget!.render(120).join("\n"), /first recap[\s\S]*Peer task/);
    assert.equal(creates, 1); assert.equal(disposes, 0);
    command = h.session.prompt("/recap"); await flush(); h.finishRecap(1, reply("refreshed recap")); await command;
    assert.match(h.currentWidget!.render(120).join("\n"), /refreshed recap[\s\S]*Peer task/);
    assert.equal(creates, 1); assert.equal(disposes, 0);
    peer.set(h.ctx, ["Updated task"]);
    assert.match(h.currentWidget!.render(120).join("\n"), /refreshed recap[\s\S]*Updated task/);
    peer.set(h.ctx, undefined);
    assert.match(h.currentWidget!.render(120).join("\n"), /refreshed recap/);
    assert.doesNotMatch(h.currentWidget!.render(120).join("\n"), /task/);
    assert.deepEqual(writes, [], "updating slots never republishes the composite or external widgets");
    assert.equal(h.mounted.get("external.widget"), thirdParty);
});
