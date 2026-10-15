import type { ExtensionAPI, ExtensionContext, SessionEntry } from "@earendil-works/pi-coding-agent";
import { branchIdentity, fingerprint, prepareConversation } from "../shared/context.ts";
import { failureDetail } from "../shared/errors.ts";
import { generateText, RequestCancelled } from "../shared/request.ts";
import { DEFAULTS, loadConfig, saveConfig, type NameConfig } from "./config.ts";
import { readTitle, TITLE_PROMPT } from "./title.ts";

const STATE_TYPE = "preset.session-name.v1";
interface Progress { version: 1; count: number; evaluated: number; retryAt: number; observedIds: string[] }
interface Ownership { version: 1; titleEntryId: string | null; title: string | null; owned: boolean }
interface Stored { progress?: Progress; ownership?: Ownership }
interface Candidate { text: string; eligible: boolean; after: Set<string> }

function textOf(content: string | readonly { type: string; text?: string }[]): string {
    return typeof content === "string" ? content : content.filter(part => part.type === "text").map(part => part.text ?? "").join("\n");
}
function latestTitle(ctx: ExtensionContext): { id: string | null; name: string | null } {
    const title = ctx.sessionManager.getEntries().findLast(entry => entry.type === "session_info");
    return { id: title?.id ?? null, name: ctx.sessionManager.getSessionName() ?? null };
}
function stored(entry: SessionEntry): Stored | undefined {
    if (entry.type !== "custom" || entry.customType !== STATE_TYPE || !entry.data || typeof entry.data !== "object") return undefined;
    return entry.data as Stored;
}
function validProgress(value: Progress | undefined): value is Progress {
    return value?.version === 1 && Number.isSafeInteger(value.count) && value.count >= 0 &&
        Number.isSafeInteger(value.evaluated) && value.evaluated >= 0 && value.evaluated <= value.count &&
        Number.isSafeInteger(value.retryAt) && value.retryAt >= 0 && Array.isArray(value.observedIds) &&
        value.observedIds.every(id => typeof id === "string");
}

export default function registerSessionName(pi: ExtensionAPI): void {
    let active = false;
    let config: NameConfig = { ...DEFAULTS };
    let configWarning = false;
    let epoch = 0;
    let controller: AbortController | undefined;
    let progress: Progress = { version: 1, count: 0, evaluated: 0, retryAt: 0, observedIds: [] };
    let ownership: Ownership = { version: 1, titleEntryId: null, title: null, owned: false };
    let candidates: Candidate[] = [];
    let sessionId: string | undefined;
    let writingTitle = false;
    let manualGeneration = 0;
    let manualPending: number | undefined;

    const cancel = () => { epoch++; controller?.abort(); controller = undefined; };
    const persist = () => pi.appendEntry<Stored>(STATE_TYPE, { progress: { ...progress, observedIds: [...progress.observedIds] }, ownership: { ...ownership } });
    const notify = (ctx: ExtensionContext, text: string, severity: "info" | "warning" | "error") => {
        if (active && ctx.sessionManager.getSessionId() === sessionId) ctx.ui.notify(text, severity);
    };
    function restore(ctx: ExtensionContext): void {
        cancel();
        manualGeneration++;
        manualPending = undefined;
        active = true;
        sessionId = ctx.sessionManager.getSessionId();
        candidates = [];
        const state = ctx.sessionManager.getBranch().map(stored).findLast(value => validProgress(value?.progress));
        progress = state?.progress ? { ...state.progress, observedIds: [...state.progress.observedIds] } :
            { version: 1, count: 0, evaluated: 0, retryAt: 0, observedIds: [] };
        const own = ctx.sessionManager.getEntries().map(stored).findLast(value => value?.ownership?.version === 1)?.ownership;
        const title = latestTitle(ctx);
        ownership = own && own.titleEntryId === title.id && own.title === title.name ? { ...own } :
            { version: 1, titleEntryId: title.id, title: title.name, owned: false };
        try { config = loadConfig(); configWarning = false; } catch { config = { ...DEFAULTS }; configWarning = true; }
        if (configWarning) notify(ctx, "Could not load session-name configuration; using defaults. Fix session-name.json before saving changes.", "warning");
    }
    function checkOwnership(ctx: ExtensionContext): void {
        const title = latestTitle(ctx);
        if (title.id !== ownership.titleEntryId || title.name !== ownership.title) {
            cancel();
            ownership = { version: 1, titleEntryId: title.id, title: title.name, owned: false };
            persist();
        }
    }
    function collectDelivered(ctx: ExtensionContext): void {
        const branch = ctx.sessionManager.getBranch();
        const observed = new Set(progress.observedIds);
        const delivered = branch.filter(entry => entry.type === "message" && entry.message.role === "user" && !observed.has(entry.id));
        for (const entry of delivered) {
            if (entry.type !== "message" || entry.message.role !== "user") continue;
            const text = textOf(entry.message.content);
            const matches = candidates.filter(candidate => !candidate.after.has(entry.id) && candidate.text === text);
            // Unknown provenance, duplicate candidates and transformed text are deliberately not guessed.
            if (matches.length !== 1 || !matches[0].eligible) continue;
            const matchingMessages = delivered.filter(other => other.type === "message" && other.message.role === "user" &&
                !matches[0].after.has(other.id) && textOf(other.message.content) === text);
            if (matchingMessages.length !== 1) continue;
            progress.count++;
            observed.add(entry.id);
        }
        progress.observedIds = [...observed];
        candidates = [];
    }
    async function evaluate(ctx: ExtensionContext, manual: boolean): Promise<void> {
        if (!active || ctx.sessionManager.getSessionId() !== sessionId) return;
        checkOwnership(ctx);
        if (!manual && (!config.automatic || (ownership.title !== null && !ownership.owned))) return;
        cancel();
        const requestEpoch = epoch;
        const requestController = new AbortController();
        controller = requestController;
        const expectedTitle = latestTitle(ctx);
        const expectedBranch = branchIdentity(ctx.sessionManager);
        const conversation = prepareConversation(ctx.sessionManager);
        const expectedContext = fingerprint(conversation);
        const count = progress.count;
        const model = ctx.model;
        const thinking = pi.getThinkingLevel();
        const valid = () => active && epoch === requestEpoch && !requestController.signal.aborted &&
            ctx.sessionManager.getSessionId() === sessionId && branchIdentity(ctx.sessionManager) === expectedBranch &&
            fingerprint(prepareConversation(ctx.sessionManager)) === expectedContext &&
            latestTitle(ctx).id === expectedTitle.id && latestTitle(ctx).name === expectedTitle.name;
        try {
            if (!model) throw new Error("No model selected");
            if (!conversation.length) throw new Error("No conversation available");
            const response = await generateText({ registry: ctx.modelRegistry, model, thinking,
                sessionId: ctx.sessionManager.getSessionId(), systemPrompt: TITLE_PROMPT,
                data: { currentTitle: expectedTitle.name, conversation }, signal: requestController.signal });
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
                ownership = { version: 1, titleEntryId: written.id, title: written.name, owned: false };
                persist();
                return;
            }
            ownership = { version: 1, titleEntryId: written.id, title, owned: true };
            progress.evaluated = count;
            progress.retryAt = 0;
            persist();
            if (manual) notify(ctx, `Session name: ${title}`, "info");
        } catch (error) {
            if (error instanceof RequestCancelled || !valid()) return;
            progress.retryAt = count + config.interval;
            persist();
            const detail = failureDetail(error);
            notify(ctx, manual ? `Session name refresh failed: ${detail}; previous title kept.` :
                `Automatic session naming failed: ${detail}; previous title kept. Will retry after ${config.interval} more user inputs.`, "error");
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
        collectDelivered(ctx);
        persist();
        const due = progress.retryAt > 0 ? progress.count >= progress.retryAt :
            ownership.title === null ? progress.count > 0 : progress.count - progress.evaluated >= config.interval;
        // Do not hold the notification-only settled dispatch while waiting on a provider.
        if (!event.aborted && due && manualPending === undefined) void evaluate(ctx, false).catch(() => {});
    });
    pi.registerCommand("session-name", {
        description: "Refresh the session title, or configure automatic naming",
        getArgumentCompletions: prefix => "config".startsWith(prefix) ? [{ value: "config", label: "config" }] : null,
        handler: async (args, ctx) => {
            if (!active) restore(ctx);
            if (args.trim() === "config") {
                if (!ctx.hasUI) { notify(ctx, "Session-name configuration requires an interactive UI.", "warning"); return; }
                const choice = await ctx.ui.select(`Session naming (automatic ${config.automatic ? "on" : "off"}, N=${config.interval})`,
                    ["Enable automatic naming", "Disable automatic naming", "Set interval"]);
                if (!choice || !active) return;
                let next = { ...config };
                if (choice === "Set interval") {
                    const raw = await ctx.ui.input("User inputs between evaluations (1–10000)", String(config.interval));
                    if (raw === undefined || !active) return;
                    const interval = Number(raw);
                    if (!raw.trim() || !Number.isSafeInteger(interval) || interval < 1 || interval > 10_000) {
                        notify(ctx, "Interval must be an integer between 1 and 10000.", "error"); return;
                    }
                    next.interval = interval;
                } else next.automatic = choice === "Enable automatic naming";
                try {
                    saveConfig(next); config = next; cancel();
                    if (progress.retryAt) progress.retryAt = progress.count + config.interval;
                    persist();
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
