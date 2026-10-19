export interface TaskIdentity {
    readonly sourceId: string;
    readonly taskId: string;
    readonly runId: string;
}

/** JSON tuple encoding prevents collisions even when backend IDs contain separators. */
export function taskKey(identity: TaskIdentity): string {
    return JSON.stringify([identity.sourceId, identity.taskId, identity.runId]);
}

export type TaskKind = "shell" | "monitor" | "agent" | "workflow";
export type TaskExecutionMode = "foreground" | "background" | "owned";
export type TaskStatus = "starting" | "queued" | "running" | "paused" | "completed" | "failed" | "stopped";

export interface TaskView extends TaskIdentity {
    readonly key: string;
    readonly parentKey?: string;
    readonly kind: TaskKind;
    readonly title: string;
    readonly description?: string;
    /** Model-facing short name supplied by the caller; never derived from commands or prompts. */
    readonly reminderTitle?: string;
    readonly status: TaskStatus;
    readonly executionMode: TaskExecutionMode;
    readonly waitCount: number;
    readonly startedAt?: number;
    readonly endedAt?: number;
    readonly executionConfig?: import("../runtime-tasks/execution-config.ts").ExecutionConfig;
    readonly stats: Readonly<{
        pid?: number; exitCode?: number; durationMs?: number;
        tokens?: number; inputTokens?: number; outputTokens?: number; cost?: number;
        toolUses?: number; turnCount?: number; maxTurns?: number; activity?: string;
        model?: string; thinking?: string;
        doneCount?: number; totalCount?: number;
        phases?: readonly Readonly<{ index: number; title: string; detail?: string }>[];
    }>;
    readonly artifacts: readonly Readonly<{ kind: "log" | "conversation" | "worktree"; path: string }>[];
    readonly capabilities: Readonly<{ stop: boolean; details: boolean }>;
}

export interface TaskDetailRequest {
    readonly offset?: number;
    readonly limit?: number;
}

export interface TaskDetail {
    readonly text: string;
    readonly path?: string;
    readonly start?: number;
    readonly end?: number;
    readonly size?: number;
    readonly omittedBefore?: number;
    readonly omittedAfter?: number;
}

/** Sources expose read models and finite operations, never runtime records or sessions. */
export interface TaskSource {
    readonly sourceId: string;
    readonly revision: number;
    list(): readonly TaskView[];
    detail(identity: TaskIdentity, request?: TaskDetailRequest): TaskDetail | undefined;
    stop(identity: TaskIdentity): boolean;
    subscribe(listener: () => void): () => void;
    dispose(): void;
}

export interface TaskSourceView {
    readonly sourceId: string;
    readonly revision: number;
    readonly tasks: readonly TaskView[];
}

export type WaitKind = "launch" | "retrieval";
export type DetachReason = "manual" | "timeout";
export type WaitOutcome<T> =
    | Readonly<{ kind: "completed"; value: T }>
    | Readonly<{ kind: "detached"; reason: DetachReason }>
    | Readonly<{ kind: "interrupted" | "disposed" }>;

export interface WaitLease<T> {
    readonly result: Promise<WaitOutcome<T>>;
    readonly settled: boolean;
    complete(value: T): boolean;
    detach(reason?: DetachReason): boolean;
    interrupt(): boolean;
    dispose(): boolean;
}

export interface WaitRegistration {
    readonly identity: TaskIdentity;
    readonly label: string;
    readonly kind: WaitKind;
    readonly signal?: AbortSignal;
    /** Only launch leases change execution ownership. */
    readonly onDetach?: (reason: DetachReason) => void;
    /** Launch interruption stops execution; retrieval interruption does not. */
    readonly onInterrupt?: () => void;
    readonly onDispose?: () => void;
    /** Backend consumption runs atomically before wait suppression is released. */
    readonly onComplete?: () => void;
    readonly cleanup?: () => void;
}
