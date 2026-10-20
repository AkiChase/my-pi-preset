import type { DetachReason, TaskControl, TaskDetail, TaskDetailRequest, TaskIdentity, TaskSource, TaskSourceView, TaskView, WaitLease, WaitOutcome, WaitRegistration } from "./types.ts";
import { taskKey } from "./types.ts";

/** One composition-owned coordinator; execution and terminal result ownership stay in backends. */
export class TaskCoordinator {
    private readonly waits = new Set<{ key: string; detach(reason: DetachReason): boolean; dispose(): boolean }>();
    private readonly sources = new Map<string, { source: TaskSource; unsubscribe: () => void }>();
    private readonly listeners = new Set<() => void>();
    private readonly waitListeners = new Set<() => void>();
    private closed = false;
    private accepting = true;
    private stamp = 0;

    get revision(): number { return this.stamp; }
    get waitCount(): number { return this.waits.size; }

    countWaits(identity: TaskIdentity): number {
        const key = taskKey(identity);
        let count = 0;
        for (const wait of this.waits) if (wait.key === key) count++;
        return count;
    }

    subscribe(listener: () => void): () => void {
        if (this.closed) return () => {};
        this.listeners.add(listener);
        return () => { this.listeners.delete(listener); };
    }

    subscribeWaits(listener: () => void): () => void {
        if (!this.closed) this.waitListeners.add(listener);
        return () => { this.waitListeners.delete(listener); };
    }

    private waitsChanged(): void {
        for (const listener of [...this.waitListeners]) {
            try { listener(); } catch (error) { console.error("[task-ui] wait subscription failed:", error); }
        }
        this.changed();
    }

    private changed(): void {
        this.stamp++;
        for (const listener of [...this.listeners]) {
            try { listener(); } catch (error) { console.error("[task-ui] subscription failed:", error); }
        }
    }

    /** Irreversible activation boundary; waits are cancelled only after backend freeze. */
    freezeAdmission(): void { this.accepting = false; }

    registerWait<T>(registration: WaitRegistration): WaitLease<T> {
        if (this.closed || !this.accepting) throw new Error("Task coordinator is disposed");
        let settled = false;
        let resolve!: (outcome: WaitOutcome<T>) => void;
        const result = new Promise<WaitOutcome<T>>((done) => { resolve = done; });
        const finish = (outcome: WaitOutcome<T>, callback?: () => void): boolean => {
            if (settled) return false;
            settled = true;
            registration.signal?.removeEventListener("abort", onAbort);
            this.waits.delete(entry);
            // Callbacks run synchronously: cancellation links must be removed before
            // detachAll returns, not on a later Promise continuation.
            try { callback?.(); } catch (error) { console.error("[task-ui] wait callback failed:", error); }
            try { registration.cleanup?.(); } catch (error) { console.error("[task-ui] wait cleanup failed:", error); }
            resolve(Object.freeze(outcome));
            this.waitsChanged();
            return true;
        };
        const lease: WaitLease<T> = {
            result,
            get settled() { return settled; },
            complete: (value) => finish({ kind: "completed", value }, registration.onComplete),
            detach: (reason = "manual") => finish({ kind: "detached", reason },
                registration.kind === "launch" ? () => registration.onDetach?.(reason) : undefined),
            interrupt: () => finish({ kind: "interrupted" },
                registration.kind === "launch" ? registration.onInterrupt : undefined),
            dispose: () => finish({ kind: "disposed" }, registration.onDispose),
        };
        const entry = { key: taskKey(registration.identity), detach: lease.detach, dispose: lease.dispose };
        const onAbort = () => { lease.interrupt(); };
        this.waits.add(entry);
        registration.signal?.addEventListener("abort", onAbort, { once: true });
        this.waitsChanged();
        if (registration.signal?.aborted) onAbort();
        return lease;
    }

    detachAll(reason: DetachReason = "manual"): number {
        let count = 0;
        for (const wait of [...this.waits]) {
            try { if (wait.detach(reason)) count++; } catch (error) {
                count++;
                console.error("[task-ui] detach callback failed:", error);
            }
        }
        return count;
    }

    /** Stage 3 can release old-epoch waits without destroying the composition instance. */
    cancelWaits(): void {
        for (const wait of [...this.waits]) {
            try { wait.dispose(); } catch (error) { console.error("[task-ui] wait disposal failed:", error); }
        }
    }

    registerSource(source: TaskSource): () => void {
        if (this.closed || !this.accepting) throw new Error("Task coordinator is disposed");
        if (this.sources.has(source.sourceId)) throw new Error(`Duplicate task source: ${source.sourceId}`);
        const unsubscribe = source.subscribe(() => { if (!this.closed) this.changed(); });
        if (this.closed || !this.accepting) { unsubscribe(); throw new Error("Task coordinator is disposed"); }
        const entry = { source, unsubscribe };
        this.sources.set(source.sourceId, entry);
        this.changed();
        return () => {
            if (this.sources.get(source.sourceId) !== entry) return;
            this.sources.delete(source.sourceId);
            try { entry.unsubscribe(); } catch (error) { console.error("[task-ui] source unsubscribe failed:", error); }
            this.changed();
        };
    }

    snapshot(): readonly TaskSourceView[] {
        return Object.freeze([...this.sources.values()].map(({ source }) => Object.freeze({
            sourceId: source.sourceId,
            revision: source.revision,
            tasks: source.list(),
        })));
    }

    list(): readonly TaskView[] { return this.closed ? Object.freeze([]) : Object.freeze(this.snapshot().flatMap((source) => source.tasks)); }

    /** Finite, identity-routed operations. Sources reject stale runs themselves. */
    detail(identity: TaskIdentity, request: TaskDetailRequest = {}): TaskDetail | undefined {
        if (this.closed || !this.accepting) return undefined;
        const source = this.sources.get(identity.sourceId)?.source;
        const current = () => !this.closed && this.accepting && this.sources.get(identity.sourceId)?.source === source;
        if (!source || !source.list().some(view => view.key === taskKey(identity) && view.capabilities.details) || !current()) return undefined;
        const limit = Number.isFinite(request.limit) ? Math.max(1, Math.min(16_000, Math.floor(request.limit!))) : 16_000;
        const offset = Number.isFinite(request.offset) ? Math.max(0, Math.floor(request.offset!)) : undefined;
        const paging = request.conversationPage;
        if (paging && ((paging.direction !== undefined && !["latest", "before", "after"].includes(paging.direction)) ||
            (paging.cursor !== undefined && (typeof paging.cursor !== "string" || paging.cursor.length > 256)) ||
            ((paging.direction === "before" || paging.direction === "after") && !paging.cursor))) return undefined;
        const conversationPage = paging ? Object.freeze({ ...paging,
            limit: Number.isFinite(paging.limit) ? Math.max(1, Math.min(64, Math.floor(paging.limit!))) : 64 }) : undefined;
        const detail = source.detail(identity, { limit, offset, ...(conversationPage ? { conversationPage } : {}) });
        // A synchronous source callback can unregister, close, or replace the run.
        if (!current() || !source.list().some(view => view.key === taskKey(identity) && view.capabilities.details) || !current()) return undefined;
        return detail && Object.freeze({ ...detail, text: detail.text.slice(0, limit) });
    }

    stop(identity: TaskIdentity): boolean {
        if (this.closed || !this.accepting) return false;
        const source = this.sources.get(identity.sourceId)?.source;
        if (!source || !source.list().some(view => view.key === taskKey(identity) && view.capabilities.stop)) return false;
        return source.stop(identity);
    }

    /** Routed only to a current identity that still advertises the capability. */
    private capable(identity: TaskIdentity, capability: "steer" | TaskControl): TaskSource | undefined {
        if (this.closed || !this.accepting) return undefined;
        const source = this.sources.get(identity.sourceId)?.source;
        return source?.list().some(view => view.key === taskKey(identity) && view.capabilities[capability] === true) ? source : undefined;
    }

    steer(identity: TaskIdentity, message: string): boolean {
        if (!message.trim()) return false;
        return this.capable(identity, "steer")?.steer?.(identity, message) ?? false;
    }

    control(identity: TaskIdentity, action: TaskControl): boolean {
        return this.capable(identity, action)?.control?.(identity, action) ?? false;
    }


    dispose(): void {
        if (this.closed) return;
        this.closed = true;
        this.freezeAdmission();
        this.cancelWaits();
        for (const { source, unsubscribe } of this.sources.values()) {
            try { unsubscribe(); } catch (error) { console.error("[task-ui] source unsubscribe failed:", error); }
            try { source.dispose(); } catch (error) { console.error("[task-ui] source disposal failed:", error); }
        }
        this.sources.clear();
        this.listeners.clear();
        this.waitListeners.clear();
    }
}
