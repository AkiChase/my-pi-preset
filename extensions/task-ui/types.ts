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
export type TaskStatus = "starting" | "queued" | "running" | "paused" | "completed" | "failed" | "stopped" | "interrupted";

/** Bounded actual execution facts; elapsed is sampled by the source, never inferred from history. */
export interface ToolCallState {
    readonly toolCallId: string;
    readonly name: string;
    readonly status: "running" | "completed" | "failed" | "interrupted";
    readonly elapsedMs?: number;
    readonly durationMs?: number;
}

export interface PendingMessage {
    readonly id: string; readonly text: string; readonly state: "pending" | "submitting" | "failed" | "handled" | "notDelivered";
    readonly error?: string; readonly truncated?: boolean; readonly restorable?: boolean;
}
export interface PendingMessages { readonly entries: readonly PendingMessage[]; readonly omitted: number }

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
        /** One-line preview of the latest message the running task sent to its parent. */
        latestMessage?: string;
        toolCalls?: readonly ToolCallState[];
        pendingMessages?: PendingMessages;
        /** Terminal metadata can precede actual runner/cleanup exit. */
        settling?: boolean;
        model?: string; thinking?: string;
        doneCount?: number; totalCount?: number;
        phases?: readonly Readonly<{ index: number; title: string; detail?: string }>[];
    }>;
    readonly artifacts: readonly Readonly<{ kind: "log" | "conversation" | "worktree"; path: string }>[];
    /** Optional finite operations; absent means unsupported. */
    readonly capabilities: Readonly<{ stop: boolean; details: boolean; steer?: boolean } & { readonly [K in TaskControl]?: boolean }>;
}

/** Workflow-level (pause/resume) and workflow-child (skip/retry) controls. */
export type TaskControl = "pause" | "resume" | "skip" | "retry";

export interface TaskDetailRequest {
    readonly offset?: number;
    readonly limit?: number;
    readonly conversationPage?: ConversationPageRequest;
}

/** Opaque cursors belong to one source activation and task/run. */
export interface ConversationPageRequest {
    readonly direction?: "latest" | "before" | "after";
    readonly cursor?: string;
    readonly limit?: number;
}
export interface ConversationPage {
    readonly entries: readonly ConversationEntry[];
    readonly before?: string;
    readonly after?: string;
    readonly hasOlder: boolean;
    readonly hasNewer: boolean;
    readonly source: "live" | "transcript" | "unavailable";
    readonly status: "ok" | "reset" | "unavailable";
    readonly hint?: string;
    readonly budgetLimited: boolean;
    readonly scannedMessages: number;
    readonly scannedBytes: number;
    readonly generation: string;
}
export interface ToolDataSummary {
    readonly kind: "read" | "write" | "edit" | "bash";
    readonly command?: string;
    readonly path?: string;
    readonly offset?: number;
    readonly limit?: number;
    readonly lines?: number;
    readonly bytes?: number;
    readonly addedLines?: number;
    readonly removedLines?: number;
}
export interface ToolParameters { readonly status: "complete" | "truncated" | "unavailable"; readonly json?: string }
export interface ToolResultDisplay { readonly status: "complete" | "truncated" | "unavailable"; readonly diff?: string; readonly firstChangedLine?: number; readonly diffTruncated?: boolean;
    /** Audited process launch identity only; never arbitrary execution details. */
    readonly runtimeLaunch?: Extract<import("../runtime-tasks/launch.ts").RuntimeLaunchMetadata, { task_type: "bash" | "monitor" }>;
}
export interface ToolCallSummary { readonly name: string; readonly detail?: string; readonly toolCallId?: string; readonly summary?: ToolDataSummary; readonly parameters?: ToolParameters }
/** All text is external and unstyled; renderers sanitize before applying host styles.
 * toolResult.elided counts only inspected text; sourceTruncated means additional
 * blocks were not inspected and must be described without an invented count.
 */
export type ConversationEntry = Readonly<{ id?: string }> & (
    | Readonly<{ kind: "user"; text: string }>
    | Readonly<{ kind: "assistant"; text: string; tools: readonly ToolCallSummary[] }>
    | Readonly<{ kind: "toolResult"; name?: string; text: string; elided: number; sourceTruncated?: boolean; error?: boolean; durationMs?: number; toolCallId?: string; summary?: ToolDataSummary; callDetail?: string; call?: ToolCallSummary; display?: ToolResultDisplay }>
    | Readonly<{ kind: "bash"; command: string; output: string; elided: number; exitCode?: number }>
    | Readonly<{ kind: "notice"; text: string }>);

/** Parent/child message exchange of one execution; text is external and unstyled. */
export type TaskMessageEntry =
    | Readonly<{ kind: "question"; requestId: string; state: "pending" | "replied" | "failed" | "closed"; text: string; at: number }>
    | Readonly<{ kind: "reply"; requestId: string; text: string; at: number }>
    | Readonly<{ kind: "notice"; text: string; at: number }>;

export interface TaskDetail {
    readonly text: string;
    /** Parent/child messages of this execution, oldest first. */
    readonly messages?: readonly TaskMessageEntry[];
    /** Number of older messages omitted to respect the detail request's byte budget. */
    readonly messagesOmitted?: number;
    /** Structured, bounded, unstyled conversation; renderers prefer it over `text`. */
    readonly conversation?: readonly ConversationEntry[];
    /** Optional paging metadata; absent on sources without structured history. */
    readonly conversationPage?: ConversationPage;
    /** True when older conversation entries were dropped by the source bound. */
    readonly conversationTruncated?: boolean;
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
    /** Deliver a user message to a running task; false when no longer accepted. */
    steer?(identity: TaskIdentity, message: string, replaceId?: string): boolean;
    control?(identity: TaskIdentity, action: TaskControl): boolean;
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
