import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { RuntimeTaskCapability } from "./facade.ts";
import type { TaskLifecycle } from "../task-ui/lifecycle.ts";
import { REMINDER_SYSTEM_RULE, REMINDER_TAG, buildReminder, reminderCandidates } from "./reminder.ts";

export const REMINDER_CUSTOM_TYPE = REMINDER_TAG;
export const REMINDER_SECTION = "background_task_reminder";

export interface BackgroundReminderOptions {
    readonly capabilities: () => readonly RuntimeTaskCapability[];
    readonly lifecycle: TaskLifecycle;
    /** Main-model requests between reminders; 0 disables periodic reminders only. */
    readonly interval: number;
    readonly now?: () => number;
}

/**
 * Appends hidden reminders through ordinary session boundaries before the request they target:
 * turn_end (after the assistant and all tool results) and before_agent_start (after pre-run
 * compaction). Requests are only counted in `context`; messages are never modified there.
 * Known limit: a compaction run between turn_end and the next request delivers its fresh
 * reminder one request late, because no public boundary exists after that compaction.
 */
export function registerBackgroundReminder(pi: ExtensionAPI, options: BackgroundReminderOptions): () => void {
    let closed = false;
    let requests = 0, scheduledFor = -1, pendingCompact = false;
    const live = () => !closed && options.lifecycle.active;
    const due = (request: number) => options.interval > 0 && request % options.interval === 0;
    const build = (): string | undefined => {
        try { return buildReminder(reminderCandidates(options.capabilities()), (options.now ?? Date.now)()); }
        catch (error) { console.error("[task-reminder] snapshot failed:", error); return undefined; }
    };
    /** Returns reminder text for the next request when it is due and not yet written. */
    const take = (): string | undefined => {
        const next = requests + 1;
        const periodic = due(next) && scheduledFor !== next;
        if (!periodic && !pendingCompact) return undefined;
        pendingCompact = false;
        const text = build();
        if (text !== undefined) scheduledFor = next;
        return text;
    };
    const offs = [
        pi.on("session_start", () => { requests = 0; scheduledFor = -1; pendingCompact = false; }),
        pi.on("context", () => { if (live()) requests++; }),
        pi.on("session_compact", () => { if (live()) pendingCompact = true; }),
        pi.on("turn_end", (event) => {
            if (!live()) return undefined;
            const content = take();
            return content === undefined ? undefined
                : { entries: [...event.entries, { type: "custom_message" as const, customType: REMINDER_CUSTOM_TYPE, content, display: false }] };
        }),
        pi.on("before_agent_start", (event) => {
            if (!live()) return undefined;
            event.systemPromptOptions.sections[REMINDER_SECTION] = REMINDER_SYSTEM_RULE;
            const content = take();
            return content === undefined ? undefined : { message: { customType: REMINDER_CUSTOM_TYPE, content, display: false } };
        }),
    ];
    const dispose = () => {
        if (closed) return;
        closed = true;
        for (const off of offs) { try { off(); } catch { /* isolate host cleanup */ } }
    };
    options.lifecycle.onClose(dispose);
    return dispose;
}
