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

type MonitorCtx = UiContext & { cwd: string };

interface MonitorParams {
    command?: string;
    ws?: WsSpec;
    description: string;
    wake_absent_ms?: number;
    timeout_ms?: number;
}

export function registerMonitorTool(pi: ExtensionAPI, reg: BackgroundRegistry): void {
    pi.registerTool({
        name: "monitor",
        label: "monitor",
        description: "Start a command or WebSocket observation task with batched event notifications.",
        promptSnippet: "Observe event streams; manage the returned task through process_manage",
        promptGuidelines: [
            `Monitor usage:
  - Use monitor for ongoing event streams and updates; use bash for a finite command or a condition loop that exits with one final result. process_manage manages both tools' tasks.
  - Provide exactly one source: command or ws. ws requires url and optional protocols in preference order. Provide a specific non-empty description, shown on every notification.
  - timeout_ms is an optional finite positive total observation deadline in milliseconds; omitted means no deadline. wake_absent_ms is an independent finite positive silence threshold: remind once per silent period, keep observing, and notify when events resume. Silence is not completion or success.
  - Startup returns task_id and the log path, not a completed result. Events arrive as batched notifications. Use process_manage output/search for logs, wait for observation to end, or stop to end it. Cancelling/releasing wait does not stop observation. Session closure stops owned tasks.
  - stdout and stderr are both observed; complete lines count as activity, partial lines do not wake the agent. stderr text alone is not failure. command | grep filters stdout only; command 2>&1 | grep filters both. Flush pipeline stages per line with grep --line-buffered or awk fflush().
  - WebSocket messages, including empty messages, count as activity. Notifications are batched, not one per message/line. Monitors share a ${reg.config.monitorFlushMs}ms cadence; first/timely events batch within min(200ms, configured interval). A zero interval sends source-callback batches without this delay.
  - Observation ends when the main command/source ends or fails, or the deadline is reached. It does not wait for descendant output after the main shell exits. Terminal reason and pending output are combined; explicit stop/session shutdown is silent, and an already reported result is not notified again.
  - Notifications are bounded previews. Read omitted output through process_manage or its log path. Oversized batches expose omitted-source counts and a JSONL manifest of source/log metadata; read it to locate omitted sources. Manifest failures are explicit, not automatic retries.
  - Examples:
    Command: {"command":"tail -f ./service.log | grep --line-buffered READY","description":"Service readiness events","wake_absent_ms":60000,"timeout_ms":600000}
    WebSocket: {"ws":{"url":"wss://example.com/events"},"description":"Service events","timeout_ms":600000}`,
        ],
        // Closed at both levels. A misspelled `wake_absent_ms` (say `wake_abscent_ms`)
        // otherwise passed validation and the watch silently ran without the
        // silence reminder the caller asked for.
        parameters: Type.Object({
            command: Type.Optional(
                Type.String({ description: "Shell script; complete stdout or stderr lines are activity. Mutually exclusive with ws." })
            ),
            ws: Type.Optional(
                Type.Object(
                    {
                        url: Type.String({ description: "WebSocket URL (ws:// or wss://)" }),
                        protocols: Type.Optional(
                            Type.Array(Type.String({ description: "Subprotocol name" }), {
                                description: "WebSocket subprotocols to request, in preference order",
                            })
                        ),
                    },
                    { additionalProperties: false, description: "WebSocket source; each text frame is an event. Mutually exclusive with command." }
                )
            ),
            description: Type.String({ description: "Specific description, shown on every notification." }),
            timeout_ms: Type.Optional(
                Type.Number({ exclusiveMinimum: 0, description: "Optional finite positive total deadline in milliseconds. Omitted means no deadline." })
            ),
            wake_absent_ms: Type.Optional(
                Type.Number({ exclusiveMinimum: 0, description: "Optional finite positive event-arrival silence threshold in milliseconds; remind once, keep watching." })
            ),
        }, { additionalProperties: false }),

        async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
            if (!params || typeof params !== "object" || Array.isArray(params)) throw new Error("Monitor arguments must be an object.");
            for (const key of Object.keys(params)) {
                if (!["command", "ws", "description", "timeout_ms", "wake_absent_ms"].includes(key)) throw new Error(`Unknown monitor parameter '${key}'.`);
            }
            const p = params as MonitorParams;
            const mctx = ctx as MonitorCtx;

            if (p.command !== undefined && typeof p.command !== "string") throw new Error("command must be a string.");
            if (p.ws !== undefined) {
                if (!p.ws || typeof p.ws !== "object" || Array.isArray(p.ws)) throw new Error("ws must be an object with url and optional protocols.");
                for (const key of Object.keys(p.ws)) if (!["url", "protocols"].includes(key)) throw new Error(`Unknown ws parameter '${key}'.`);
                if (p.ws.protocols !== undefined && (!Array.isArray(p.ws.protocols) || p.ws.protocols.some(protocol => typeof protocol !== "string"))) throw new Error("ws.protocols must be an array of strings.");
            }
            // --- Validation: command XOR ws -------------------------------
            // The dependency is a cross-field rule, so it stays a runtime check
            // rather than duplicating object variants in a provider-facing schema. "Provided" is judged by the raw value: a caller
            // that sends `command: ""` meant to pass a command, and saying "provide
            // either" is more useful than a blank-command message about the other
            // source.
            const commandGiven = p.command !== undefined;
            const wsGiven = p.ws !== undefined;
            const hasCommand = typeof p.command === "string" && !isBlankCommand(p.command);
            const hasWs = !!p.ws && typeof p.ws.url === "string" && p.ws.url.length > 0;
            if (commandGiven && wsGiven) {
                throw new Error("Provide either `command` or `ws`, not both.");
            }
            if (!hasCommand && !hasWs) {
                if (commandGiven) throw new Error("`command` is empty; provide a shell script or a `ws` source.");
                if (wsGiven) throw new Error("`ws.url` must be a non-empty WebSocket URL (ws:// or wss://).");
                throw new Error("A monitor needs a `command` or a `ws` source.");
            }
            if (typeof p.description !== "string" || p.description.trim().length === 0) {
                throw new Error("`description` must be a non-empty string (shown on every notification).");
            }
            if (hasWs && !isWsSupported()) {
                throw new Error(
                    "WebSocket is not available in this runtime (needs Node 22+). " +
                        `Use command: 'websocat ${p.ws!.url}' or 'wscat -c ${p.ws!.url}' instead.`
                );
            }
            if (hasCommand) requireExistingCwd(mctx.cwd);
            assertJobSlot(reg);

            for (const key of ["timeout_ms", "wake_absent_ms"] as const) {
                const value = p[key];
                if (value !== undefined && (typeof value !== "number" || !Number.isFinite(value) || value <= 0)) {
                    throw new Error(`\`${key}\` must be a finite positive number, got ${String(value)}.`);
                }
            }
            const description = p.description.trim();
            const id = newJobId("monitor", reg);
            const logPath = logPathFor(reg, id);

            const job = createRunningJob({
                id, name: description, command: hasWs ? `ws ${p.ws!.url}` : p.command!,
                pid: 0, logPath, toolCallId: _toolCallId, kind: "monitor",
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
                            `Output: ${logPath}`
                    ),
                ],
                details: { runtimeLaunch: launchMetadata("monitor", id, id, "background") },
            };
        },
    });
}
