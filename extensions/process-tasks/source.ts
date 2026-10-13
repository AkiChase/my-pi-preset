import type { BackgroundRegistry } from "./state.ts";
import type { TaskDetail, TaskDetailRequest, TaskIdentity, TaskSource, TaskView } from "../task-ui/types.ts";
import { taskKey } from "../task-ui/types.ts";
import { isTerminalStatus } from "./types.ts";
import { readLogSlice } from "./output.ts";
import { terminateJobSilently } from "./lifecycle.ts";

export const PROCESS_SOURCE_ID = "process";
export function processTaskIdentity(jobId: string): TaskIdentity {
    return Object.freeze({ sourceId: PROCESS_SOURCE_ID, taskId: jobId, runId: jobId });
}

/** Backend-local adapter. Snapshots never retain Job, process, hooks or promises. */
export function createProcessTaskSource(reg: BackgroundRegistry): TaskSource {
    let disposed = false;
    const listeners = new Set<() => void>();
    let revision = 0;
    const changed = () => {
        if (disposed) return;
        revision++;
        for (const listener of [...listeners]) {
            try { listener(); } catch (error) { console.error("[process-tasks] source subscription failed:", error); }
        }
    };
    const unsubscribeRegistry = reg.subscribe(changed);
    const unsubscribeWaits = reg.coordinator.subscribeWaits(changed);
    const lookup = (identity: TaskIdentity) => !disposed && identity.sourceId === PROCESS_SOURCE_ID && identity.runId === identity.taskId
        ? reg.jobs.get(identity.taskId) : undefined;
    return {
        sourceId: PROCESS_SOURCE_ID,
        get revision() { return revision; },
        list(): readonly TaskView[] {
            if (disposed) return Object.freeze([]);
            return Object.freeze([...reg.jobs.values()].map((job): TaskView => {
                const identity = processTaskIdentity(job.id);
                return Object.freeze({
                    ...identity,
                    key: taskKey(identity),
                    kind: job.kind ?? "shell",
                    title: job.name ?? job.command,
                    description: job.command,
                    status: job.status === "pending" ? "queued" : job.status === "killed" ? "stopped" : job.status,
                    executionMode: job.isBackgrounded ? "background" : "foreground",
                    waitCount: reg.coordinator.countWaits(identity),
                    startedAt: job.startTime,
                    endedAt: job.endedAt,
                    stats: Object.freeze({ pid: job.pid, exitCode: job.exitCode, durationMs: (job.endedAt ?? Date.now()) - job.startTime }),
                    artifacts: Object.freeze([Object.freeze({ kind: "log" as const, path: job.logPath })]),
                    capabilities: Object.freeze({ stop: !isTerminalStatus(job.status), details: true }),
                });
            }));
        },
        detail(identity: TaskIdentity, request: TaskDetailRequest = {}): TaskDetail | undefined {
            const job = lookup(identity);
            if (!job) return undefined;
            const limit = Math.min(Math.max(0, request.limit ?? reg.config.outputPreviewChars), reg.config.outputPreviewChars);
            const slice = readLogSlice(job.logPath, { offset: request.offset, limit });
            return Object.freeze(slice ? {
                text: slice.text, path: job.logPath, start: slice.start, end: slice.end, size: slice.size,
                omittedBefore: slice.start, omittedAfter: slice.size - slice.end,
            } : { text: "No output yet", path: job.logPath });
        },
        stop(identity: TaskIdentity): boolean {
            const job = lookup(identity);
            if (!job || isTerminalStatus(job.status)) return false;
            terminateJobSilently(reg, job);
            return true;
        },
        subscribe(listener: () => void): () => void {
            if (!disposed) listeners.add(listener);
            return () => { listeners.delete(listener); };
        },
        dispose() {
            if (disposed) return;
            disposed = true;
            unsubscribeRegistry();
            unsubscribeWaits();
            listeners.clear();
        },
    };
}
