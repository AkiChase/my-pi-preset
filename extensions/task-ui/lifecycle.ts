import type { TaskCoordinator } from "./coordinator.ts";

/** Backends own execution references. The composition owns shutdown ordering. */
export interface TaskLifecycleParticipant {
    readonly name: string;
    /** Synchronous: close admission AND disarm every outward notification path. */
    freeze(): void;
    /** Synchronous silent cancellation; must not flush monitor batches. */
    stop(): void;
    /** Await actual execution/startup/worker cleanup, not a terminal result promise. */
    drain(): Promise<void>;
    /** Release sources/subscriptions after all participants have drained. */
    dispose(): void;
}

export type TaskActivationPhase = "active" | "closing" | "closed";

/** One instance per factory activation; a disposed activation is never resurrected. */
export class TaskLifecycle {
    private readonly participants = new Set<TaskLifecycleParticipant>();
    private readonly closeHooks = new Set<() => void>();
    private closing: Promise<void> | undefined;
    private phaseValue: TaskActivationPhase = "active";
    private readonly coordinator: TaskCoordinator;
    private readonly drainTimeoutMs: number;
    constructor(coordinator: TaskCoordinator, drainTimeoutMs = 2_000) {
        this.coordinator = coordinator;
        this.drainTimeoutMs = drainTimeoutMs;
    }

    get phase(): TaskActivationPhase { return this.phaseValue; }
    get active(): boolean { return this.phaseValue === "active"; }

    register(participant: TaskLifecycleParticipant): () => void {
        if (!this.active) throw new Error("Task activation is closing");
        this.participants.add(participant);
        return () => { this.participants.delete(participant); };
    }

    /** Future panel/editor/footer owners register synchronous teardown here. */
    onClose(callback: () => void): () => void {
        if (!this.active) { this.safely("late close hook", callback); return () => {}; }
        this.closeHooks.add(callback);
        return () => { this.closeHooks.delete(callback); };
    }

    private safely(label: string, callback: () => void): void {
        try { callback(); } catch (error) { console.error(`[task-ui] ${label} failed:`, error); }
    }

    /** Freeze ALL backends before wait callbacks can trigger any cancellation. */
    shutdown(): Promise<void> {
        if (this.closing) return this.closing;
        this.phaseValue = "closing";
        const participants = [...this.participants];
        // Publish the stable promise before invoking reentrant cleanup callbacks.
        let resolve!: () => void;
        this.closing = new Promise<void>((done) => { resolve = done; });
        this.coordinator.freezeAdmission();
        for (const p of participants) this.safely(`${p.name} freeze`, () => p.freeze());
        for (const hook of this.closeHooks) this.safely("close hook", hook);
        this.closeHooks.clear();
        this.coordinator.cancelWaits();
        for (const p of participants) this.safely(`${p.name} stop`, () => p.stop());
        void Promise.all(participants.map(async (p) => {
            let timer: NodeJS.Timeout | undefined;
            try {
                await Promise.race([
                    Promise.resolve().then(() => p.drain()),
                    new Promise<void>((done) => { timer = setTimeout(() => {
                        console.error(`[task-ui] ${p.name} cleanup timed out`);
                        done();
                    }, this.drainTimeoutMs); }),
                ]);
            } catch (error) { console.error(`[task-ui] ${p.name} drain failed:`, error); }
            finally { clearTimeout(timer); }
        })).then(() => {
            for (const p of participants) this.safely(`${p.name} dispose`, () => p.dispose());
            this.safely("coordinator dispose", () => this.coordinator.dispose());
            this.participants.clear();
            this.phaseValue = "closed";
            resolve();
        });
        return this.closing;
    }
}
