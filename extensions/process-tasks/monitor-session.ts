/** Event-arrival scheduling and single-consumption monitor notifications. */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { BackgroundRegistry } from "./state.ts";
import { isTerminalStatus, type Job, type UiContext } from "./types.ts";
import { renderSidebar } from "./registry.ts";
import { abortJob, markTerminal, startBackgroundJob, terminateJob } from "./lifecycle.ts";
import { killProcessTree } from "./spawn.ts";
import { MonitorBuffer } from "./monitor-buffer.ts";
import type { MonitorResult, MonitorSource, MonitorSourceFactory } from "./monitor-source.ts";
import { completionSummary,
    type MonitorNotificationPayload, type TerminalStatus } from "./notify.ts";

const MAX_TIMER_MS = 2_147_483_647;

export function isMonitorSetupCancelled(reg: BackgroundRegistry, job: Job): boolean {
    return reg.closed || reg.jobs.get(job.id) !== job || isTerminalStatus(job.status);
}

/** The source factory receives live sinks before spawning; no replay queue is needed.
 * Cancellation is distinct from a setup exception: retained terminal counts/logs
 * belong to lifecycle, not the tool's failed-admission rollback. */
export function startMonitorSession(args: {
    pi: ExtensionAPI; reg: BackgroundRegistry; ctx: UiContext; job: Job;
    createSource: MonitorSourceFactory; description: string;
    timeoutMs?: number; wakeAbsentMs?: number;
}): "started" | "cancelled" {
    const { pi, reg, ctx, job, description, timeoutMs, wakeAbsentMs } = args;
    // add() publishes synchronously; both the tool and direct callers must
    // recheck admission before constructing a socket/process or opening its fd.
    if (isMonitorSetupCancelled(reg, job)) return "cancelled";
    const { monitorMaxLinesPerEvent, outputPreviewChars } = reg.config;
    const pending = new MonitorBuffer(monitorMaxLinesPerEvent, outputPreviewChars);
    let state: "active" | "absent" | "finishing" | "terminal" = "active";
    const startedAt = Date.now();
    let lastActivity = startedAt;
    let timer: NodeJS.Timeout | undefined;
    let source: MonitorSource;
    let sourceStopped = false;
    let stopResult: MonitorResult | void;
    const stopSource = () => {
        if (sourceStopped) return;
        sourceStopped = true;
        stopResult = source.stop();
    };
    const deadline = timeoutMs === undefined ? undefined : startedAt + timeoutMs;
    const current = () => !isMonitorSetupCancelled(reg, job);
    const cancel = () => { if (timer) clearTimeout(timer); timer = undefined; };
    const beginFinishing = () => {
        if (state === "terminal") return;
        state = "finishing";
        reg.monitorNotifications.unobserve(job);
        reg.monitorNotifications.suspend(job);
        cancel();
    };
    const payload = (notificationState: MonitorNotificationPayload["state"], note?: string): MonitorNotificationPayload => {
        return { state: notificationState, description, preview: pending.take(), ...(note ? { note } : {}) };
    };
    const emit = (notificationState: "progress" | "absent" | "resumed", now: number) => {
        const monitor = payload(notificationState);
        if (notificationState === "absent") monitor.silenceMs = now - lastActivity;
        reg.monitorNotifications.enqueue(pi, job, monitor);
    };
    const finish = (status: TerminalStatus, summary: string, note?: string) => {
        if (state === "terminal" || !current()) return;
        beginFinishing();
        state = "terminal";
        reg.monitorNotifications.enqueue(pi, job, payload(status, note), summary);
    };
    const stopWithReason = (reason: string) => {
        if (state === "terminal" || state === "finishing" || !current()) return;
        beginFinishing();
        // stop synchronously drains only Node-buffered output into terminal pending.
        terminateJob(job);
        finish("killed", `Monitor "${description}" stopped (${reason})`, stopResult?.observationNote);
        markTerminal(reg, job, "killed");
        abortJob(reg, job.id);
        renderSidebar(reg, ctx);
    };
    const decide = () => {
        cancel();
        if (state === "finishing" || state === "terminal" || !current()) return;
        const now = Date.now();
        if (deadline !== undefined && now >= deadline) {
            stopWithReason(`timeout after ${timeoutMs}ms`);
            return;
        }
        if (state === "active" && wakeAbsentMs !== undefined && now - lastActivity >= wakeAbsentMs) {
            state = "absent";
            emit("absent", now);
        }
        // An outward callback may synchronously shut down while emitting.
        if (!current()) { cancel(); return; }
        const due: number[] = [];
        if (deadline !== undefined) due.push(deadline);
        if (state === "active" && wakeAbsentMs !== undefined) due.push(lastActivity + wakeAbsentMs);
        if (due.length) {
            const delay = Math.min(MAX_TIMER_MS, Math.max(1, Math.min(...due) - now));
            timer = setTimeout(decide, delay);
            timer.unref();
        }
    };
    reg.monitorNotifications.observe(job, decide);
    try {
        source = args.createSource({
            event(preview, arrivedAt) {
                if (state === "finishing" || state === "terminal" || !current()) return;
                lastActivity = arrivedAt;
                pending.add(preview);
                // A total deadline wins over any activity at the boundary.
                if (deadline !== undefined && Date.now() >= deadline) { decide(); return; }
                const notificationState = state === "absent" ? "resumed" : "progress";
                state = "active";
                emit(notificationState, Date.now());
                decide();
            },
            finishing: beginFinishing,
            final(preview) { if (state === "finishing" && current()) pending.add(preview); },
        });
    } catch (error) {
        cancel();
        reg.monitorNotifications.cancel(job);
        state = "terminal";
        throw error;
    }
    job.pid = source.pid;
    job.command = source.label;
    const stopOwnedSource = () => {
        if (sourceStopped) return;
        beginFinishing();
        try { stopSource(); } finally {
            if (source.execution) source.execution.stop();
            else killProcessTree(source.pid); // Non-process fixtures / legacy local source seam.
        }
    };
    const silentAbort = () => {
        // Natural completion aborts runtime hooks too; its finite tail remains queued.
        const naturalTerminal = state === "terminal";
        beginFinishing();
        try { stopOwnedSource(); } finally {
            state = "terminal";
            if (!naturalTerminal) reg.monitorNotifications.cancel(job);
            pending.take();
        }
    };
    job.stop = stopOwnedSource;
    try {
        const ac = startBackgroundJob({ reg, pi, ctx, job, exit: source.exit, execution: source.execution,
            notification: "self", disablePromptStall: true,
            handleOversize: () => stopWithReason(`log size exceeded ${reg.config.maxLogBytes} bytes`),
            onExit(raw) {
                const result = raw as MonitorResult;
                const status = result.signal ? "killed" : result.code === 0 ? "completed" : "failed";
                job.exitCode = result.code ?? undefined;
                finish(status, result.reason ? `Monitor "${description}" failed (${result.reason})`
                    : completionSummary(job, status), result.observationNote);
            },
        });
        // startBackgroundJob can return an already-aborted controller after a
        // factory/subscriber/UI hook shuts down. A late listener never fires.
        if (ac.signal.aborted) silentAbort();
        else ac.signal.addEventListener("abort", silentAbort, { once: true });
        if (ac.signal.aborted || isMonitorSetupCancelled(reg, job)) return "cancelled";
        decide();
        // The initial silence/deadline submission can synchronously shut down.
        // A normal immediate deadline is still an admitted, now finished watch.
        return reg.closed || reg.jobs.get(job.id) !== job ? "cancelled" : "started";
    } catch (err) {
        // A genuine setup exception is rolled back by the tool only while
        // nonterminal; a reentrant shutdown already owns terminal accounting.
        // Use the captured stop owner even if markTerminal deleted job.stop.
        beginFinishing();
        try {
            stopOwnedSource();
        } finally {
            state = "terminal";
            reg.monitorNotifications.cancel(job);
            pending.take();
            abortJob(reg, job.id);
            job.resolveDone?.();
            delete job.resolveDone;
            delete job.donePromise;
            delete job.stop;
            delete job.proc;
        }
        throw err;
    }
}
