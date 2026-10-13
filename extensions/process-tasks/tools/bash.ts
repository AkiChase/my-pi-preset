/**
 * `bash` tool override.
 *
 * Single file-descriptor backend (no tmux):
 *   - run_in_background=true spawns immediately and returns a job handle
 *   - foreground commands race completion against backgrounding
 *   - a 2s quick-completion window delays only progress UI, never explicit detach
 *   - Ctrl+Shift+B (manual) or the timeout timer move a command to background
 */

import type {
    AgentToolResult,
    AgentToolUpdateCallback,
} from "@earendil-works/pi-agent-core";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
    createBashToolDefinition,
    type BashToolDetails,
} from "@earendil-works/pi-coding-agent";
import { appendFileSync } from "node:fs";
import type { BackgroundRegistry } from "../state.ts";
import {
    QUICK_COMPLETION_MS,
    type ForegroundSlot,
    type UiContext,
} from "../types.ts";
import { spawnWithFileOutput, type SpawnExit } from "../spawn.ts";
import { streamLog } from "../output.ts";
import { showBackgroundHint, clearBackgroundHint } from "../hint.ts";
import {
    add,
    createRunningJob,
    newJobId,
    logPathFor,
    renderSidebar,
    stopSidebarTicker,
    readLogTail,
} from "../registry.ts";
import {
    assertJobSlot,
    detectBlockedSleep,
    SLEEP_WAIT_GUIDANCE,
    isAutoBackgroundAllowed,
    isBlankCommand,
    requireExistingCwd,
    startBackgroundJob,
    terminateJobSilently,
} from "../lifecycle.ts";
import { markOutcomeSurfaced } from "../notify.ts";
import { processTaskIdentity } from "../source.ts";
import { textBlock } from "../format.ts";
import { bashParamSchema } from "./bash-params.ts";

/** UI context + cwd is all this tool needs from the host context. */
type BashCtx = UiContext & { cwd: string };

/** Register the overridden `bash` tool. */
export function registerBashTool(
    pi: ExtensionAPI,
    reg: BackgroundRegistry,
    originalBash: ReturnType<typeof createBashToolDefinition>
): void {
    pi.registerTool({
        ...originalBash,
        name: "bash",
        description:
            `Run a bash command. Long-running commands auto-background after ` +
            `${Math.round(reg.config.timeoutMs / 1000)}s. ` +
            "Set run_in_background=true to start in background immediately. " +
            "Use /bg to manually background a running command.",
        promptSnippet:
            "Run shell commands; long-running commands auto-background or use run_in_background=true",
        promptGuidelines: [
            "Use bash with run_in_background=true when a command is expected to run for a long time.",
            "run_in_background is for ONE notification (the command exits when done). For per-event streaming (watching logs, polling an API, file changes), use the monitor tool instead.",
            "Never `sleep N` to wait for something — the job lingers for the full sleep. Wait on a background job with jobs action='attach', watch with the monitor tool, or poll with an `until` loop that exits when ready.",
            "Check background job status with jobs action='list'.",
            "Read background output with jobs action='output'.",
        ],
        parameters: bashParamSchema(reg.config),

        async execute(toolCallId, params, signal, onUpdate, ctx) {
            const p = params as {
                command: string;
                timeout?: number;
                run_in_background?: boolean;
                description?: string;
            };
            const bashCtx = ctx as BashCtx;

            if (isBlankCommand(p.command)) throw new Error("Command is empty.");
            requireExistingCwd(bashCtx.cwd);

            const sleepMatch = detectBlockedSleep(p.command);
            if (sleepMatch) {
                throw new Error(`Blocked: ${sleepMatch}. ${SLEEP_WAIT_GUIDANCE}`);
            }

            assertJobSlot(reg);

            // Explicit background mode — spawn and return immediately.
            if (p.run_in_background) {
                return spawnBackground({
                    toolCallId,
                    command: p.command,
                    name: p.description,
                    cwd: bashCtx.cwd,
                    reg,
                    pi,
                    ctx: bashCtx,
                });
            }

            // Foreground mode — race completion against backgrounding.
            return runForeground({
                toolCallId,
                command: p.command,
                timeoutMs: p.timeout ? p.timeout * 1000 : reg.config.timeoutMs,
                signal,
                onUpdate,
                ctx: bashCtx,
                reg,
                pi,
            });
        },
    });
}

// --- Foreground backend --------------------------------------------------

async function runForeground(args: {
    toolCallId: string;
    command: string;
    timeoutMs: number;
    signal: AbortSignal | undefined;
    onUpdate: AgentToolUpdateCallback<BashToolDetails | undefined> | undefined;
    ctx: BashCtx;
    reg: BackgroundRegistry;
    pi: ExtensionAPI;
}): Promise<AgentToolResult<BashToolDetails | undefined>> {
    const { toolCallId, command, timeoutMs, signal, onUpdate, ctx, reg, pi } =
        args;
    const id = newJobId("shell", reg);
    const logPath = logPathFor(reg, id);

    // The launch lease owns the parent signal, so manual detach removes that
    // cancellation link synchronously without stopping or restarting the process.
    const spawned = spawnWithFileOutput({
        command,
        cwd: ctx.cwd,
        logPath,
    });

    let handedToBackground = false;
    const job = createRunningJob({ id, command, pid: spawned.pid, logPath, toolCallId, isBackgrounded: false });
    job.stop = () => spawned.execution.stop();
    add(reg, job);
    let progressPoller: { stop: () => void } | undefined;
    let timeoutTimer: NodeJS.Timeout | undefined;
    let quickTimer: NodeJS.Timeout | undefined;
    let cleaned = false;
    const cleanup = () => {
        if (cleaned) return;
        cleaned = true;
        // Each display teardown is independent: a failed poller/widget must
        // never starve timers, foreground ownership, or lease disposal.
        try { progressPoller?.stop(); } catch { /* best-effort display teardown */ }
        progressPoller = undefined;
        try { clearTimeout(timeoutTimer); } catch { /* continue teardown */ }
        try { clearTimeout(quickTimer); } catch { /* continue teardown */ }
        reg.foreground.delete(toolCallId);
        try { clearBackgroundHint(reg, ctx, toolCallId); } catch { /* optional hint */ }
    };
    // Register before any await. The lease alone owns the parent cancellation link.
    const lease = reg.coordinator.registerWait<SpawnExit>({
        identity: processTaskIdentity(id), label: command, kind: "launch", signal,
        onDetach: () => {
            handedToBackground = true;
            job.isBackgrounded = true;
            reg.changed();
            reg.notificationRetries.get(id)?.();
        },
        onComplete: () => { markOutcomeSurfaced(job); reg.notificationRetries.delete(id); },
        onInterrupt: () => terminateJobSilently(reg, job),
        onDispose: () => terminateJobSilently(reg, job),
        cleanup,
    });
    const requestPause = (reason: "manual" | "timeout") => { lease.detach(reason); };
    const slot: ForegroundSlot = { requestPause, jobId: id };
    if (!lease.settled) reg.foreground.set(toolCallId, slot);
    // Keep exit/monitor ownership in the backend even after the launch wait ends.
    try {
        startBackgroundJob({ reg, pi, ctx, job, exit: spawned.exit, execution: spawned.execution });
        void spawned.exit.then((exit) => {
            if (!lease.settled) {
                lease.complete(exit);
            }
        });
        renderSidebar(reg, ctx);

        // Timeout timer.
        if (!lease.settled) timeoutTimer = setTimeout(() => {
            if (reg.nonInteractive) return;
            if (!reg.foreground.has(toolCallId)) return;
            if (!isAutoBackgroundAllowed(command)) {
                // Not eligible for auto-background (e.g. `sleep`) — kill it, but
                // leave a marker in the log first so the model can tell a timeout
                // kill apart from a normal failure (Claude Code prepends
                // "Command timed out after {duration}" to the output).
                try {
                    appendFileSync(logPath, `Command timed out after ${Math.round(timeoutMs / 1000)}s\n`);
                } catch { /* best-effort — the kill below still happens */ }
                spawned.execution.stop();
                return;
            }
            requestPause("timeout");
        }, timeoutMs);
        timeoutTimer?.unref();

        // Foreground completion (quick or normal): read output, surface errors.
        // The backend retains terminal metadata and the log after inline completion.
        const finishForeground = (
            exit: SpawnExit
        ): AgentToolResult<BashToolDetails | undefined> => {
            const output = readLogTail(job, reg.config.outputPreviewChars);
            // A signal death (e.g. Esc-cancel killed the process group) is a
            // deliberate cancel, not a command failure — never an error result.
            if (exit.signal === null && exit.code !== 0) {
                throw new Error(output || `Command exited with code ${exit.code ?? 1}`);
            }
            return { content: [textBlock(output || "(no output)")], details: undefined };
        };

        // Explicit detach participates in the initial window, not only after two seconds.
        const quickResult = lease.settled ? await lease.result : await Promise.race([
            lease.result,
            new Promise<null>((resolve) => {
                quickTimer = setTimeout(() => resolve(null), QUICK_COMPLETION_MS);
                quickTimer.unref();
            }),
        ]);
        if (quickResult === null && !lease.settled) {
            progressPoller = streamLog(logPath, onUpdate);
            showBackgroundHint(reg, ctx, toolCallId);
        }
        const outcome = quickResult ?? await lease.result;
        if (outcome.kind === "completed") return finishForeground(outcome.value);
        if (outcome.kind === "detached") {
            const text = outcome.reason === "manual"
                ? `Command was manually backgrounded by user with ID: ${id}. Output is being written to: ${logPath}`
                : `Command running in background with ID: ${id}. Output is being written to: ${logPath}`;
            return { content: [textBlock(text)], details: undefined };
        }
        // Genuine cancellation kills the launch, then preserves its observed final log.
        const exit = await spawned.exit;
        return finishForeground(exit);
    } finally {
        // Dispose before optional display cleanup. If setup/hint rendering threw,
        // stop and observe the process exit before rejecting with that same error.
        const stopLaunch = !handedToBackground && !lease.settled;
        if (stopLaunch) lease.dispose();
        cleanup();
        if (stopLaunch) await spawned.exit;
        try { renderSidebar(reg, ctx); } catch {
            // renderSidebar can throw before it stops the last live ticker.
            stopSidebarTicker(reg);
        }
    }
}

// --- Background backend --------------------------------------------------

async function spawnBackground(args: {
    toolCallId: string;
    command: string;
    name?: string;
    cwd: string;
    reg: BackgroundRegistry;
    pi: ExtensionAPI;
    ctx: UiContext;
}): Promise<AgentToolResult<BashToolDetails | undefined>> {
    const id = newJobId("shell", args.reg);
    const logPath = logPathFor(args.reg, id);

    const spawned = spawnWithFileOutput({
        command: args.command,
        cwd: args.cwd,
        logPath,
    });

    const job = createRunningJob({
        id,
        name: args.name,
        command: args.command,
        pid: spawned.pid,
        logPath,
        toolCallId: args.toolCallId,
    });
    job.stop = () => spawned.execution.stop();
    add(args.reg, job);
    try {
        startBackgroundJob({ reg: args.reg, pi: args.pi, ctx: args.ctx, job, exit: spawned.exit, execution: spawned.execution });
    } catch (error) {
        // No handle was returned: setup failure must not leave an owned process
        // or completion/stall hooks alive. Preserve the log and original error.
        terminateJobSilently(args.reg, job);
        await spawned.exit;
        throw error;
    }

    return {
        content: [
            textBlock(
                `Command running in background with ID: ${id}. Output is being written to: ${logPath}`
            ),
        ],
        details: undefined,
    };
}
