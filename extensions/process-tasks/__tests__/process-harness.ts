import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { ExtensionAPI, ExtensionToolContext, SessionShutdownEvent } from "@earendil-works/pi-coding-agent";
import { createBashToolDefinition } from "@earendil-works/pi-coding-agent";
import { TaskCoordinator } from "../../task-ui/coordinator.ts";
import { TaskLifecycle } from "../../task-ui/lifecycle.ts";
import { BackgroundRegistry } from "../state.ts";
import { DEFAULTS, type ProcessTasksConfig } from "../config.ts";
import { registerBashTool } from "../tools/bash.ts";
import { registerBashBgTool } from "../tools/bash-bg.ts";
import { registerJobsTool } from "../tools/jobs.ts";
import { registerMonitorTool } from "../tools/monitor.ts";
import { startRegistrySweep } from "../registry.ts";
import { createProcessLifecycleParticipant } from "../lifecycle.ts";
import { createProcessTaskSource } from "../source.ts";

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
export async function until(predicate: () => boolean): Promise<void> {
    for (let n = 0; n < 200; n++) { if (predicate()) return; await sleep(10); }
    assert.ok(predicate(), "condition did not settle");
}

/** Typed host boundary; tools/registry/source/lifecycle are the real implementations. */
interface CapturedTool {
    execute(id: string, params: unknown, signal: AbortSignal | undefined, update: undefined, ctx: ExtensionToolContext): Promise<{ content: { text?: string }[] }>;
}

export function processActivation(dir: string, config: Partial<ProcessTasksConfig> = {}) {
    const coordinator = new TaskCoordinator();
    const lifecycle = new TaskLifecycle(coordinator);
    const reg = new BackgroundRegistry({ ...DEFAULTS, logDir: dir, maxConcurrentJobs: 20, ...config }, coordinator);
    const tools = new Map<string, CapturedTool>();
    const messages: unknown[] = [];
    const partialPi: Pick<ExtensionAPI, "registerTool" | "sendMessage"> = {
        registerTool(tool) { tools.set(tool.name, tool as unknown as CapturedTool); }, sendMessage(message) { messages.push(message); },
    };
    const ctx = { cwd: dir, hasUI: false, ui: { setStatus() {}, setWidget() {}, notify() {}, theme: { fg: (_color: string, text: string) => text } } };
    // SDK contexts contain services unrelated to these four tools; this is the sole fixture boundary.
    const pi = partialPi as ExtensionAPI;
    const context = ctx as unknown as ExtensionToolContext;
    registerBashTool(pi, reg, createBashToolDefinition(dir));
    registerBashBgTool(pi, reg); registerJobsTool(pi, reg); registerMonitorTool(pi, reg);
    const source = createProcessTaskSource(reg);
    const unregister = coordinator.registerSource(source);
    lifecycle.register(createProcessLifecycleParticipant(reg, () => { unregister(); source.dispose(); }));
    startRegistrySweep(reg);
    return { coordinator, lifecycle, reg, source, tools, messages, context,
        execute(name: string, params: unknown, signal?: AbortSignal) {
            return tools.get(name)!.execute(`${name}-${reg.totalStarted}`, params, signal, undefined, context);
        },
        async emit(event: SessionShutdownEvent) { assert.equal(event.type, "session_shutdown"); await lifecycle.shutdown(); },
    };
}
