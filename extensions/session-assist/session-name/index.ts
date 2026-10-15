import type { ExtensionAPI, ExtensionContext, SessionEntry } from "@earendil-works/pi-coding-agent";
import { branchIdentity } from "../shared/context.ts";
import { failureDetail } from "../shared/errors.ts";
import { buildMaterial } from "../shared/material.ts";
import { generateText, RequestCancelled } from "../shared/request.ts";
import { DEFAULTS, loadConfig, saveConfig, type NameConfig } from "./config.ts";
import { readTitle, TITLE_PROMPT } from "./title.ts";

export const STATE_TYPE = "preset.session-name.v2";
export const LEGACY_STATE_TYPE = "preset.session-name.v1";
/** Naming uses a fixed shared-material budget; Recap keeps its own configurable budget. */
export const MATERIAL_BUDGET = 32_000;
type Phase = "first" | "second" | "finished";
const PHASES: readonly Phase[] = ["first", "second", "finished"];
/**
 * Session-level automatic quota. `anchor` is the counted input total when the first chance started;
 * `lastCountedId` is the latest counted user message, so later boundaries only scan newer entries.
 */
interface Quota { phase: Phase; count: number; anchor: number | null; lastCountedId: string | null }
interface Ownership { titleEntryId: string | null; title: string | null; owned: boolean }
interface Stored { version: 2; quota: Quota; ownership: Ownership }
interface Candidate { text: string; eligible: boolean; after: Set<string> }

function textOf(content: string | readonly { type: string; text?: string }[]): string {
    return typeof content === "string" ? content : content.filter(part => part.type === "text").map(part => part.text ?? "").join("\n");
}
function latestTitle(ctx: ExtensionContext): { id: string | null; name: string | null } {
    const title = ctx.sessionManager.getEntries().findLast(entry => entry.type === "session_info");
    return { id: title?.id ?? null, name: ctx.sessionManager.getSessionName() ?? null };
}
const record = (value: unknown): Record<string, unknown> | undefined =>
    value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
const count = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
function ownershipOf(value: unknown): Ownership | undefined {
    const own = record(value);
    if (!own || (own.titleEntryId !== null && typeof own.titleEntryId !== "string") ||
        (own.title !== null && typeof own.title !== "string") || typeof own.owned !== "boolean") return undefined;
    return { titleEntryId: own.titleEntryId as string | null, title: own.title as string | null, owned: own.owned };
}
function quotaOf(value: unknown): Quota | undefined {
    const quota = record(value);
    if (!quota || !PHASES.includes(quota.phase as Phase) || !count(quota.count) ||
        !(quota.anchor === null || (count(quota.anchor) && quota.anchor <= quota.count)) ||
        // The second chance is scheduled from the anchor; without it the entry is unusable.
        (quota.phase === "second" && quota.anchor === null) ||
        !(quota.lastCountedId === null || typeof quota.lastCountedId === "string")) return undefined;
    return { phase: quota.phase as Phase, count: quota.count, anchor: quota.anchor as number | null, lastCountedId: quota.lastCountedId as string | null };
}
function custom(entry: SessionEntry, type: string): Record<string, unknown> | undefined {
    return entry.type === "custom" && entry.customType === type ? record(entry.data) : undefined;
}
const FRESH: Quota = { phase: "first", count: 0, anchor: null, lastCountedId: null };
/**
 * Quota comes from the latest valid v2 entry in whole-session append order, never the current branch,
 * so branch navigation, reload and resume keep using it. v1 or unreadable state simply starts fresh:
 * an extra automatic rename is acceptable, and manual or unknown titles stay protected by ownership.
 */
function restoreQuota(entries: SessionEntry[]): Quota {
    for (let index = entries.length - 1; index >= 0; index--) {
        const data = custom(entries[index], STATE_TYPE);
        const quota = data?.version === 2 ? quotaOf(data.quota) : undefined;
        if (quota) return quota;
    }
    return { ...FRESH };
}
function restoreOwnership(entries: SessionEntry[]): Ownership | undefined {
    for (let index = entries.length - 1; index >= 0; index--) {
        const data = custom(entries[index], STATE_TYPE) ?? custom(entries[index], LEGACY_STATE_TYPE);
        const ownership = data ? ownershipOf(data.ownership) : undefined;
        if (ownership) return ownership;
    }
    return undefined;
}

export default function registerSessionName(pi: ExtensionAPI): void {
    let active = false;
    let config: NameConfig = { ...DEFAULTS };
    let configWarning = false;
    let epoch = 0;
    let controller: AbortController | undefined;
    let quota: Quota = { ...FRESH };
    let ownership: Ownership = { titleEntryId: null, title: null, owned: false };
    let candidates: Candidate[] = [];
    let sessionId: string | undefined;
    let writingTitle = false;
    let manualGeneration = 0;
    let manualPending: number | undefined;

    const cancel = () => { epoch++; controller?.abort(); controller = undefined; };
    const persist = () => pi.appendEntry<Stored>(STATE_TYPE, { version: 2,
        quota: { ...quota }, ownership: { ...ownership } });
    const notify = (ctx: ExtensionContext, text: string, severity: "info" | "warning" | "error") => {
        if (active && ctx.sessionManager.getSessionId() === sessionId) ctx.ui.notify(text, severity);
    };
    const remaining = () => ownership.title !== null && !ownership.owned ? "automatic paused for the current title" :
        quota.phase === "first" ? "2 automatic attempts left" :
        quota.phase === "second" ? "1 automatic attempt left" : "automatic attempts finished";
    /** The second chance needs N inputs after the first input and a new input after the first chance started. */
    function dueChance(): Phase | undefined {
        if (quota.phase === "first") return quota.count > 0 ? "first" : undefined;
        if (quota.phase === "second" && quota.anchor !== null &&
            quota.count >= Math.max(1 + config.interval, quota.anchor + 1)) return "second";
        return undefined;
    }
    /** Counted inputs still needed before the second chance becomes due. */
    function inputsUntilSecond(): number {
        return Math.max(1 + config.interval, (quota.anchor ?? quota.count) + 1) - quota.count;
    }
    function restore(ctx: ExtensionContext): void {
        cancel();
        manualGeneration++;
        manualPending = undefined;
        active = true;
        sessionId = ctx.sessionManager.getSessionId();
        candidates = [];
        const entries = ctx.sessionManager.getEntries();
        quota = restoreQuota(entries);
        const own = restoreOwnership(entries);
        const title = latestTitle(ctx);
        ownership = own && own.titleEntryId === title.id && own.title === title.name ? { ...own } :
            { titleEntryId: title.id, title: title.name, owned: false };
        try { config = loadConfig(); configWarning = false; } catch { config = { ...DEFAULTS }; configWarning = true; }
        if (configWarning) notify(ctx, "Could not load session-name configuration; using defaults. Fix session-name.json before saving changes.", "warning");
    }
    function checkOwnership(ctx: ExtensionContext): void {
        const title = latestTitle(ctx);
        if (title.id !== ownership.titleEntryId || title.name !== ownership.title) {
            cancel();
            ownership = { titleEntryId: title.id, title: title.name, owned: false };
            persist();
        }
    }
    function collectDelivered(ctx: ExtensionContext): boolean {
        const branch = ctx.sessionManager.getBranch();
        // Candidate `after` sets already exclude older messages; the last counted id is a cheap extra guard.
        const start = quota.lastCountedId === null ? 0 : branch.findIndex(entry => entry.id === quota.lastCountedId) + 1;
        const delivered = branch.slice(start).filter(entry => entry.type === "message" && entry.message.role === "user");
        let changed = false;
        for (const entry of delivered) {
            if (entry.type !== "message" || entry.message.role !== "user") continue;
            const text = textOf(entry.message.content);
            const matches = candidates.filter(candidate => !candidate.after.has(entry.id) && candidate.text === text);
            // Unknown provenance, duplicate candidates and transformed text are deliberately not guessed.
            if (matches.length !== 1 || !matches[0].eligible) continue;
            const matchingMessages = delivered.filter(other => other.type === "message" && other.message.role === "user" &&
                !matches[0].after.has(other.id) && textOf(other.message.content) === text);
            if (matchingMessages.length !== 1) continue;
            quota.count++;
            quota.lastCountedId = entry.id;
            changed = true;
        }
        candidates = [];
        return changed;
    }
    async function evaluate(ctx: ExtensionContext, manual: boolean): Promise<void> {
        if (!active || ctx.sessionManager.getSessionId() !== sessionId) return;
        checkOwnership(ctx);
        const chance = manual ? undefined : dueChance();
        if (!manual && (!chance || !config.automatic || (ownership.title !== null && !ownership.owned))) return;
        const material = buildMaterial(ctx.sessionManager, MATERIAL_BUDGET);
        if (material.empty) {
            // No request is sent, so an automatic chance remains unstarted.
            if (manual) notify(ctx, "Session name refresh failed: No conversation available; previous title kept.", "error");
            return;
        }
        // Without a model no request can be sent, so an automatic chance stays unstarted.
        if (chance && !ctx.model) return;
        cancel();
        if (chance) {
            // Persist consumption before the request: failure, cancellation or resume never re-issues it.
            quota = chance === "first" ? { ...quota, phase: "second", anchor: quota.count } : { ...quota, phase: "finished" };
            persist();
        }
        const requestEpoch = epoch;
        const requestController = new AbortController();
        controller = requestController;
        const expectedTitle = latestTitle(ctx);
        const expectedBranch = branchIdentity(ctx.sessionManager);
        const model = ctx.model;
        const thinking = pi.getThinkingLevel();
        const valid = () => active && epoch === requestEpoch && !requestController.signal.aborted &&
            ctx.sessionManager.getSessionId() === sessionId && branchIdentity(ctx.sessionManager) === expectedBranch &&
            buildMaterial(ctx.sessionManager, MATERIAL_BUDGET).identity === material.identity &&
            latestTitle(ctx).id === expectedTitle.id && latestTitle(ctx).name === expectedTitle.name;
        try {
            if (!model) throw new Error("No model selected");
            const response = await generateText({ registry: ctx.modelRegistry, model, thinking,
                sessionId: ctx.sessionManager.getSessionId(), systemPrompt: TITLE_PROMPT,
                data: undefined, textMaterial: material.text, signal: requestController.signal });
            const title = readTitle(response);
            if (!valid()) return;
            const beforeWriteIds = new Set(ctx.sessionManager.getEntries().filter(entry => entry.type === "session_info").map(entry => entry.id));
            if (title !== expectedTitle.name) {
                writingTitle = true;
                try { pi.setSessionName(title); } finally { writingTitle = false; }
            }
            const written = latestTitle(ctx);
            // setSessionName can reenter other extensions; never claim their different final write.
            const writes = ctx.sessionManager.getEntries().filter(entry => entry.type === "session_info" && !beforeWriteIds.has(entry.id));
            if (!active || epoch !== requestEpoch || written.name !== title) return;
            if (title !== expectedTitle.name && (writes.length !== 1 || writes[0].id !== written.id)) {
                ownership = { titleEntryId: written.id, title: written.name, owned: false };
                persist();
                return;
            }
            // A manually requested title belongs to the user: automatic naming never replaces it.
            ownership = { titleEntryId: written.id, title, owned: !manual };
            persist();
            if (manual) notify(ctx, `Session name: ${title}`, "info");
        } catch (error) {
            if (error instanceof RequestCancelled || !valid()) return;
            const detail = failureDetail(error);
            const consequence = chance === "first"
                ? `One automatic attempt remains after ${inputsUntilSecond()} more user inputs; run /session-name to retry now.`
                : "Automatic naming is finished for this session; run /session-name to retry.";
            notify(ctx, manual ? `Session name refresh failed: ${detail}; previous title kept.` :
                `Automatic session naming failed: ${detail}; previous title kept. ${consequence}`, "error");
        } finally {
            if (controller === requestController) controller = undefined;
        }
    }

    pi.on("session_start", (_event, ctx) => restore(ctx));
    pi.on("session_tree", (_event, ctx) => restore(ctx));
    pi.on("session_before_tree", () => { cancel(); manualGeneration++; manualPending = undefined; candidates = []; });
    pi.on("session_before_switch", () => { cancel(); manualGeneration++; manualPending = undefined; candidates = []; });
    pi.on("session_shutdown", () => { cancel(); manualGeneration++; manualPending = undefined; active = false; sessionId = undefined; candidates = []; });
    pi.on("session_info_changed", (_event, ctx) => {
        // Deferral only resolves synchronous host reentry; ownership is always checked by entry identity.
        if (writingTitle) queueMicrotask(() => { if (active) checkOwnership(ctx); });
        else if (active) checkOwnership(ctx);
    });
    pi.on("agent_start", () => cancel());
    pi.on("input", (event, ctx) => {
        if (!active) return;
        cancel();
        manualGeneration++;
        manualPending = undefined;
        // Extension input can be transformed downstream into an older handled input's text.
        // Discard earlier attribution evidence rather than crediting an injected delivery.
        if (event.source === "extension") candidates = [];
        candidates.push({ text: event.text, eligible: event.source !== "extension" &&
            !event.text.trimStart().startsWith("/") && !!event.text.trim(),
            after: new Set(ctx.sessionManager.getBranch().map(entry => entry.id)) });
    });
    pi.on("agent_settled", (event, ctx) => {
        if (!active) return;
        checkOwnership(ctx);
        // Finished sessions no longer need input progress; only ownership remains tracked.
        if (quota.phase === "finished") { candidates = []; return; }
        if (collectDelivered(ctx)) persist();
        // Aborted boundaries never start a chance; do not hold the notification-only dispatch on a provider.
        if (!event.aborted && dueChance() && manualPending === undefined) void evaluate(ctx, false).catch(() => {});
    });
    pi.registerCommand("session-name", {
        description: "Generate the session title, or configure automatic naming",
        getArgumentCompletions: prefix => "config".startsWith(prefix) ? [{ value: "config", label: "config" }] : null,
        handler: async (args, ctx) => {
            if (!active) restore(ctx);
            if (args.trim() === "config") {
                if (!ctx.hasUI) { notify(ctx, "Session-name configuration requires an interactive UI.", "warning"); return; }
                const choice = await ctx.ui.select(`Session naming (automatic ${config.automatic ? "on" : "off"}, N=${config.interval}, ${remaining()} in this session)`,
                    ["Enable automatic naming", "Disable automatic naming", "Set interval"]);
                if (!choice || !active) return;
                let next = { ...config };
                if (choice === "Set interval") {
                    const raw = await ctx.ui.input("User inputs before the second automatic naming (1–10000)", String(config.interval));
                    if (raw === undefined || !active) return;
                    const interval = Number(raw);
                    if (!raw.trim() || !Number.isSafeInteger(interval) || interval < 1 || interval > 10_000) {
                        notify(ctx, "Interval must be an integer between 1 and 10000.", "error"); return;
                    }
                    next.interval = interval;
                } else next.automatic = choice === "Enable automatic naming";
                try {
                    saveConfig(next); config = next;
                    // Configuration never grants or returns chances; only disabling stops an automatic request.
                    if (!config.automatic) cancel();
                    notify(ctx, "Session-name configuration saved.", "info");
                } catch { notify(ctx, "Could not save session-name configuration; nothing changed.", "error"); }
                return;
            }
            if (args.trim()) { notify(ctx, "Usage: /session-name [config]", "warning"); return; }
            cancel();
            const token = ++manualGeneration;
            manualPending = token;
            try {
                await ctx.waitForIdle();
                if (active && manualGeneration === token && ctx.sessionManager.getSessionId() === sessionId) await evaluate(ctx, true);
            } finally {
                if (manualPending === token) manualPending = undefined;
            }
        },
    });
}
