/**
 * S2: subagent input admission and failure marking.
 *
 * Two halves. The first asserts against the real registered tool schemas through
 * the host's validator, so an enum keyword that does nothing cannot pass. The
 * second drives the real `execute` for the branches a schema cannot express —
 * blank values and `resume` conflicts — which are exactly the ones that used to
 * be accepted and then silently ignored.
 */
import "./source-loader.mjs";
import assert from "node:assert/strict";
import { it } from "node:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentSession, ExtensionAPI, ExtensionToolContext } from "@earendil-works/pi-coding-agent";
import { validateToolArguments } from "@earendil-works/pi-ai";
import { TaskCoordinator } from "../../task-ui/coordinator.ts";
import { TaskLifecycle } from "../../task-ui/lifecycle.ts";
import type { AgentManagerDependencies } from "../src/agent-manager.ts";
import type { RunResult } from "../src/agent-runner.ts";
import type { AgentRecord, NotificationDetails } from "../src/types.ts";
import { assertNonEmptyString } from "../src/spawn-input.ts";
import { THINKING_LEVELS, resolveAgentInvocationConfig, thinkingParam } from "../src/invocation-config.ts";

const { createNestedSubagentTools } = await import("../src/nested-tools.ts");
const { default: agentTasks } = await import("../src/index.ts");

function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((done) => { resolve = done; });
    return { promise, resolve };
}

/**
 * Minimal real registration: the extension's own `session_start` wiring, a stub
 * manager, and nothing else. Anything this file asserts about comes from the
 * real tool definitions, so a stubbed assertion would prove nothing.
 */
async function factory(settings: Record<string, unknown> = {}) {
    const root = mkdtempSync(join(tmpdir(), "agent-input-errors-"));
    const cwd = join(root, "cwd");
    const config = join(root, "agent");
    mkdirSync(cwd);
    mkdirSync(config);
    if (settings.customAgent) {
        mkdirSync(join(config, "agents"));
        writeFileSync(join(config, "agents", "custom.md"), "---\nname: custom\ndescription: Offline agent\n---\nDo work.\n");
    }
    writeFileSync(join(config, "agent-tasks.json"), JSON.stringify({ schedulingEnabled: false, ...settings }));
    const previous = process.env.PI_CODING_AGENT_DIR;
    process.env.PI_CODING_AGENT_DIR = config;

    const tools = new Map<string, Parameters<ExtensionAPI["registerTool"]>[0]>();
    const handlers = new Map<string, ((...args: unknown[]) => unknown)[]>();
    const bus = new Map<string, Set<(data: unknown) => void>>();
    const calls: AgentRecord[] = [];
    const deps: AgentManagerDependencies = {
        runAgent: async (_ctx, _type, _prompt, options) => {
            const result = deferred<RunResult>();
            const id = options.agentId!;
            calls.push({ id } as AgentRecord);
            options.signal?.addEventListener("abort", () => result.resolve({ session: {} as AgentSession, responseText: "stopped", aborted: true, steered: false }), { once: true });
            return result.promise;
        },
    };
    const events = {
        emit(name: string, data: unknown) {
            if (name === "subagents:created") calls.push({ id: (data as { id: string }).id } as AgentRecord);
            for (const fn of bus.get(name) ?? []) fn(data);
        },
        on(name: string, fn: (data: unknown) => void) {
            const set = bus.get(name) ?? new Set<(data: unknown) => void>();
            set.add(fn);
            bus.set(name, set);
            return () => { set.delete(fn); };
        },
    };
    const pi = {
        registerTool(tool: Parameters<ExtensionAPI["registerTool"]>[0]) { tools.set(tool.name, tool); },
        registerMessageRenderer() {}, registerEntryRenderer() {}, registerFlag() {}, registerCommand() {},
        on(name: string, handler: (...args: unknown[]) => unknown) {
            const list = handlers.get(name) ?? [];
            list.push(handler);
            handlers.set(name, list);
        },
        events,
        appendEntry() {},
        sendMessage(_message: { customType: string; content: unknown; details?: NotificationDetails }) {},
        exec: undefined,
        getFlag: () => undefined,
        getAllTools: () => [],
        getActiveTools: () => [],
    } as unknown as ExtensionAPI;

    const coordinator = new TaskCoordinator();
    // Passing a lifecycle makes this session the owner: the extension then does
    // not register `session_shutdown` itself, so this harness shuts the
    // lifecycle down explicitly in `close()`.
    const lifecycle = new TaskLifecycle(coordinator);
    agentTasks(pi, { coordinator, lifecycle, managerDependencies: deps });
    const ctx = {
        cwd,
        hasUI: false,
        mode: "print",
        ui: { setWidget() {}, setStatus() {}, notify() {} },
        sessionManager: { getSessionId: () => "input-errors", getBranch: () => [] },
        modelRegistry: {},
    } as unknown as ExtensionToolContext;
    await handlers.get("session_start")![0]!(undefined, ctx);

    const execute = (name: string, params: Record<string, unknown>) =>
        tools.get(name)!.execute("call", params, undefined, () => {}, ctx);
    const paramSchema = (name: string) => tools.get(name)!.parameters;

    return {
        root, cwd, config, tools, calls, ctx, paramSchema, execute,
        nested: () => createNestedSubagentTools({
            manager: {} as import("../src/nested-tools.ts").NestedAgentManager,
            pi: {} as ExtensionAPI, parentAgentId: "parent", depth: 1,
            maxSubagentDepth: 2, allowedSubagents: "all", configCwd: cwd,
        }),
        async close() {
            for (const handler of handlers.get("session_shutdown") ?? []) await handler();
            await lifecycle.shutdown();
            coordinator.dispose();
            if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR;
            else process.env.PI_CODING_AGENT_DIR = previous;
            rmSync(root, { recursive: true, force: true });
        },
    };
}

function text(result: { content: { type: string; text?: string }[] }): string {
    return result.content.filter((block) => block.type === "text").map((block) => block.text ?? "").join("\n");
}

function hostError(parameters: unknown, args: unknown): Error | undefined {
    try {
        validateToolArguments(
            { name: "subagent_run", description: "", parameters } as never,
            { id: "call", name: "subagent_run", arguments: args } as never
        );
        return undefined;
    } catch (err) {
        return err as Error;
    }
}

void it("thinking is a closed enum in both the root and nested schemas", async () => {
    const f = await factory();
    try {
        for (const [label, parameters] of [["root", f.paramSchema("subagent_run")], ["nested", f.nested()[0]!.parameters]] as const) {
            const schema = JSON.parse(JSON.stringify(parameters)) as { properties: Record<string, { enum?: string[] }> };
            assert.deepEqual(schema.properties.thinking?.enum, [...THINKING_LEVELS], `${label}: thinking must list every level`);
            // Optional: an enum that were required would break every call that
            // does not name a level.
            const required = (JSON.parse(JSON.stringify(parameters)) as { required?: string[] }).required ?? [];
            assert.ok(!required.includes("thinking"), `${label}: thinking must stay optional`);
        }
    } finally { await f.close(); }
});

void it("a misspelled thinking level is rejected by name instead of silently doing nothing", async () => {
    const f = await factory();
    try {
        for (const [label, parameters] of [["root", f.paramSchema("subagent_run")], ["nested", f.nested()[0]!.parameters]] as const) {
            const err = hostError(parameters, { subagent_type: "general-purpose", description: "x", prompt: "y", thinking: "hight" });
            assert.ok(err, `${label}: "hight" must be rejected`);
            // Previously this passed validation, was cast to ThinkingLevel, and the
            // run proceeded at the default level with no indication.
            assert.match(err.message, /thinking/);
        }
        assert.equal(hostError(f.paramSchema("subagent_run"), { subagent_type: "general-purpose", description: "x", prompt: "y", thinking: "high" }), undefined);
    } finally { await f.close(); }
});

void it("a blank prompt or description is refused before any agent is started", async () => {
    const f = await factory();
    try {
        // Thrown rather than returned as an error result: the host turns a throw
        // into `isError: true` with the message, and it stops the call at the
        // guard instead of threading a flag through the rest of execute().
        for (const [field, value] of [["prompt", "   "], ["description", "\n"]] as const) {
            await assert.rejects(
                () => f.execute("subagent_run", { subagent_type: "general-purpose", description: "ok", prompt: "ok", [field]: value }),
                new RegExp(`\`${field}\` must be a non-empty string`)
            );
        }
        assert.equal(f.calls.length, 0, "no run may start from a blank field");
    } finally { await f.close(); }
});

void it("resume refuses start-time parameters rather than accepting and ignoring them", async () => {
    const f = await factory();
    try {
        for (const [field, value] of [["model", "sonnet"], ["thinking", "minimal"], ["isolated", true], ["inherit_context", true], ["isolation", "worktree"]] as const) {
            const result = await f.execute("subagent_run", {
                subagent_type: "general-purpose", description: "resume", prompt: "continue",
                resume: "does-not-exist", [field]: value,
            });
            assert.equal((result as { isError?: boolean }).isError, true, `${field} must be refused with resume`);
            assert.match(text(result), new RegExp(field));
            assert.match(text(result), /resume/);
        }
        // A bare resume still reaches the ordinary lookup, so the conflict check
        // is not swallowing the path it is meant to protect.
        const plain = await f.execute("subagent_run", { subagent_type: "general-purpose", description: "resume", prompt: "continue", resume: "does-not-exist" });
        assert.equal((plain as { isError?: boolean }).isError, true);
        assert.match(text(plain), /not found/);
    } finally { await f.close(); }
});

void it("an unusable agent type fails closed as an error result", async () => {
    for (const type of ["NoSuchAgent", ""]) {
        const f = await factory({ fallbackSubagent: "none" });
        try {
            const result = await f.execute("subagent_run", { subagent_type: type, description: "x", prompt: "y" });
            assert.equal((result as { isError?: boolean }).isError, true, `type=${JSON.stringify(type)} must fail closed`);
            assert.equal(f.calls.length, 0, "nothing may spawn");
        } finally { await f.close(); }
    }
});

void it("the nested delegation tool marks a blank field as an error result rather than throwing", async () => {
    const f = await factory();
    try {
        const nested = f.nested()[0]!;
        const result = await nested.execute("call", { subagent_type: "general-purpose", description: "  ", prompt: "ok" }, undefined, () => {}, f.ctx);
        // A nested tool has no host loop to convert a throw; it returns the
        // message with `isError` so the parent agent sees a failed call.
        assert.equal((result as { isError?: boolean }).isError, true);
        assert.match(text(result as { content: { type: string; text?: string }[] }), /`description` must be a non-empty string/);
    } finally { await f.close(); }
});

void it("assertNonEmptyString separates a missing value from a blank one", () => {
    assert.throws(() => assertNonEmptyString(undefined, "`prompt`"), /`prompt` must be a string, got undefined/);
    assert.throws(() => assertNonEmptyString(7, "`prompt`"), /must be a string, got number/);
    assert.throws(() => assertNonEmptyString(" \t\n", "`prompt`"), /must be a non-empty string; it was blank/);
    assert.doesNotThrow(() => assertNonEmptyString("ok", "`prompt`"));
});

void it("thinkingParam is the single source shared by the root, nested and wizard lists", () => {
    assert.deepEqual(Object.keys(thinkingParam()), ["thinking"]);
    const schema = JSON.parse(JSON.stringify(thinkingParam().thinking)) as { enum?: string[]; description?: string };
    assert.deepEqual(schema.enum, [...THINKING_LEVELS]);
    for (const level of THINKING_LEVELS) assert.match(schema.description ?? "", new RegExp(level));
});

void it("a frontmatter override keeps the caller's own value visible in the effective config", () => {
    const config = { name: "pinned", description: "x", thinking: "high", model: "anthropic/claude-haiku-4-5" } as never;
    const resolved = resolveAgentInvocationConfig(config, { thinking: "minimal", model: "sonnet" });
    // Effective value wins; `overridden` carries what the caller asked for, which
    // is what the surfaces render as "(asked X)".
    assert.equal(resolved.thinking, "high");
    assert.equal(resolved.modelInput, "anthropic/claude-haiku-4-5");
    assert.deepEqual(resolved.overridden, { thinking: "minimal", model: "sonnet" });
    // Asked-for-what-they-got is not an override.
    assert.equal(resolveAgentInvocationConfig({ name: "pinned", description: "x", thinking: "high" } as never, { thinking: "high" }).overridden, undefined);
});
