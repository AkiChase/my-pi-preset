import { parseAgentToolArguments } from "../src/tool-contract.ts";
import { completeToolCall } from "./tool-inputs.ts";
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
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
const sdkEntry = fileURLToPath(import.meta.resolve("@earendil-works/pi-coding-agent"));
const { buildSystemPrompt } = await import(pathToFileURL(join(dirname(sdkEntry), "core/system-prompt.js")).href) as {
    buildSystemPrompt(options: { cwd: string; selectedTools: string[]; hiddenTools?: string[]; toolSnippets: Record<string, string>; toolGuidelines: Record<string, string[]> }): string;
};
import type { AgentSession, ExtensionAPI, ExtensionToolContext } from "@earendil-works/pi-coding-agent";
import { validateToolArguments } from "@earendil-works/pi-ai";
import { TaskCoordinator } from "../../task-ui/coordinator.ts";
import { TaskLifecycle } from "../../task-ui/lifecycle.ts";
import type { AgentManagerDependencies } from "../src/agent-manager.ts";
import type { RunResult } from "../src/agent-runner.ts";
import type { AgentRecord, NotificationDetails } from "../src/types.ts";
import { assertNonEmptyString } from "../src/spawn-input.ts";
import { THINKING_LEVELS, resolveAgentInvocationConfig, thinkingParam, formatInvocationOverrideNote } from "../src/invocation-config.ts";

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
async function factory(settings: Record<string, unknown> = {}, extra: AgentManagerDependencies = {}) {
    const root = mkdtempSync(join(tmpdir(), "agent-input-errors-"));
    const cwd = join(root, "cwd");
    const config = join(root, "agent");
    mkdirSync(cwd);
    mkdirSync(config);
    if (settings.testTemplate) writeFileSync(join(config, "agent-tool-description.md"), "OLD_CUSTOM_TEMPLATE");
    if (settings.customAgent) {
        mkdirSync(join(config, "agents"));
        writeFileSync(join(config, "agents", "custom.md"), typeof settings.customAgent === "string" ? settings.customAgent : "---\nname: custom\ndescription: Offline agent\n---\nDo work.\n");
    }
    writeFileSync(join(config, "agent-tasks.json"), JSON.stringify({ schedulingEnabled: false, worktreeIsolation: true, outputTranscript: false, rememberAgents: false, defaultJoinMode: "async", ...settings }));
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
        ...extra,
    };
    const eventNames: string[] = [];
    const events = {
        emit(name: string, data: unknown) {
            eventNames.push(name);
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
        tools.get(name)!.execute("call", completeToolCall(tools.get(name)!.parameters, params), undefined, () => {}, ctx);
    const paramSchema = (name: string) => tools.get(name)!.parameters;

    const registry = Reflect.get(globalThis, Symbol.for("pi-subagents:manager")) as { getRecord(id: string): AgentRecord | undefined };
    return {
        root, cwd, config, tools, calls, ctx, paramSchema, execute, registry, coordinator, eventNames,
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

function hostError(parameters: unknown, args: unknown, name = "subagent_run"): Error | undefined {
    try {
        validateToolArguments(
            { name, description: "", parameters } as never,
            { id: "call", name, arguments: completeToolCall(parameters as never, args as Record<string, unknown>) } as never
        );
        return undefined;
    } catch (err) {
        return err as Error;
    }
}

void it("actual registered Agent tools contribute one official SDK rule group and ignore old modes/templates", async () => {
    for (const backgroundByDefault of [false, true]) {
        const f = await factory({ backgroundByDefault, toolDescriptionMode: "custom", testTemplate: true, schedulingEnabled: false, worktreeIsolation: false });
        try {
            const definitions = [...f.tools.values()];
            const snippets = Object.fromEntries(definitions.map(tool => [tool.name, tool.promptSnippet ?? ""]));
            const guidelines = Object.fromEntries(definitions.map(tool => [tool.name, tool.promptGuidelines ?? []]));
            const selectedTools = definitions.map(tool => tool.name);
            const prompt = buildSystemPrompt({ cwd: f.cwd, selectedTools: [...selectedTools, "peer"], toolSnippets: { ...snippets, peer: "Peer index" }, toolGuidelines: { ...guidelines, peer: ["Peer guideline"] } });
            for (const heading of ["Subagent_run usage:", "Subagent_message usage:", "Subagent_workflow usage:"]) assert.equal(prompt.split(heading).length - 1, 1);
            assert.match(prompt, /set resume to null for a new agent/);
            assert.match(prompt, new RegExp(`execution defaults to ${backgroundByDefault ? "background" : "foreground"}`));
            assert.match(prompt, /Peer index/); assert.match(prompt, /Peer guideline/);
            assert.doesNotMatch(prompt, /OLD_CUSTOM_TEMPLATE|toolDescriptionMode|\{\{typeList\}\}/);
            assert.ok(definitions.every(tool => tool.description.length < 150));
            const props = Reflect.get(f.paramSchema("subagent_run"), "properties");
            assert.equal(Object.hasOwn(props, "schedule"), false); assert.equal(Object.hasOwn(props, "isolation"), false);
            const hidden = buildSystemPrompt({ cwd: f.cwd, selectedTools, hiddenTools: selectedTools, toolSnippets: snippets, toolGuidelines: guidelines });
            assert.doesNotMatch(hidden, /Subagent_run usage:|Subagent_message usage:|Subagent_workflow usage:/);
        } finally { await f.close(); }
    }
});

void it("thinking is a closed enum in both the root and nested schemas", async () => {
    const f = await factory();
    try {
        for (const [label, parameters] of [["root", f.paramSchema("subagent_run")], ["nested", f.nested()[0]!.parameters]] as const) {
            const schema = JSON.parse(JSON.stringify(parameters)) as { properties: Record<string, { enum?: string[] }> };
            assert.deepEqual((schema.properties.thinking as { anyOf: { enum?: string[] }[] }).anyOf[1]?.enum, [...THINKING_LEVELS], `${label}: thinking must list every level`);
            // Every exposed control is required and explicitly nullable.
            const required = (JSON.parse(JSON.stringify(parameters)) as { required: string[] }).required;
      assert.deepEqual([...required].sort(), Object.keys(schema.properties).sort(), "all wire fields are required");
      const complete = completeToolCall(parameters as never, { prompt: "work", description: "work", subagent_type: "general-purpose" });
      for (const field of required) {
        const missing = { ...complete }; delete missing[field];
        assert.throws(() => validateToolArguments({ name: "subagent_run", description: "", parameters } as never, { type: "toolCall", id: "missing", name: "subagent_run", arguments: missing as never }));
      }
            assert.ok(required.includes("thinking"), `${label}: thinking must be provided, using null for defaults`);
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
            const result = await f.execute("subagent_run", { subagent_type: "general-purpose", description: "ok", prompt: "ok", [field]: value });
            assert.equal(result.isError, true);
            assert.match(text(result), new RegExp(`\`${field}\` must be a non-empty string`));
        }
        assert.equal(f.calls.length, 0, "no run may start from a blank field");
    } finally { await f.close(); }
});

void it("blank resume placeholders are corrected before any root or nested manager lookup", async t => {
    const f = await factory();
    const { AgentManager } = await import("../src/agent-manager.ts");
    let lookups = 0;
    const original = AgentManager.prototype.getRecord;
    const mock = t.mock.method(AgentManager.prototype, "getRecord", function (this: InstanceType<typeof AgentManager>, id: string) {
        lookups++; return original.call(this, id);
    });
    const nested = createNestedSubagentTools({
        manager: {
            getRecord() { lookups++; return undefined; },
            async resume() { throw new Error("unexpected resume"); },
            spawn() { throw new Error("unexpected spawn"); },
            async awaitStartup() {},
            async spawnAndWait() { throw new Error("unexpected spawnAndWait"); },
        }, pi: {} as ExtensionAPI, parentAgentId: "parent", depth: 1, maxSubagentDepth: 2,
        allowedSubagents: "all", configCwd: f.cwd,
    })[0]!;
    try {
        for (const resume of ["", " \t\n"]) {
            const args = { prompt: "inspect", description: "Inspect", subagent_type: "general-purpose", resume };
            for (const result of [await f.execute("subagent_run", args), await nested.execute("bad", completeToolCall(nested.parameters, args as never), undefined, undefined, f.ctx)]) {
                assert.equal(result.isError, true);
                assert.match(text(result), /`resume` must be/);
                assert.match(text(result), /Set resume to null for a new agent/);
                assert.doesNotMatch(text(result), /Field 'description'/);
            }
        }
        assert.equal(lookups, 0);
        assert.equal(f.calls.length, 0);
        assert.equal(f.coordinator.list().length, 0);
    } finally { mock.mock.restore(); await f.close(); }
});

void it("actual host preserves required nullable null for tool admission and preserves legitimate values", async () => {
    const f = await factory();
    try {
        const tool = f.tools.get("subagent_run")!;
        const args = { prompt: "inspect", description: "Inspect", subagent_type: "general-purpose", resume: null, model: null, run_in_background: false, isolated: false };
        const validated = validateToolArguments(tool, { type: "toolCall", id: "host", name: tool.name, arguments: completeToolCall(tool.parameters, args) as never });
        assert.equal(validated.resume, null);
        assert.equal(validated.model, null);
        const admitted = parseAgentToolArguments(validated, { nested: false, isolation: true, scheduling: false });
        assert.equal(Object.hasOwn(admitted, "resume"), false);
        assert.equal(Object.hasOwn(admitted, "model"), false);
        assert.equal(validated.run_in_background, false);
        assert.equal(validated.isolated, false);
        assert.equal(args.resume, null, "host validation does not mutate the original payload");
        const empty = validateToolArguments(tool, { type: "toolCall", id: "host", name: tool.name, arguments: completeToolCall(tool.parameters, { ...args, resume: "" }) as never });
        assert.equal(empty.resume, "");
        const result = await f.execute(tool.name, empty);
        assert.equal(result.isError, true);
        assert.match(text(result), /Set resume to null/);
        const workflow = f.tools.get("subagent_workflow")!;
        const json = validateToolArguments(workflow, { type: "toolCall", id: "json", name: workflow.name, arguments: completeToolCall(workflow.parameters, { script: "return args", args: { nil: null, flag: false, index: 0, text: "" } }) as never });
        assert.deepEqual(json.args, { nil: null, flag: false, index: 0, text: "" });
        assert.equal(f.calls.length, 0);
    } finally { await f.close(); }
});

void it("resume refuses start-time parameters rather than accepting and ignoring them", async () => {
    const f = await factory();
    try {
        for (const [field, value] of [["model", "sonnet"], ["thinking", "minimal"], ["isolated", true], ["inherit_context", true], ["isolation", "worktree"]] as const) {
            const result = await f.execute("subagent_run", {
                prompt: "continue", resume: "does-not-exist", [field]: value,
            });
            assert.equal((result as { isError?: boolean }).isError, true, `${field} must be refused with resume`);
            assert.match(text(result), new RegExp(field));
            assert.match(text(result), /resume/);
        }
        // A bare resume still reaches the ordinary lookup, so the conflict check
        // is not swallowing the path it is meant to protect.
        const plain = await f.execute("subagent_run", { prompt: "continue", resume: "does-not-exist" });
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
        const result = await nested.execute("call", completeToolCall(nested.parameters, { subagent_type: "general-purpose", description: "  ", prompt: "ok" }), undefined, () => {}, f.ctx);
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
    assert.deepEqual((schema as { anyOf: { enum?: string[] }[] }).anyOf[1]?.enum, [...THINKING_LEVELS]);
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

void it("configuration retains boolean and isolation precedence and discloses false requests", () => {
    const resolved = resolveAgentInvocationConfig({ name: "pinned", description: "x", runInBackground: true, isolated: true, inheritContext: true, isolation: "off" } as never,
        { run_in_background: false, isolated: false, inherit_context: false, isolation: "worktree" });
    assert.equal(resolved.runInBackground, true); assert.equal(resolved.isolation, undefined);
    const note = formatInvocationOverrideNote({ runInBackground: resolved.runInBackground, isolated: resolved.isolated, inheritContext: resolved.inheritContext, isolation: resolved.isolation,
        requestedRunInBackground: resolved.overridden?.runInBackground, requestedIsolated: resolved.overridden?.isolated,
        requestedInheritContext: resolved.overridden?.inheritContext, requestedIsolation: resolved.overridden?.isolation });
    for (const field of ["run_in_background", "isolated", "inherit_context", "isolation"]) assert.match(note, new RegExp(field));
    assert.match(note, /requested false, effective true/); assert.match(note, /requested "worktree", effective "off"/);
});

void it("registered workflow rejects sources, removed fields and unsafe args before execution", async () => {
    const f = await factory();
    const script = "export const meta = { name: 'x', description: 'x' }; return args;";
    try {
        for (const params of [{}, { script, name: "x" }, { scriptPath: "missing", script }, { script: "" }, { script, title: "x" }, { script, description: "x" }, { script, args: { x: undefined } }, { script: script + "\u0000" }, { script: "bad meta" }]) {
            const result = await f.execute("subagent_workflow", params);
            assert.equal(result.isError, true);
            assert.equal(f.coordinator.list().length, 0); assert.equal(f.calls.length, 0);
        }
    } finally { await f.close(); }
});

void it("all five registered fixed schemas reject unknown fields through the host validator", async () => {
    const f = await factory();
    try {
        const nested = f.nested();
        const run = { subagent_type: "general-purpose", description: "work", prompt: "work" };
        const steering = { agent_id: "agent", message: "continue" };
        const cases = [
            [f.tools.get("subagent_run")!, run],
            [f.tools.get("subagent_workflow")!, { script: "export const meta = { name: 'x', description: 'x' }; return args;" }],
            [f.tools.get("subagent_message")!, steering],
            [nested[0]!, run], [nested[1]!, steering],
        ] as const;
        for (const [tool, args] of cases) {
            const err = hostError(tool.parameters, { ...args, misspelled_field: true }, tool.name);
            assert.ok(err, `${tool.name} must reject unknown fields`);
            assert.match(err.message, /misspelled_field/);
            assert.equal(hostError(tool.parameters, { ...args }, tool.name), undefined);
        }
        const args = { arbitrary: { model: "script-owned", strange_field: [null, 1, { extra: true }] } };
        assert.equal(hostError(f.paramSchema("subagent_workflow"), { script: "return args;", args }, "subagent_workflow"), undefined, "workflow args remain free-form JSON");
        assert.equal(f.calls.length, 0);
    } finally { await f.close(); }
});

void it("blank root steering is refused before lookup, events, queueing or session steer", async t => {
    const f = await factory();
    const { AgentManager } = await import("../src/agent-manager.ts");
    const getRecord = AgentManager.prototype.getRecord;
    let lookups = 0, steers = 0;
    try {
        await f.execute("subagent_run", { subagent_type: "general-purpose", description: "work", prompt: "work", run_in_background: true });
        const id = f.calls[0]!.id, record = f.registry.getRecord(id)!;
        const mock = t.mock.method(AgentManager.prototype, "getRecord", function (this: InstanceType<typeof AgentManager>, ref: string) {
            lookups++; return getRecord.call(this, ref);
        });
        for (const ready of [false, true]) {
            record.session = ready ? { async steer() { steers++; } } as unknown as AgentSession : undefined;
            const eventCount = f.eventNames.length;
            lookups = 0;
            for (const message of ["", "  \t\n", "\u3000"]) {
                const result = await f.execute("subagent_message", { agent_id: id, message });
                assert.equal(result.isError, true);
                assert.match(text(result), /`message` must be a non-empty string/);
            }
            assert.equal(lookups, 0);
            assert.equal(f.eventNames.length, eventCount);
            assert.equal(record.pendingSteers, undefined);
            assert.equal(steers, 0);
        }
        record.session = undefined;
        mock.mock.restore();
        for (const ref of [record.handle!, `exec_not_an_agent`, "unknown-name"]) {
            const result = await f.execute("subagent_message", { agent_id: ref, message: "continue" });
            assert.equal(result.isError, true); assert.equal(record.pendingSteers, undefined);
        }
        const queued = await f.execute("subagent_message", { agent_id: id, message: "continue" });
        assert.equal(queued.isError, undefined); assert.match(text(queued), /queued/);
        assert.deepEqual(record.pendingSteers, ["continue"]);
    } finally { await f.close(); }
});

void it("nested steering blanks and resume conflicts are refused before any manager effect", async () => {
    const f = await factory();
    let lookups = 0, resumes = 0, steers = 0;
    const record = { id: "owned", parentAgentId: "parent", status: "running" } as AgentRecord;
    const manager = {
        getRecord() { lookups++; return record; },
        async resume() { resumes++; return record; },
        spawn() { throw new Error("unexpected spawn"); },
        async awaitStartup() {},
        async spawnAndWait() { throw new Error("unexpected spawnAndWait"); },
    } satisfies import("../src/nested-tools.ts").NestedAgentManager;
    try {
        const [run, steer] = createNestedSubagentTools({ manager, pi: {} as ExtensionAPI, parentAgentId: "parent", depth: 1,
            maxSubagentDepth: 2, allowedSubagents: "all", configCwd: f.cwd });
        for (const ready of [false, true]) {
            record.session = ready ? { async steer() { steers++; } } as unknown as AgentSession : undefined;
            for (const message of ["", " \t\n", "\u3000"]) {
                const result = await steer!.execute("call", { agent_id: "owned", message }, undefined, undefined, f.ctx);
                assert.equal(result.isError, true);
                assert.match(text(result), /`message` must be a non-empty string/);
            }
        }
        const base = { prompt: "continue", resume: "owned" };
        for (const [key, value] of [["model", ""], ["thinking", "off"], ["isolated", false], ["inherit_context", false], ["isolation", "off"]] as const) {
            const result = await run!.execute("call", completeToolCall(run!.parameters, { ...base, [key]: value }), undefined, undefined, f.ctx);
            assert.equal(result.isError, true);
            assert.match(text(result), new RegExp(key));
            assert.match(text(result), /No agent was resumed/);
        }
        assert.equal(lookups, 0);
        assert.equal(resumes, 0);
        assert.equal(steers, 0);
        assert.equal(record.pendingSteers, undefined);
        record.status = "completed";
        await run!.execute("call", completeToolCall(run!.parameters, base), undefined, undefined, f.ctx);
        assert.equal(resumes, 1, "a plain nested resume still reaches the manager");
    } finally { await f.close(); }
});

const pinnedModel = { provider: "offline", id: "pinned", name: "Pinned" };
const otherModel = { provider: "offline", id: "other", name: "Other" };
function modelRegistry(ctx: ExtensionToolContext) {
    ctx.model = otherModel as ExtensionToolContext["model"];
    ctx.modelRegistry = {
        getAll: () => [pinnedModel, otherModel], getAvailable: () => [pinnedModel, otherModel],
        find: (_provider: string, id: string) => [pinnedModel, otherModel].find(model => model.id === id),
    } as unknown as ExtensionToolContext["modelRegistry"];
}
const pinnedAgent = "---\nname: custom\ndescription: Pinned offline agent\nmodel: offline/pinned\nthinking: high\noutput_transcript: false\n---\nDo work.\n";
function assertOverride(textValue: string, thinking = "high") {
    assert.match(textValue, /model requested "other", effective "offline\/pinned"/);
    assert.match(textValue, new RegExp(`thinking requested "minimal", effective "${thinking}"`));
}

for (const background of [false, true]) void it(`root ${background ? "background" : "foreground"} returns model-visible requested/effective overrides`, async () => {
    const f = await factory({ customAgent: pinnedAgent }, {
        async runAgent(_ctx, _type, _prompt, options) {
            assert.equal(options.model?.id, "pinned");
            assert.equal(options.thinkingLevel, "high", "frontmatter precedence is unchanged");
            const session = { model: pinnedModel, thinkingLevel: "low", messages: [], subscribe: () => () => {},
                dispose() {}, sessionManager: { getSessionFile: () => undefined } } as unknown as AgentSession;
            options.onSessionCreated?.(session);
            return { session, responseText: "visible answer", aborted: false, steered: false };
        },
    });
    try {
        modelRegistry(f.ctx);
        const result = await f.execute("subagent_run", { subagent_type: "custom", description: "work", prompt: "work",
            model: "other", thinking: "minimal", run_in_background: background });
        assertOverride(text(result), "low");
        if (!background) assert.match(text(result), /visible answer/);
        const same = await f.execute("subagent_run", { subagent_type: "custom", description: "work", prompt: "work",
            model: "pinned", thinking: "low", run_in_background: background });
        assert.doesNotMatch(text(same), /model requested/, "same-model fuzzy alias is not a model override");
        assert.doesNotMatch(text(same), /thinking requested/, "actual effective level matching the request is not an override");
    } finally { await f.close(); }
});

for (const background of [false, true]) void it(`nested ${background ? "background" : "foreground"} returns overrides from actual invocation metadata`, async () => {
    const f = await factory({ customAgent: pinnedAgent });
    const records = new Map<string, AgentRecord>();
    const manager: import("../src/nested-tools.ts").NestedAgentManager = {
        getRecord: id => records.get(id), async resume(id) { return records.get(id); }, async awaitStartup() {},
        spawn(_pi, _ctx, _type, _prompt, options) {
            assert.equal(options.model?.id, "pinned"); assert.equal(options.thinkingLevel, "high");
            const id = `child-${records.size}`;
            records.set(id, { id, runId: "1", status: "completed", result: "nested answer", parentAgentId: "parent",
                invocation: { ...options.invocation, thinking: "low" } } as AgentRecord);
            return id;
        },
        async spawnAndWait(pi, ctx, type, prompt, options, onSpawned) {
            const id = this.spawn(pi, ctx, type, prompt, options); onSpawned?.(id);
            return { id, record: records.get(id)! };
        },
    };
    try {
        modelRegistry(f.ctx);
        const run = createNestedSubagentTools({ manager, pi: {} as ExtensionAPI, parentAgentId: "parent", depth: 1,
            maxSubagentDepth: 2, allowedSubagents: "all", configCwd: f.cwd })[0]!;
        const result = await run.execute("call", completeToolCall(run.parameters, { subagent_type: "custom", description: "work", prompt: "work",
            model: "other", thinking: "minimal", run_in_background: background }), undefined, undefined, f.ctx);
        assertOverride(text(result), "low");
        if (!background) assert.match(text(result), /nested answer/);
        const same = await run.execute("call", completeToolCall(run.parameters, { subagent_type: "custom", description: "work", prompt: "work",
            model: "pinned", thinking: "low", run_in_background: background }), undefined, undefined, f.ctx);
        assert.doesNotMatch(text(same), /model requested|thinking requested/);
    } finally { await f.close(); }
});
