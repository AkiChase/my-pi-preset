import type { RuntimeTaskCapability } from "./facade.ts";
import type { TaskView } from "../task-ui/types.ts";

export const REMINDER_TAG = "background-task-reminder";
/** Constant model-facing rule; dynamic task data never enters the system prompt. */
export const REMINDER_SYSTEM_RULE = `Periodic <${REMINDER_TAG}> messages help you remember outstanding
background work. They are not a live or complete task list. Use the corresponding
task-management tools when you need current status or a full list. Do not forget
pending results or duplicate delegated work; completion notifications arrive
automatically.`;

export const REMINDER_MAX_ITEMS = 12;
export const REMINDER_MAX_CHARS = 4_000;
const TITLE_MAX = 60;
const ID_MAX = 256;
const KIND_ORDER = ["agent", "workflow", "shell", "monitor"] as const;
const ACTIVE = new Set<TaskView["status"]>(["starting", "queued", "running", "paused"]);

/** One line, bounded, and unable to open or close the reminder tag. */
export function reminderText(value: string | undefined, max = TITLE_MAX): string | undefined {
    if (!value) return undefined;
    const text = value
        .replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, " ")
        .replace(/\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)/g, " ")
        .replace(/[\u0000-\u001f\u007f-\u009f]/g, " ")
        .replace(/</g, "‹").replace(/>/g, "›").replace(/\|/g, "/")
        .replace(/\s+/g, " ").trim();
    if (!text) return undefined;
    const chars = [...text];
    return chars.length > max ? `${chars.slice(0, max - 1).join("").trimEnd()}…` : text;
}

export function reminderDuration(ms: number): string {
    const seconds = Math.max(0, Math.floor(ms / 1000));
    if (seconds < 60) return `${seconds}s`;
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m`;
    const hours = Math.floor(minutes / 60), rest = minutes % 60;
    return rest ? `${hours}h${rest}m` : `${hours}h`;
}

function identity(view: TaskView): string[] | undefined {
    const ids = view.kind === "agent" ? [`agent_id=${view.taskId}`] : [view.taskId];
    return ids.every(id => id.length > 0 && id.length <= ID_MAX && !/[\s|<>]/.test(id)) ? ids : undefined;
}

function name(view: TaskView): string {
    const preferred = view.kind === "agent" ? view.description ?? view.title
        : view.kind === "workflow" ? view.title : view.reminderTitle;
    return reminderText(preferred) ?? view.kind;
}

function line(view: TaskView, now: number): string | undefined {
    const ids = identity(view);
    if (!ids) return undefined;
    const fields = [view.kind, ...ids, name(view)];
    if (view.kind === "monitor" && view.status === "running") fields.push("watching");
    else if (view.status !== "running") fields.push(view.status);
    const { doneCount: done, totalCount: total } = view.stats;
    if (view.kind === "workflow" && Number.isSafeInteger(done) && Number.isSafeInteger(total) && total! > 0 && done! >= 0 && done! <= total!)
        fields.push(`${done}/${total} done`);
    if (view.waitCount > 0) fields.push("main-waiting");
    if (view.startedAt !== undefined && Number.isFinite(view.startedAt)) fields.push(reminderDuration(now - view.startedAt));
    return fields.join(" | ");
}

/** Manageable, non-terminal background roots of this activation; owned children stay with their owner. */
export function reminderCandidates(capabilities: readonly RuntimeTaskCapability[]): TaskView[] {
    const seen = new Set<string>();
    const views: TaskView[] = [];
    for (const capability of capabilities) {
        for (const entry of capability.list()) {
            const view = entry.view;
            if (!entry.manageable || !ACTIVE.has(view.status) || view.executionMode !== "background" || view.parentKey) continue;
            if (!(KIND_ORDER as readonly string[]).includes(view.kind) || seen.has(view.key)) continue;
            seen.add(view.key);
            views.push(view);
        }
    }
    return views.sort((a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind)
        || (a.startedAt ?? Infinity) - (b.startedAt ?? Infinity) || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
}

/** Bounded reminder body, or undefined when no background work is outstanding. */
export function buildReminder(views: readonly TaskView[], now = Date.now()): string | undefined {
    if (views.length === 0) return undefined;
    const open = `<${REMINDER_TAG}>`, close = `</${REMINDER_TAG}>`;
    const lines = views.map(view => line(view, now));
    const reserve = `… ${views.length} more`.length + 1;
    const chosen = new Set<number>();
    let size = open.length + 1 + close.length;
    const tryAdd = (index: number) => {
        const text = lines[index];
        if (text === undefined || chosen.has(index) || chosen.size >= REMINDER_MAX_ITEMS) return;
        if (size + text.length + 1 + reserve > REMINDER_MAX_CHARS) return;
        chosen.add(index); size += text.length + 1;
    };
    // One representative per present kind first, then fill in stable order.
    for (const kind of KIND_ORDER) tryAdd(views.findIndex(view => view.kind === kind));
    for (let index = 0; index < views.length; index++) tryAdd(index);
    const body = [...chosen].sort((a, b) => a - b).map(index => lines[index]!);
    const omitted = views.length - chosen.size;
    if (omitted > 0) body.push(`… ${omitted} more`);
    return [open, ...body, close].join("\n");
}
