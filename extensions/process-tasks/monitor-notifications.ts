/** Registry-owned monitor delivery cadence; never owns a source or execution. */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { BackgroundRegistry } from "./state.ts";
import { DELIVER_STEER, EVENT, type Job } from "./types.ts";
import { MonitorBuffer, prefix, type MonitorPreview } from "./monitor-buffer.ts";
import { markOutcomeSurfaced, type MonitorNotificationPayload } from "./notify.ts";
import { boundedMonitorBatch, monitorBatchPayload, monitorPayloadFits, newMonitorManifestPath, writeMonitorManifest, type ManifestSource } from "./monitor-batch.ts";

const MAX_TIMER_MS = 2_147_483_647;
const MAX_TRANSITIONS = 16;
const terminal = (state: string) => state === "completed" || state === "failed" || state === "killed";
function notificationError(error: unknown): string {
    // Host sinks can throw any value, including objects with throwing coercion.
    try {
        if (error instanceof Error && typeof error.message === "string" && error.message) return error.message;
        return String(error);
    } catch { return "Unknown notification error"; }
}
function reportNotificationError(label: string, error: unknown): void {
    // Logging the original object invokes inspect.custom and can itself throw.
    // Diagnostics must never turn host submission/save failure into source failure.
    try { console.error(label, notificationError(error)); } catch { /* Optional diagnostic sink. */ }
}
export interface MonitorBatchItem {
    jobId: string;
    logPath: string;
    monitor: MonitorNotificationPayload;
    summary?: string;
    toolUseId?: string;
    transitions: string[];
    omittedTransitions: number;
}
interface Pending {
    job: Job;
    buffer: MonitorBuffer;
    monitor: MonitorNotificationPayload;
    summary?: string;
    transitions: string[];
    omittedTransitions: number;
    timely: boolean;
    due: number;
    suspended: boolean;
}

export class MonitorNotifications {
    private pending = new Map<Job, Pending>();
    private checks = new Map<Job, () => void>();
    private timer: NodeJS.Timeout | undefined;
    private lastSubmission: number | undefined;
    private pi: Pick<ExtensionAPI, "sendMessage"> | undefined;
    private epoch = 0;
    private closed = false;
    private flushing = false;
    private inFlight = new Set<Job>();
    private retryJobs = new Set<Job>();
    private readonly reg: BackgroundRegistry;
    constructor(reg: BackgroundRegistry) { this.reg = reg; }

    private valid(job: Job): boolean {
        return !this.closed && !this.reg.closed && this.reg.jobs.get(job.id) === job;
    }
    private ordinaryDue(now: number): number {
        const f = this.reg.config.monitorFlushMs;
        return this.lastSubmission === undefined || now >= this.lastSubmission + f
            ? now + Math.min(200, f) : this.lastSubmission + f;
    }
    enqueue(pi: Pick<ExtensionAPI, "sendMessage">, job: Job, monitor: MonitorNotificationPayload, summary?: string, history?: Pick<MonitorBatchItem, "transitions" | "omittedTransitions">): void {
        if (!this.valid(job)) return;
        this.pi ??= pi;
        const now = Date.now();
        const timely = monitor.state !== "progress";
        let entry = this.pending.get(job);
        if (!entry) {
            entry = { job, buffer: new MonitorBuffer(this.reg.config.monitorMaxLinesPerEvent, this.reg.config.outputPreviewChars),
                monitor, summary, transitions: [], omittedTransitions: 0, timely,
                due: timely ? now + Math.min(200, this.reg.config.monitorFlushMs) : this.ordinaryDue(now), suspended: false };
            this.pending.set(job, entry);
        }
        entry.buffer.add(monitor.preview);
        const previousState = entry.monitor.state;
        // Preserve original snapshot metadata for the log-retained manifest.
        // Only the wire item below crops human text; paths are never cropped.
        entry.monitor = { ...monitor, state: !timely && entry.timely ? previousState : monitor.state };
        entry.summary = summary;
        entry.suspended = false;
        if (timely) {
            entry.timely = true;
            entry.due = Math.min(entry.due, now + Math.min(200, this.reg.config.monitorFlushMs));
            if (history) {
                entry.transitions = [...history.transitions];
                entry.omittedTransitions = history.omittedTransitions;
            } else if (entry.transitions.length < MAX_TRANSITIONS) entry.transitions.push(monitor.state);
            else entry.omittedTransitions++;
        }
        this.schedule();
    }
    observe(job: Job, check: () => void): void { if (this.valid(job)) this.checks.set(job, check); }
    unobserve(job: Job): void { this.checks.delete(job); }
    /** Finishing is known before the exit promise settles; retain output for its terminal. */
    suspend(job: Job): void {
        const entry = this.pending.get(job);
        if (entry) entry.suspended = true;
        this.schedule();
    }
    cancel(job: Job): void {
        this.pending.delete(job);
        this.checks.delete(job);
        this.reg.notificationRetries.delete(job.id);
        this.retryJobs.delete(job);
        this.schedule();
    }
    reset(): void {
        this.epoch++;
        if (this.timer) clearTimeout(this.timer);
        this.timer = undefined;
        this.pending.clear();
        this.checks.clear();
        this.inFlight.clear();
        for (const job of this.retryJobs) this.reg.notificationRetries.delete(job.id);
        this.retryJobs.clear();
        this.lastSubmission = undefined;
        this.pi = undefined;
    }
    freeze(): void { this.closed = true; this.reset(); }
    dispose(): void { this.freeze(); }

    private schedule(): void {
        if (this.timer) clearTimeout(this.timer);
        this.timer = undefined;
        if (this.closed || this.reg.closed || this.flushing) return;
        let due = Infinity;
        for (const entry of this.pending.values()) {
            if (!this.valid(entry.job) || entry.job.outcomeSurfaced) { this.pending.delete(entry.job); continue; }
            if (!entry.suspended) due = Math.min(due, entry.due);
        }
        if (due === Infinity) return;
        const delay = Math.max(0, due - Date.now());
        if (delay === 0) { this.flush(); return; }
        this.timer = setTimeout(() => { this.timer = undefined; this.schedule(); }, Math.min(MAX_TIMER_MS, delay));
        this.timer.unref();
    }
    private flush(): void {
        const pi = this.pi;
        if (!pi) return;
        const epoch = this.epoch;
        // Resolve known deadlines/silence before ordinary delivery regardless of
        // equal-due timer insertion order. Checks never own the shared cadence.
        this.flushing = true;
        try {
            for (const [job, check] of [...this.checks]) {
                if (epoch !== this.epoch || this.closed || this.reg.closed) break;
                if (this.valid(job)) {
                    try { check(); } catch (error) { reportNotificationError("[process-tasks] monitor decision failed:", error); }
                } else this.checks.delete(job);
            }
        } finally { this.flushing = false; }
        if (epoch !== this.epoch || this.closed || this.reg.closed) {
            // A synchronous decision callback may reset and enqueue a fresh epoch
            // while flushing suppresses schedule(). Give that epoch its own timer.
            this.schedule();
            return;
        }
        const snapshot: Pending[] = [];
        // Remove snapshots BEFORE the synchronous host callback. Reentrant arrivals
        // get a fresh buffer; they cannot be consumed by this submission's commit.
        for (const entry of this.pending.values()) {
            if (entry.suspended) continue;
            this.pending.delete(entry.job);
            if (!this.valid(entry.job) || entry.job.outcomeSurfaced) continue;
            if (terminal(entry.monitor.state) && (entry.job.attachCount ?? 0) > 0) {
                const payload = { ...entry.monitor, preview: entry.buffer.take() };
                this.retryJobs.add(entry.job);
                this.reg.notificationRetries.set(entry.job.id, () => {
                    if (this.epoch === epoch && this.valid(entry.job) && !entry.job.outcomeSurfaced && !this.inFlight.has(entry.job) && !this.pending.has(entry.job)) {
                        this.enqueue(pi, entry.job, payload, entry.summary, entry);
                    }
                });
                continue;
            }
            snapshot.push(entry);
        }
        if (!snapshot.length) { this.schedule(); return; }
        const previews = snapshot.map(entry => entry.buffer.take());
        const budgets = fairBudgets(previews, this.reg.config.outputPreviewChars);
        const reg = this.reg;
        function* wireItems(): Generator<MonitorBatchItem> {
            for (const [i, entry] of snapshot.entries()) {
                const buffer = new MonitorBuffer(reg.config.monitorMaxLinesPerEvent, budgets[i]!);
                buffer.add(previews[i]!);
                yield { jobId: entry.job.id, logPath: entry.job.logPath,
                    monitor: { ...entry.monitor, description: prefix(entry.monitor.description, 160),
                        ...(entry.monitor.note ? { note: prefix(entry.monitor.note, 512) } : {}), preview: buffer.take() },
                    ...(entry.summary ? { summary: prefix(entry.summary, 512) } : {}),
                    ...(entry.job.toolCallId ? { toolUseId: entry.job.toolCallId } : {}),
                    transitions: entry.transitions, omittedTransitions: entry.omittedTransitions };
            }
        }
        function* manifestSources(): Generator<ManifestSource> {
            for (const entry of snapshot) yield { jobId: entry.job.id, logPath: entry.job.logPath,
                state: entry.monitor.state, description: entry.monitor.description,
                transitions: entry.transitions, omittedTransitions: entry.omittedTransitions,
                summary: entry.summary, note: entry.monitor.note, silenceMs: entry.monitor.silenceMs,
                toolUseId: entry.job.toolCallId };
        }
        for (const [i, entry] of snapshot.entries()) if (terminal(entry.monitor.state)) {
            const payload = { ...entry.monitor, preview: previews[i]! };
            this.retryJobs.add(entry.job);
            this.reg.notificationRetries.set(entry.job.id, () => {
                if (this.epoch === epoch && this.valid(entry.job) && !entry.job.outcomeSurfaced &&
                    !this.inFlight.has(entry.job) && !this.pending.has(entry.job)) this.enqueue(pi, entry.job, payload, entry.summary, entry);
            });
        }
        let bounded = boundedMonitorBatch(wireItems(), snapshot.length);
        let payload = monitorBatchPayload(bounded.items);
        let manifestSaved = false;
        if (bounded.items.length < snapshot.length || !monitorPayloadFits(payload)) {
            try {
                const manifestPath = newMonitorManifestPath(this.reg.config.logDir);
                // Validate even the empty wire payload BEFORE filesystem work.
                // An unrepresentably long path becomes an explicit save failure,
                // never a truncated path or an over-capacity notification.
                bounded = boundedMonitorBatch(wireItems(), snapshot.length, { manifestPath });
                writeMonitorManifest(manifestPath, manifestSources(), snapshot.length, snapshot.length - bounded.items.length);
                manifestSaved = true;
            } catch (error) {
                bounded = boundedMonitorBatch(wireItems(), snapshot.length, { manifestError: "Could not save complete batch metadata; query source logs/jobs directly." });
                for (const entry of snapshot.slice(bounded.items.length)) if (this.valid(entry.job)) {
                    entry.job.notifyError = "Monitor batch manifest failed";
                }
                reportNotificationError("[process-tasks] monitor manifest failed:", error);
            }
            payload = bounded.payload;
        }
        const surfaced = manifestSaved ? snapshot : snapshot.slice(0, bounded.items.length);
        this.flushing = true;
        for (const entry of snapshot) this.inFlight.add(entry.job);
        try {
            pi.sendMessage({ customType: snapshot.some(entry => terminal(entry.monitor.state)) ? EVENT.taskNotification : EVENT.monitorEvent,
                ...payload, display: true,
            }, DELIVER_STEER);
            if (this.epoch === epoch && !this.closed && !this.reg.closed) {
                this.lastSubmission = Date.now();
                for (const entry of surfaced) if (this.valid(entry.job) && terminal(entry.monitor.state)) {
                    markOutcomeSurfaced(entry.job, this.reg);
                    this.reg.notificationRetries.delete(entry.job.id);
                }
                for (const entry of this.pending.values()) if (!entry.timely) entry.due = this.lastSubmission + this.reg.config.monitorFlushMs;
                this.reg.changed();
            }
        } catch (error) {
            if (this.epoch === epoch) for (const entry of snapshot) if (this.valid(entry.job) && !entry.job.outcomeSurfaced) {
                entry.job.notifyError = notificationError(error);
            }
            reportNotificationError("[process-tasks] monitor notification failed:", error);
        } finally {
            for (const entry of snapshot) this.inFlight.delete(entry.job);
            this.flushing = false;
            this.schedule();
        }
    }
}

/** Water-fill output budgets, redistributing unused shares from small sources. */
function fairBudgets(previews: MonitorPreview[], total: number): number[] {
    const sizes = previews.map(p => p.lines.reduce((n, line) => n + line.text.length, Math.max(0, p.lines.length - 1)));
    const budgets = sizes.map(() => 0);
    let remaining = total;
    let active = sizes.map((_, i) => i);
    while (active.length && remaining > 0) {
        const share = Math.max(1, Math.floor(remaining / active.length));
        for (const i of active) {
            const grant = Math.min(share, sizes[i]! - budgets[i]!, remaining);
            budgets[i]! += grant; remaining -= grant;
        }
        active = active.filter(i => budgets[i]! < sizes[i]!);
    }
    return budgets;
}
