import { copyMonitorExecutionConfig, monitorExecutionSummary } from "../../runtime-tasks/execution-config.ts";
import { createToolCardRenderers } from "../../beautify/tool-card.ts";
import { text } from "../../beautify/types.ts";
import { launchMetadata, launchText } from "../../runtime-tasks/launch.ts";
// Monitor tool: event-arrival notifications, bounded batching, optional silence wakes.

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
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
import { integerString, nullableObject, parseControls, sentinelString } from "../../shared/tool-arguments.ts";

type MonitorCtx = UiContext & { cwd: string };

interface MonitorParams {
    command?: string;
    ws?: WsSpec;
    description: string;
    wake_absent_ms?: number;
    timeout_ms?: number;
}

/** Validate the complete model envelope; only declared "null" sentinels mean unspecified. */
export function parseMonitorArguments(input: unknown): MonitorParams {
    const { values: p } = parseControls(input,
        ["command", "ws", "description", "timeout_ms", "wake_absent_ms"],
        { command: { kind: "nullable" }, ws: { kind: "nullable" }, timeout_ms: { kind: "nullable", integer: { min: 1 } }, wake_absent_ms: { kind: "nullable", integer: { min: 1 } } });
    if (p.command !== undefined && typeof p.command !== "string") throw new Error("`command` must be a string or \"null\".");
    let ws: WsSpec | undefined;
    if (p.ws !== undefined) {
        // A separate fixed-object boundary. protocols is a plain array: [] means no preference.
        if (!p.ws || typeof p.ws !== "object" || Array.isArray(p.ws)) throw new Error("`ws` must be an object with url and protocols, or \"null\" when using command.");
        const { values: nested } = parseControls(p.ws, ["url", "protocols"], {});
        if (typeof nested.url !== "string" || nested.url.length === 0) {
            throw new Error("`ws.url` must be a non-empty WebSocket URL (ws:// or wss://).");
        }
        if (!Array.isArray(nested.protocols) || nested.protocols.some(protocol => typeof protocol !== "string")) {
            throw new Error("`ws.protocols` must be an array of strings; use [] for no preference.");
        }
        ws = { url: nested.url, ...(nested.protocols.length > 0 ? { protocols: nested.protocols as string[] } : {}) };
    }
    if (p.command !== undefined && ws !== undefined) {
        throw new Error("Provide either `command` or `ws`, not both. Set the unused source to \"null\".");
    }
    if (p.command === undefined && ws === undefined) throw new Error("A monitor needs a `command` or a `ws` source; only the unused one is \"null\".");
    if (typeof p.command === "string" && isBlankCommand(p.command)) throw new Error("`command` is empty; provide a shell script or a `ws` source.");
    if (typeof p.description !== "string" || p.description.trim().length === 0) {
        throw new Error("`description` must be a non-empty string (shown on every notification).");
    }
    return {
        command: p.command as string | undefined, ws, description: p.description as string,
        timeout_ms: p.timeout_ms as number | undefined, wake_absent_ms: p.wake_absent_ms as number | undefined,
    };
}

export function registerMonitorTool(pi: ExtensionAPI, reg: BackgroundRegistry): void {
    const monitorCardRenderers = createToolCardRenderers("monitor", undefined, (args, result) => ({
        identity: "monitor",
        summary: typeof args.description === "string" ? args.description : "",
        bodyText: result ? text(result) : undefined,
    }));
    pi.registerTool({
        name: "monitor",
        label: "monitor",
        ...monitorCardRenderers,
        description: "Start a command or WebSocket observation task with batched event notifications.",
        promptSnippet: "Observe event streams; manage the returned task through process_manage",
        promptGuidelines: [
            `Monitor usage:
  - Use monitor for ongoing event streams and updates; use bash for a finite command or a condition loop that exits with one final result. process_manage manages both tools' tasks.
  - Provide every field: command, ws, description, timeout_ms, wake_absent_ms. Never JSON null: set the unused source and unused time controls to the string "null"; exactly one source has a value. ws is an object with url and protocols; protocols [] means no preference, otherwise order is preserved. Provide a specific non-empty description, shown on every notification.
  - timeout_ms is a positive total observation deadline in milliseconds as a decimal string, or "null" for no deadline. wake_absent_ms is an independent positive silence threshold as a decimal string, or "null" for no silence reminder: remind once per silent period, keep observing, and notify when events resume. Silence is not completion or success.
  - Startup returns task_id and the log path, not a completed result. Events arrive as batched notifications. Use process_manage output/search for logs, wait for observation to end, or stop to end it. Cancelling/releasing wait does not stop observation. Session closure stops owned tasks.
  - stdout and stderr are both observed; complete lines count as activity, partial lines do not wake the agent. stderr text alone is not failure. command | grep filters stdout only; command 2>&1 | grep filters both. Flush pipeline stages per line with grep --line-buffered or awk fflush().
  - WebSocket messages, including empty messages, count as activity. Notifications are batched, not one per message/line. Monitors use the configured batch interval; startup results show the adopted batch configuration, not an exact delivery cadence; first/timely events batch within min(200ms, configured interval). A zero interval sends source-callback batches without this delay.
  - Observation ends when the main command/source ends or fails, or the deadline is reached. It does not wait for descendant output after the main shell exits. Terminal reason and pending output are combined; explicit stop/session shutdown is silent, and an already reported result is not notified again.
  - Notifications are bounded previews. Read omitted output through process_manage or its log path. Oversized batches expose omitted-source counts and a JSONL manifest of source/log metadata; read it to locate omitted sources. Manifest failures are explicit, not automatic retries.
  - Examples:
    Command: {"command":"tail -f ./service.log | grep --line-buffered READY","ws":"null","description":"Service readiness events","timeout_ms":"600000","wake_absent_ms":"60000"}
    WebSocket: {"command":"null","ws":{"url":"wss://example.com/events","protocols":[]},"description":"Service events","timeout_ms":"600000","wake_absent_ms":"null"}`,
        ],
        // Closed at both levels. A misspelled `wake_absent_ms` (say `wake_abscent_ms`)
        // otherwise passed validation and the watch silently ran without the
        // silence reminder the caller asked for.
        parameters: Type.Object({
            command: sentinelString('Shell script; complete stdout or stderr lines are activity. "null" when using ws.'),
            ws: nullableObject(
                Type.Object(
                    {
                        url: Type.String({ description: "WebSocket URL (ws:// or wss://)" }),
                        protocols: Type.Array(Type.String({ description: "Subprotocol name" }), {
                            description: "WebSocket subprotocols to request, in preference order; [] means no preference.",
                        }),
                    },
                    { additionalProperties: false }
                ),
                'WebSocket source object; each text frame is an event. "null" when using command.'
            ),
            description: Type.String({ description: "Specific description, shown on every notification." }),
            timeout_ms: integerString(["null"], 'Positive total deadline in milliseconds as a decimal string; "null" means no deadline.'),
            wake_absent_ms: integerString(["null"], 'Positive event-arrival silence threshold in milliseconds as a decimal string, or "null" for no reminder; remind once, keep watching.'),
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
