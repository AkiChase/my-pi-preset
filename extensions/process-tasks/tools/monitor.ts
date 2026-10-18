import { copyMonitorExecutionConfig, monitorExecutionSummary } from "../../runtime-tasks/execution-config.ts";
import { createToolCallHeading } from "../../beautify/tool-call-heading.ts";
import { launchMetadata, launchText } from "../../runtime-tasks/launch.ts";
// Monitor tool: event-arrival notifications, bounded batching, optional silence wakes.

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "@earendil-works/pi-ai";
import type { BackgroundRegistry } from "../state.ts";
import {
    isTerminalStatus,
    type UiContext,
} from "../types.ts";
import { add, createRunningJob, newJobId, logPathFor } from "../registry.ts";
import { assertJobSlot, isBlankCommand, requireExistingCwd } from "../lifecycle.ts";
import { isWsSupported, type WsSpec } from "../monitor-ws.ts";
import {
    openWsMonitorSource,
    spawnCommandSource,
} from "../monitor-source.ts";
import { isMonitorSetupCancelled, startMonitorSession } from "../monitor-session.ts";
import { textBlock } from "../format.ts";
import { nullableControl, parseControlArguments } from "../../shared/tool-arguments.ts";

type MonitorCtx = UiContext & { cwd: string };

interface MonitorParams {
    command?: string;
    ws?: WsSpec;
    description: string;
    wake_absent_ms?: number;
    timeout_ms?: number;
}

/** Validate the complete model envelope; only declared control nulls mean unspecified. */
export function parseMonitorArguments(input: unknown): MonitorParams {
    const p = parseControlArguments(input,
        ["command", "ws", "description", "timeout_ms", "wake_absent_ms"],
        ["command", "ws", "timeout_ms", "wake_absent_ms"]);
    if (p.command !== undefined && typeof p.command !== "string") throw new Error("command must be a string.");
    let ws: WsSpec | undefined;
    if (p.ws !== undefined) {
        // This is a separate fixed-object boundary, not recursive null cleaning.
        const nested = parseControlArguments(p.ws, ["url", "protocols"], ["protocols"]);
        if (typeof nested.url !== "string" || nested.url.length === 0) {
            throw new Error("`ws.url` must be a non-empty WebSocket URL (ws:// or wss://).");
        }
        if (nested.protocols !== undefined && (!Array.isArray(nested.protocols) || nested.protocols.some(protocol => typeof protocol !== "string"))) {
            throw new Error("ws.protocols must be an array of strings.");
        }
        ws = { url: nested.url, ...(nested.protocols !== undefined ? { protocols: nested.protocols as string[] } : {}) };
    }
    // Empty strings still supply a source. Null alone means the source is unused.
    if (p.command !== undefined && ws !== undefined) {
        throw new Error("Provide either `command` or `ws`, not both. Set the unused source to null; an empty command still counts as supplied.");
    }
    if (p.command === undefined && ws === undefined) throw new Error("A monitor needs a `command` or a `ws` source.");
    if (typeof p.command === "string" && isBlankCommand(p.command)) throw new Error("`command` is empty; provide a shell script or a `ws` source.");
    if (typeof p.description !== "string" || p.description.trim().length === 0) {
        throw new Error("`description` must be a non-empty string (shown on every notification).");
    }
    for (const key of ["timeout_ms", "wake_absent_ms"] as const) {
        const value = p[key];
        if (value !== undefined && (typeof value !== "number" || !Number.isFinite(value) || value <= 0)) {
            throw new Error(`\`${key}\` must be a finite positive number, got ${String(value)}.`);
        }
    }
    return {
        command: p.command as string | undefined, ws, description: p.description,
        timeout_ms: p.timeout_ms as number | undefined, wake_absent_ms: p.wake_absent_ms as number | undefined,
    };
}

export function registerMonitorTool(pi: ExtensionAPI, reg: BackgroundRegistry): void {
    pi.registerTool({
        name: "monitor",
        label: "monitor",
        renderCall: (args, theme, context) => createToolCallHeading({ name: "monitor", detail: args.description, theme, context }),
        description: "Start a command or WebSocket observation task with batched event notifications.",
        promptSnippet: "Observe event streams; manage the returned task through process_manage",
        promptGuidelines: [
            `Monitor usage:
  - Use monitor for ongoing event streams and updates; use bash for a finite command or a condition loop that exits with one final result. process_manage manages both tools' tasks.
  - Provide every field: command, ws, description, timeout_ms, wake_absent_ms. Set the unused source and unused time controls to null; exactly one source must be non-null. ws requires url and protocols; protocols:null means no preference, while [] and protocol order are preserved. Provide a specific non-empty description, shown on every notification.
  - timeout_ms is a finite positive total observation deadline in milliseconds, or null for no deadline. wake_absent_ms is an independent finite positive silence threshold, or null for no silence reminder: remind once per silent period, keep observing, and notify when events resume. Silence is not completion or success.
  - Startup returns task_id and the log path, not a completed result. Events arrive as batched notifications. Use process_manage output/search for logs, wait for observation to end, or stop to end it. Cancelling/releasing wait does not stop observation. Session closure stops owned tasks.
  - stdout and stderr are both observed; complete lines count as activity, partial lines do not wake the agent. stderr text alone is not failure. command | grep filters stdout only; command 2>&1 | grep filters both. Flush pipeline stages per line with grep --line-buffered or awk fflush().
  - WebSocket messages, including empty messages, count as activity. Notifications are batched, not one per message/line. Monitors use the configured batch interval; startup results show the adopted batch configuration, not an exact delivery cadence; first/timely events batch within min(200ms, configured interval). A zero interval sends source-callback batches without this delay.
  - Observation ends when the main command/source ends or fails, or the deadline is reached. It does not wait for descendant output after the main shell exits. Terminal reason and pending output are combined; explicit stop/session shutdown is silent, and an already reported result is not notified again.
  - Notifications are bounded previews. Read omitted output through process_manage or its log path. Oversized batches expose omitted-source counts and a JSONL manifest of source/log metadata; read it to locate omitted sources. Manifest failures are explicit, not automatic retries.
  - Examples:
    Command: {"command":"tail -f ./service.log | grep --line-buffered READY","ws":null,"description":"Service readiness events","timeout_ms":600000,"wake_absent_ms":60000}
    WebSocket: {"command":null,"ws":{"url":"wss://example.com/events","protocols":null},"description":"Service events","timeout_ms":600000,"wake_absent_ms":null}`,
        ],
        // Closed at both levels. A misspelled `wake_absent_ms` (say `wake_abscent_ms`)
        // otherwise passed validation and the watch silently ran without the
        // silence reminder the caller asked for.
        parameters: Type.Object({
            command: nullableControl(
                Type.String({ description: "Shell script; complete stdout or stderr lines are activity. Set to null when using ws." })
            ),
            ws: nullableControl(
                Type.Object(
                    {
                        url: Type.String({ description: "WebSocket URL (ws:// or wss://)" }),
                        protocols: nullableControl(
                            Type.Array(Type.String({ description: "Subprotocol name" }), {
                                description: "WebSocket subprotocols to request, in preference order; null means no preference.",
                            })
                        ),
                    },
                    { additionalProperties: false, description: "WebSocket source; each text frame is an event. Set to null when using command." }
                )
            ),
            description: Type.String({ description: "Specific description, shown on every notification." }),
            timeout_ms: nullableControl(
                Type.Number({ exclusiveMinimum: 0, description: "Finite positive total deadline in milliseconds; null means no deadline." })
            ),
            wake_absent_ms: nullableControl(
                Type.Number({ exclusiveMinimum: 0, description: "Finite positive event-arrival silence threshold in milliseconds, or null for no reminder; remind once, keep watching." })
            ),
        }, { additionalProperties: false }),

        async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
            const p = parseMonitorArguments(params);
            const mctx = ctx as MonitorCtx;
            const hasWs = p.ws !== undefined;
            const hasCommand = p.command !== undefined;
            if (hasWs && !isWsSupported()) {
                throw new Error(
                    "WebSocket is not available in this runtime (needs Node 22+). " +
                        `Use command: 'websocat ${p.ws!.url}' or 'wscat -c ${p.ws!.url}' instead.`
                );
            }
            if (hasCommand) requireExistingCwd(mctx.cwd);
            assertJobSlot(reg);

            const description = p.description.trim();
            const id = newJobId("monitor", reg);
            const logPath = logPathFor(reg, id);

            const job = createRunningJob({
                id, name: description, command: hasWs ? `ws ${p.ws!.url}` : p.command!,
                pid: 0, logPath, toolCallId: _toolCallId, kind: "monitor",
                executionConfig: copyMonitorExecutionConfig({ kind: "monitor", mode: "background",
                    timeout_ms: p.timeout_ms ?? null, wake_absent_ms: p.wake_absent_ms ?? null,
                    batch_interval_ms: reg.config.monitorFlushMs }),
            });
            add(reg, job);
            // Publication can synchronously close admission before a source
            // exists. Lifecycle owns this stopped job's metadata/counts.
            if (isMonitorSetupCancelled(reg, job)) throw new Error("Monitor setup cancelled");
            let outcome: "started" | "cancelled";
            try {
                outcome = startMonitorSession({
                    pi, reg, ctx: mctx, job, description,
                    timeoutMs: p.timeout_ms, wakeAbsentMs: p.wake_absent_ms,
                    createSource: (sinks) => {
                        const limits = { maxLines: reg.config.monitorMaxLinesPerEvent,
                            maxChars: reg.config.outputPreviewChars };
                        return hasWs ? openWsMonitorSource(p.ws!, logPath, sinks, limits)
                            : spawnCommandSource({ command: p.command!, cwd: mctx.cwd, logPath, sinks, limits });
                    },
                });
            } catch (err) {
                // Only a nonterminal failed setup is an unstarted admission.
                // Shutdown may already have counted/retained a stopped job.
                if (!isTerminalStatus(job.status) && reg.jobs.get(id) === job) {
                    reg.jobs.delete(id);
                    reg.totalStarted--;
                    reg.changed();
                }
                throw err;
            }
            if (outcome === "cancelled") throw new Error("Monitor setup cancelled");

            const sourceDesc = hasWs ? `WebSocket ${p.ws!.url}` : "command";
            const deadlineDesc = p.timeout_ms === undefined
                ? "no deadline (stop via process_manage action='stop')" : `timeout ${p.timeout_ms}ms`;
            return {
                content: [
                    textBlock(
                        `${launchText(launchMetadata("monitor", id, id, "background"))}\nMonitor ${id} started — ${sourceDesc}, ${deadlineDesc}. ` +
                            `Events ("${description}") will arrive as notifications. ` +
                            `Output: ${logPath}\n` + monitorExecutionSummary(job.executionConfig)
                    ),
                ],
                details: { runtimeLaunch: launchMetadata("monitor", id, id, "background"), executionConfig: copyMonitorExecutionConfig(job.executionConfig) },
            };
        },
    });
}
