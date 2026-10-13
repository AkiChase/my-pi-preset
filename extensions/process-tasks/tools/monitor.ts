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
        label: "Monitor",
        description:
            "Watch a command or WebSocket with visible, agent-waking batched notifications. " +
            "Command stdout and stderr are collected together; complete lines are activity. " +
            "Monitors share one notification cadence (default 30s); first/timely events batch within 200ms (or a smaller configured interval). " +
            "No implicit timeout; the main command exit ends observation.",
        promptSnippet: "Watch event streams with batched notifications and optional silence reminders",
        promptGuidelines: [
            "For one result when done, use bash run_in_background with a loop that exits; use monitor for event streams.",
            "Both stdout and stderr are received. command | grep filters stdout only; command 2>&1 | grep filters both streams.",
            "Flush pipeline stages per line: grep --line-buffered, awk fflush(). A partial command line does not wake the agent.",
            "Silence is not success. Optional wake_absent_ms reminds once per silence; recovery is timely (within 200ms) and the watch continues.",
            "No timeout unless timeout_ms is provided. Stop session-length watches via jobs action='kill'; explicit stop sends no final notification.",
            "Give a specific description. Read the log for output omitted by bounded previews. stderr content alone is not failure.",
            "Oversized batches include an omitted-source count and local JSONL manifest path; read it for source metadata/log paths. Manifest save failures are explicit, not automatic retries.",
            "WebSocket messages, including empty messages, count as activity; progress is batched, not one notification per line.",
        ],
        parameters: Type.Object({
            command: Type.Optional(
                Type.String({ description: "Shell script; complete stdout or stderr lines are activity. Mutually exclusive with ws." })
            ),
            ws: Type.Optional(
                Type.Object(
                    {
                        url: Type.String({ description: "WebSocket URL (ws:// or wss://)" }),
                        protocols: Type.Optional(Type.Array(Type.String())),
                    },
                    { description: "WebSocket source; each text frame is an event. Mutually exclusive with command." }
                )
            ),
            description: Type.String({ description: "Specific description, shown on every notification." }),
            timeout_ms: Type.Optional(
                Type.Number({ description: "Optional finite positive total deadline in milliseconds. Omitted means no deadline." })
            ),
            wake_absent_ms: Type.Optional(
                Type.Number({ description: "Optional finite positive event-arrival silence threshold in milliseconds; remind once, keep watching." })
            ),
        }),

        async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
            const p = params as MonitorParams;
            const mctx = ctx as MonitorCtx;

            // --- Validation: command XOR ws -------------------------------
            const hasCommand = typeof p.command === "string" && !isBlankCommand(p.command);
            const hasWs = !!p.ws && typeof p.ws.url === "string" && p.ws.url.length > 0;
            if (hasCommand && hasWs) {
                throw new Error("Provide either `command` or `ws`, not both.");
            }
            if (!hasCommand && !hasWs) {
                throw new Error("A monitor needs a `command` or a `ws` source.");
            }
            if (!p.description || p.description.trim().length === 0) {
                throw new Error("`description` is required (shown on every notification).");
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
                    throw new Error(`\`${key}\` must be a finite positive number.`);
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
                ? "no deadline (stop via jobs action='kill')" : `timeout ${p.timeout_ms}ms`;
            return {
                content: [
                    textBlock(
                        `Monitor ${id} started — ${sourceDesc}, ${deadlineDesc}. ` +
                            `Events ("${description}") will arrive as notifications. ` +
                            `Output: ${logPath}`
                    ),
                ],
                details: undefined,
            };
        },
    });
}
