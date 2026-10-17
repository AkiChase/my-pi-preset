/**
 * `bash` tool override.
 *
 * Single file-descriptor backend (no tmux):
 *   - run_in_background=true spawns immediately and returns a job handle
 *   - foreground commands race completion against backgrounding
 *   - a 2s quick-completion window delays only progress UI, never explicit detach
 *   - Ctrl+Shift+B (manual) or the foreground waiting timer move a command to background
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
import { launchMetadata, launchText, type RuntimeLaunchMetadata } from "../../runtime-tasks/launch.ts";
import { constants as osConstants } from "node:os";
import type { BackgroundRegistry } from "../state.ts";
import {
    QUICK_COMPLETION_MS,
    type ForegroundSlot,
    type UiContext,
} from "../types.ts";
import { spawnWithFileOutput, type SpawnExit } from "../spawn.ts";
import { streamLog, readLogSlice } from "../output.ts";
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
    isBlankCommand,
    requireExistingCwd,
    startBackgroundJob,
    terminateJobSilently,
} from "../lifecycle.ts";
import { markOutcomeSurfaced } from "../notify.ts";
import { processTaskIdentity } from "../source.ts";
import { textBlock } from "../format.ts";
import { bashParamSchema, MAX_BACKGROUND_AFTER_SECONDS } from "./bash-params.ts";

/** UI context + cwd is all this tool needs from the host context. */
type LaunchDetails = BashToolDetails & { runtimeLaunch: RuntimeLaunchMetadata };
type BashCtx = UiContext & { cwd: string };

/**
 * Bound on the `structuredContent.output` this tool returns, matching the
 * built-in bash tool's own 1 MiB cap on the same field. The model-facing
 * content is bounded much smaller (`outputPreviewChars`); this field exists for
 * programmatic callers (codemode scripts) that want the whole run and can
 * afford it.
 */
const STRUCTURED_OUTPUT_MAX_BYTES = 1024 * 1024;

/**
 * The output contract the inherited `outputSchema` declares.
 *
 * The built-in definition carries an `outputSchema`, which this override
 * inherits through `...originalBash`. That schema is a promise about the shape
 * of `structuredContent`: with it declared, a codemode script receives
 * `structuredContent` as the call's value, and a result without it is rejected
 * (`structuredContent` was undefined). So `output`/`truncated`/`exit_code`
 * have to be filled in for every outcome, including the failures — a script
 * must be able to read the exit code instead of parsing prose.
 */
function structuredOutcome(args: {
    logPath: string;
    exitCode: number;
    wallTimeSeconds: number;
}): AgentToolResult<LaunchDetails | undefined>["structuredContent"] {
    const slice = readLogSlice(args.logPath, { limit: STRUCTURED_OUTPUT_MAX_BYTES });
    const truncated = slice !== undefined && (slice.start > 0 || slice.end < slice.size);
    return {
        output: slice?.text ?? "",
        truncated,
        ...(truncated ? { full_output_path: args.logPath } : {}),
        exit_code: args.exitCode,
        wall_time_seconds: args.wallTimeSeconds,
    } as AgentToolResult<LaunchDetails | undefined>["structuredContent"];
}

/** Register the overridden `bash` tool. */
export function registerBashTool(
    pi: ExtensionAPI,
    reg: BackgroundRegistry,
    originalBash: ReturnType<typeof createBashToolDefinition>
): void {
    pi.registerTool<ReturnType<typeof bashParamSchema>, LaunchDetails | undefined>({
        ...originalBash,
        name: "bash",
        description: "Run finite shell commands in the foreground or background. The foreground waiting threshold does not terminate execution.",
        promptSnippet: "Run finite shell commands in the foreground or background",
        promptGuidelines: [
            `Bash usage:
  - Use bash for finite shell commands. Use monitor for ongoing event streams or per-event notifications.
  - Commands run in the foreground by default. Keep short commands in the foreground. Set run_in_background=true to start in the background immediately.
  - In interactive mode, background_after_seconds controls how long to wait before backgrounding a still-running command (default: ${reg.config.timeoutMs / 1000}s). It does not terminate the command. Do not combine it with run_in_background=true. Use /bg to release a current wait without stopping execution.
  - In non-interactive mode, foreground commands wait until completion; background_after_seconds is not supported. Background tasks remain session-owned and are stopped when the session closes.
  - Foreground completion returns a tool result; background completion sends a notification automatically unless its final result has already been delivered. Do not poll list/status merely to detect completion.
  - A background launch result means started, not successfully completed. Keep the returned task_id. Use process_manage status/output/wait/stop to inspect, read, await, or stop the bash task; set task_type to null in these targeted calls. process_manage also manages monitor tasks; use agent_manage for subagent/workflow executions.
  - Never use sleep merely to wait for a task. Use process_manage action="wait", or a condition loop that exits when ready.
  - Examples:
    Foreground: {"command":"git status --short","description":"Inspect working tree"}
    Immediate background: {"command":"npm test","run_in_background":true,"description":"Run tests"}
    Background after 10s (interactive): {"command":"npm test","background_after_seconds":10,"description":"Run tests"}`,
        ],
        parameters: bashParamSchema(reg.config),

        async execute(toolCallId, params, signal, onUpdate, ctx) {
            const p = params as {
                command: string;
                background_after_seconds?: number;
                run_in_background?: boolean;
                description?: string;
            };
            const bashCtx = ctx as BashCtx;
            for (const key of Object.keys(p)) {
                if (!["command", "background_after_seconds", "run_in_background", "description"].includes(key)) {
                    const correction = key === "timeout" ? " Use background_after_seconds for the interactive foreground waiting period, not an execution deadline."
                        : key === "notify" ? " Background completion is reported automatically." : "";
                    throw new Error(`Unknown bash parameter '${key}'. Accepted fields: command, background_after_seconds, run_in_background, description.${correction}`);
                }
            }
            if (p.background_after_seconds !== undefined) {
                if (!Number.isFinite(p.background_after_seconds) || p.background_after_seconds <= 0 || p.background_after_seconds > MAX_BACKGROUND_AFTER_SECONDS)
                    throw new Error(`background_after_seconds must be finite, greater than 0 and must not exceed ${MAX_BACKGROUND_AFTER_SECONDS} seconds.`);
                if (p.run_in_background === true) throw new Error("background_after_seconds cannot be combined with run_in_background=true.");
                if (reg.nonInteractive) throw new Error("background_after_seconds is unsupported in non-interactive mode; omit it to wait until completion.");
            }
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
                name: p.description,
                backgroundAfterMs: (p.background_after_seconds ?? reg.config.timeoutMs / 1000) * 1000,
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
    name?: string;
    backgroundAfterMs: number;
    signal: AbortSignal | undefined;
    onUpdate: AgentToolUpdateCallback<LaunchDetails | undefined> | undefined;
    ctx: BashCtx;
    reg: BackgroundRegistry;
    pi: ExtensionAPI;
}): Promise<AgentToolResult<LaunchDetails | undefined>> {
    const { toolCallId, command, backgroundAfterMs, signal, onUpdate, ctx, reg, pi } =
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
    const startedAt = Date.now();

    let handedToBackground = false;
    const job = createRunningJob({ id, name: args.name, command, pid: spawned.pid, logPath, toolCallId, isBackgrounded: false });
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

        // The waiting threshold only detaches, never terminates execution.
        if (!lease.settled && !reg.nonInteractive) timeoutTimer = setTimeout(() => {
            if (reg.foreground.has(toolCallId)) requestPause("timeout");
        }, backgroundAfterMs);
        timeoutTimer?.unref();

        // Foreground completion (quick or normal): read output, surface errors.
        // The backend retains terminal metadata and the log after inline completion.
        const finishForeground = (
            exit: SpawnExit,
            cancelled = false
        ): AgentToolResult<LaunchDetails | undefined> => {
            const output = readLogTail(job, reg.config.outputPreviewChars);
            // Node reports code === null when the child died by signal, so the
            // signal half is what separates a crash from a clean exit. Exposed to
            // scripts as 128+signal — the same convention the host documents for
            // its own `BashOperations.exec`.
            const exitCode = SignalExitCode(exit);
            const details = { runtimeLaunch: launchMetadata("bash", id, id, "foreground") };
            const structuredContent = structuredOutcome({
                logPath,
                exitCode,
                wallTimeSeconds: (Date.now() - startedAt) / 1000,
            });
            // Only an interrupted launch wait is deliberate cancellation. A
            // signal observed on normal completion is a command failure.
            if (cancelled) {
                return {
                    content: [textBlock(`${launchText(details.runtimeLaunch)}\nCommand was cancelled${exit.signal ? ` (${exit.signal})` : ""} before it finished.\n${output}`)],
                    details,
                    structuredContent,
                };
            }
            if (exitCode !== 0) {
                const reason = exit.signal
                    ? `Command terminated by ${exit.signal} (exit code ${exitCode}).`
                    : `Command exited with code ${exitCode}.`;
                return {
                    content: [textBlock(`${launchText(details.runtimeLaunch)}\n${reason}\n${output}`)],
                    details,
                    structuredContent,
                    isError: true,
                };
            }
            return {
                content: [textBlock(`${launchText(details.runtimeLaunch)}\n${output || "(no output)"}`)],
                details,
                structuredContent,
            };
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
            const details = { runtimeLaunch: launchMetadata("bash", id, id, "background") };
            // The command is still running, so there is no observed exit yet. The
            // inherited outputSchema requires an integer `exit_code`, and it has no
            // sentinel for "not finished" — so 0 is reported and a codemode script
            // that needs to distinguish a running job must read `output`, the launch
            // metadata, or wait on the job rather than trusting this field.
            // `wall_time_seconds` is time-so-far, not a completed run's duration.
            return {
                content: [textBlock(`${launchText(details.runtimeLaunch)}\n${text}`)],
                details,
                structuredContent: structuredOutcome({
                    logPath,
                    exitCode: 0,
                    wallTimeSeconds: (Date.now() - startedAt) / 1000,
                }),
            };
        }
        // Genuine cancellation kills the launch, then preserves its observed final log.
        const exit = await spawned.exit;
        return finishForeground(exit, true);
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

/**
 * Exit status for a finished child: its code, or 128+signal when a signal
 * killed it (the convention the host's own `BashOperations` documents).
 * `null` code with no signal is reported as 1 — the host treats it as failed.
 */
function SignalExitCode(exit: SpawnExit): number {
    if (exit.code !== null) return exit.code;
    if (exit.signal === null) return 1;
    const signalNumber = osConstants.signals[exit.signal];
    return signalNumber === undefined ? 1 : 128 + signalNumber;
}

async function spawnBackground(args: {
    toolCallId: string;
    command: string;
    name?: string;
    cwd: string;
    reg: BackgroundRegistry;
    pi: ExtensionAPI;
    ctx: UiContext;
}): Promise<AgentToolResult<LaunchDetails | undefined>> {
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
                `${launchText(launchMetadata("bash", id, id, "background"))}\nCommand running in background with ID: ${id}. Output is being written to: ${logPath}`
            ),
        ],
        details: { runtimeLaunch: launchMetadata("bash", id, id, "background") },
        // Started, not finished — same contract as the foreground detach path.
        structuredContent: {
            output: "",
            truncated: false,
            exit_code: 0,
            wall_time_seconds: 0,
        } as AgentToolResult<LaunchDetails | undefined>["structuredContent"],
    };
}
